import { Component, Input } from '@angular/core';

import { AirportDetail } from '../event-format';

/**
 * The name and place of the airports of an event ("RPLL - Ninoy Aquino International Airport · Manila (Pasay),
 * Philippines"), under the line that lists the codes. Only the airports that are valid ICAO codes are given, so it
 * shows nothing for an event without any. `limit` cuts a long list ("+2 more airports") for the small event cards.
 */
@Component({
  selector: 'app-event-airport-list',
  standalone: true,
  templateUrl: './event-airport-list.html',
  styleUrl: './event-airport-list.css',
})
export class EventAirportListComponent {
  @Input() airports: readonly AirportDetail[] = [];
  /** Most airports to list; 0 lists them all. */
  @Input() limit = 0;

  get shown(): readonly AirportDetail[] {
    return this.limit > 0 ? this.airports.slice(0, this.limit) : this.airports;
  }

  get hiddenCount(): number {
    return this.airports.length - this.shown.length;
  }
}
