import { Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';

/** A downloadable document. `file` is a PDF under web/public/documents (relative, so the site's base href applies). */
interface DocumentEntry {
  readonly title: string;
  readonly description: string;
  readonly file: string;
  /** File name offered by the Download button. */
  readonly downloadName: string;
}

/** Public list of the division's documents. To add one, drop the PDF in web/public/documents and add a line here. */
@Component({
  selector: 'app-documents',
  standalone: true,
  imports: [PlaceholderBannerComponent],
  template: `
    <section class="page-shell">
      <div class="form-shell">
        <app-placeholder-banner title="Documents" subheading="IVAO PHILIPPINES"></app-placeholder-banner>

        <div class="dashboard-header">
          <p>Official documents of IVAO Philippines.</p>
        </div>

        <ul class="documents-list">
          @for (doc of documents; track doc.file) {
            <li class="documents-item">
              <div class="documents-item__text">
                <h2>
                  <a [href]="doc.file" target="_blank" rel="noopener noreferrer">{{ doc.title }}</a>
                </h2>
                <p>{{ doc.description }}</p>
              </div>
              <div class="documents-item__actions">
                <a
                  class="universal-button universal-button--primary documents-icon-button"
                  [href]="doc.file"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View document"
                  aria-label="View document"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </a>
                <a
                  class="universal-button universal-button--edit documents-icon-button"
                  [href]="doc.file"
                  [attr.download]="doc.downloadName"
                  title="Download document"
                  aria-label="Download document"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 3v12" />
                    <path d="M7 10l5 5 5-5" />
                    <path d="M4 21h16" />
                  </svg>
                </a>
              </div>
            </li>
          }
        </ul>
      </div>
    </section>
  `,
  styles: `
    .documents-list {
      display: grid;
      gap: 0.75rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .documents-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.75rem 1.5rem;
      padding: 1rem 1.25rem;
      border: 1px solid var(--c-line);
      border-radius: 8px;
      background: var(--c-surface);
    }

    .documents-item__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .documents-icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.6rem;
      text-decoration: none;
    }

    .documents-item__text h2 {
      margin: 0 0 0.25rem;
      font-size: 1.2rem;
    }

    .documents-item__text h2 a {
      color: var(--c-brand-ink);
      text-decoration: none;
    }

    .documents-item__text h2 a:hover,
    .documents-item__text h2 a:focus-visible {
      text-decoration: underline;
    }

    .documents-item__text p {
      margin: 0;
      color: var(--c-slate-500);
    }
  `,
})
export class DocumentsComponent {
  private readonly title = inject(Title);

  readonly documents: readonly DocumentEntry[] = [
    {
      title: 'RPHI Manila FIR ATC Standard Operating Procedures',
      description: 'Standard operating procedures for air traffic controllers in the Manila FIR (RPHI).',
      file: 'documents/RPHI-Manila-FIR-ATC-Standard-Operating-Procedures.pdf',
      downloadName: 'RPHI Manila FIR ATC Standard Operating Procedures.pdf',
    },
  ];

  constructor() {
    this.title.setTitle('IVAO Philippines - Documents');
  }
}
