import { Injectable, NgZone, inject } from '@angular/core';
import { BUILD_VERSION } from '../../environments/build-info';

/**
 * Detects a new deployment by comparing the version baked into this bundle with the server's version.json.
 * The update is applied on the user's next navigation (see App), so typed form data is never lost mid-page.
 */
@Injectable({ providedIn: 'root' })
export class AppVersionService {
  private static readonly CHECK_INTERVAL_MS = 5 * 60 * 1000;
  private static readonly RELOAD_GUARD_KEY = 'app-version-reload-target';

  private readonly zone = inject(NgZone);
  private updateAvailable = false;
  private started = false;

  start(): void {
    if (this.started || typeof window === 'undefined') {
      return;
    }
    this.started = true;

    void this.check();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.check();
      }
    });
    this.zone.runOutsideAngular(() => {
      window.setInterval(() => void this.check(), AppVersionService.CHECK_INTERVAL_MS);
    });
  }

  /** Full page load of `url` when a newer deployment exists; returns true if a reload was started. */
  reloadIfUpdateAvailable(url: string): boolean {
    if (!this.updateAvailable) {
      return false;
    }

    // Loop guard: if we already reloaded for this deployment and the bundle is still old, stop trying.
    try {
      const latest = sessionStorage.getItem(AppVersionService.RELOAD_GUARD_KEY);
      if (latest === this.latestVersion) {
        return false;
      }
      sessionStorage.setItem(AppVersionService.RELOAD_GUARD_KEY, this.latestVersion);
    } catch {
      // Storage unavailable: reload anyway, once per page load is bounded by the fresh bundle.
    }

    window.location.assign(url);
    return true;
  }

  private latestVersion = '';

  private async check(): Promise<void> {
    try {
      const response = await fetch(new URL(`version.json?ts=${Date.now()}`, document.baseURI).toString(), {
        cache: 'no-store',
      });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { version?: string };
      if (data.version && data.version !== BUILD_VERSION) {
        this.latestVersion = data.version;
        this.updateAvailable = true;
      }
    } catch {
      // Offline or server restarting: try again on the next check.
    }
  }
}
