import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { ParkingSearchService } from '../../services/parking-search.service';
import {
  AirportParkingSpot,
  airlineLabel,
  airlinesSourceLabel,
  isSimulatorSource,
  parkingSourceLabel,
  standTypeLabel,
  standUseLabel,
} from '../airport-parking';
import { DATA_MANAGE_MESSAGES } from '../data-manage-messages';
import { PopupMessageComponent } from '../popup/popup-message';
import { TablePagination, TablePaginationComponent } from '../table-pagination/table-pagination';
import { ParkingMapComponent } from './parking-map';

/** A spot with more airlines than this shows their number, which opens the list. */
const AIRLINES_IN_A_CELL = 6;
/** The notes of single airports, by ICAO code, shown above their results. */
const AIRPORT_NOTES: Readonly<Record<string, string>> = {
  //   keeps "Terminal 3" on one line.
  RPLL: 'Virtual airlines, and airlines that are not listed here, can park at Terminal 3.',
};

/**
 * The "Airport Parking" section: the map and list of the parking spots managed on Data Management > Airport Parking, for
 * the airport whose ICAO code is searched, with the airlines of its terminals (Data Management > Airport Terminals) and
 * of each spot. ATC Lounge and Pilot's Lounge both show this component; the search comes from the shared
 * ParkingSearchService, so an airport searched on one page is shown on the other.
 */
@Component({
  selector: 'app-parking-search',
  standalone: true,
  imports: [ParkingMapComponent, PopupMessageComponent, TablePaginationComponent],
  templateUrl: './parking-search.html',
  styleUrl: './parking-search.css',
})
export class ParkingSearchComponent implements OnInit {
  private readonly parking = inject(ParkingSearchService);

  readonly messages = DATA_MANAGE_MESSAGES;
  readonly standTypeLabel = standTypeLabel;
  readonly sourceLabel = parkingSourceLabel;
  readonly useLabel = standUseLabel;
  readonly airlineLabel = airlineLabel;
  readonly airlinesSourceLabel = airlinesSourceLabel;
  readonly isSimulator = isSimulatorSource;
  readonly airlinesInACell = AIRLINES_IN_A_CELL;
  /** The terminal lists start open, except on a phone, where they would push the map far down. */
  readonly expandTerminals = window.matchMedia('(min-width: 601px)').matches;
  /** 10 rows a page, so the table under the map stays short. */
  readonly pager = new TablePagination(10);

  readonly isLoading = this.parking.isLoading;
  readonly errorMessage = this.parking.errorMessage;
  readonly typedIcao = this.parking.typedIcao;
  readonly icaoError = this.parking.icaoError;
  readonly shownIcao = this.parking.shownIcao;
  readonly selectedAirline = this.parking.selectedAirline;
  readonly searchTerm = this.parking.searchTerm;
  readonly airports = this.parking.airports;
  readonly airportName = this.parking.airportName;
  readonly airportSpots = this.parking.airportSpots;
  readonly airportTerminals = this.parking.airportTerminals;
  readonly airportAirlines = this.parking.airportAirlines;
  readonly airlineSpots = this.parking.airlineSpots;
  readonly listedSpots = this.parking.listedSpots;
  readonly focused = signal<{ id: number } | null>(null);

  /** Empty for an airport without a note of its own. */
  readonly airportNote = computed(() => AIRPORT_NOTES[this.shownIcao()] ?? '');
  readonly simulatorCount = computed(() => this.airlineSpots().filter((spot) => isSimulatorSource(spot.source)).length);

  ngOnInit(): void {
    this.parking.load();
  }

  onIcaoInput(input: HTMLInputElement): void {
    this.parking.setIcaoFromInput(input);
  }

  searchAirport(): void {
    this.parking.search();
    this.showFirstRows();
  }

  selectAirline(code: string): void {
    this.parking.selectAirline(code);
    this.showFirstRows();
  }

  onSearch(value: string): void {
    this.searchTerm.set(value);
  }

  showOnMap(spot: AirportParkingSpot): void {
    this.focused.set({ id: spot.id });
  }

  /** New results start on the first page, with no spot chosen on the map. */
  private showFirstRows(): void {
    this.focused.set(null);
    this.pager.goTo(0);
  }
}
