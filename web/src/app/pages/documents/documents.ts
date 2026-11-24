import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { environment } from '../../../environments/environment';
import { getAuthHeader } from '../../app';
import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import { DATA_MANAGE_MESSAGES } from '../../shared/data-manage-messages';
import { FileActionsComponent } from '../../shared/file-actions/file-actions';
import { getLinkHost } from '../../shared/link-url';
import { PublicFileService } from '../../shared/public-file.service';
import { buildSubmitErrorMessage } from '../../shared/submit-error-utils';
import { formatFileSize, formatIsoDate, getFileExtension } from '../../shared/upload-files';

/** A document managed on Data Management > Documents, as the public API returns it (enabled and valid today only). */
interface UploadedDocument {
  id: number;
  name: string;
  description: string | null;
  /** The page a link document opens in a new tab; null for a document that holds a file. */
  link_url: string | null;
  /** The link points to a PDF: it can be downloaded (the server fetches it) as well as opened. */
  link_is_pdf: boolean;
  /** The file fields are null for a link. */
  file_name: string | null;
  file_mimetype: string | null;
  file_size: number | null;
  /** YYYY-MM-DD, or null when the document has no validity dates. */
  start_date: string | null;
  end_date: string | null;
}

const DOCUMENTS_API = `${environment.apiUrl.replace(/\/$/, '')}/documents`;

const FILE_TYPE_LABELS: Readonly<Record<string, string>> = {
  pdf: 'PDF',
  doc: 'Word',
  docx: 'Word',
  xls: 'Excel',
  xlsx: 'Excel',
};

/**
 * Public list of the division's documents: the ones managed on Data Management > Documents, shown while they are
 * enabled and valid today.
 */
@Component({
  selector: 'app-documents',
  standalone: true,
  imports: [PlaceholderBannerComponent, FileActionsComponent],
  template: `
    <section class="page-shell">
      <div class="form-shell">
        <app-placeholder-banner title="Documents" subheading="IVAO PHILIPPINES"></app-placeholder-banner>

        <div class="dashboard-header">
          <p>Official documents of IVAO Philippines.</p>
        </div>

        @if (errorMessage()) {
          <div class="status-box error" role="alert">{{ errorMessage() }}</div>
        }

        @if (isLoading()) {
          <p class="universal-helper-text-gray" role="status">{{ messages.loading('Documents') }}...</p>
        } @else if (!errorMessage() && documents().length === 0) {
          <p class="universal-helper-text-gray">{{ messages.noRecords('Documents') }}</p>
        }

        <ul class="file-list">
          @for (doc of documents(); track doc.id) {
            <li class="file-item">
              <div class="file-item__text">
                <h2>
                  @if (doc.link_url) {
                    <a [href]="doc.link_url" target="_blank" rel="noopener noreferrer">{{ doc.name }}</a>
                  } @else if (canView(doc)) {
                    <a
                      href="#"
                      (click)="$event.preventDefault(); open(doc, 'view')"
                      [attr.aria-disabled]="busyId() === doc.id"
                      >{{ doc.name }}</a
                    >
                  } @else {
                    {{ doc.name }}
                  }
                </h2>
                @if (doc.description) {
                  <p>{{ doc.description }}</p>
                }
                <p>{{ describe(doc) }}</p>
              </div>
              <app-file-actions
                label="document"
                [canView]="canView(doc)"
                [canDownload]="!doc.link_url || doc.link_is_pdf"
                [busy]="busyId() === doc.id"
                (view)="open(doc, 'view')"
                (download)="open(doc, 'download')"
              ></app-file-actions>
            </li>
          }
        </ul>
      </div>
    </section>
  `,
})
export class DocumentsComponent implements OnInit {
  private readonly title = inject(Title);
  private readonly http = inject(HttpClient);
  private readonly publicFiles = inject(PublicFileService);

  readonly messages = DATA_MANAGE_MESSAGES;
  readonly documents = signal<UploadedDocument[]>([]);
  readonly isLoading = signal(true);
  /** The document whose file is being fetched (its buttons are disabled meanwhile). */
  readonly busyId = signal<number | null>(null);
  readonly errorMessage = signal('');

  constructor() {
    this.title.setTitle('IVAO Philippines - Documents');
  }

  ngOnInit(): void {
    this.http.get<UploadedDocument[]>(DOCUMENTS_API, { headers: this.headers }).subscribe({
      next: (rows) => {
        this.documents.set(Array.isArray(rows) ? rows : []);
        this.isLoading.set(false);
      },
      error: (error) => {
        this.errorMessage.set(
          buildSubmitErrorMessage(error, { fallbackMessage: DATA_MANAGE_MESSAGES.unableToLoad('documents') }),
        );
        this.isLoading.set(false);
      },
    });
  }

  /** "PDF - 1.2 MB" (or "Link - example.com"), plus "Valid until Nov 30, 2026" when the document has an End Date. */
  describe(doc: UploadedDocument): string {
    const parts = doc.link_url
      ? ['Link', getLinkHost(doc.link_url)]
      : [FILE_TYPE_LABELS[getFileExtension(doc.file_name ?? '')] ?? 'File', formatFileSize(doc.file_size ?? 0)];
    if (doc.end_date) {
      parts.push(`Valid until ${formatIsoDate(doc.end_date)}`);
    }

    return parts.join(' - ');
  }

  /** A link is opened; of the files only a PDF can be shown in the browser (Word and Excel files are downloaded). */
  canView(doc: UploadedDocument): boolean {
    return !!doc.link_url || doc.file_mimetype === 'application/pdf';
  }

  /**
   * A link opens in a new tab; only a link to a PDF can also be downloaded (the server fetches it). A file is shown
   * (PDF only) or saved.
   */
  open(doc: UploadedDocument, mode: 'view' | 'download'): void {
    const isLink = !!doc.link_url;
    if (isLink && mode === 'view') {
      window.open(doc.link_url!, '_blank', 'noopener,noreferrer');
      return;
    }
    if (isLink && !doc.link_is_pdf) {
      return;
    }

    const fileName = isLink ? `${doc.name}.pdf` : doc.file_name;
    const mimetype = isLink ? 'application/pdf' : doc.file_mimetype;
    if (!fileName || !mimetype || this.busyId() !== null) {
      return;
    }

    this.busyId.set(doc.id);
    this.errorMessage.set('');
    this.publicFiles.open(`${DOCUMENTS_API}/${doc.id}/file`, fileName, mimetype, mode).subscribe({
      next: () => this.busyId.set(null),
      error: (error) => {
        this.errorMessage.set(
          buildSubmitErrorMessage(error, {
            notFoundMessage: isLink
              ? 'This PDF could not be downloaded from the website it is on. Please use View to open it instead.'
              : 'This document is no longer available. Please refresh the page.',
            fallbackMessage: 'Unable to open the document. Please try again.',
          }),
        );
        this.busyId.set(null);
      },
    });
  }

  private get headers(): HttpHeaders {
    return new HttpHeaders({ Authorization: getAuthHeader() });
  }
}
