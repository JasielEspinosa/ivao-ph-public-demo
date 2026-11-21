import { AfterViewInit, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

const TWO_COLUMN_CLASS = 'menu-columns--two';
const SINGLE_COLUMN_MAX_WIDTH = 900;
const BOTTOM_SPACE_PX = 24;

/**
 * Keeps a menu card list in one column and switches it to two columns when the single column
 * would run past the bottom of the browser window (small windows or zoomed-in pages).
 */
@Directive({
  selector: '[appMenuColumns]',
  standalone: true,
})
export class MenuColumnsDirective implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly onResize = () => this.update();
  private readonly mutationObserver = new MutationObserver(() => this.update());

  ngAfterViewInit(): void {
    window.addEventListener('resize', this.onResize);
    this.mutationObserver.observe(this.host, { childList: true });
    this.update();
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.mutationObserver.disconnect();
  }

  private update(): void {
    // Always measure the single-column height so the result does not depend on the current state.
    this.host.classList.remove(TWO_COLUMN_CLASS);
    if (window.innerWidth <= SINGLE_COLUMN_MAX_WIDTH) {
      return;
    }

    const singleColumnBottom = this.host.getBoundingClientRect().bottom + window.scrollY;
    if (singleColumnBottom > window.innerHeight - BOTTOM_SPACE_PX) {
      this.host.classList.add(TWO_COLUMN_CLASS);
    }
  }
}
