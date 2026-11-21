import { HttpErrorResponse, HttpEvent, HttpHeaders, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { Observable, catchError, filter, map, of, shareReplay, switchMap, throwError } from 'rxjs';

import { environment } from '../../environments/environment';
import { AirportPosition, PHILIPPINE_AIRPORTS } from './demo-airport-positions';

/**
 * Public demo only: GitHub Pages has no backend, so the API calls listed here are answered
 * without one.
 *  - `DEMO_RESPONSES`: dummy JSON files in `public/demo/` (served next to the site, so the URL is
 *    relative to the page's base href).
 *  - `/pilots/online` and `/atc/online`: the live IVAO feed, read straight from the browser (the
 *    feed allows cross-origin requests) and reshaped the way the real backend does.
 *  - `/weather/:icao/metar`: the live METAR from VATSIM's public METAR service (it allows
 *    cross-origin requests), with the nearest airport's METAR when the airport has none.
 *  - `/weather/:icao/taf`: no live TAF: no free TAF service allows requests from a browser, and the
 *    real backend's source (aviationweather.gov) does not, so the card says so.
 *  - `/weather/:icao/model`: the live ECMWF model data from Open-Meteo (it allows cross-origin
 *    requests), as the real backend does.
 *  - `/weather/:icao/notam`: a snapshot of the CAAP AIS NOTAMs in `public/demo/notams.json` (the
 *    service does not allow requests from a browser). `web/scripts/fetch-demo-notams.mjs` refreshes
 *    it before each deploy; ended NOTAMs are dropped and active/upcoming is worked out here, in the
 *    browser, so an older snapshot still shows the right state.
 */
const DEMO_RESPONSES: Record<string, string> = {
  '/members': 'demo/members.json',
};

const IVAO_WHAZZUP_API = 'https://api.ivao.aero/v2/tracker/whazzup';
const METAR_API = 'https://metar.vatsim.net';
const ICAO_PATTERN = /^[A-Z]{4}$/;
const OPEN_METEO_ECMWF_API = 'https://api.open-meteo.com/v1/ecmwf';
const MODEL_NAME = 'ECMWF IFS';
const MODEL_VARIABLES = [
  'temperature_2m',
  'dew_point_2m',
  'pressure_msl',
  'wind_direction_10m',
  'wind_speed_10m',
  'wind_gusts_10m',
  'cloud_cover',
  'precipitation',
] as const;
const TAF_DEMO_NOTE = 'TAF is not available in the public demo.';
const NOTAMS_FILE = 'demo/notams.json';
/** The feed is ~800 KB and refreshes about every 15 seconds; Home asks for pilots and ATC together. */
const WHAZZUP_TTL_MS = 30 * 1000;
const PHILIPPINE_PREFIX = 'RP';
/** A pilot on the ground farther than this from both airports is not "at" either of them. */
const AT_AIRPORT_MAX_KM = 5;
const HOME_COUNTRY = 'Philippines';

/** ICAO prefix (first 2 letters of the callsign) -> country. The Philippines and the areas bordering the Manila FIR. */
const COUNTRY_BY_PREFIX: Readonly<Record<string, string>> = {
  PG: 'Guam, Palau & Micronesia',
  PT: 'Guam, Palau & Micronesia',
  RC: 'Taiwan',
  RJ: 'Japan',
  RO: 'Japan',
  RP: HOME_COUNTRY,
  VH: 'Hong Kong',
  VV: 'Vietnam',
  WA: 'Indonesia',
  WB: 'Malaysia & Brunei',
  WI: 'Indonesia',
  WM: 'Malaysia & Brunei',
  ZG: 'China',
  ZS: 'China',
};

/** IVAO ATC ratings (1 is the Observer rating). */
const RATING_LABELS: Readonly<Record<number, string>> = {
  1: 'OBS',
  2: 'AS1',
  3: 'AS2',
  4: 'AS3',
  5: 'ADC',
  6: 'APC',
  7: 'ACC',
  8: 'SEC',
  9: 'SAI',
  10: 'CAI',
};

interface WhazzupAtc {
  id?: unknown;
  callsign?: unknown;
  rating?: unknown;
  time?: unknown;
  atcSession?: { frequency?: unknown; position?: unknown } | null;
}

interface WhazzupPilot {
  callsign?: unknown;
  lastTrack?: {
    altitude?: unknown;
    onGround?: unknown;
    departureDistance?: unknown;
    arrivalDistance?: unknown;
  } | null;
  flightPlan?: { aircraftId?: unknown; departureId?: unknown; arrivalId?: unknown } | null;
}

interface Whazzup {
  updatedAt: string;
  atcs: WhazzupAtc[];
  pilots: WhazzupPilot[];
}

interface DemoAtc {
  /** IVAO session id, used to link to the controller on Webeye; null when the feed has none. */
  sessionId: number | null;
  callsign: string;
  position: string;
  frequency: number | null;
  rating: string;
  onlineSeconds: number;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/** Same rules as the backend's PilotsService. */
function buildPilots(feed: Whazzup) {
  const pilots = [];
  for (const pilot of feed.pilots) {
    const departure = text(pilot.flightPlan?.departureId);
    const arrival = text(pilot.flightPlan?.arrivalId);
    if (!departure.startsWith(PHILIPPINE_PREFIX) && !arrival.startsWith(PHILIPPINE_PREFIX)) {
      continue;
    }

    const altitude = pilot.lastTrack?.altitude;
    const onGround = pilot.lastTrack?.onGround === true;
    const fromDeparture =
      typeof pilot.lastTrack?.departureDistance === 'number' ? pilot.lastTrack.departureDistance : Infinity;
    const fromArrival =
      typeof pilot.lastTrack?.arrivalDistance === 'number' ? pilot.lastTrack.arrivalDistance : Infinity;
    const standsAtAirport = fromDeparture !== fromArrival && Math.min(fromDeparture, fromArrival) <= AT_AIRPORT_MAX_KM;

    pilots.push({
      callsign: text(pilot.callsign),
      aircraft: text(pilot.flightPlan?.aircraftId),
      departure,
      arrival,
      altitudeFt: typeof altitude === 'number' ? Math.round(altitude) : null,
      onGround,
      groundAirport: onGround && standsAtAirport ? (fromDeparture < fromArrival ? departure : arrival) || null : null,
    });
  }

  pilots.sort((a, b) => a.callsign.localeCompare(b.callsign));
  return { updatedAt: feed.updatedAt, pilots };
}

/** Same rules as the backend's AtcService. */
function buildAtc(feed: Whazzup) {
  const byCountry = new Map<string, DemoAtc[]>();
  for (const atc of feed.atcs) {
    const callsign = text(atc.callsign);
    const country = COUNTRY_BY_PREFIX[callsign.slice(0, 2)];
    if (!country) {
      continue;
    }

    const frequency = atc.atcSession?.frequency;
    const position = atc.atcSession?.position;
    const rating = typeof atc.rating === 'number' ? atc.rating : 0;
    byCountry.set(country, [
      ...(byCountry.get(country) ?? []),
      {
        sessionId: typeof atc.id === 'number' ? atc.id : null,
        callsign,
        position: typeof position === 'string' ? position : '',
        frequency: typeof frequency === 'number' && frequency > 0 ? frequency : null,
        rating: RATING_LABELS[rating] ?? (rating > 10 ? 'STAFF' : 'OBS'),
        onlineSeconds: typeof atc.time === 'number' && atc.time > 0 ? atc.time : 0,
      },
    ]);
  }

  const groups = [...byCountry.entries()]
    .map(([country, controllers]) => ({
      country,
      controllers: controllers.sort((a, b) => a.callsign.localeCompare(b.callsign)),
    }))
    .sort((a, b) =>
      a.country === HOME_COUNTRY ? -1 : b.country === HOME_COUNTRY ? 1 : a.country.localeCompare(b.country),
    );
  return { updatedAt: feed.updatedAt, groups };
}

/** The METAR text, or null when the service has none (empty answer). */
function parseMetar(body: unknown): string | null {
  const metar = typeof body === 'string' ? body.trim() : '';
  return metar === '' ? null : metar;
}

const EARTH_RADIUS_KM = 6371;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in km (haversine), as in the backend's WeatherService. */
function distanceBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** 8-point compass direction of the initial bearing from point 1 to point 2. */
function directionBetween(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const dLon = toRadians(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRadians(lat2));
  const x =
    Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
    Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

/**
 * The closest Philippine airport that has a METAR, from the service's "all RP*" answer (one report per line).
 * Needs the position of the airport asked for, so an airport that is not in the Philippine list gets no suggestion.
 */
function findNearestMetar(icao: string, allMetars: string) {
  const origin = PHILIPPINE_AIRPORTS.find((airport) => airport.icao === icao);
  if (!origin) {
    return null;
  }

  let best: { airport: AirportPosition; report: string; distanceKm: number } | null = null;
  for (const line of allMetars.split('\n')) {
    const report = line.trim();
    const airport = PHILIPPINE_AIRPORTS.find((candidate) => candidate.icao === report.slice(0, 4));
    if (!airport || airport.icao === icao) {
      continue;
    }
    const distanceKm = distanceBetween(origin.lat, origin.lon, airport.lat, airport.lon);
    if (best === null || distanceKm < best.distanceKm) {
      best = { airport, report, distanceKm };
    }
  }
  if (best === null) {
    return null;
  }

  return {
    icao: best.airport.icao,
    name: best.airport.name,
    distanceKm: Math.round(best.distanceKm),
    direction: directionBetween(origin.lat, origin.lon, best.airport.lat, best.airport.lon),
    report: best.report,
  };
}

interface SnapshotNotam {
  loc_indicator?: string | null;
  full_number?: string | null;
  notam_type?: string | null;
  begin_effect?: string | null;
  end_effect?: string | null;
  estperm?: string | null;
  additional_txt?: string | null;
  notam_code?: string | null;
  status?: string | number | null;
  is_draft?: number | boolean | null;
}

/** "2026-11-21 10:40:00" (UTC, as NOTAMs are) -> "2026-11-21T10:40:00.000Z"; null when empty or not a date. */
function toUtcIso(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const time = Date.parse(`${value.trim().replace(' ', 'T')}Z`);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Same rules as the backend's WeatherService: published NOTAMs of the airport that have not ended, newest start first. */
function toNotams(snapshot: unknown, icao: string) {
  const rows = (snapshot as { notams?: SnapshotNotam[] } | null)?.notams;
  if (!Array.isArray(rows)) {
    throw new Error('Unexpected NOTAM snapshot');
  }

  const now = Date.now();
  const notams = [];
  for (const row of rows) {
    if (row.loc_indicator !== icao) {
      continue;
    }
    // Drafts and unpublished rows are not shown.
    if (row.is_draft || (row.status !== undefined && row.status !== null && String(row.status) !== '1')) {
      continue;
    }
    const from = toUtcIso(row.begin_effect);
    const to = toUtcIso(row.end_effect);
    if (!row.full_number || from === null || (to !== null && Date.parse(to) < now)) {
      continue;
    }
    // An end before the start is a typo in the source; do not show a misleading date.
    if (to !== null && Date.parse(to) < Date.parse(from)) {
      continue;
    }

    notams.push({
      number: row.full_number,
      type: row.notam_type ?? '',
      status: Date.parse(from) <= now ? 'active' : 'upcoming',
      from,
      to,
      estPerm: row.estperm || null,
      text: (row.additional_txt ?? '').replace(/\r/g, '').trim(),
      qCode: row.notam_code || null,
    });
  }
  return notams.sort((a, b) => Date.parse(b.from) - Date.parse(a.from));
}

/** Keeps the current UTC hour of Open-Meteo's answer (it starts at 00:00 UTC of today); same shape as the backend's. */
function toModelForecast(body: unknown) {
  const hourly = (body as { hourly?: { time?: string[] } & Record<string, (number | null)[] | undefined> } | null)
    ?.hourly;
  if (!hourly?.time?.length) {
    return null;
  }
  const currentHour = new Date().toISOString().slice(0, 13);
  const index = Math.max(
    0,
    hourly.time.findIndex((time) => time.slice(0, 13) >= currentHour),
  );
  const value = (name: (typeof MODEL_VARIABLES)[number]): number | null => hourly[name]?.[index] ?? null;
  return {
    model: MODEL_NAME,
    hours: [
      {
        // Open-Meteo sends UTC times without a zone; the "Z" stops the browser reading them as local time.
        time: `${hourly.time[index]}Z`,
        tempC: value('temperature_2m'),
        dewpointC: value('dew_point_2m'),
        qnhHpa: value('pressure_msl'),
        windDirection: value('wind_direction_10m'),
        windKt: value('wind_speed_10m'),
        gustKt: value('wind_gusts_10m'),
        cloudCoverPct: value('cloud_cover'),
        precipMm: value('precipitation'),
      },
    ],
  };
}

let cachedFeed: { at: number; feed$: Observable<Whazzup> } | null = null;

/** One shared download of the feed per WHAZZUP_TTL_MS; a failed download is not kept. */
function loadFeed(download: () => Observable<HttpEvent<unknown>>): Observable<Whazzup> {
  if (cachedFeed && Date.now() - cachedFeed.at < WHAZZUP_TTL_MS) {
    return cachedFeed.feed$;
  }

  const entry = {
    at: Date.now(),
    feed$: download().pipe(
      map((event): Whazzup => {
        const body = (event as HttpResponse<unknown>).body as { clients?: { atcs?: unknown; pilots?: unknown } } | null;
        const clients = body?.clients;
        return {
          updatedAt: new Date().toISOString(),
          atcs: Array.isArray(clients?.atcs) ? (clients.atcs as WhazzupAtc[]) : [],
          pilots: Array.isArray(clients?.pilots) ? (clients.pilots as WhazzupPilot[]) : [],
        };
      }),
      catchError(() => {
        if (cachedFeed === entry) {
          cachedFeed = null;
        }
        // 503 is what the real backend answers when IVAO is not reachable; Home shows its "not available" message.
        return throwError(
          () => new HttpErrorResponse({ status: 503, statusText: 'Service Unavailable', url: IVAO_WHAZZUP_API }),
        );
      }),
      shareReplay(1),
    ),
  };
  cachedFeed = entry;
  return entry.feed$;
}

export const demoDataInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.method !== 'GET') {
    return next(req);
  }

  const apiBase = environment.apiUrl.replace(/\/$/, '');
  const path = req.url.startsWith(apiBase) ? req.url.slice(apiBase.length).split('?')[0] : null;

  if (path === '/pilots/online' || path === '/atc/online') {
    // A request to another site must not carry the API credentials.
    const download = () => next(req.clone({ url: IVAO_WHAZZUP_API, headers: new HttpHeaders() }));
    return loadFeed(download).pipe(
      map(
        (feed) =>
          new HttpResponse({ status: 200, body: path === '/pilots/online' ? buildPilots(feed) : buildAtc(feed) }),
      ),
    );
  }

  const weather = path === null ? null : /^\/weather\/([^/]+)\/(metar|taf|model|notam)$/.exec(path);
  if (weather !== null) {
    const icao = decodeURIComponent(weather[1]).toUpperCase();
    const part = weather[2];
    if (!ICAO_PATTERN.test(icao)) {
      return throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { message: 'Enter a 4-letter airport ICAO code, for example RPLL.' },
          }),
      );
    }
    const ok = (body: unknown) => of(new HttpResponse({ status: 200, body }));

    if (part === 'taf') {
      // No live TAF in the demo (see the top of this file), so the TAF box says so instead of
      // claiming the airport has none.
      return ok({ icao, report: TAF_DEMO_NOTE, nearest: null });
    }

    if (part === 'notam') {
      // CAAP publishes NOTAMs for the Manila FIR only, as in the backend.
      if (!icao.startsWith(PHILIPPINE_PREFIX)) {
        return ok({ icao, notams: [] });
      }
      return next(req.clone({ url: NOTAMS_FILE, headers: new HttpHeaders() })).pipe(
        filter((event): event is HttpResponse<unknown> => event instanceof HttpResponse),
        map((event) => new HttpResponse({ status: 200, body: { icao, notams: toNotams(event.body, icao) } })),
        catchError(() =>
          throwError(() => new HttpErrorResponse({ status: 503, statusText: 'Service Unavailable', url: NOTAMS_FILE })),
        ),
      );
    }

    if (part === 'model') {
      const airport = PHILIPPINE_AIRPORTS.find((candidate) => candidate.icao === icao);
      if (!airport) {
        return ok({ icao, forecast: null });
      }
      const query = new URLSearchParams({
        latitude: String(airport.lat),
        longitude: String(airport.lon),
        hourly: MODEL_VARIABLES.join(','),
        wind_speed_unit: 'kn',
        timezone: 'GMT',
        forecast_days: '2',
      });
      return next(req.clone({ url: `${OPEN_METEO_ECMWF_API}?${query}`, headers: new HttpHeaders() })).pipe(
        filter((event): event is HttpResponse<unknown> => event instanceof HttpResponse),
        map((event) => new HttpResponse({ status: 200, body: { icao, forecast: toModelForecast(event.body) } })),
        // Like the backend, a model problem gives "no forecast", not an error.
        catchError(() => ok({ icao, forecast: null })),
      );
    }

    const getText = (url: string) =>
      next(req.clone({ url, headers: new HttpHeaders(), responseType: 'text' })).pipe(
        filter((event): event is HttpResponse<string> => event instanceof HttpResponse),
        map((event) => event.body ?? ''),
      );

    return getText(`${METAR_API}/${icao}`).pipe(
      switchMap((body) => {
        const report = parseMetar(body);
        // Like the backend, look for the closest airport with a METAR only when this one has none.
        const nearest$ =
          report === null
            ? getText(`${METAR_API}/?id=${PHILIPPINE_PREFIX}`).pipe(
                map((all) => findNearestMetar(icao, all)),
                catchError(() => of(null)),
              )
            : of(null);
        return nearest$.pipe(map((nearest) => new HttpResponse({ status: 200, body: { icao, report, nearest } })));
      }),
      catchError(() =>
        throwError(() => new HttpErrorResponse({ status: 503, statusText: 'Service Unavailable', url: METAR_API })),
      ),
    );
  }

  const file = path === null ? undefined : DEMO_RESPONSES[path];

  // Drop the API credentials: the static file needs none.
  return next(file ? req.clone({ url: file, headers: req.headers.delete('Authorization') }) : req);
};
