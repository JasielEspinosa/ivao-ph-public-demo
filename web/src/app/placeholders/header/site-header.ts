import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, Input, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';

import { AdminAuthService } from '../../services/admin-auth.service';
import { ApprovalNotificationsComponent } from '../../shared/approval-notifications/approval-notifications';
import { ThemeToggleComponent } from '../../shared/theme-toggle/theme-toggle';

/** How far the page is scrolled (px) before the header switches to its compact mode. */
const COMPACT_SCROLL_OFFSET = 40;

/**
 * The site header on every page: IVAO Philippines logo (links to ivao.aero), the main menu, the theme switch, the
 * notification button (event approvers only), and Log-In (visitors) or the user menu with Log-Out (signed-in users).
 * Profile Settings, Data Management and Admin Settings appear in the user menu only, and only for the users who may
 * open them.
 */
@Component({
  selector: 'app-site-header',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, ThemeToggleComponent, ApprovalNotificationsComponent],
  templateUrl: './site-header.html',
  styleUrl: './site-header.css',
})
export class SiteHeaderComponent implements AfterViewInit {
  /** The forgot-password and set-password pages stay light and have no theme switch. */
  @Input() showThemeToggle = true;

  private readonly authService = inject(AdminAuthService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Phone: the main menu opens as a panel under the bar. */
  readonly menuOpen = signal(false);
  readonly rulesOpen = signal(false);
  readonly userMenuOpen = signal(false);

  /**
   * Scrolled down: the header is cut in the center and only the logo, theme switch, notification button and one dropdown
   * with every menu stay.
   */
  readonly compact = signal(false);
  readonly compactMenuOpen = signal(false);

  constructor() {
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => this.closeAll());
  }

  ngAfterViewInit(): void {
    // A reload in the middle of a page keeps its scroll position, so start in the right mode.
    this.updateCompact();
  }

  get userLabel(): string | null {
    return this.authService.getCurrentUserDisplayLabel();
  }

  get canManageData(): boolean {
    return this.authService.hasDataManagementAccess();
  }

  get isAdmin(): boolean {
    return this.authService.hasAdminRole();
  }

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
    this.rulesOpen.set(false);
    this.userMenuOpen.set(false);
  }

  toggleRules(): void {
    this.rulesOpen.update((open) => !open);
    this.userMenuOpen.set(false);
  }

  toggleUserMenu(): void {
    this.userMenuOpen.update((open) => !open);
    this.rulesOpen.set(false);
  }

  toggleCompactMenu(): void {
    this.compactMenuOpen.update((open) => !open);
  }

  logout(): void {
    this.closeAll();
    this.authService.logout();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.rulesOpen.set(false);
      this.userMenuOpen.set(false);
      this.compactMenuOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeAll();
  }

  @HostListener('window:scroll')
  onScroll(): void {
    this.updateCompact();
  }

  closeAll(): void {
    this.menuOpen.set(false);
    this.rulesOpen.set(false);
    this.userMenuOpen.set(false);
    this.compactMenuOpen.set(false);
  }

  private updateCompact(): void {
    const shouldCompact = window.scrollY > COMPACT_SCROLL_OFFSET;
    if (shouldCompact === this.compact()) {
      return;
    }

    const host = this.host.nativeElement;
    if (shouldCompact) {
      // The compact bar is fixed to the window, so the host keeps the full header height as a placeholder:
      // the page below does not jump, and the scroll position cannot flip-flop between the two modes.
      host.style.height = `${host.offsetHeight}px`;
    } else {
      host.style.height = '';
    }

    this.compact.set(shouldCompact);
    this.closeAll();
  }
}
