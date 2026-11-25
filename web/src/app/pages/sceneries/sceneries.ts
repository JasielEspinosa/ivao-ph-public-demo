import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { environment } from '../../../environments/environment';
import { getAuthHeader } from '../../app';
import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import { AuthImageDirective } from '../../shared/auth-image';
import { DATA_MANAGE_MESSAGES } from '../../shared/data-manage-messages';
import { getLinkHost } from '../../shared/link-url';
import { PopupMessageComponent } from '../../shared/popup/popup-message';
import { SceneryDownload, SceneryLinks, sceneryDownloads } from '../../shared/scenery-simulators';
import { buildSubmitErrorMessage } from '../../shared/submit-error-utils';

/** A scenery managed on Data Management > Sceneries, as the public API returns it (enabled ones only). */
interface PublicScenery extends SceneryLinks {
  id: number;
  airport_icao: string;
  airport_name: string;
  note: string | null;
  has_image: boolean;
  updated_at: string;
}

interface SceneryCard {
  scenery: PublicScenery;
  /** The picture's address ('' when the scenery has none). */
  imageUrl: string;
  downloads: (SceneryDownload & { host: string })[];
}

const SCENERIES_API = `${environment.apiUrl.replace(/\/$/, '')}/sceneries`;

/** An empty picture: what shows (as the tinted box) while the real one loads. */
const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * Public list of the recommended airport sceneries managed on Data Management > Sceneries, by airport. The website keeps
 * no scenery files: each button opens the site the scenery of that flight simulator is downloaded from, in a new tab.
 */
@Component({
  selector: 'app-sceneries',
  standalone: true,
  imports: [AuthImageDirective, PopupMessageComponent, PlaceholderBannerComponent],
  template: `
    <section class="page-shell">
      <div class="form-shell">
        <app-placeholder-banner title="Sceneries" subheading="IVAO PHILIPPINES"></app-placeholder-banner>

        <div class="dashboard-header">
          <p>
            Airport sceneries recommended by IVAO Philippines. Choose your flight simulator to open the website the
            scenery is downloaded from.
          </p>
        </div>

        <app-popup-message type="error" [message]="errorMessage()" />

        @if (isLoading()) {
          <p class="universal-helper-text-gray" role="status">{{ messages.loading('Sceneries') }}...</p>
        } @else if (!errorMessage() && cards().length === 0) {
          <p class="universal-helper-text-gray">{{ messages.noRecords('Sceneries') }}</p>
        }

        <ul class="file-list">
          @for (card of cards(); track card.scenery.id) {
            <li class="file-item">
              @if (card.imageUrl) {
                <img
                  class="scenery-image"
                  [appAuthSrc]="card.imageUrl"
                  [appAuthFallback]="blankImage"
                  [alt]="'Scenery of ' + card.scenery.airport_name"
                />
              }
              <div class="file-item__text">
                <h2>{{ card.scenery.airport_icao }} - {{ card.scenery.airport_name }}</h2>
                @if (card.scenery.note) {
                  <p>{{ card.scenery.note }}</p>
                }
                <ul class="scenery-links" [attr.aria-label]="'Downloads for ' + card.scenery.airport_icao">
                  @for (download of card.downloads; track download.label) {
                    <li>
                      <a
                        class="scenery-link"
                        [href]="download.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        [title]="download.url"
                      >
                        <strong>{{ download.label }}</strong>
                        <span>{{ download.host }}</span>
                      </a>
                    </li>
                  }
                </ul>
              </div>
            </li>
          }
        </ul>
      </div>
    </section>
  `,
  styleUrl: './sceneries.css',
})
export class SceneriesComponent implements OnInit {
  private readonly title = inject(Title);
  private readonly http = inject(HttpClient);

  readonly messages = DATA_MANAGE_MESSAGES;
  readonly blankImage = BLANK_IMAGE;
  readonly cards = signal<SceneryCard[]>([]);
  readonly isLoading = signal(true);
  readonly errorMessage = signal('');

  constructor() {
    this.title.setTitle('IVAO Philippines - Sceneries');
  }

  ngOnInit(): void {
    this.http
      .get<PublicScenery[]>(SCENERIES_API, { headers: new HttpHeaders({ Authorization: getAuthHeader() }) })
      .subscribe({
        next: (rows) => {
          this.cards.set((Array.isArray(rows) ? rows : []).map((row) => this.toCard(row)));
          this.isLoading.set(false);
        },
        error: (error) => {
          this.errorMessage.set(
            buildSubmitErrorMessage(error, { fallbackMessage: DATA_MANAGE_MESSAGES.unableToLoad('sceneries') }),
          );
          this.isLoading.set(false);
        },
      });
  }

  private toCard(scenery: PublicScenery): SceneryCard {
    return {
      scenery,
      imageUrl: scenery.has_image
        ? `${SCENERIES_API}/${scenery.id}/image?v=${encodeURIComponent(scenery.updated_at)}`
        : '',
      downloads: sceneryDownloads(scenery).map((download) => ({ ...download, host: getLinkHost(download.url) })),
    };
  }
}
