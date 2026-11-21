import { HttpErrorResponse, HttpEvent, HttpHeaders, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { Observable, catchError, map, shareReplay, throwError } from 'rxjs';

import { environment } from '../../environments/environment';

/**
 * Public demo only: GitHub Pages has no backend, so the API calls listed here are answered
 * without one.
 *  - `DEMO_RESPONSES`: dummy JSON files in `public/demo/` (served next to the site, so the URL is
 *    relative to the page's base href).
 *  - `/pilots/online` and `/atc/online`: the live IVAO feed, read straight from the browser (the
 *    feed allows cross-origin requests) and reshaped the way the real backend does.
 *  - `/weather/:icao`: the live METAR from VATSIM's public METAR service (it allows cross-origin
 *    requests). There is no live TAF: no free TAF service allows requests from a browser, and the
 *    real backend's source (aviationweather.gov) does not.
 */
const DEMO_RESPONSES: Record<string, string> = {
  '/members': 'demo/members.json',
};

const IVAO_WHAZZUP_API = 'https://api.ivao.aero/v2/tracker/whazzup';
const METAR_API = 'https://metar.vatsim.net';
const ICAO_PATTERN = /^[A-Z]{4}$/;
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

  const icao = path?.startsWith('/weather/') ? decodeURIComponent(path.slice('/weather/'.length)).toUpperCase() : null;
  if (icao !== null) {
    if (!ICAO_PATTERN.test(icao)) {
      return throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { message: 'Enter a 4-letter airport ICAO code, for example RPLL.' },
          }),
      );
    }
    return next(req.clone({ url: `${METAR_API}/${icao}`, headers: new HttpHeaders(), responseType: 'text' })).pipe(
      map((event) =>
        event instanceof HttpResponse
          ? new HttpResponse({
              status: 200,
              // No live TAF in the demo (see the top of this file), and no nearby-airport search.
              body: { icao, metar: parseMetar(event.body), taf: null, nearestMetar: null, nearestTaf: null },
            })
          : event,
      ),
      catchError(() =>
        throwError(() => new HttpErrorResponse({ status: 503, statusText: 'Service Unavailable', url: METAR_API })),
      ),
    );
  }

  const file = path === null ? undefined : DEMO_RESPONSES[path];

  // Drop the API credentials: the static file needs none.
  return next(file ? req.clone({ url: file, headers: req.headers.delete('Authorization') }) : req);
};
