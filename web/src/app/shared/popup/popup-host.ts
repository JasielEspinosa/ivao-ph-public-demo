import { Component, ElementRef, ViewChild, computed, inject } from '@angular/core';

import { PopupService } from './popup.service';

/**
 * Draws the popup on screen (see PopupService). A native modal `<dialog>`, so it opens above everything else, including
 * the site's other windows.
 */
@Component({
  selector: 'app-popup-host',
  standalone: true,
  templateUrl: './popup-host.html',
  styleUrl: './popup-host.css',
})
export class PopupHostComponent {
  readonly popups = inject(PopupService);

  /** A list of at most one, so every popup gets a window of its own (and with it the keyboard focus). */
  readonly shown = computed(() => {
    const popup = this.popups.current();
    return popup ? [popup] : [];
  });

  /** The window is shown as soon as it is on the page. */
  @ViewChild('dialog') set dialog(element: ElementRef<HTMLDialogElement> | undefined) {
    if (element && !element.nativeElement.open) {
      element.nativeElement.showModal();
    }
  }
}
