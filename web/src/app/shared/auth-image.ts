import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Directive, ElementRef, Input, OnChanges, OnDestroy, inject } from '@angular/core';
import { Subscription } from 'rxjs';

import { getAuthHeader } from '../app';
import { AdminAuthService } from '../services/admin-auth.service';

/**
 * Shows a picture of the API in an `<img>`. The API asks for a login of the site itself (and, for the Data Management
 * routes, of the user), which a plain `src` cannot send, so the picture is fetched with the request headers and shown
 * from the browser's memory. An empty address, or a picture that cannot be loaded, shows `appAuthFallback` instead.
 *
 * `<img [appAuthSrc]="url" appAuthFallback="images/home/event-launch.svg" [appAuthAdmin]="true" />`
 */
@Directive({ selector: 'img[appAuthSrc]', standalone: true })
export class AuthImageDirective implements OnChanges, OnDestroy {
  /** The API address of the picture ('' for no picture). */
  @Input() appAuthSrc = '';
  /** Shown while no picture is available. */
  @Input() appAuthFallback = '';
  /** Send the signed-in user's session as well (the Data Management routes). */
  @Input() appAuthAdmin = false;

  private readonly http = inject(HttpClient);
  private readonly authService = inject(AdminAuthService);
  private readonly image = inject<ElementRef<HTMLImageElement>>(ElementRef).nativeElement;

  private request: Subscription | null = null;
  private objectUrl = '';

  ngOnChanges(): void {
    this.release();
    this.image.src = this.appAuthFallback;
    if (!this.appAuthSrc) {
      return;
    }

    const headers = this.appAuthAdmin
      ? this.authService.getAdminApiHeaders()
      : new HttpHeaders({ Authorization: getAuthHeader() });
    this.request = this.http.get(this.appAuthSrc, { headers, responseType: 'blob' }).subscribe({
      next: (blob) => {
        this.objectUrl = URL.createObjectURL(blob);
        this.image.src = this.objectUrl;
      },
      // The fallback stays.
      error: () => undefined,
    });
  }

  ngOnDestroy(): void {
    this.release();
  }

  private release(): void {
    this.request?.unsubscribe();
    this.request = null;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = '';
    }
  }
}
