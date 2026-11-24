import { CommonModule, Location } from '@angular/common';
import { AfterViewInit, Component, OnDestroy, inject, signal } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterOutlet,
} from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { SiteFooterComponent } from './placeholders/footer/site-footer';
import { SiteHeaderComponent } from './placeholders/header/site-header';
import { environment } from '../environments/environment';
import { AdminAuthService } from './services/admin-auth.service';
import { AppVersionService } from './services/app-version.service';
import { ThemeService } from './services/theme.service';
import { installAutoTrimInputs } from './shared/auto-trim-inputs';

export function getAuthHeader(): string {
  const username = environment.apiAuth.username;
  const password = environment.apiAuth.password;
  return `Basic ${btoa(`${username}:${password}`)}`;
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, SiteHeaderComponent, SiteFooterComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements AfterViewInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly authService = inject(AdminAuthService);
  private readonly appVersion = inject(AppVersionService);
  private readonly themeService = inject(ThemeService);
  private readonly location = inject(Location);
  private readonly resizedTables = new WeakSet<HTMLTableElement>();
  private tableResizeObserver: MutationObserver | null = null;

  /** Forgot-password and set-password stay light and have no theme switch; every other page (login included) follows the theme. */
  private readonly lightOnlyRoutes = new Set(['/forgot-password', '/set-password']);

  showThemeToggle = true;
  readonly isNavigating = signal(true);
  readonly backToTopEligible = signal(false);
  readonly backToTopScrolled = signal(false);
  private readonly onWindowScroll = (): void => this.backToTopScrolled.set(window.scrollY > 300);
  private readonly sessionTicker = window.setInterval(() => this.enforceSessionTimeout(), 30000);
  private readonly subscriptions = new Subscription();
  private readonly stopAutoTrimInputs = installAutoTrimInputs();
  private loadingDelayTimer: ReturnType<typeof setTimeout> | null = null;
  private hasCompletedInitialNavigation = false;
  private static readonly LOADING_START_DELAY_MS = 125;

  constructor() {
    const currentUrl = this.getCurrentRouteUrl();
    this.updateThemeMode(currentUrl);
    this.updateBackToTop(currentUrl);
    window.addEventListener('scroll', this.onWindowScroll, { passive: true });
    this.enforceSessionTimeout();
    this.appVersion.start();

    this.subscriptions.add(
      this.router.events.pipe(filter((event) => event instanceof NavigationStart)).subscribe((event) => {
        // A newer deployment exists: load the destination as a full page so the new bundle is used.
        if (
          this.hasCompletedInitialNavigation &&
          this.appVersion.reloadIfUpdateAvailable(this.location.prepareExternalUrl((event as NavigationStart).url))
        ) {
          return;
        }

        // The initial navigation performs the session login check and must show loading right away.
        if (!this.hasCompletedInitialNavigation) {
          this.isNavigating.set(true);
          return;
        }

        this.clearLoadingDelayTimer();
        this.loadingDelayTimer = setTimeout(() => {
          this.loadingDelayTimer = null;
          this.isNavigating.set(true);
        }, App.LOADING_START_DELAY_MS);
      }),
    );

    this.subscriptions.add(
      this.router.events
        .pipe(
          filter(
            (event) =>
              event instanceof NavigationEnd || event instanceof NavigationCancel || event instanceof NavigationError,
          ),
        )
        .subscribe(() => {
          this.clearLoadingDelayTimer();
          this.isNavigating.set(false);
          this.hasCompletedInitialNavigation = true;
        }),
    );

    this.subscriptions.add(
      this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((event) => {
        const url = (event as NavigationEnd).urlAfterRedirects;
        this.updateThemeMode(url);
        this.updateBackToTop(url);
        this.enforceSessionTimeout();
        this.initializeResizableTables();
      }),
    );
  }

  ngAfterViewInit(): void {
    this.initializeResizableTables();
    this.observeTableChanges();
  }

  ngOnDestroy(): void {
    window.clearInterval(this.sessionTicker);
    window.removeEventListener('scroll', this.onWindowScroll);
    this.stopAutoTrimInputs();
    this.clearLoadingDelayTimer();
    this.subscriptions.unsubscribe();
    this.tableResizeObserver?.disconnect();
    this.tableResizeObserver = null;
    document.body.classList.remove('column-resize-active');
  }

  scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** The long list pages get a "back to top" button: Members and the data management pages. */
  private updateBackToTop(url: string): void {
    const path = this.normalizePath(url);
    const isLongPage = path === '/members' || path === '/data-management' || path.endsWith('-manage');

    this.backToTopEligible.set(isLongPage);
    this.onWindowScroll();
  }

  private clearLoadingDelayTimer(): void {
    if (this.loadingDelayTimer !== null) {
      clearTimeout(this.loadingDelayTimer);
      this.loadingDelayTimer = null;
    }
  }
  private observeTableChanges(): void {
    if (this.tableResizeObserver) {
      return;
    }

    this.tableResizeObserver = new MutationObserver(() => {
      this.initializeResizableTables();
    });

    this.tableResizeObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  private initializeResizableTables(): void {
    const tables = document.querySelectorAll<HTMLTableElement>('.table-wrap table');
    tables.forEach((table) => {
      this.enableTableColumnResize(table);
      this.fitContentColumns(table);
    });
  }

  /**
   * Columns marked `data-fit-content` (e.g. ID) are fixed to the widest of their header label or cell text.
   * Re-measured on every DOM change because rows load after the table first renders. Measured with Range so no
   * DOM nodes are added (the table observer would otherwise re-trigger itself).
   */
  private fitContentColumns(table: HTMLTableElement): void {
    const headerRow = table.tHead?.rows[0];
    if (!headerRow) {
      return;
    }

    // Measure every column first, then write, so the browser does not re-layout once per column.
    const fits: Array<{ header: HTMLTableCellElement; width: number }> = [];
    Array.from(headerRow.cells).forEach((header) => {
      // A column the user dragged keeps their width instead of being re-fitted on the next DOM change.
      if (header.dataset['userResized'] || !header.hasAttribute('data-fit-content')) {
        return;
      }

      const columnIndex = header.cellIndex;
      const cells: HTMLTableCellElement[] = [];
      Array.from(table.tBodies).forEach((body) => {
        Array.from(body.rows).forEach((row) => {
          const cell = row.cells[columnIndex];
          if (cell && cell.colSpan === 1) {
            cells.push(cell);
          }
        });
      });

      let widest = this.measureRangeWidth(header.querySelector<HTMLElement>('.sort-header-button') ?? header);
      cells.forEach((cell) => {
        widest = Math.max(widest, this.measureRangeWidth(cell));
      });

      const headerStyle = window.getComputedStyle(header);
      const padding = Number.parseFloat(headerStyle.paddingLeft) + Number.parseFloat(headerStyle.paddingRight);
      fits.push({ header, width: Math.ceil(widest + padding) });
    });

    fits.forEach(({ header, width }) => {
      const fitted = `${width}px`;
      header.style.width = fitted;
      header.style.minWidth = fitted;
      header.style.maxWidth = fitted;
    });
  }

  private measureRangeWidth(element: HTMLElement): number {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().width;
  }

  private enableTableColumnResize(table: HTMLTableElement): void {
    if (this.resizedTables.has(table)) {
      return;
    }

    const headerRow = table.querySelector('thead tr');
    if (!headerRow) {
      return;
    }

    const headers = Array.from(headerRow.querySelectorAll<HTMLTableCellElement>('th'));
    if (!headers.length) {
      return;
    }

    const filterRow = table.querySelector('thead tr.column-filter-row');

    headers.forEach((header, headerIndex) => {
      if (header.hasAttribute('data-disable-resize')) {
        return;
      }

      if (header.querySelector('.column-resize-handle')) {
        return;
      }

      header.classList.add('resizable-column-header');
      if (!header.getAttribute('title')) {
        header.setAttribute('title', 'Drag the right edge to resize this column');
      }

      const setResizeHoverState = (event: PointerEvent) => {
        const rect = header.getBoundingClientRect();
        const isNearRightEdge = rect.right - event.clientX <= 12;
        header.classList.toggle('resize-hover', isNearRightEdge);
      };

      header.addEventListener('pointermove', (event: PointerEvent) => {
        setResizeHoverState(event);
      });

      header.addEventListener('pointerleave', () => {
        header.classList.remove('resize-hover');
      });

      // Every resizable column keeps its header label on one line: it cannot shrink below its own header text.
      header.style.minWidth = `${Math.ceil(this.measureHeaderLabelWidth(header))}px`;
      filterRow?.children[headerIndex]?.classList.add('resizable-wrap-column');

      // Header-fit columns start at an equal width (set in CSS) instead of being measured.
      const isEqualWidth = header.hasAttribute('data-equal-width') || header.hasAttribute('data-measure-header-only');

      const minWidth = this.getColumnMinWidthPx(header);
      // Remember the real minimum (header label width) so a later drag can shrink back down to it.
      if (!header.dataset['minWidthPx']) {
        header.dataset['minWidthPx'] = String(minWidth);
      }

      if (!header.style.width && !isEqualWidth) {
        const isHeaderOnly = header.hasAttribute('data-measure-header-only');
        const rawWidth = isHeaderOnly ? this.measureHeaderLabelWidth(header) : header.getBoundingClientRect().width;
        const measuredWidth = Math.max(minWidth, Math.round(rawWidth));
        header.style.width = `${measuredWidth}px`;

        // Auto table-layout would otherwise crush word-break columns to near-zero to make room for unwrapped ones.
        if (isHeaderOnly) {
          header.style.minWidth = `${measuredWidth}px`;
        }
      }

      const handle = document.createElement('span');
      handle.className = 'column-resize-handle';
      handle.setAttribute('aria-hidden', 'true');
      handle.setAttribute('title', 'Drag to resize column');

      header.addEventListener('pointerdown', (event: PointerEvent) => {
        const rect = header.getBoundingClientRect();
        const isNearRightEdge = rect.right - event.clientX <= 12;
        if (!isNearRightEdge) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.startColumnResize(header, event.clientX);
      });

      header.appendChild(handle);
    });

    this.resizedTables.add(table);
  }

  private startColumnResize(header: HTMLTableCellElement, startX: number): void {
    const startWidth = header.getBoundingClientRect().width;
    const minWidth = this.getColumnMinWidthPx(header);
    document.body.classList.add('column-resize-active');

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      header.dataset['userResized'] = 'true';
      const nextWidth = Math.max(minWidth, startWidth + deltaX);
      const roundedWidth = `${Math.round(nextWidth)}px`;

      header.style.width = roundedWidth;
      header.style.minWidth = roundedWidth;
      header.style.maxWidth = roundedWidth;
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      document.body.classList.remove('column-resize-active');
    };

    const onPointerUp = () => {
      cleanup();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  private measureHeaderLabelWidth(header: HTMLTableCellElement): number {
    const resizeHandleAllowance = 6;
    const labelButton = header.querySelector<HTMLElement>('.sort-header-button');
    if (!labelButton) {
      return header.getBoundingClientRect().width;
    }

    const clone = labelButton.cloneNode(true) as HTMLElement;
    clone.style.position = 'absolute';
    clone.style.visibility = 'hidden';
    clone.style.whiteSpace = 'nowrap';
    clone.style.width = 'auto';
    document.body.appendChild(clone);

    const labelWidth = clone.getBoundingClientRect().width;
    document.body.removeChild(clone);

    const headerStyle = window.getComputedStyle(header);
    const horizontalPadding = Number.parseFloat(headerStyle.paddingLeft) + Number.parseFloat(headerStyle.paddingRight);

    return labelWidth + horizontalPadding + resizeHandleAllowance;
  }

  private getColumnMinWidthPx(header: HTMLTableCellElement): number {
    const fallbackMinWidth = 90;
    const attrMinWidth = Number.parseFloat(header.dataset['minWidthPx'] || '');

    if (Number.isFinite(attrMinWidth) && attrMinWidth > 0) {
      return attrMinWidth;
    }

    const computedMinWidth = Number.parseFloat(window.getComputedStyle(header).minWidth);
    if (Number.isFinite(computedMinWidth) && computedMinWidth > 0) {
      return computedMinWidth;
    }

    return fallbackMinWidth;
  }

  private updateThemeMode(currentUrl: string): void {
    const pathName = this.normalizePath(currentUrl);

    // Every page follows the theme except forgot-password / set-password, which stay light and have no switch.
    const isThemeablePage = !this.lightOnlyRoutes.has(pathName);
    this.showThemeToggle = isThemeablePage;
    this.themeService.apply(isThemeablePage);
  }

  private enforceSessionTimeout(): void {
    const pathName = this.normalizePath(this.getCurrentRouteUrl());
    const isPublicRoute = this.authService.isPublicRoute(pathName);

    this.subscriptions.add(
      this.authService.revalidateSession(true).subscribe((isValid) => {
        if (!isValid && !isPublicRoute) {
          this.router.navigate(['/login']);
        }
      }),
    );
  }

  private normalizePath(url: string): string {
    const path = (url || '').split(/[?#]/)[0].trim();
    return path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;
  }

  private getCurrentRouteUrl(): string {
    const basePath = new URL(document.baseURI).pathname.replace(/\/$/, '');
    const browserPath = window.location.pathname.startsWith(basePath)
      ? window.location.pathname.slice(basePath.length) || '/'
      : window.location.pathname;
    const browserUrl = `${browserPath}${window.location.search}`;

    if (this.router.url === '/' && browserUrl !== '/') {
      return browserUrl;
    }

    return this.router.url || browserUrl;
  }
}
