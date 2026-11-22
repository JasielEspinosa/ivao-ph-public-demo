import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, WritableSignal, computed, inject, signal } from '@angular/core';

import { environment } from '../../environments/environment';
import { getAuthHeader } from '../app';
import { buildSubmitErrorMessage } from '../shared/submit-error-utils';

/** A report from the closest airport that publishes one, shown when the airport asked for has none. */
export interface NearbyReport {
  readonly icao: string;
  readonly name: string;
  readonly distanceKm: number;
  /** Compass direction from the airport asked for, e.g. "NE". */
  readonly direction: string;
  readonly report: string;
}

/** The latest METAR or TAF of one airport, as returned by GET /api/weather/:icao/metar and /taf. */
export interface AirportReport {
  readonly icao: string;
  /** Null when the airport publishes none. */
  readonly report: string | null;
  readonly nearest: NearbyReport | null;
}

/** The model forecast of one airport, as returned by GET /api/weather/:icao/model. */
export interface AirportModelForecast {
  readonly icao: string;
  readonly forecast: ModelForecast | null;
}

/** One NOTAM, as returned by GET /api/weather/:icao/notam. Times are UTC ISO 8601. */
export interface Notam {
  readonly number: string;
  /** N = new, R = replacement, C = cancellation. */
  readonly type: string;
  readonly status: 'active' | 'upcoming';
  readonly from: string;
  /** Null when no end time is published. */
  readonly to: string | null;
  /** "EST" (estimated end) or "PERM" (permanent), when marked so. */
  readonly estPerm: string | null;
  readonly text: string;
  readonly qCode: string | null;
}

/** The NOTAMs of one airport, as returned by GET /api/weather/:icao/notam. */
export interface AirportNotams {
  readonly icao: string;
  readonly notams: readonly Notam[];
}

/** One weather card: it shows its own loading or error state while the others may already be showing data. */
export interface WeatherCard<T> {
  readonly status: 'loading' | 'loaded' | 'error';
  readonly data: T | null;
  readonly error: string;
}

export const loadingCard = <T>(): WeatherCard<T> => ({ status: 'loading', data: null, error: '' });

/** One hourly step of the ECMWF model forecast (UTC). A value is null when the model gives none. */
export interface ModelForecastHour {
  readonly time: string;
  readonly tempC: number | null;
  readonly dewpointC: number | null;
  readonly qnhHpa: number | null;
  readonly windDirection: number | null;
  readonly windKt: number | null;
  readonly gustKt: number | null;
  readonly cloudCoverPct: number | null;
  readonly precipMm: number | null;
}

/** ECMWF model data for the airport's position. Model values, not an official forecast. */
export interface ModelForecast {
  readonly model: string;
  readonly hours: readonly ModelForecastHour[];
}

const WEATHER_API = `${environment.apiUrl.replace(/\/$/, '')}/weather`;
const ICAO_PATTERN = /^[A-Z]{4}$/;
const WEATHER_UNAVAILABLE_MESSAGE = 'The weather is not available right now. Please try again in a few moments.';

/**
 * The Weather & NOTAMs lookup, shared by every page that shows it (Home and Pilot's Lounge): the airport typed and
 * the cards loaded on one page are the ones shown on the other.
 */
@Injectable({ providedIn: 'root' })
export class WeatherService {
  private readonly http = inject(HttpClient);

  /** The lookup starts empty: no code typed, nothing loaded, no message. */
  readonly icao = signal('');
  readonly error = signal('');
  /** The airport the cards below belong to; empty until a lookup starts. */
  readonly shownIcao = signal('');
  readonly metarCard = signal<WeatherCard<AirportReport>>(loadingCard());
  readonly tafCard = signal<WeatherCard<AirportReport>>(loadingCard());
  readonly modelCard = signal<WeatherCard<AirportModelForecast>>(loadingCard());
  readonly notamCard = signal<WeatherCard<AirportNotams>>(loadingCard());
  /** The NOTAMs already in force and the ones that start later, shown as two separate lists. */
  readonly activeNotams = computed(() => this.notamCard().data?.notams.filter((n) => n.status === 'active') ?? []);
  readonly upcomingNotams = computed(() => this.notamCard().data?.notams.filter((n) => n.status === 'upcoming') ?? []);
  /** True while any of the cards is still loading (the button stays disabled). */
  readonly loading = computed(
    () =>
      this.shownIcao() !== '' &&
      [this.metarCard(), this.tafCard(), this.modelCard(), this.notamCard()].some((card) => card.status === 'loading'),
  );

  /** Keeps the code to letters (ICAO codes have no digits or spaces), in capitals, at most 4 of them. */
  setIcaoFromInput(input: HTMLInputElement): void {
    const icao = input.value
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 4);
    input.value = icao;
    this.icao.set(icao);
  }

  /** Loads the METAR, TAF, model forecast and NOTAMs of the typed airport; each card appears as soon as its data does. */
  fetch(): void {
    const icao = this.icao();
    this.shownIcao.set('');

    if (!ICAO_PATTERN.test(icao)) {
      this.error.set('Enter a 4-letter airport ICAO code, for example RPLL.');
      return;
    }

    this.error.set('');
    this.metarCard.set(loadingCard());
    this.tafCard.set(loadingCard());
    this.modelCard.set(loadingCard());
    this.notamCard.set(loadingCard());
    this.shownIcao.set(icao);

    this.loadCard<AirportReport>(icao, 'metar', this.metarCard);
    this.loadCard<AirportReport>(icao, 'taf', this.tafCard);
    this.loadCard<AirportModelForecast>(icao, 'model', this.modelCard);
    this.loadCard<AirportNotams>(icao, 'notam', this.notamCard);
  }

  private loadCard<T>(
    icao: string,
    part: 'metar' | 'taf' | 'model' | 'notam',
    card: WritableSignal<WeatherCard<T>>,
  ): void {
    this.http
      .get<T>(`${WEATHER_API}/${icao}/${part}`, { headers: new HttpHeaders({ Authorization: getAuthHeader() }) })
      .subscribe({
        next: (data) => {
          // A newer lookup for another airport may have started meanwhile; its cards must not be overwritten.
          if (this.shownIcao() === icao) {
            card.set({ status: 'loaded', data, error: '' });
          }
        },
        error: (error: HttpErrorResponse) => {
          if (this.shownIcao() === icao) {
            card.set({
              status: 'error',
              data: null,
              error:
                error.status === 503
                  ? WEATHER_UNAVAILABLE_MESSAGE
                  : buildSubmitErrorMessage(error, { fallbackMessage: WEATHER_UNAVAILABLE_MESSAGE }),
            });
          }
        },
      });
  }
}
