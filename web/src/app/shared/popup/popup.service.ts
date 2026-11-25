import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';

/** How a message popup looks and what it is titled. */
export type PopupTone = 'success' | 'error' | 'info';

export interface PopupQuestion {
  title: string;
  message: string;
  /** What the button that goes ahead says ("Delete", "Approve"). */
  confirmLabel: string;
  /** The action cannot be taken back (delete, clear a password): its button is red. */
  danger?: boolean;
  /** The action gives a go-ahead (an approval): its button is green. */
  success?: boolean;
}

export interface Popup extends Required<PopupQuestion> {
  readonly id: number;
  readonly kind: 'question' | PopupTone;
  /** Closes it; `confirmed` is true only for a question that was answered with its go-ahead button. */
  readonly onClose: (confirmed: boolean) => void;
}

const TONE_TITLES: Readonly<Record<PopupTone, string>> = { success: 'Success', error: 'Error', info: 'Notice' };

/**
 * The popup windows of the site: questions to confirm an action, and success and error messages. They are shown one at a
 * time, in the order asked for, by `PopupHostComponent` (in the app's template). Pages normally use `ask` for questions
 * and `<app-popup-message>` for messages.
 */
@Injectable({ providedIn: 'root' })
export class PopupService {
  private readonly queue = signal<readonly Popup[]>([]);
  private nextId = 0;

  /** The popup on screen (null = none). */
  readonly current = computed<Popup | null>(() => this.queue()[0] ?? null);

  constructor() {
    // Leaving the page answers an open question with "no": its action belongs to the page that is going away.
    inject(Router)
      .events.pipe(filter((event) => event instanceof NavigationStart))
      .subscribe(() => {
        for (const popup of this.queue().filter((item) => item.kind === 'question')) {
          this.close(popup, false);
        }
      });
  }

  /** Asks the user to confirm an action: true to go ahead, false on Cancel, Escape or leaving the page. */
  ask(question: PopupQuestion): Promise<boolean> {
    return new Promise((resolve) =>
      this.add({ danger: false, success: false, ...question, kind: 'question', onClose: resolve }),
    );
  }

  /** Shows a message until the user closes it; the returned function takes it away without calling `onClose`. */
  show(tone: PopupTone, message: string, onClose: () => void, title = ''): () => void {
    const id = this.add({
      kind: tone,
      title: title || TONE_TITLES[tone],
      message,
      confirmLabel: 'OK',
      danger: false,
      success: false,
      onClose: () => onClose(),
    });
    return () => this.remove(id);
  }

  close(popup: Popup, confirmed: boolean): void {
    if (!this.queue().some((item) => item.id === popup.id)) {
      return;
    }
    this.remove(popup.id);
    popup.onClose(confirmed);
  }

  private add(popup: Omit<Popup, 'id'>): number {
    const id = ++this.nextId;
    this.queue.update((popups) => [...popups, { ...popup, id }]);
    return id;
  }

  private remove(id: number): void {
    this.queue.update((popups) => popups.filter((item) => item.id !== id));
  }
}
