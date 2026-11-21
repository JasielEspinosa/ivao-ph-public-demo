import { CommonModule, DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Component, DestroyRef, WritableSignal, computed, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { environment } from '../../../environments/environment';
import { getAuthHeader } from '../../app';
import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import { buildSubmitErrorMessage } from '../../shared/submit-error-utils';
import { PHILIPPINE_AIRPORTS } from './philippine-airports';

/** A sample "Upcoming Event" card. Dummy content until the events calendar exists. */
interface UpcomingEvent {
  readonly title: string;
  /** Day of the event (UTC); always in the future because it is computed from today. */
  readonly date: Date;
  readonly time: string;
  /** The same time range in Philippine Time, "hh:mm AM - hh:mm PM". */
  readonly timePht: string;
  readonly summary: string;
  readonly image: string;
  readonly imageAlt: string;
}

/** One online pilot flying to or from the Philippines, as returned by GET /api/pilots/online. */
interface OnlinePilot {
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
interface OnlineAtc {
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
interface OnlineAtcGroup {
  readonly country: string;
  readonly controllers: readonly OnlineAtc[];
}

interface OnlineAtcResponse {
  readonly updatedAt: string;
  readonly groups: readonly OnlineAtcGroup[];
}

/** A report from the closest airport that publishes one, shown when the airport asked for has none. */
interface NearbyReport {
  readonly icao: string;
  readonly name: string;
  readonly distanceKm: number;
  /** Compass direction from the airport asked for, e.g. "NE". */
  readonly direction: string;
  readonly report: string;
}

/** The latest METAR or TAF of one airport, as returned by GET /api/weather/:icao/metar and /taf. */
interface AirportReport {
  readonly icao: string;
  /** Null when the airport publishes none. */
  readonly report: string | null;
  readonly nearest: NearbyReport | null;
}

/** The model forecast of one airport, as returned by GET /api/weather/:icao/model. */
interface AirportModelForecast {
  readonly icao: string;
  readonly forecast: ModelForecast | null;
}

/** One NOTAM, as returned by GET /api/weather/:icao/notam. Times are UTC ISO 8601. */
interface Notam {
  readonly number: string;
  /** N = new, R = replacement, C = cancellation. */
  readonly type: string;
  readonly status: 'active' | 'upcoming';
  readonly from: string;
  /** Null when no end time is published. */
  readonly to: string | null;
  /** "EST" (estimated end) or "PERM" (permanent), when marked so. */
  readonly estPerm: string | null;
  readonly text: string;
  readonly qCode: string | null;
}

/** The NOTAMs of one airport, as returned by GET /api/weather/:icao/notam. */
interface AirportNotams {
  readonly icao: string;
  readonly notams: readonly Notam[];
}

/** One weather card: it shows its own loading or error state while the others may already be showing data. */
interface WeatherCard<T> {
  readonly status: 'loading' | 'loaded' | 'error';
  readonly data: T | null;
  readonly error: string;
}

const loadingCard = <T>(): WeatherCard<T> => ({ status: 'loading', data: null, error: '' });

/** One hourly step of the ECMWF model forecast (UTC). A value is null when the model gives none. */
interface ModelForecastHour {
  readonly time: string;
  readonly tempC: number | null;
  readonly dewpointC: number | null;
  readonly qnhHpa: number | null;
  readonly windDirection: number | null;
  readonly windKt: number | null;
  readonly gustKt: number | null;
  readonly cloudCoverPct: number | null;
  readonly precipMm: number | null;
}

/** ECMWF model data for the airport's position. Model values, not an official forecast. */
interface ModelForecast {
  readonly model: string;
  readonly hours: readonly ModelForecastHour[];
}

type SortDirection = 'asc' | 'desc';

/** The column an online table is sorted by; null keeps the order the server sends. */
interface SortState<K extends string> {
  readonly column: K;
  readonly direction: SortDirection;
}

type PilotColumn = 'callsign' | 'name' | 'aircraft' | 'departure' | 'arrival' | 'altitude';
type AtcColumn = 'callsign' | 'name' | 'position' | 'frequency' | 'rating' | 'online';

interface SortableColumn<K extends string> {
  readonly key: K;
  readonly label: string;
}

const PILOT_COLUMNS: readonly SortableColumn<PilotColumn>[] = [
  { key: 'callsign', label: 'Callsign' },
  { key: 'name', label: 'Name/VID' },
  { key: 'aircraft', label: 'Aircraft' },
  { key: 'departure', label: 'From' },
  { key: 'arrival', label: 'To' },
  { key: 'altitude', label: 'Altitude' },
];

const ATC_COLUMNS: readonly SortableColumn<AtcColumn>[] = [
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

const DAY_MS = 24 * 60 * 60 * 1000;
const WEATHER_API = `${environment.apiUrl.replace(/\/$/, '')}/weather`;
const ATC_API = `${environment.apiUrl.replace(/\/$/, '')}/atc`;
const PILOTS_API = `${environment.apiUrl.replace(/\/$/, '')}/pilots`;
const ONLINE_REFRESH_MS = 60 * 1000;
/** The longest the first load of the online pilots and controllers waits for the browser to be idle. */
const ONLINE_LOAD_DELAY_MS = 1500;
const ATC_UNAVAILABLE_MESSAGE =
  'The online controllers are not available right now. Please try again in a few moments.';
const PILOTS_UNAVAILABLE_MESSAGE = 'The online pilots are not available right now. Please try again in a few moments.';
/** Altitudes from here up are shown as flight levels. */
const TRANSITION_ALTITUDE_FT = 18000;
const ICAO_PATTERN = /^[A-Z]{4}$/;
const WEATHER_UNAVAILABLE_MESSAGE = 'The weather is not available right now. Please try again in a few moments.';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, DatePipe, PlaceholderBannerComponent],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class HomeComponent {
  private readonly title = inject(Title);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  /** Pilots whose flight plan departs from or arrives in the Philippines, refreshed every minute. */
  /** IVAO Webeye, the live map the "Track" icons open in a new tab. */
  readonly webeyeUrl = 'https://webeye.ivao.aero/';

  /** Webeye link that centres the map on one pilot callsign. */
  webeyeTrackUrl(callsign: string): string {
    return `${this.webeyeUrl}?callsign=${encodeURIComponent(callsign)}`;
  }

  /** Webeye link that focuses one controller, by IVAO session id (falls back to the plain map). */
  webeyeAtcUrl(atc: OnlineAtc): string {
    return atc.sessionId === null ? this.webeyeUrl : `${this.webeyeUrl}?atcId=${atc.sessionId}`;
  }

  readonly pilots = signal<readonly OnlinePilot[]>([]);
  readonly pilotsLoaded = signal(false);
  readonly pilotsError = signal('');
  readonly pilotsUpdatedAt = signal<Date | null>(null);

  /** Controllers online in the Philippines and the neighbouring areas, refreshed every minute. */
  readonly atcGroups = signal<readonly OnlineAtcGroup[]>([]);
  readonly atcLoaded = signal(false);
  readonly atcError = signal('');
  readonly atcUpdatedAt = signal<Date | null>(null);

  /** Clickable column headers of the two online tables. */
  readonly pilotColumns = PILOT_COLUMNS;
  readonly atcColumns = ATC_COLUMNS;
  /** The pilots start sorted by callsign, A to Z. */
  readonly pilotSort = signal<SortState<PilotColumn> | null>({ column: 'callsign', direction: 'asc' });
  readonly atcSort = signal<SortState<AtcColumn> | null>(null);

  /** The pilots in the order picked by the headers; the sort survives the minute refresh. */
  readonly sortedPilots = computed(() => {
    const sort = this.pilotSort();
    return sort
      ? sortRows(this.pilots(), (pilot) => HomeComponent.pilotValue(pilot, sort.column), sort.direction)
      : this.pilots();
  });

  /** The controllers of each country in the order picked by the headers (the default order is the server's). */
  readonly sortedAtcGroups = computed(() => {
    const sort = this.atcSort();
    if (!sort) {
      return this.atcGroups();
    }
    return this.atcGroups().map((group) => ({
      country: group.country,
      controllers: sortRows(group.controllers, (atc) => HomeComponent.atcValue(atc, sort.column), sort.direction),
    }));
  });

  toggleSortPilots(column: PilotColumn): void {
    this.pilotSort.update((current) => nextSort(current, column));
  }

  toggleSortAtc(column: AtcColumn): void {
    this.atcSort.update((current) => nextSort(current, column));
  }

  /** "↑" or "↓" on the sorted column, nothing on the others. */
  sortIndicator(sort: SortState<string> | null, column: string): string {
    return sort?.column === column ? (sort.direction === 'asc' ? '↑' : '↓') : '';
  }

  /** The aria-sort value of a column header. */
  ariaSort(sort: SortState<string> | null, column: string): 'ascending' | 'descending' | 'none' {
    return sort?.column === column ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  }

  private static pilotValue(pilot: OnlinePilot, column: PilotColumn): SortValue {
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

  private static atcValue(atc: OnlineAtc, column: AtcColumn): SortValue {
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

  /** Suggestions for the weather lookup's ICAO field. */
  readonly airports = PHILIPPINE_AIRPORTS;

  /** The weather lookup starts empty: no code typed, nothing loaded, no message. */
  readonly weatherIcao = signal('');
  readonly weatherError = signal('');
  /** The airport the cards below belong to; empty until a lookup starts. */
  readonly weatherShownIcao = signal('');
  readonly metarCard = signal<WeatherCard<AirportReport>>(loadingCard());
  readonly tafCard = signal<WeatherCard<AirportReport>>(loadingCard());
  readonly modelCard = signal<WeatherCard<AirportModelForecast>>(loadingCard());
  readonly notamCard = signal<WeatherCard<AirportNotams>>(loadingCard());
  /** The NOTAMs already in force and the ones that start later, shown as two separate lists. */
  readonly activeNotams = computed(() => this.notamCard().data?.notams.filter((n) => n.status === 'active') ?? []);
  readonly upcomingNotams = computed(() => this.notamCard().data?.notams.filter((n) => n.status === 'upcoming') ?? []);
  /** True while any of the cards is still loading (the button stays disabled). */
  readonly weatherLoading = computed(
    () =>
      this.weatherShownIcao() !== '' &&
      [this.metarCard(), this.tafCard(), this.modelCard(), this.notamCard()].some((card) => card.status === 'loading'),
  );

  readonly events: readonly UpcomingEvent[] = HomeComponent.buildEvents();

  constructor() {
    this.title.setTitle('IVAO Philippines');

    // The online lists are not needed to show the page, so the first request waits until the page has finished
    // loading and the browser is idle; the periodic refresh only starts after that first load.
    let refresh: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    const cancelDeferred = HomeComponent.runWhenIdle(() => {
      if (cancelled) {
        return;
      }
      this.loadOnlineTraffic();
      refresh = setInterval(() => this.loadOnlineTraffic(), ONLINE_REFRESH_MS);
    });
    this.destroyRef.onDestroy(() => {
      cancelled = true;
      cancelDeferred();
      if (refresh !== undefined) {
        clearInterval(refresh);
      }
    });
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

  /** "FL340" from the transition altitude up, "2,500 ft" below it and "On ground" while parked or taxiing. */
  formatAltitude(pilot: OnlinePilot): string {
    if (pilot.onGround) {
      return pilot.groundAirport ? `On ground at ${pilot.groundAirport}` : 'On ground';
    }
    if (pilot.altitudeFt === null) {
      return '-';
    }
    if (pilot.altitudeFt >= TRANSITION_ALTITUDE_FT) {
      return `FL${String(Math.round(pilot.altitudeFt / 100)).padStart(3, '0')}`;
    }
    return `${Math.max(0, pilot.altitudeFt).toLocaleString('en-US')} ft`;
  }

  /** How long a NOTAM applies: "5 h" up to 48 hours, then whole days ("14 days"). A 23:59 end counts as the full day. */
  formatNotamDuration(notam: Notam): string {
    if (!notam.to) {
      return '';
    }
    const hours = Math.round((Date.parse(notam.to) - Date.parse(notam.from)) / (60 * 60 * 1000));
    if (hours <= 48) {
      return `${Math.max(hours, 1)} h`;
    }
    const days = Math.round(hours / 24);
    return `${days} days`;
  }

  /** "1h 05m" for the time a controller has been online. */
  formatOnlineTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
  }

  private loadOnlineTraffic(): void {
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

  /** Keeps the field to letters (ICAO codes have no digits or spaces), in capitals, at most 4 of them. */
  onWeatherIcaoInput(input: HTMLInputElement): void {
    const icao = input.value
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 4);
    input.value = icao;
    this.weatherIcao.set(icao);
  }

  /** Loads the METAR, TAF, model forecast and NOTAMs of the typed airport; each card appears as soon as its data does. */
  fetchWeather(): void {
    const icao = this.weatherIcao();
    this.weatherShownIcao.set('');

    if (!ICAO_PATTERN.test(icao)) {
      this.weatherError.set('Enter a 4-letter airport ICAO code, for example RPLL.');
      return;
    }

    this.weatherError.set('');
    this.metarCard.set(loadingCard());
    this.tafCard.set(loadingCard());
    this.modelCard.set(loadingCard());
    this.notamCard.set(loadingCard());
    this.weatherShownIcao.set(icao);

    this.loadWeatherCard<AirportReport>(icao, 'metar', this.metarCard);
    this.loadWeatherCard<AirportReport>(icao, 'taf', this.tafCard);
    this.loadWeatherCard<AirportModelForecast>(icao, 'model', this.modelCard);
    this.loadWeatherCard<AirportNotams>(icao, 'notam', this.notamCard);
  }

  private loadWeatherCard<T>(
    icao: string,
    part: 'metar' | 'taf' | 'model' | 'notam',
    card: WritableSignal<WeatherCard<T>>,
  ): void {
    this.http
      .get<T>(`${WEATHER_API}/${icao}/${part}`, { headers: new HttpHeaders({ Authorization: getAuthHeader() }) })
      .subscribe({
        next: (data) => {
          // A newer lookup for another airport may have started meanwhile; its cards must not be overwritten.
          if (this.weatherShownIcao() === icao) {
            card.set({ status: 'loaded', data, error: '' });
          }
        },
        error: (error: HttpErrorResponse) => {
          if (this.weatherShownIcao() === icao) {
            card.set({
              status: 'error',
              data: null,
              error:
                error.status === 503
                  ? WEATHER_UNAVAILABLE_MESSAGE
                  : buildSubmitErrorMessage(error, { fallbackMessage: WEATHER_UNAVAILABLE_MESSAGE }),
            });
          }
        },
      });
  }

  /** Smoothly scrolls to a section of the page (instantly for people who prefer reduced motion). */
  scrollToSection(event: Event, sectionId: string): void {
    event.preventDefault();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(sectionId)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  /** The event links go nowhere yet. */
  noEventPageYet(event: Event): void {
    event.preventDefault();
  }

  /** Three sample events 2, 4 and about 6 weeks from today, so they are never in the past. */
  private static buildEvents(): UpcomingEvent[] {
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const inDays = (days: number) => new Date(todayUtc + days * DAY_MS);

    /** "1200Z - 1600Z" -> "08:00 PM - 12:00 AM" (PHT is UTC+8, no daylight saving). */
    const toPht = (zuluRange: string): string =>
      zuluRange
        .split('-')
        .map((part) => {
          const digits = part.replace(/\D/g, '');
          const minutesOfDay = (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)) + 8 * 60) % (24 * 60);
          const hours24 = Math.floor(minutesOfDay / 60);
          const hours12 = hours24 % 12 || 12;
          const minutes = String(minutesOfDay % 60).padStart(2, '0');
          return `${String(hours12).padStart(2, '0')}:${minutes} ${hours24 < 12 ? 'AM' : 'PM'}`;
        })
        .join(' - ');

    const events: Omit<UpcomingEvent, 'timePht'>[] = [
      {
        title: 'Mabuhay IVAO PH Launch Fly-In',
        date: inDays(14),
        time: '1200Z - 1600Z',
        summary: 'Join us for the launch of IVAO Philippines. Fly into Manila and enjoy full ATC coverage.',
        image: 'images/home/event-launch.svg',
        imageAlt: 'An airliner crossing a sunrise over the sea',
      },
      {
        title: 'Friday Flyday: Manila ATC Night',
        date: inDays(28),
        time: '1300Z - 1700Z',
        summary: 'A weekly night of busy Manila airspace. Controllers and pilots welcome, all ratings.',
        image: 'images/home/event-atc-night.svg',
        imageAlt: 'A radar screen at night',
      },
      {
        title: '7,641 Islands Tour: Part 1',
        date: inDays(45),
        time: '0900Z - 1300Z',
        summary: 'A relaxed island-hopping tour across the Philippines with staff-led briefings.',
        image: 'images/home/event-islands-tour.svg',
        imageAlt: 'A route linking islands on a map',
      },
    ];

    return events.map((event) => ({ ...event, timePht: toPht(event.time) }));
  }
}
