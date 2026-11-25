import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, Injector, OnInit, afterNextRender, computed, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';

import { getAuthHeader } from '../../app';
import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import { ChartSearchComponent } from '../../shared/chart-search/chart-search';
import { DATA_MANAGE_MESSAGES } from '../../shared/data-manage-messages';
import { FileActionsComponent } from '../../shared/file-actions/file-actions';
import { getLinkHost } from '../../shared/link-url';
import { PHILIPPINE_AIRPORTS } from '../../shared/philippine-airports';
import {
  CHARTS_API,
  CHART_LIST_ANCHOR,
  PublicChart,
  airportChartsAnchor,
  scrollToAnchor,
} from '../../shared/public-charts';
import { PublicFileService } from '../../shared/public-file.service';
import { buildSubmitErrorMessage } from '../../shared/submit-error-utils';
import { formatFileSize } from '../../shared/upload-files';
import { PopupMessageComponent } from '../../shared/popup/popup-message';

interface AirportCharts {
  /** '' for the charts without an airport. */
  icao: string;
  /** The airport's name when it is a known Philippine airport. */
  name: string;
  charts: PublicChart[];
}

/** Public Charts page: the Charts search, then the airport charts managed on Data Management > Charts, by airport. */
@Component({
  selector: 'app-charts',
  standalone: true,
  imports: [PopupMessageComponent, PlaceholderBannerComponent, ChartSearchComponent, FileActionsComponent],
  template: `
    <section class="page-shell">
      <div class="form-shell">
        <app-placeholder-banner title="Charts" subheading="IVAO PHILIPPINES"></app-placeholder-banner>

        <div class="dashboard-header">
          <p>Airport charts of the Philippines, shared by IVAO Philippines.</p>
        </div>

        <app-popup-message type="error" [message]="errorMessage()" />

        <app-chart-search class="home-content" [onChartsPage]="true"></app-chart-search>

        @if (isLoading()) {
          <p class="universal-helper-text-gray" role="status">{{ messages.loading('Charts') }}...</p>
        } @else if (!errorMessage() && airports().length === 0) {
          <p class="universal-helper-text-gray">{{ messages.noRecords('Charts') }}</p>
        }

        <div class="charts-list" [id]="chartListAnchor">
          @for (airport of airports(); track airport.icao) {
            <h2 class="charts-airport" [attr.id]="airport.icao ? airportChartsAnchor(airport.icao) : null">
              @if (airport.icao) {
                {{ airport.icao }}
                @if (airport.name) {
                  <span class="charts-airport__name">- {{ airport.name }}</span>
                }
              } @else {
                Other Charts
              }
            </h2>

            <ul class="file-list">
              @for (chart of airport.charts; track chart.id) {
                <li class="file-item">
                  <div class="file-item__text">
                    <h3 class="charts-chart">
                      @if (chart.link_url) {
                        <a [href]="chart.link_url" target="_blank" rel="noopener noreferrer">{{ chart.chart_name }}</a>
                      } @else {
                        <a
                          href="#"
                          (click)="$event.preventDefault(); open(chart, 'view')"
                          [attr.aria-disabled]="busyId() === chart.id"
                          >{{ chart.chart_name }}</a
                        >
                      }
                    </h3>
                    @if (chart.description) {
                      <p>{{ chart.description }}</p>
                    }
                    <p>{{ describe(chart) }}</p>
                  </div>
                  <app-file-actions
                    label="chart"
                    [canDownload]="!chart.link_url || chart.link_is_pdf"
                    [busy]="busyId() === chart.id"
                    (view)="open(chart, 'view')"
                    (download)="open(chart, 'download')"
                  ></app-file-actions>
                </li>
              }
            </ul>
          }
        </div>
      </div>
    </section>
  `,
  styles: `
    .charts-airport {
      margin: 1.5rem 0 0.75rem;
      color: var(--c-brand-ink);
      font-size: 1.3rem;
    }

    /* Keeps what is scrolled to clear of the floating header. */
    .charts-list,
    .charts-airport {
      scroll-margin-top: 5rem;
    }

    .charts-airport__name {
      font-weight: 400;
    }

    .charts-chart {
      margin: 0 0 0.25rem;
      font-size: 1.1rem;
    }

    .charts-chart a {
      color: var(--c-brand-ink);
      text-decoration: none;
    }

    .charts-chart a:hover,
    .charts-chart a:focus-visible {
      text-decoration: underline;
    }
  `,
})
export class ChartsComponent implements OnInit {
  private readonly title = inject(Title);
  private readonly http = inject(HttpClient);
  private readonly publicFiles = inject(PublicFileService);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);

  readonly messages = DATA_MANAGE_MESSAGES;
  readonly airportChartsAnchor = airportChartsAnchor;
  readonly chartListAnchor = CHART_LIST_ANCHOR;

  readonly isLoading = signal(true);
  readonly errorMessage = signal('');
  /** The chart whose file is being fetched (its buttons are disabled meanwhile). */
  readonly busyId = signal<number | null>(null);
  private readonly charts = signal<PublicChart[]>([]);

  /** The charts grouped by airport; the API already sorts them by airport and chart name. */
  readonly airports = computed<AirportCharts[]>(() => {
    const groups = new Map<string, AirportCharts>();
    for (const chart of this.charts()) {
      const icao = chart.airport_icao ?? '';
      let group = groups.get(icao);
      if (!group) {
        const known = PHILIPPINE_AIRPORTS.find((airport) => airport.icao === icao);
        group = { icao, name: known?.name ?? '', charts: [] };
        groups.set(icao, group);
      }
      group.charts.push(chart);
    }

    return [...groups.values()];
  });

  constructor() {
    this.title.setTitle('IVAO Philippines - Charts');
  }

  ngOnInit(): void {
    this.http
      .get<PublicChart[]>(CHARTS_API, { headers: new HttpHeaders({ Authorization: getAuthHeader() }) })
      .subscribe({
        next: (rows) => {
          this.charts.set(Array.isArray(rows) ? rows : []);
          this.isLoading.set(false);
          this.scrollToLinkedAirport();
        },
        error: (error) => {
          this.errorMessage.set(
            buildSubmitErrorMessage(error, { fallbackMessage: DATA_MANAGE_MESSAGES.unableToLoad('charts') }),
          );
          this.isLoading.set(false);
        },
      });
  }

  /** A link to one airport's charts (/charts#airport-RPLL) is scrolled to here: the list loads after the page. */
  private scrollToLinkedAirport(): void {
    const anchor = this.route.snapshot.fragment;
    if (anchor) {
      afterNextRender(() => scrollToAnchor(anchor), { injector: this.injector });
    }
  }

  /** "PDF - 1.2 MB", or "Link - example.com" for a chart that points to a page. */
  describe(chart: PublicChart): string {
    return chart.link_url ? `Link - ${getLinkHost(chart.link_url)}` : `PDF - ${formatFileSize(chart.file_size ?? 0)}`;
  }

  /**
   * A link opens in a new tab; only a link to a PDF can also be downloaded (the server fetches it). A file is shown in a new tab or saved (see PublicFileService
   * for why it is fetched instead of linked).
   */
  open(chart: PublicChart, mode: 'view' | 'download'): void {
    const isLink = !!chart.link_url;
    if (isLink && mode === 'view') {
      window.open(chart.link_url!, '_blank', 'noopener,noreferrer');
      return;
    }
    if (isLink && !chart.link_is_pdf) {
      return;
    }

    const fileName = isLink ? `${chart.chart_name}.pdf` : chart.file_name;
    if (!fileName || this.busyId() !== null) {
      return;
    }

    this.busyId.set(chart.id);
    this.errorMessage.set('');
    this.publicFiles.open(`${CHARTS_API}/${chart.id}/file`, fileName, 'application/pdf', mode).subscribe({
      next: () => this.busyId.set(null),
      error: (error) => {
        this.errorMessage.set(
          buildSubmitErrorMessage(error, {
            notFoundMessage: isLink
              ? 'This PDF could not be downloaded from the website it is on. Please use View to open it instead.'
              : 'This chart is no longer available. Please refresh the page.',
            fallbackMessage: 'Unable to open the chart. Please try again.',
          }),
        );
        this.busyId.set(null);
      },
    });
  }
}
