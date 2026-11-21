import { CommonModule, DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { environment } from '../../../environments/environment';
import { getAuthHeader } from '../../app';
import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import { buildSubmitErrorMessage } from '../../shared/submit-error-utils';
import { PHILIPPINE_AIRPORTS } from './philippine-airports';

/** A sample "Upcoming Event" card. Dummy content until the events calendar exists. */
interface UpcomingEvent {
  readonly title: string;
  /** Day of the event (UTC); always in the future because it is computed from today. */
  readonly date: Date;
  readonly time: string;
  readonly summary: string;
  readonly image: string;
  readonly imageAlt: string;
}

/** One online pilot flying to or from the Philippines, as returned by GET /api/pilots/online. */
interface OnlinePilot {
  readonly callsign: string;
  readonly aircraft: string;
  readonly departure: string;
  readonly arrival: string;
  /** Feet, or null when none is published. */
  readonly altitudeFt: number | null;
  readonly onGround: boolean;
  /** The airport the pilot stands at while on the ground, or null in the air / at neither airport. */
  readonly groundAirport: string | null;
}

interface OnlinePilotsResponse {
  readonly updatedAt: string;
  readonly pilots: readonly OnlinePilot[];
}

/** One online controller, as returned by GET /api/atc/online. */
interface OnlineAtc {
  readonly callsign: string;
  readonly position: string;
  /** MHz, or null when none is published. */
  readonly frequency: number | null;
  readonly rating: string;
  readonly onlineSeconds: number;
}

/** The online controllers of one country (or group of neighbouring countries). */
interface OnlineAtcGroup {
  readonly country: string;
  readonly controllers: readonly OnlineAtc[];
}

interface OnlineAtcResponse {
  readonly updatedAt: string;
  readonly groups: readonly OnlineAtcGroup[];
}

/** A report from the closest airport that publishes one, shown when the airport asked for has none. */
interface NearbyReport {
  readonly icao: string;
  readonly name: string;
  readonly distanceKm: number;
  /** Compass direction from the airport asked for, e.g. "NE". */
  readonly direction: string;
  readonly report: string;
}

/** The latest weather of one airport, as returned by GET /api/weather/:icao. A report is null when none is published. */
interface AirportWeather {
  readonly icao: string;
  readonly metar: string | null;
  readonly taf: string | null;
  readonly nearestMetar: NearbyReport | null;
  readonly nearestTaf: NearbyReport | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEATHER_API = `${environment.apiUrl.replace(/\/$/, '')}/weather`;
const ATC_API = `${environment.apiUrl.replace(/\/$/, '')}/atc`;
const PILOTS_API = `${environment.apiUrl.replace(/\/$/, '')}/pilots`;
const ONLINE_REFRESH_MS = 60 * 1000;
const ATC_UNAVAILABLE_MESSAGE =
  'The online controllers are not available right now. Please try again in a few moments.';
const PILOTS_UNAVAILABLE_MESSAGE = 'The online pilots are not available right now. Please try again in a few moments.';
/** Altitudes from here up are shown as flight levels. */
const TRANSITION_ALTITUDE_FT = 18000;
const ICAO_PATTERN = /^[A-Z]{4}$/;
const WEATHER_UNAVAILABLE_MESSAGE = 'The weather is not available right now. Please try again in a few moments.';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, DatePipe, PlaceholderBannerComponent],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class HomeComponent {
  private readonly title = inject(Title);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  /** Pilots whose flight plan departs from or arrives in the Philippines, refreshed every minute. */
  readonly pilots = signal<readonly OnlinePilot[]>([]);
  readonly pilotsLoaded = signal(false);
  readonly pilotsError = signal('');
  readonly pilotsUpdatedAt = signal<Date | null>(null);

  /** Controllers online in the Philippines and the neighbouring areas, refreshed every minute. */
  readonly atcGroups = signal<readonly OnlineAtcGroup[]>([]);
  readonly atcLoaded = signal(false);
  readonly atcError = signal('');
  readonly atcUpdatedAt = signal<Date | null>(null);

  /** Suggestions for the weather lookup's ICAO field. */
  readonly airports = PHILIPPINE_AIRPORTS;

  /** The weather lookup starts empty: no code typed, nothing loaded, no message. */
  readonly weatherIcao = signal('');
  readonly weatherLoading = signal(false);
  readonly weatherError = signal('');
  readonly weather = signal<AirportWeather | null>(null);

  readonly events: readonly UpcomingEvent[] = HomeComponent.buildEvents();

  constructor() {
    this.title.setTitle('IVAO Philippines');

    this.loadOnlineTraffic();
    const refresh = setInterval(() => this.loadOnlineTraffic(), ONLINE_REFRESH_MS);
    this.destroyRef.onDestroy(() => clearInterval(refresh));
  }

  /** "FL340" from the transition altitude up, "2,500 ft" below it and "On ground" while parked or taxiing. */
  formatAltitude(pilot: OnlinePilot): string {
    if (pilot.onGround) {
      return pilot.groundAirport ? `On ground at ${pilot.groundAirport}` : 'On ground';
    }
    if (pilot.altitudeFt === null) {
      return '-';
    }
    if (pilot.altitudeFt >= TRANSITION_ALTITUDE_FT) {
      return `FL${String(Math.round(pilot.altitudeFt / 100)).padStart(3, '0')}`;
    }
    return `${Math.max(0, pilot.altitudeFt).toLocaleString('en-US')} ft`;
  }

  /** "1h 05m" for the time a controller has been online. */
  formatOnlineTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
  }

  private loadOnlineTraffic(): void {
    this.loadOnlinePilots();
    this.loadOnlineAtc();
  }

  /** Loads the online pilots. On a failed refresh the last list stays on screen next to the message. */
  private loadOnlinePilots(): void {
    this.http
      .get<OnlinePilotsResponse>(`${PILOTS_API}/online`, {
        headers: new HttpHeaders({ Authorization: getAuthHeader() }),
      })
      .subscribe({
        next: (response) => {
          this.pilots.set(response.pilots);
          this.pilotsUpdatedAt.set(new Date(response.updatedAt));
          this.pilotsError.set('');
          this.pilotsLoaded.set(true);
        },
        error: (error: HttpErrorResponse) => {
          this.pilotsError.set(
            error.status === 503
              ? PILOTS_UNAVAILABLE_MESSAGE
              : buildSubmitErrorMessage(error, { fallbackMessage: PILOTS_UNAVAILABLE_MESSAGE }),
          );
          this.pilotsLoaded.set(true);
        },
      });
  }

  /** Loads the online controllers. On a failed refresh the last list stays on screen next to the message. */
  private loadOnlineAtc(): void {
    this.http
      .get<OnlineAtcResponse>(`${ATC_API}/online`, { headers: new HttpHeaders({ Authorization: getAuthHeader() }) })
      .subscribe({
        next: (response) => {
          this.atcGroups.set(response.groups);
          this.atcUpdatedAt.set(new Date(response.updatedAt));
          this.atcError.set('');
          this.atcLoaded.set(true);
        },
        error: (error: HttpErrorResponse) => {
          this.atcError.set(
            error.status === 503
              ? ATC_UNAVAILABLE_MESSAGE
              : buildSubmitErrorMessage(error, { fallbackMessage: ATC_UNAVAILABLE_MESSAGE }),
          );
          this.atcLoaded.set(true);
        },
      });
  }

  /** Keeps the field to letters (ICAO codes have no digits or spaces), in capitals, at most 4 of them. */
  onWeatherIcaoInput(input: HTMLInputElement): void {
    const icao = input.value
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 4);
    input.value = icao;
    this.weatherIcao.set(icao);
  }

  /** Loads the latest METAR and TAF of the typed airport. */
  fetchWeather(): void {
    const icao = this.weatherIcao();
    this.weather.set(null);

    if (!ICAO_PATTERN.test(icao)) {
      this.weatherError.set('Enter a 4-letter airport ICAO code, for example RPLL.');
      return;
    }

    this.weatherError.set('');
    this.weatherLoading.set(true);
    this.http
      .get<AirportWeather>(`${WEATHER_API}/${icao}`, { headers: new HttpHeaders({ Authorization: getAuthHeader() }) })
      .subscribe({
        next: (weather) => {
          this.weather.set(weather);
          this.weatherLoading.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.weatherError.set(
            error.status === 503
              ? WEATHER_UNAVAILABLE_MESSAGE
              : buildSubmitErrorMessage(error, { fallbackMessage: WEATHER_UNAVAILABLE_MESSAGE }),
          );
          this.weatherLoading.set(false);
        },
      });
  }

  /** The event links go nowhere yet. */
  noEventPageYet(event: Event): void {
    event.preventDefault();
  }

  /** Three sample events 2, 4 and about 6 weeks from today, so they are never in the past. */
  private static buildEvents(): UpcomingEvent[] {
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const inDays = (days: number) => new Date(todayUtc + days * DAY_MS);

    return [
      {
        title: 'Mabuhay IVAO PH Launch Fly-In',
        date: inDays(14),
        time: '1200Z - 1600Z',
        summary: 'Join us for the launch of IVAO Philippines. Fly into Manila and enjoy full ATC coverage.',
        image: 'images/home/event-launch.svg',
        imageAlt: 'An airliner crossing a sunrise over the sea',
      },
      {
        title: 'Friday Flyday: Manila ATC Night',
        date: inDays(28),
        time: '1300Z - 1700Z',
        summary: 'A weekly night of busy Manila airspace. Controllers and pilots welcome, all ratings.',
        image: 'images/home/event-atc-night.svg',
        imageAlt: 'A radar screen at night',
      },
      {
        title: '7,641 Islands Tour: Part 1',
        date: inDays(45),
        time: '0900Z - 1300Z',
        summary: 'A relaxed island-hopping tour across the Philippines with staff-led briefings.',
        image: 'images/home/event-islands-tour.svg',
        imageAlt: 'A route linking islands on a map',
      },
    ];
  }
}
