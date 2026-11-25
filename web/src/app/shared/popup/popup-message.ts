import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, inject } from '@angular/core';

import { PopupService, PopupTone } from './popup.service';

/**
 * Shows a page's message in a popup: `<app-popup-message type="success" [message]="successMessage"
 * (closed)="successMessage = ''" />`. The popup opens when `message` becomes a non-empty text, closes when the user
 * presses OK (`closed`), and goes away by itself when the message is cleared or the page is left. Clearing the message
 * on `closed` lets the same text show again the next time.
 */
@Component({
  selector: 'app-popup-message',
  standalone: true,
  template: '',
  // No box of its own, so it adds no gap wherever a page puts it.
  styles: ':host { display: none; }',
})
export class PopupMessageComponent implements OnChanges, OnDestroy {
  @Input() message = '';
  @Input() type: PopupTone = 'error';
  /** Replaces the usual title (Success, Error, Notice). */
  @Input() title = '';
  @Output() readonly closed = new EventEmitter<void>();

  private readonly popups = inject(PopupService);
  private takeAway: (() => void) | null = null;

  ngOnChanges(): void {
    this.dismiss();
    if (this.message) {
      this.takeAway = this.popups.show(this.type, this.message, () => this.closed.emit(), this.title);
    }
  }

  ngOnDestroy(): void {
    this.dismiss();
  }

  private dismiss(): void {
    this.takeAway?.();
    this.takeAway = null;
  }
}
