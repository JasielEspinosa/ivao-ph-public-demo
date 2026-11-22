import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, tap, throwError } from 'rxjs';

import { getAuthHeader } from '../app';

/**
 * Shows or saves a file of the public pages (Documents, Charts). The API asks for a login of the site itself (not of a
 * user), which a plain link cannot send, so the file is fetched with the request headers and then shown or saved from
 * the browser's memory.
 */
@Injectable({ providedIn: 'root' })
export class PublicFileService {
  private readonly http = inject(HttpClient);

  /**
   * Call this directly from the click: a tab opened after the file arrives can be blocked as a pop-up, so for `view` the
   * tab is opened now and pointed at the file later. Subscribe to start the download; errors are passed on.
   */
  open(url: string, fileName: string, mimetype: string, mode: 'view' | 'download'): Observable<void> {
    const viewer = mode === 'view' ? window.open('', '_blank') : null;

    return this.http
      .get(url, { headers: new HttpHeaders({ Authorization: getAuthHeader() }), responseType: 'blob' })
      .pipe(
        tap((blob) => {
          const objectUrl = URL.createObjectURL(new Blob([blob], { type: mimetype }));
          if (viewer) {
            viewer.location.href = objectUrl;
          } else {
            const link = document.createElement('a');
            link.href = objectUrl;
            if (mode === 'download') {
              link.download = fileName;
            } else {
              link.target = '_blank';
              link.rel = 'noopener';
            }
            link.click();
          }

          // Give the browser time to load the file before the temporary address is released.
          setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        }),
        map(() => undefined),
        catchError((error) => {
          viewer?.close();
          return throwError(() => error);
        }),
      );
  }
}
