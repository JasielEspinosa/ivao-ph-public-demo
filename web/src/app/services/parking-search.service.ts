import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription, forkJoin } from 'rxjs';

import { environment } from '../../environments/environment';
import { getAuthHeader } from '../app';
import {
  Airline,
  AirportParkingSpot,
  AirportTerminal,
  airlineLabel,
  parkingSourceLabel,
  standTypeLabel,
  standUseLabel,
} from '../shared/airport-parking';
import { DATA_MANAGE_MESSAGES } from '../shared/data-manage-messages';
import { buildSubmitErrorMessage } from '../shared/submit-error-utils';

const AIRPORT_PARKING_API = `${environment.apiUrl.replace(/\/$/, '')}/airport-parking`;
const ICAO_PATTERN = /^[A-Z]{4}$/;

export interface ParkingAirport {
  icao: string;
  name: string;
}

/**
 * The parking spots, terminals and state of the Airport Parking search. It is kept here, so every page that shows the
 * search shows the same airport, airline and search text. The API returns the enabled spots only, with the simulator
 * (X-Plane) ones just where real-world data is missing.
 */
@Injectable({ providedIn: 'root' })
export class ParkingSearchService {
  private readonly http = inject(HttpClient);
  private request?: Subscription;

  /** Waited for only while there is nothing to show: a later load refreshes what is already shown. */
  readonly isLoading = signal(true);
  readonly errorMessage = signal('');
  private readonly allSpots = signal<AirportParkingSpot[]>([]);
  private readonly allTerminals = signal<AirportTerminal[]>([]);
  /** What is in the ICAO field. The search starts empty, with nothing shown. */
  readonly typedIcao = signal('');
  readonly icaoError = signal('');
  /** The airport the results belong to; empty until a search is done. */
  readonly shownIcao = signal('');
  private readonly chosenAirline = signal('');
  readonly searchTerm = signal('');

  /** The airports that have spots: the suggestions of the ICAO field. */
  readonly airports = computed<ParkingAirport[]>(() => {
    const names = new Map(this.allSpots().map((spot) => [spot.airport_icao, spot.airport_name]));
    return [...names]
      .map(([icao, name]) => ({ icao, name }))
      .sort((left, right) => left.icao.localeCompare(right.icao));
  });

  readonly airportName = computed(
    () => this.airports().find((airport) => airport.icao === this.shownIcao())?.name ?? '',
  );

  /** The spots of the airport searched, by stand name. */
  readonly airportSpots = computed(() =>
    this.allSpots()
      .filter((spot) => spot.airport_icao === this.shownIcao())
      .sort((left, right) =>
        (left.stand_name ?? '').localeCompare(right.stand_name ?? '', undefined, { numeric: true }),
      ),
  );

  readonly airportTerminals = computed(() =>
    this.allTerminals().filter((terminal) => terminal.airport_icao === this.shownIcao()),
  );

  /** The airlines that spots of the airport show, by name: the choices of the Airline list. */
  readonly airportAirlines = computed<Airline[]>(() => {
    const airlines = new Map<string, Airline>();
    for (const spot of this.airportSpots()) {
      for (const airline of spot.shown_airlines) {
        airlines.set(airline.code, airline);
      }
    }
    return [...airlines.values()].sort((left, right) => airlineLabel(left).localeCompare(airlineLabel(right)));
  });

  /** The code of the airline chosen; empty for all airlines, also once a reload no longer has the chosen one. */
  readonly selectedAirline = computed(() => {
    const code = this.chosenAirline();
    return this.airportAirlines().some((airline) => airline.code === code) ? code : '';
  });

  /** The spots on the map: those of the airport, or those of the airline chosen. */
  readonly airlineSpots = computed(() => {
    const code = this.selectedAirline();
    return code
      ? this.airportSpots().filter((spot) => spot.shown_airlines.some((airline) => airline.code === code))
      : this.airportSpots();
  });

  /** The listed spots: those on the map that match the search box. */
  readonly listedSpots = computed(() => {
    const needle = this.searchTerm().trim().toLowerCase();
    if (!needle) {
      return this.airlineSpots();
    }

    return this.airlineSpots().filter((spot) =>
      [
        spot.stand_name,
        spot.terminal_name,
        standTypeLabel(spot.stand_type),
        standUseLabel(spot.shown_use),
        ...spot.shown_airlines.map(airlineLabel),
        parkingSourceLabel(spot.source),
        spot.note,
      ]
        .map((part) => (part ?? '').toLowerCase())
        .join(' ')
        .includes(needle),
    );
  });

  /** Reads the spots and terminals. Each page showing the search calls this, so changes made by staff appear. */
  load(): void {
    this.request?.unsubscribe();
    this.errorMessage.set('');
    this.isLoading.set(this.allSpots().length === 0);
    const options = { headers: new HttpHeaders({ Authorization: getAuthHeader() }) };
    this.request = forkJoin({
      spots: this.http.get<AirportParkingSpot[]>(AIRPORT_PARKING_API, options),
      terminals: this.http.get<AirportTerminal[]>(`${AIRPORT_PARKING_API}/terminals`, options),
    }).subscribe({
      next: ({ spots, terminals }) => {
        this.allSpots.set(Array.isArray(spots) ? spots : []);
        this.allTerminals.set(Array.isArray(terminals) ? terminals : []);
        this.isLoading.set(false);
      },
      error: (error) => {
        this.errorMessage.set(
          buildSubmitErrorMessage(error, { fallbackMessage: DATA_MANAGE_MESSAGES.unableToLoad('parking spots') }),
        );
        this.isLoading.set(false);
      },
    });
  }

  /** Keeps the field to letters (ICAO codes have no digits or spaces), in capitals, at most 4 of them. */
  setIcaoFromInput(input: HTMLInputElement): void {
    const icao = input.value
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 4);
    input.value = icao;
    this.typedIcao.set(icao);
  }

  /** Shows the parking spots of the typed airport. */
  search(): void {
    const icao = this.typedIcao();
    const isValid = ICAO_PATTERN.test(icao);
    this.icaoError.set(isValid ? '' : 'Enter a 4-letter airport ICAO code, for example RPLL.');
    this.shownIcao.set(isValid ? icao : '');
    this.searchTerm.set('');
    this.chosenAirline.set('');
  }

  selectAirline(code: string): void {
    this.chosenAirline.set(code);
  }
}
