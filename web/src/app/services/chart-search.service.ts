import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { getAuthHeader } from '../app';
import { AIRPORT_CHARTS, AirportChart, CHART_TYPES, ChartType } from '../shared/chart-search/philippine-charts';
import { PHILIPPINE_AIRPORTS } from '../shared/philippine-airports';
import { CHARTS_API, PublicChart } from '../shared/public-charts';

const PHILIPPINE_ICAO_PATTERN = /^RP[A-Z]{2}$/;

/** The charts of one type, as listed in the Charts search results. */
export interface ChartGroup {
  readonly type: ChartType;
  readonly charts: readonly AirportChart[];
}

/**
 * What the Charts page holds for the airport searched: 'available' charts of that airport, only 'others' (charts, but
 * none of that airport), 'none' at all, or 'unknown' when that could not be checked.
 */
export type ChartsPageState = 'checking' | 'available' | 'others' | 'none' | 'unknown';

/**
 * The state of the Charts search. It is kept here, so every page that shows the search shows the same one, and a result
 * is not looked up again when moving between those pages: only a new search does that.
 */
@Injectable({ providedIn: 'root' })
export class ChartSearchService {
  private readonly http = inject(HttpClient);
  private chartsPageRequest?: Subscription;

  /** The search starts empty: no code typed, nothing shown, no message. */
  readonly icao = signal('');
  readonly error = signal('');
  /** The airport the results belong to; empty until a search is done. */
  readonly shownIcao = signal('');
  readonly chartsPage = signal<ChartsPageState>('checking');

  /** The charts kept on this site for the airport searched, grouped by type. Empty when there are none. */
  readonly chartGroups = computed<readonly ChartGroup[]>(() => {
    const charts = AIRPORT_CHARTS[this.shownIcao()] ?? [];
    return CHART_TYPES.map((type) => ({ type, charts: charts.filter((chart) => chart.type === type) })).filter(
      (group) => group.charts.length > 0,
    );
  });

  /** The name of the airport searched, when it is one of the known Philippine airports. */
  readonly airportName = computed(
    () => PHILIPPINE_AIRPORTS.find((airport) => airport.icao === this.shownIcao())?.name ?? '',
  );

  /** Keeps the field to letters (ICAO codes have no digits or spaces), in capitals, at most 4 of them. */
  setIcaoFromInput(input: HTMLInputElement): void {
    const icao = input.value
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 4);
    input.value = icao;
    this.icao.set(icao);
  }

  /** Shows the charts of the typed airport. Only Philippine airports (RP**) have charts here. */
  search(): void {
    const icao = this.icao();
    this.shownIcao.set('');

    if (!PHILIPPINE_ICAO_PATTERN.test(icao)) {
      this.error.set('Enter a Philippine airport ICAO code: 4 letters starting with RP, for example RPLL.');
      return;
    }

    this.error.set('');
    this.shownIcao.set(icao);
    this.checkChartsPage(icao);
  }

  /** Looks up what the Charts page holds for an airport. */
  private checkChartsPage(icao: string): void {
    // The answer for an earlier search must not replace the answer for this one.
    this.chartsPageRequest?.unsubscribe();
    this.chartsPage.set('checking');
    this.chartsPageRequest = this.http
      .get<PublicChart[]>(CHARTS_API, { headers: new HttpHeaders({ Authorization: getAuthHeader() }) })
      .subscribe({
        next: (rows) => {
          const charts = Array.isArray(rows) ? rows : [];
          if (charts.some((chart) => chart.airport_icao === icao)) {
            this.chartsPage.set('available');
          } else {
            this.chartsPage.set(charts.length > 0 ? 'others' : 'none');
          }
        },
        error: () => this.chartsPage.set('unknown'),
      });
  }
}
