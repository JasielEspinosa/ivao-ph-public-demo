import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

import { environment } from '../../environments/environment';
import { getAuthHeader } from '../app';
import { buildSubmitErrorMessage } from '../shared/submit-error-utils';

/** A pilot's latest SimBrief flight plan, as returned by GET /api/simbrief/:pilotIdOrUsername. */
export interface SimbriefFlightPlan {
  readonly callsign: string | null;
  readonly origin: string | null;
  readonly destination: string | null;
  readonly alternate: string | null;
  readonly aircraft: string | null;
  readonly cruiseAltitude: string | null;
  readonly route: string | null;
  /** The "(FPL-...)" text for IVAO's ICAO import; null when SimBrief gave none. */
  readonly icaoFlightPlan: string | null;
}

const SIMBRIEF_API = `${environment.apiUrl.replace(/\/$/, '')}/simbrief`;
const SIMBRIEF_UNAVAILABLE_MESSAGE = 'SimBrief is not available right now. Please try again in a few moments.';
const LOOKUP_PATTERN = /^(\d{1,10}|[A-Za-z0-9._-]{2,40})$/;

/** Looks up the latest SimBrief flight plan of a Pilot ID or username, for the Pilot's Lounge. */
@Injectable({ providedIn: 'root' })
export class SimbriefService {
  private readonly http = inject(HttpClient);

  readonly lookup = signal('');
  readonly loading = signal(false);
  readonly error = signal('');
  readonly flightPlan = signal<SimbriefFlightPlan | null>(null);

  /** Keeps the field to what a Pilot ID or username can contain. */
  setLookupFromInput(input: HTMLInputElement): void {
    const value = input.value.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40);
    input.value = value;
    this.lookup.set(value);
  }

  fetch(): void {
    const lookup = this.lookup();
    this.flightPlan.set(null);

    if (!LOOKUP_PATTERN.test(lookup)) {
      this.error.set('Enter your SimBrief Pilot ID or username. A callsign cannot be used to find a flight plan.');
      return;
    }

    this.error.set('');
    this.loading.set(true);
    this.http
      .get<SimbriefFlightPlan>(`${SIMBRIEF_API}/${encodeURIComponent(lookup)}`, {
        headers: new HttpHeaders({ Authorization: getAuthHeader() }),
      })
      .subscribe({
        next: (flightPlan) => {
          this.flightPlan.set(flightPlan);
          this.loading.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.error.set(buildSubmitErrorMessage(error, { fallbackMessage: SIMBRIEF_UNAVAILABLE_MESSAGE }));
          this.loading.set(false);
        },
      });
  }
}
