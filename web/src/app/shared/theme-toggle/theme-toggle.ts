import { CommonModule } from '@angular/common';
import { Component, inject, Input, OnChanges, OnDestroy, signal, SimpleChanges } from '@angular/core';

import { ThemePreference } from '../../services/admin-auth.service';
import { ThemeService } from '../../services/theme.service';

/** How long the friendly "Try ..." balloon stays visible. */
const THEME_HINT_DURATION_MS = 3000;
/** The balloon waits this long after the page has finished loading, so it never competes with the content appearing. */
const THEME_HINT_DELAY_AFTER_LOAD_MS = 1000;

/** Icon button in the headers that cycles Light, Dark, System. Used by the admin header and the public form header. */
@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './theme-toggle.html',
  styleUrl: './theme-toggle.css',
})
export class ThemeToggleComponent implements OnChanges, OnDestroy {
  /** True on `*-form` pages: the balloon may point at the button for 3 seconds (once per device per week, see ThemeService). */
  @Input() showHint = false;

  readonly hintMessage = 'Try switching themes here: Light, Dark, or match your device!';
  readonly hintVisible = signal(false);

  private readonly themeService = inject(ThemeService);
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private loadListener: (() => void) | null = null;

  get themePreference(): ThemePreference {
    return this.themeService.getPreference();
  }

  /** The label names the current choice and what the next click switches to. */
  get themeToggleLabel(): string {
    const names: Record<ThemePreference, string> = {
      light: 'Light',
      dark: 'Dark',
      system: 'System (match this device)',
    };
    return `Theme: ${names[this.themePreference]}. Click for ${names[ThemeToggleComponent.nextTheme(this.themePreference)]}.`;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['showHint']) {
      return;
    }
    this.closeHint();
    if (this.showHint) {
      this.scheduleHint();
    }
  }

  ngOnDestroy(): void {
    this.closeHint();
  }

  /** Light, then Dark, then System (follows the device). A failed save just reverts the choice. */
  cycleTheme(): void {
    this.closeHint();
    this.themeService
      .setPreference(ThemeToggleComponent.nextTheme(this.themePreference))
      .subscribe({ error: () => undefined });
  }

  /** Waits until the page (images included) has finished loading, plus a short settle delay, before showing. */
  private scheduleHint(): void {
    const startSettleDelay = (): void => {
      this.hintTimer = setTimeout(() => {
        // Only now is the hint "used up" for this week, so leaving the page early does not waste it.
        if (this.showHint && this.themeService.claimThemeHint()) {
          this.openHint();
        }
      }, THEME_HINT_DELAY_AFTER_LOAD_MS);
    };

    if (document.readyState === 'complete') {
      startSettleDelay();
      return;
    }

    this.loadListener = () => {
      this.loadListener = null;
      startSettleDelay();
    };
    window.addEventListener('load', this.loadListener, { once: true });
  }

  private openHint(): void {
    this.hintVisible.set(true);
    this.hintTimer = setTimeout(() => this.closeHint(), THEME_HINT_DURATION_MS);
  }

  /** Hides the balloon and cancels anything still pending (waiting for the page load, the settle delay, the 3 seconds). */
  private closeHint(): void {
    if (this.hintTimer !== null) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    if (this.loadListener) {
      window.removeEventListener('load', this.loadListener);
      this.loadListener = null;
    }
    this.hintVisible.set(false);
  }

  private static nextTheme(current: ThemePreference): ThemePreference {
    return current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light';
  }
}
