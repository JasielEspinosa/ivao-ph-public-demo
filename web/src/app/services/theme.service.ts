import { Injectable, effect, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap, throwError } from 'rxjs';

import { AdminAuthService, THEME_PREFERENCES, ThemePreference } from './admin-auth.service';

/** The cached copy is only trusted for the user it was saved for, so shared workstations never mix users. */
const THEME_CACHE_KEY = 'ivao_ui_theme_v1';
/** Choice of visitors who are not logged in (the public pages); light until they pick otherwise. */
const PUBLIC_THEME_KEY = 'ivao_public_theme_v1';
/** When the "Try switching themes" balloon was last shown on this device, and whether the switch was ever used. */
const THEME_HINT_KEY = 'ivao_theme_hint_v1';
/** The balloon comes back this often until the visitor uses the switch. */
const THEME_HINT_REPEAT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Logged-in users get their saved choice (`ui_theme` on the account, mirrored into localStorage so the first paint,
 * see the inline script in index.html, is already correct). Visitors who are not logged in start on light and can
 * switch on any page (the login page included); that choice stays in this browser only. Forgot-password and
 * set-password pages are always light.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly authService = inject(AdminAuthService);
  private readonly systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  private themeablePage = false;
  private readonly publicPreference = signal<ThemePreference>(this.readPublicPreference());
  /** The choice being saved; a signal so templates showing the theme update if saving fails and it reverts. */
  private readonly pendingPreference = signal<ThemePreference | null>(null);

  constructor() {
    this.systemDarkQuery.addEventListener('change', () => this.refresh());
    // Re-applies when the session user changes (login, logout, the 60s session refresh from another device).
    effect(() => {
      this.authService.getCurrentUser();
      this.refresh();
    });
  }

  /** Called on every navigation with whether the page being shown follows the theme (false: always light). */
  apply(isThemeablePage: boolean): void {
    this.themeablePage = isThemeablePage;
    this.refresh();
  }

  /**
   * The signed-in user's choice: saved value, else this browser's cached copy for the same user, else light.
   * Without a signed-in user it is the visitor's own browser choice (light by default).
   */
  getPreference(): ThemePreference {
    const pending = this.pendingPreference();
    if (pending) {
      return pending;
    }

    const user = this.authService.getCurrentUser();
    if (!user) {
      return this.publicPreference();
    }

    return user.ui_theme ?? this.readCache(user.login_email) ?? 'light';
  }

  /**
   * Asks to show the "Try switching themes" balloon. True at most once per device per week, and never again once the
   * switch has been used; the time is recorded when this returns true. If storage is blocked it is true only once
   * per page load, so it never repeats on every navigation.
   */
  claimThemeHint(): boolean {
    const state = this.readHintState();
    const now = Date.now();
    if (state.done || (state.lastShown !== null && now - state.lastShown < THEME_HINT_REPEAT_MS)) {
      return false;
    }

    this.writeHintState({ lastShown: now, done: false });
    return true;
  }

  /** Applies the choice right away, then saves it to the account; the previous choice returns if saving fails. */
  setPreference(preference: ThemePreference): Observable<ThemePreference> {
    // Using the switch (or Profile Settings) means the visitor knows it: the balloon stops for good.
    this.writeHintState({ lastShown: this.readHintState().lastShown, done: true });

    const user = this.authService.getCurrentUser();
    if (!user) {
      this.publicPreference.set(preference);
      this.writePublicPreference(preference);
      this.refresh();
      return of(preference);
    }

    const previous = this.getPreference();
    this.pendingPreference.set(preference);
    this.refresh();

    return this.authService.updateOwnProfile({ ui_theme: preference }).pipe(
      map(() => preference),
      tap(() => {
        this.pendingPreference.set(null);
        this.writeCache(user.login_email, preference);
        this.refresh();
      }),
      catchError((error) => {
        this.pendingPreference.set(null);
        this.writeCache(user.login_email, previous);
        this.refresh();
        return throwError(() => error);
      }),
    );
  }

  /** The theme shown right now ('dark' never applies on the forgot-password and set-password pages). */
  isDark(): boolean {
    if (!this.themeablePage) {
      return false;
    }

    const preference = this.getPreference();
    return preference === 'dark' || (preference === 'system' && this.systemDarkQuery.matches);
  }

  private refresh(): void {
    const user = this.authService.getCurrentUser();
    if (user && !this.pendingPreference() && user.ui_theme) {
      this.writeCache(user.login_email, user.ui_theme);
    }

    const root = document.documentElement;
    if (this.isDark()) {
      root.setAttribute('data-theme', 'dark');
      root.setAttribute('data-bs-theme', 'dark');
      root.style.colorScheme = 'dark';
    } else {
      root.removeAttribute('data-theme');
      root.removeAttribute('data-bs-theme');
      root.style.removeProperty('color-scheme');
    }
  }

  /** Kept in memory too, so a browser that blocks storage still shows the balloon only once per page load. */
  private hintState: { lastShown: number | null; done: boolean } = { lastShown: null, done: false };

  private readHintState(): { lastShown: number | null; done: boolean } {
    try {
      const stored = JSON.parse(localStorage.getItem(THEME_HINT_KEY) || 'null');
      if (stored) {
        this.hintState = {
          lastShown: typeof stored.lastShown === 'number' ? stored.lastShown : null,
          done: stored.done === true,
        };
      }
    } catch {
      // Storage unavailable or corrupt: use the in-memory copy.
    }

    return this.hintState;
  }

  private writeHintState(state: { lastShown: number | null; done: boolean }): void {
    this.hintState = state;
    try {
      localStorage.setItem(THEME_HINT_KEY, JSON.stringify(state));
    } catch {
      // Storage unavailable: the in-memory copy still applies until the page is reloaded.
    }
  }

  private readPublicPreference(): ThemePreference {
    try {
      const stored = localStorage.getItem(PUBLIC_THEME_KEY);
      if (stored && THEME_PREFERENCES.includes(stored as ThemePreference)) {
        return stored as ThemePreference;
      }
    } catch {
      // Storage unavailable: stay on light.
    }

    return 'light';
  }

  private writePublicPreference(preference: ThemePreference): void {
    try {
      localStorage.setItem(PUBLIC_THEME_KEY, preference);
    } catch {
      // Storage unavailable: the choice applies until the page is reloaded.
    }
  }

  private readCache(loginEmail: string): ThemePreference | null {
    try {
      const cached = JSON.parse(localStorage.getItem(THEME_CACHE_KEY) || 'null');
      if (cached?.email === loginEmail && THEME_PREFERENCES.includes(cached?.theme)) {
        return cached.theme;
      }
    } catch {
      // Storage unavailable or corrupt: fall back to the saved value.
    }

    return null;
  }

  private writeCache(loginEmail: string | undefined, preference: ThemePreference): void {
    if (!loginEmail) {
      return;
    }

    try {
      localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({ email: loginEmail, theme: preference }));
    } catch {
      // Storage unavailable: the account value still applies after the next session load.
    }
  }
}
