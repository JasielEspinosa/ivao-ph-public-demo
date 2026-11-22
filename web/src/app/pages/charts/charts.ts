import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { environment } from '../../../environments/environment';
import { getAuthHeader } from '../../app';
import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import { DATA_MANAGE_MESSAGES } from '../../shared/data-manage-messages';
import { FileActionsComponent } from '../../shared/file-actions/file-actions';
import { PHILIPPINE_AIRPORTS } from '../../shared/philippine-airports';
import { PublicFileService } from '../../shared/public-file.service';
import { buildSubmitErrorMessage } from '../../shared/submit-error-utils';
import { formatFileSize } from '../../shared/upload-files';

/** A chart as the public API returns it: enabled charts only. */
interface PublicChart {
  id: number;
  airport_icao: string;
  chart_name: string;
  file_name: string;
  file_size: number;
}

interface AirportCharts {
  icao: string;
  /** The airport's name when it is a known Philippine airport. */
  name: string;
  charts: PublicChart[];
}

const CHARTS_API = `${environment.apiUrl.replace(/\/$/, '')}/charts`;

/** Public list of the airport charts managed on Data Management > Charts, grouped by airport. */
@Component({
  selector: 'app-charts',
  standalone: true,
  imports: [PlaceholderBannerComponent, FileActionsComponent],
  template: `
    <section class="page-shell">
      <div class="form-shell">
        <app-placeholder-banner title="Charts" subheading="IVAO PHILIPPINES"></app-placeholder-banner>

        <div class="dashboard-header">
          <p>Airport charts of the Philippines, shared by IVAO Philippines.</p>
        </div>

        @if (errorMessage()) {
          <div class="status-box error" role="alert">{{ errorMessage() }}</div>
        }

        @if (isLoading()) {
          <p class="universal-helper-text-gray" role="status">{{ messages.loading('Charts') }}...</p>
        } @else if (!errorMessage() && airports().length === 0) {
          <p class="universal-helper-text-gray">{{ messages.noRecords('Charts') }}</p>
        }

        @for (airport of airports(); track airport.icao) {
          <h2 class="charts-airport">
            {{ airport.icao }}
            @if (airport.name) {
              <span class="charts-airport__name">- {{ airport.name }}</span>
            }
          </h2>

          <ul class="file-list">
            @for (chart of airport.charts; track chart.id) {
              <li class="file-item">
                <div class="file-item__text">
                  <h3 class="charts-chart">{{ chart.chart_name }}</h3>
                  <p>PDF - {{ formatFileSize(chart.file_size) }}</p>
                </div>
                <app-file-actions
                  label="chart"
                  [busy]="busyId() === chart.id"
                  (view)="open(chart, 'view')"
                  (download)="open(chart, 'download')"
                ></app-file-actions>
              </li>
            }
          </ul>
        }
      </div>
    </section>
  `,
  styles: `
    .charts-airport {
      margin: 1.5rem 0 0.75rem;
      color: var(--c-brand-ink);
      font-size: 1.3rem;
    }

    .charts-airport__name {
      font-weight: 400;
    }

    .charts-chart {
      margin: 0 0 0.25rem;
      font-size: 1.1rem;
    }
  `,
})
export class ChartsComponent implements OnInit {
  private readonly title = inject(Title);
  private readonly http = inject(HttpClient);
  private readonly publicFiles = inject(PublicFileService);

  readonly messages = DATA_MANAGE_MESSAGES;
  readonly formatFileSize = formatFileSize;

  readonly isLoading = signal(true);
  readonly errorMessage = signal('');
  /** The chart whose file is being fetched (its buttons are disabled meanwhile). */
  readonly busyId = signal<number | null>(null);
  private readonly charts = signal<PublicChart[]>([]);

  /** The charts grouped by airport; the API already sorts them by airport and chart name. */
  readonly airports = computed<AirportCharts[]>(() => {
    const groups = new Map<string, AirportCharts>();
    for (const chart of this.charts()) {
      let group = groups.get(chart.airport_icao);
      if (!group) {
        const known = PHILIPPINE_AIRPORTS.find((airport) => airport.icao === chart.airport_icao);
        group = { icao: chart.airport_icao, name: known?.name ?? '', charts: [] };
        groups.set(chart.airport_icao, group);
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
        },
        error: (error) => {
          this.errorMessage.set(
            buildSubmitErrorMessage(error, { fallbackMessage: DATA_MANAGE_MESSAGES.unableToLoad('charts') }),
          );
          this.isLoading.set(false);
        },
      });
  }

  /** Shows the chart in a new tab or saves it; see PublicFileService for why it is fetched instead of linked. */
  open(chart: PublicChart, mode: 'view' | 'download'): void {
    if (this.busyId() !== null) {
      return;
    }

    this.busyId.set(chart.id);
    this.errorMessage.set('');
    this.publicFiles.open(`${CHARTS_API}/${chart.id}/file`, chart.file_name, 'application/pdf', mode).subscribe({
      next: () => this.busyId.set(null),
      error: (error) => {
        this.errorMessage.set(
          buildSubmitErrorMessage(error, {
            notFoundMessage: 'This chart is no longer available. Please refresh the page.',
            fallbackMessage: 'Unable to open the chart. Please try again.',
          }),
        );
        this.busyId.set(null);
      },
    });
  }
}
