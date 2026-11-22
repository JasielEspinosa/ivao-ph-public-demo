import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

import { environment } from '../../environments/environment';
import { getAuthHeader } from '../app';
import { buildSubmitErrorMessage } from '../shared/submit-error-utils';

/** One online pilot flying to or from the Philippines, as returned by GET /api/pilots/online. */
export interface OnlinePilot {
  /** IVAO VID; shown when no name is known. */
  readonly vid: string;
  /** The member's name, or null when the pilot is not a member of this site. */
  readonly name: string | null;
  readonly callsign: string;
  readonly aircraft: string;
  readonly departure: string;
  readonly arrival: string;
  /** Feet, or null when none is published. */
  readonly altitudeFt: number | null;
  readonly onGround: boolean;
  /** The airport the pilot stands at while on the ground, or null in the air / at neither airport. */
  readonly groundAirport: string | null;
}

interface OnlinePilotsResponse {
  readonly updatedAt: string;
  readonly pilots: readonly OnlinePilot[];
}

/** One online controller, as returned by GET /api/atc/online. */
export interface OnlineAtc {
  /** IVAO session id for the Webeye link, or null when none is published. */
  readonly sessionId: number | null;
  /** IVAO VID; shown when no name is known. */
  readonly vid: string;
  /** The member's name, or null when the controller is not a member of this site. */
  readonly name: string | null;
  readonly callsign: string;
  readonly position: string;
  /** MHz, or null when none is published. */
  readonly frequency: number | null;
  readonly rating: string;
  readonly onlineSeconds: number;
}

/** The online controllers of one country (or group of neighbouring countries). */
export interface OnlineAtcGroup {
  readonly country: string;
  readonly controllers: readonly OnlineAtc[];
}

interface OnlineAtcResponse {
  readonly updatedAt: string;
  readonly groups: readonly OnlineAtcGroup[];
}

export type SortDirection = 'asc' | 'desc';

/** The column an online table is sorted by; null keeps the order the server sends. */
export interface SortState<K extends string> {
  readonly column: K;
  readonly direction: SortDirection;
}

export type PilotColumn = 'callsign' | 'name' | 'aircraft' | 'departure' | 'arrival' | 'altitude';
export type AtcColumn = 'callsign' | 'name' | 'position' | 'frequency' | 'rating' | 'online';

export interface SortableColumn<K extends string> {
  readonly key: K;
  readonly label: string;
}

export const PILOT_COLUMNS: readonly SortableColumn<PilotColumn>[] = [
  { key: 'callsign', label: 'Callsign' },
  { key: 'name', label: 'Name/VID' },
  { key: 'aircraft', label: 'Aircraft' },
  { key: 'departure', label: 'From' },
  { key: 'arrival', label: 'To' },
  { key: 'altitude', label: 'Altitude' },
];

export const ATC_COLUMNS: readonly SortableColumn<AtcColumn>[] = [
  { key: 'callsign', label: 'Callsign' },
  { key: 'name', label: 'Name/VID' },
  { key: 'position', label: 'Position' },
  { key: 'frequency', label: 'Frequency' },
  { key: 'rating', label: 'Rating' },
  { key: 'online', label: 'Online' },
];

/** Controller ratings from the lowest to the highest, so the Rating column sorts by rank and not alphabetically. */
const RATING_RANK: readonly string[] = ['OBS', 'AS1', 'AS2', 'AS3', 'ADC', 'APC', 'ACC', 'SEC', 'SAI', 'CAI', 'STAFF'];

/** Text or number to sort by; null (or an empty text) means "no value" and always lands at the bottom. */
type SortValue = string | number | null;

/** Sorts a copy of the rows by one column; rows without a value stay at the bottom in both directions. */
function sortRows<T>(rows: readonly T[], valueOf: (row: T) => SortValue, direction: SortDirection): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);
    const leftEmpty = left === null || left === '';
    const rightEmpty = right === null || right === '';
    if (leftEmpty || rightEmpty) {
      return leftEmpty === rightEmpty ? 0 : leftEmpty ? 1 : -1;
    }
    if (typeof left === 'number' && typeof right === 'number') {
      return sign * (left - right);
    }
    return sign * String(left).localeCompare(String(right), 'en', { numeric: true, sensitivity: 'base' });
  });
}

/** Click order of a header: ascending, then descending, then back to the default order. */
function nextSort<K extends string>(current: SortState<K> | null, column: K): SortState<K> | null {
  if (current?.column !== column) {
    return { column, direction: 'asc' };
  }
  return current.direction === 'asc' ? { column, direction: 'desc' } : null;
}

function pilotValue(pilot: OnlinePilot, column: PilotColumn): SortValue {
  switch (column) {
    case 'callsign':
      return pilot.callsign;
    case 'name':
      return pilot.name || pilot.vid;
    case 'aircraft':
      return pilot.aircraft;
    case 'departure':
      return pilot.departure;
    case 'arrival':
      return pilot.arrival;
    case 'altitude':
      // Parked or taxiing aircraft count as the lowest.
      return pilot.onGround ? -1 : pilot.altitudeFt;
  }
}

function atcValue(atc: OnlineAtc, column: AtcColumn): SortValue {
  switch (column) {
    case 'callsign':
      return atc.callsign;
    case 'name':
      return atc.name || atc.vid;
    case 'position':
      return atc.position;
    case 'frequency':
      return atc.frequency;
    case 'rating': {
      const rank = RATING_RANK.indexOf(atc.rating);
      return rank === -1 ? null : rank;
    }
    case 'online':
      return atc.onlineSeconds;
  }
}

const API_URL = environment.apiUrl.replace(/\/$/, '');
const ATC_API = `${API_URL}/atc`;
const PILOTS_API = `${API_URL}/pilots`;
const ONLINE_REFRESH_MS = 60 * 1000;
/** The longest the first load of the online pilots and controllers waits for the browser to be idle. */
const ONLINE_LOAD_DELAY_MS = 1500;
const ATC_UNAVAILABLE_MESSAGE =
  'The online controllers are not available right now. Please try again in a few moments.';
const PILOTS_UNAVAILABLE_MESSAGE = 'The online pilots are not available right now. Please try again in a few moments.';

/**
 * The online pilots and controllers, shared by every page that shows them (Home and Pilot's Lounge), so the list
 * loaded on one page is the list on the other and is not fetched twice. The minute refresh runs only while at least
 * one page shows the lists (see `acquire`).
 */
@Injectable({ providedIn: 'root' })
export class OnlineTrafficService {
  private readonly http = inject(HttpClient);

  /** Pilots whose flight plan departs from or arrives in the Philippines. */
  readonly pilots = signal<readonly OnlinePilot[]>([]);
  readonly pilotsLoaded = signal(false);
  readonly pilotsError = signal('');
  readonly pilotsUpdatedAt = signal<Date | null>(null);

  /** Controllers online in the Philippines and the neighbouring areas. */
  readonly atcGroups = signal<readonly OnlineAtcGroup[]>([]);
  readonly atcLoaded = signal(false);
  readonly atcError = signal('');
  readonly atcUpdatedAt = signal<Date | null>(null);

  /** The pilots start sorted by callsign, A to Z. */
  readonly pilotSort = signal<SortState<PilotColumn> | null>({ column: 'callsign', direction: 'asc' });
  readonly atcSort = signal<SortState<AtcColumn> | null>(null);

  /** The pilots in the order picked by the headers; the sort survives the minute refresh. */
  readonly sortedPilots = computed(() => {
    const sort = this.pilotSort();
    return sort ? sortRows(this.pilots(), (pilot) => pilotValue(pilot, sort.column), sort.direction) : this.pilots();
  });

  /** The controllers of each country in the order picked by the headers (the default order is the server's). */
  readonly sortedAtcGroups = computed(() => {
    const sort = this.atcSort();
    if (!sort) {
      return this.atcGroups();
    }
    return this.atcGroups().map((group) => ({
      country: group.country,
      controllers: sortRows(group.controllers, (atc) => atcValue(atc, sort.column), sort.direction),
    }));
  });

  private viewers = 0;
  private refresh: ReturnType<typeof setInterval> | undefined;
  private cancelDeferred: (() => void) | undefined;
  private lastLoadAt = 0;

  toggleSortPilots(column: PilotColumn): void {
    this.pilotSort.update((current) => nextSort(current, column));
  }

  toggleSortAtc(column: AtcColumn): void {
    this.atcSort.update((current) => nextSort(current, column));
  }

  /**
   * A page that shows the lists calls this when it opens and the returned function when it closes. The first viewer
   * starts the refresh; data already loaded by another page is shown at once and only reloaded when it is stale.
   */
  acquire(): () => void {
    this.viewers++;
    if (this.viewers === 1) {
      this.start();
    }

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.viewers--;
      if (this.viewers === 0) {
        this.stop();
      }
    };
  }

  private start(): void {
    const startRefresh = () => {
      this.cancelDeferred = undefined;
      if (Date.now() - this.lastLoadAt >= ONLINE_REFRESH_MS) {
        this.loadOnlineTraffic();
      }
      this.refresh = setInterval(() => this.loadOnlineTraffic(), ONLINE_REFRESH_MS);
    };

    if (this.lastLoadAt > 0) {
      startRefresh();
      return;
    }
    // The lists are not needed to show the page, so the very first request waits until the page has finished
    // loading and the browser is idle; the periodic refresh only starts after that first load.
    this.cancelDeferred = OnlineTrafficService.runWhenIdle(startRefresh);
  }

  private stop(): void {
    this.cancelDeferred?.();
    this.cancelDeferred = undefined;
    if (this.refresh !== undefined) {
      clearInterval(this.refresh);
      this.refresh = undefined;
    }
  }

  /** Runs the callback once the window has loaded and the browser is idle (or after a short delay). Returns a canceller. */
  private static runWhenIdle(callback: () => void): () => void {
    let idleHandle: number | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const onLoad = () => {
      if (typeof window.requestIdleCallback === 'function') {
        idleHandle = window.requestIdleCallback(callback, { timeout: ONLINE_LOAD_DELAY_MS });
      } else {
        timeoutHandle = setTimeout(callback, ONLINE_LOAD_DELAY_MS);
      }
    };

    if (document.readyState === 'complete') {
      onLoad();
    } else {
      window.addEventListener('load', onLoad, { once: true });
    }

    return () => {
      window.removeEventListener('load', onLoad);
      if (idleHandle !== undefined) {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    };
  }

  private loadOnlineTraffic(): void {
    this.lastLoadAt = Date.now();
    this.loadOnlinePilots();
    this.loadOnlineAtc();
  }

  /** Loads the online pilots. On a failed refresh the last list stays on screen next to the message. */
  private loadOnlinePilots(): void {
    this.http
      .get<OnlinePilotsResponse>(`${PILOTS_API}/online`, {
        headers: new HttpHeaders({ Authorization: getAuthHeader() }),
      })
      .subscribe({
        next: (response) => {
          this.pilots.set(response.pilots);
          this.pilotsUpdatedAt.set(new Date(response.updatedAt));
          this.pilotsError.set('');
          this.pilotsLoaded.set(true);
        },
        error: (error: HttpErrorResponse) => {
          this.pilotsError.set(
            error.status === 503
              ? PILOTS_UNAVAILABLE_MESSAGE
              : buildSubmitErrorMessage(error, { fallbackMessage: PILOTS_UNAVAILABLE_MESSAGE }),
          );
          this.pilotsLoaded.set(true);
        },
      });
  }

  /** Loads the online controllers. On a failed refresh the last list stays on screen next to the message. */
  private loadOnlineAtc(): void {
    this.http
      .get<OnlineAtcResponse>(`${ATC_API}/online`, { headers: new HttpHeaders({ Authorization: getAuthHeader() }) })
      .subscribe({
        next: (response) => {
          this.atcGroups.set(response.groups);
          this.atcUpdatedAt.set(new Date(response.updatedAt));
          this.atcError.set('');
          this.atcLoaded.set(true);
        },
        error: (error: HttpErrorResponse) => {
          this.atcError.set(
            error.status === 503
              ? ATC_UNAVAILABLE_MESSAGE
              : buildSubmitErrorMessage(error, { fallbackMessage: ATC_UNAVAILABLE_MESSAGE }),
          );
          this.atcLoaded.set(true);
        },
      });
  }
}
