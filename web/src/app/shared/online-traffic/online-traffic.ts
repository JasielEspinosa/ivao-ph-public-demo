import { CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, input } from '@angular/core';

import {
  ATC_COLUMNS,
  AtcColumn,
  OnlineAtc,
  OnlinePilot,
  OnlineTrafficService,
  PILOT_COLUMNS,
  PilotColumn,
  SortState,
} from '../../services/online-traffic.service';

/** Altitudes from here up are shown as flight levels. */
const TRANSITION_ALTITUDE_FT = 18000;

/**
 * The "Online Pilots" and "Online Air Traffic Controllers" sections. Home and Pilot's Lounge show both; ATC Lounge
 * shows the controllers only. The data comes from the shared OnlineTrafficService, so the pages always show the same
 * lists.
 */
@Component({
  selector: 'app-online-traffic',
  standalone: true,
  imports: [CommonModule, DatePipe],
  templateUrl: './online-traffic.html',
  styles: ':host { display: block; }',
})
export class OnlineTrafficComponent {
  private readonly traffic = inject(OnlineTrafficService);

  /** False leaves out the "Online Pilots" section. */
  readonly showPilots = input(true);

  /** IVAO Webeye, the live map the "Track" icons open in a new tab. */
  readonly webeyeUrl = 'https://webeye.ivao.aero/';

  readonly pilots = this.traffic.pilots;
  readonly pilotsLoaded = this.traffic.pilotsLoaded;
  readonly pilotsError = this.traffic.pilotsError;
  readonly pilotsUpdatedAt = this.traffic.pilotsUpdatedAt;
  readonly sortedPilots = this.traffic.sortedPilots;
  readonly pilotSort = this.traffic.pilotSort;
  readonly pilotColumns = PILOT_COLUMNS;

  readonly atcGroups = this.traffic.atcGroups;
  readonly atcLoaded = this.traffic.atcLoaded;
  readonly atcError = this.traffic.atcError;
  readonly atcUpdatedAt = this.traffic.atcUpdatedAt;
  readonly sortedAtcGroups = this.traffic.sortedAtcGroups;
  readonly atcSort = this.traffic.atcSort;
  readonly atcColumns = ATC_COLUMNS;

  constructor() {
    const release = this.traffic.acquire();
    inject(DestroyRef).onDestroy(release);
  }

  toggleSortPilots(column: PilotColumn): void {
    this.traffic.toggleSortPilots(column);
  }

  toggleSortAtc(column: AtcColumn): void {
    this.traffic.toggleSortAtc(column);
  }

  /** "↑" or "↓" on the sorted column, nothing on the others. */
  sortIndicator(sort: SortState<string> | null, column: string): string {
    return sort?.column === column ? (sort.direction === 'asc' ? '↑' : '↓') : '';
  }

  /** The aria-sort value of a column header. */
  ariaSort(sort: SortState<string> | null, column: string): 'ascending' | 'descending' | 'none' {
    return sort?.column === column ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  }

  /** Webeye link that centres the map on one pilot callsign. */
  webeyeTrackUrl(callsign: string): string {
    return `${this.webeyeUrl}?callsign=${encodeURIComponent(callsign)}`;
  }

  /** Webeye link that focuses one controller, by IVAO session id (falls back to the plain map). */
  webeyeAtcUrl(atc: OnlineAtc): string {
    return atc.sessionId === null ? this.webeyeUrl : `${this.webeyeUrl}?atcId=${atc.sessionId}`;
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

  /** "1h 05m" for the time a controller has been online. */
  formatOnlineTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
  }
}
