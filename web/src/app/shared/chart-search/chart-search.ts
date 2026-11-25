import { CommonModule } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ChartSearchService } from '../../services/chart-search.service';
import { PHILIPPINE_AIRPORTS } from '../philippine-airports';
import { CHART_LIST_ANCHOR, airportChartsAnchor, scrollToAnchor } from '../public-charts';
import { CHART_SOURCES } from './philippine-charts';

/**
 * The "Charts" search section. Pilot's Lounge and Charts both show this component; the search state comes from the
 * shared ChartSearchService, so an airport searched on one page is shown on the other.
 */
@Component({
  selector: 'app-chart-search',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './chart-search.html',
  styleUrl: './chart-search.css',
})
export class ChartSearchComponent {
  private readonly chartSearch = inject(ChartSearchService);

  /** Set by the Charts page, which lists the charts itself: the links then scroll down to them. */
  @Input() onChartsPage = false;

  /** Suggestions for the search's ICAO field. */
  readonly airports = PHILIPPINE_AIRPORTS;
  readonly chartSources = CHART_SOURCES;

  readonly chartsIcao = this.chartSearch.icao;
  readonly chartsError = this.chartSearch.error;
  readonly chartsShownIcao = this.chartSearch.shownIcao;
  readonly chartGroups = this.chartSearch.chartGroups;
  readonly chartsAirportName = this.chartSearch.airportName;
  readonly chartsPage = this.chartSearch.chartsPage;
  readonly airportChartsAnchor = airportChartsAnchor;
  readonly chartListAnchor = CHART_LIST_ANCHOR;

  onChartsIcaoInput(input: HTMLInputElement): void {
    this.chartSearch.setIcaoFromInput(input);
  }

  searchCharts(): void {
    this.chartSearch.search();
  }

  scrollOnPage(event: Event, anchor: string): void {
    event.preventDefault();
    scrollToAnchor(anchor);
  }
}
