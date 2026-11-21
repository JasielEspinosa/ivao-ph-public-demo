import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, map, of, retry, shareReplay, tap, throwError, timeout, timer } from 'rxjs';

import { environment } from '../../environments/environment';
import { getAuthHeader } from '../app';

export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

export interface AdminSessionUser {
  login_email: string;
  nickname: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  suffix: string | null;
  is_admin: boolean;
  manage_all_data: boolean;
  manage_data_codes: string[];
  /** Null when the stored session predates the theme setting; the next session refresh fills it in. */
  ui_theme: ThemePreference | null;
}

/** Fields left out are kept as stored, so a theme-only save does not touch the name or password. */
export interface OwnProfilePayload {
  nickname?: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  suffix?: string;
  ui_theme?: ThemePreference;
  current_password?: string;
  new_password?: string;
  confirm_password?: string;
}

interface LoginApiResponse {
  token: string;
  expires_at: string;
  server_time?: string;
  user: AdminSessionUser;
}

interface SessionApiResponse {
  valid: boolean;
  user: AdminSessionUser;
  /** Renewed token (sliding session); absent when talking to an older backend. */
  token?: string;
  expires_at?: string;
  server_time?: string;
}

interface StoredAdminSession {
  token: string;
  expiresAt: string;
  /** Server time minus device time, so a wrong phone clock does not expire the session early or late. */
  clockOffsetMs?: number;
  user: AdminSessionUser;
}

@Injectable({ providedIn: 'root' })
export class AdminAuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private session: StoredAdminSession | null = null;
  private lastRevalidatedAt = 0;
  private inflightRevalidation: Observable<boolean> | null = null;
  private static readonly FORCED_REVALIDATE_REUSE_MS = 5000;
  private static readonly SESSION_CHECK_TIMEOUT_MS = 15000;
  private static readonly SESSION_CHECK_RETRIES = 2;
  private static readonly SESSION_CHECK_RETRY_DELAY_MS = 1000;
  private readonly sessionVersion = signal(0);

  constructor() {
    this.restoreSession();
    this.watchBrowserSession();
  }

  login(loginEmail: string, loginPassword: string): Observable<LoginApiResponse> {
    const formBody = new URLSearchParams();
    formBody.set('login_email', loginEmail);
    formBody.set('login_password', loginPassword);

    return this.http
      .post<LoginApiResponse>(`${environment.adminAuthApi}/login`, formBody.toString(), {
        headers: new HttpHeaders({
          Authorization: getAuthHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      })
      .pipe(
        tap((response) => {
          this.session = {
            token: response.token,
            expiresAt: response.expires_at,
            clockOffsetMs: this.computeClockOffsetMs(response.server_time),
            user: {
              ...this.normalizeSessionUser(response.user),
            },
          };
          this.lastRevalidatedAt = Date.now();
          this.persistSession();
          this.notifySessionChanged();
        }),
      );
  }

  requestPasswordReset(loginEmail: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `${environment.adminAuthApi}/forgot-password`,
      { login_email: loginEmail },
      { headers: this.getPublicApiHeaders() },
    );
  }

  setNewPassword(token: string, newPassword: string, confirmPassword: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `${environment.adminAuthApi}/set-password`,
      { token, new_password: newPassword, confirm_password: confirmPassword },
      { headers: this.getPublicApiHeaders() },
    );
  }

  validatePasswordSetupToken(token: string): Observable<{ valid: boolean }> {
    return this.http.post<{ valid: boolean }>(
      `${environment.adminAuthApi}/set-password/validate`,
      { token },
      { headers: this.getPublicApiHeaders() },
    );
  }

  private getPublicApiHeaders(): HttpHeaders {
    return new HttpHeaders({
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
    });
  }

  revalidateSession(force = false): Observable<boolean> {
    if (!this.ensureActiveSession()) {
      return of(false);
    }

    const now = Date.now();
    const maxAgeMs = force ? AdminAuthService.FORCED_REVALIDATE_REUSE_MS : environment.revalidateIntervalMs;

    if (now - this.lastRevalidatedAt < maxAgeMs) {
      return of(true);
    }

    // App bootstrap, route guards and the login page can all call this at once; share one request.
    if (this.inflightRevalidation) {
      return this.inflightRevalidation;
    }

    this.inflightRevalidation = this.http
      .get<SessionApiResponse>(`${environment.adminAuthApi}/session`, {
        headers: this.getAdminApiHeaders(),
      })
      .pipe(
        // A stalled mobile connection must fail fast and be retried, not hang the page.
        timeout(AdminAuthService.SESSION_CHECK_TIMEOUT_MS),
        retry({
          count: AdminAuthService.SESSION_CHECK_RETRIES,
          delay: (error) =>
            this.isSessionRejection(error)
              ? throwError(() => error)
              : timer(AdminAuthService.SESSION_CHECK_RETRY_DELAY_MS),
        }),
        map((response) => {
          if (!response?.valid || !response?.user) {
            return false;
          }

          // Sliding session: take the renewed token so active users are not logged out at the old expiry.
          this.session = {
            ...this.session!,
            ...(response.token && response.expires_at
              ? {
                  token: response.token,
                  expiresAt: response.expires_at,
                  clockOffsetMs: this.computeClockOffsetMs(response.server_time),
                }
              : {}),
            user: {
              ...this.normalizeSessionUser(response.user),
            },
          };
          this.lastRevalidatedAt = now;
          this.persistSession();
          this.notifySessionChanged();

          return true;
        }),
        catchError((error: unknown) => {
          // Only the server saying "this session is not valid" ends the session. A dropped connection, timeout or
          // 5xx (common on mobile networks) says nothing about the session, so keep it; the API still enforces it.
          if (this.isSessionRejection(error)) {
            this.clearSession();
            return of(false);
          }

          return of(this.ensureActiveSession());
        }),
        finalize(() => {
          this.inflightRevalidation = null;
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );

    return this.inflightRevalidation;
  }

  /** Ends the session. The site is public, so signing out lands on the Home page. */
  logout(redirectToHome = true): void {
    this.clearSession();

    if (redirectToHome) {
      this.router.navigate(['/home']);
    }
  }

  ensureActiveSession(): boolean {
    if (!this.session) {
      return false;
    }

    if (this.isSessionExpired()) {
      this.clearSession();
      return false;
    }

    return true;
  }

  getCurrentUser(): AdminSessionUser | null {
    this.sessionVersion();

    if (!this.ensureActiveSession()) {
      return null;
    }

    return this.session!.user;
  }

  getCurrentUserDisplayLabel(): string | null {
    const user = this.getCurrentUser();
    if (!user) {
      return null;
    }

    const nickname = String(user.nickname || '').trim();
    const firstName = String(user.first_name || '').trim();
    const lastName = String(user.last_name || '').trim();
    const loginEmail = String(user.login_email || '').trim();

    if (nickname) {
      return nickname;
    }

    if (firstName && lastName) {
      return `${firstName} ${lastName}`;
    }

    if (firstName || lastName) {
      return firstName || lastName;
    }

    return loginEmail || null;
  }

  updateCurrentUserProfile(
    originalLoginEmail: string,
    userProfile: Pick<
      AdminSessionUser,
      | 'login_email'
      | 'nickname'
      | 'first_name'
      | 'middle_name'
      | 'last_name'
      | 'suffix'
      | 'is_admin'
      | 'manage_all_data'
      | 'manage_data_codes'
    >,
  ): void {
    if (!this.ensureActiveSession()) {
      return;
    }

    const activeLoginEmail = this.session!.user.login_email.trim().toLowerCase();
    if (activeLoginEmail !== originalLoginEmail.trim().toLowerCase()) {
      return;
    }

    this.session = {
      ...this.session!,
      user: this.normalizeSessionUser({
        ...this.session!.user,
        ...userProfile,
      }),
    };
    this.persistSession();
    this.notifySessionChanged();
  }

  /** Saves the logged-in user's own name details (and password, when given) and refreshes the stored session. */
  updateOwnProfile(payload: OwnProfilePayload): Observable<AdminSessionUser> {
    return this.http
      .put<{ success: boolean; user: AdminSessionUser }>(`${environment.adminAuthApi}/profile`, payload, {
        headers: this.getAdminApiHeaders(),
      })
      .pipe(
        map((response) => {
          const user = this.normalizeSessionUser(response.user);
          if (this.ensureActiveSession()) {
            this.session = { ...this.session!, user };
            this.persistSession();
            this.notifySessionChanged();
          }

          return user;
        }),
      );
  }

  hasAdminRole(): boolean {
    const user = this.getCurrentUser();
    return Boolean(user?.is_admin);
  }

  /** True when the user may open at least one data management page (all of them, or any individual page code). */
  hasDataManagementAccess(): boolean {
    const user = this.getCurrentUser();
    if (!user) {
      return false;
    }

    if (user.is_admin || user.manage_all_data) {
      return true;
    }

    return this.normalizeCodes(user.manage_data_codes).length > 0;
  }

  canAccessDataManagementCode(pageCode: string): boolean {
    const user = this.getCurrentUser();
    if (!user) {
      return false;
    }

    if (user.is_admin || user.manage_all_data) {
      return true;
    }

    const normalizedCode = (pageCode || '').trim().toUpperCase();
    return this.normalizeCodes(user.manage_data_codes).includes(normalizedCode);
  }

  getAdminApiHeaders(): HttpHeaders {
    const token = this.getSessionToken();

    return new HttpHeaders({
      Authorization: getAuthHeader(),
      'x-admin-session': token,
    });
  }

  /** Pages anyone can open without signing in. Everything else (profile, admin, data management) needs a session. */
  isPublicRoute(routePath: string): boolean {
    const sanitizedRoutePath = (routePath || '').split('?')[0].replace(/\/$/, '');
    const publicRoutes = new Set([
      '',
      '/home',
      '/members',
      '/documents',
      '/privacy-policy',
      '/login',
      '/forgot-password',
      '/set-password',
    ]);

    return publicRoutes.has(sanitizedRoutePath);
  }

  private getSessionToken(): string {
    if (!this.ensureActiveSession()) {
      return '';
    }

    return this.session!.token;
  }

  private isSessionExpired(): boolean {
    if (!this.session) {
      return true;
    }

    const expiresAt = new Date(this.session.expiresAt).getTime();
    return !Number.isFinite(expiresAt) || expiresAt <= Date.now() + (this.session.clockOffsetMs ?? 0);
  }

  /** True only when the server itself says the session is not valid (401/403), never for network trouble. */
  private isSessionRejection(error: unknown): boolean {
    return error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403);
  }

  private computeClockOffsetMs(serverTime?: string): number {
    const serverMs = serverTime ? new Date(serverTime).getTime() : NaN;
    return Number.isFinite(serverMs) ? serverMs - Date.now() : 0;
  }

  private restoreSession(): void {
    const rawValue = localStorage.getItem(environment.sessionStorageKey);
    if (!rawValue) {
      return;
    }

    try {
      const parsedSession = JSON.parse(rawValue) as StoredAdminSession;
      this.session = {
        token: String(parsedSession.token || ''),
        expiresAt: String(parsedSession.expiresAt || ''),
        clockOffsetMs: Number.isFinite(parsedSession.clockOffsetMs) ? parsedSession.clockOffsetMs : 0,
        user: this.normalizeSessionUser(parsedSession.user),
      };
      this.notifySessionChanged();

      if (!this.ensureActiveSession()) {
        this.clearSession();
      }
    } catch {
      this.clearSession();
    }
  }

  /**
   * Keeps the session alive and in sync without waiting for the next click:
   * - returning to the tab or regaining the network renews the token (phones suspend background tabs);
   * - another tab logging in, renewing or logging out is picked up here.
   */
  private watchBrowserSession(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const renewIfNeeded = () => {
      if (document.visibilityState === 'hidden' || !this.ensureActiveSession()) {
        return;
      }

      this.revalidateSession().subscribe((isValid) => this.leaveIfSignedOut(isValid));
    };

    document.addEventListener('visibilitychange', renewIfNeeded);
    window.addEventListener('online', renewIfNeeded);
    window.addEventListener('storage', (event) => {
      if (event.key !== environment.sessionStorageKey) {
        return;
      }

      if (!event.newValue) {
        this.session = null;
        this.lastRevalidatedAt = 0;
        this.notifySessionChanged();
        this.leaveIfSignedOut(false);
        return;
      }

      this.restoreSession();
    });
  }

  private leaveIfSignedOut(isValid: boolean): void {
    const routePath = this.router.url.split(/[?#]/)[0];
    if (!isValid && !this.isPublicRoute(routePath)) {
      this.router.navigate(['/login']);
    }
  }

  private persistSession(): void {
    if (!this.session) {
      return;
    }

    localStorage.setItem(environment.sessionStorageKey, JSON.stringify(this.session));
  }

  private clearSession(): void {
    this.session = null;
    this.lastRevalidatedAt = 0;
    localStorage.removeItem(environment.sessionStorageKey);
    this.notifySessionChanged();
  }

  private notifySessionChanged(): void {
    this.sessionVersion.update((version) => version + 1);
  }

  private normalizeCodes(rawCodes: unknown): string[] {
    if (!Array.isArray(rawCodes)) {
      return [];
    }

    return rawCodes
      .map((value) =>
        String(value || '')
          .trim()
          .toUpperCase(),
      )
      .filter((value) => value.length > 0);
  }

  private normalizeSessionUser(rawUser: any): AdminSessionUser {
    return {
      login_email: String(rawUser?.login_email || ''),
      nickname: rawUser?.nickname ?? null,
      first_name: rawUser?.first_name ?? null,
      middle_name: rawUser?.middle_name ?? null,
      last_name: rawUser?.last_name ?? null,
      suffix: rawUser?.suffix ?? null,
      is_admin: Boolean(rawUser?.is_admin),
      manage_all_data: Boolean(rawUser?.manage_all_data),
      manage_data_codes: this.normalizeCodes(rawUser?.manage_data_codes),
      ui_theme: THEME_PREFERENCES.includes(rawUser?.ui_theme) ? rawUser.ui_theme : null,
    };
  }
}
