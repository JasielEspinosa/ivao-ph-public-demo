import { Component, EventEmitter, Input, Output } from '@angular/core';

/** The View (eye) and Download buttons of a file on the public Documents and Charts pages (styles: styles-file-list.css). */
@Component({
  selector: 'app-file-actions',
  standalone: true,
  template: `
    <div class="file-actions">
      @if (canView) {
        <button
          type="button"
          class="universal-button universal-button--primary file-icon-button"
          [disabled]="busy"
          [title]="'View ' + label"
          [attr.aria-label]="'View ' + label"
          (click)="view.emit()"
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
        </button>
      }
      <button
        type="button"
        class="universal-button universal-button--edit file-icon-button"
        [disabled]="busy"
        [title]="'Download ' + label"
        [attr.aria-label]="'Download ' + label"
        (click)="download.emit()"
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
      </button>
    </div>
  `,
})
export class FileActionsComponent {
  /** What the buttons' labels call the file ("document", "chart"). */
  @Input() label = 'file';
  /** Only a PDF can be shown in the browser; other files are downloaded. */
  @Input() canView = true;
  /** The file is being fetched: both buttons wait. */
  @Input() busy = false;

  @Output() readonly view = new EventEmitter<void>();
  @Output() readonly download = new EventEmitter<void>();
}
