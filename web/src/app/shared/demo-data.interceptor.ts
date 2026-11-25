import { HttpErrorResponse, HttpEvent, HttpHeaders, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { Observable, catchError, filter, forkJoin, from, map, of, shareReplay, switchMap, throwError } from 'rxjs';

import { environment } from '../../environments/environment';
import { AirportPosition, PHILIPPINE_AIRPORTS } from './demo-airport-positions';

/**
 * Public demo only: GitHub Pages has no backend, so the API calls listed here are answered
 * without one.
 *  - `DEMO_RESPONSES`: dummy JSON files in `public/demo/` (served next to the site, so the URL is
 *    relative to the page's base href). Every area has at least 5 dummy records.
 *  - `DEMO_FILE_ROUTES`: the dummy files behind those records (event, scenery and staff pictures, document and
 *    chart PDFs).
 *  - `/members`: the dummy members plus the pilots online now on a flight plan to or from the Philippines, as the
 *    real backend lists them (their VID only).
 *  - `/simbrief/:id`: one of the dummy flight plans in `public/demo/simbrief.json`; any Pilot ID or username works,
 *    and nothing is sent to SimBrief.
 *  - `/events`: `public/demo/events.json` holds day offsets, not dates; `buildEvents` turns them into real
 *    dates so Events Today, Upcoming Events and Past Events are never empty, whatever day it is.
 *  - `/event-approvals`: the demo user is shown as an event approver, with dummy notifications from
 *    `public/demo/event-approvals.json`. Approve and Dismiss only remove the notification until the page
 *    is reloaded.
 *  - `/manage-integrations`: empty settings (an admin page, which the demo user cannot open).
 *  - `/pilots/online` and `/atc/online`: the live IVAO feed, read straight from the browser (the
 *    feed allows cross-origin requests) and reshaped the way the real backend does.
 *  - `/weather/:icao/metar`: the live METAR from VATSIM's public METAR service (it allows
 *    cross-origin requests), with the nearest airport's METAR when the airport has none.
 *  - `/weather/:icao/taf`: no live TAF: no free TAF service allows requests from a browser, and the
 *    real backend's source (aviationweather.gov) does not, so the card says so.
 *  - `/weather/:icao/model`: the live ECMWF model data from Open-Meteo (it allows cross-origin
 *    requests), as the real backend does.
 *  - `/admin-auth/login|session|profile|profile/photo`: a dummy account, so Profile Settings (and the profile photo)
 *    can be tried (see `demoAccountResponse`).
 *  - `/weather/:icao/notam`: a snapshot of the CAAP AIS NOTAMs in `public/demo/notams.json` (the
 *    service does not allow requests from a browser). `web/scripts/fetch-demo-notams.mjs` refreshes
 *    it before each deploy; ended NOTAMs are dropped and active/upcoming is worked out here, in the
 *    browser, so an older snapshot still shows the right state.
 */
const DEMO_RESPONSES: Record<string, string> = {
  '/members/contacts': 'demo/contacts.json',
  '/documents': 'demo/documents.json',
  '/charts': 'demo/charts.json',
  '/sceneries': 'demo/sceneries.json',
  '/airport-parking': 'demo/airport-parking.json',
  '/airport-parking/terminals': 'demo/airport-terminals.json',
};

/** API file routes -> the dummy file in `public/demo/` ($1 is the record id). */
const DEMO_FILE_ROUTES: readonly { pattern: RegExp; file: string }[] = [
  { pattern: /^\/events\/(\d+)\/image$/, file: 'demo/events/event-$1.svg' },
  { pattern: /^\/members\/(\d+)\/photo$/, file: 'demo/members/photo-$1.svg' },
  { pattern: /^\/members\/(\d+)\/avatar$/, file: 'demo/members/avatar-$1.svg' },
  { pattern: /^\/documents\/(\d+)\/file$/, file: 'demo/documents/document-$1.pdf' },
  { pattern: /^\/charts\/(\d+)\/file$/, file: 'demo/charts/chart-$1.pdf' },
  { pattern: /^\/sceneries\/(\d+)\/image$/, file: 'demo/sceneries/scenery-$1.svg' },
  { pattern: /^\/event-approvals\/(\d+)\/image$/, file: 'demo/event-approvals/event-approval-$1.svg' },
];
const EVENTS_FILE = 'demo/events.json';
const MEMBERS_FILE = 'demo/members.json';
const SIMBRIEF_FILE = 'demo/simbrief.json';
const APPROVALS_FILE = 'demo/event-approvals.json';
const EMPTY_INTEGRATIONS = { discord_webhook_url: '', facebook_page_id: '', facebook_page_access_token: '' };
const DAY_MS = 24 * 60 * 60 * 1000;
const PHILIPPINE_OFFSET_MS = 8 * 60 * 60 * 1000;

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
  userId?: unknown;
  callsign?: unknown;
  rating?: unknown;
  time?: unknown;
  atcSession?: { frequency?: unknown; position?: unknown } | null;
}

interface WhazzupPilot {
  userId?: unknown;
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
  /** The IVAO VID, shown because the demo knows no names. */
  vid: string;
  name: string | null;
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

function vidOf(userId: unknown): string {
  return typeof userId === 'number' || typeof userId === 'string' ? String(userId).trim() : '';
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
      vid: vidOf(pilot.userId),
      name: null,
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

/** The ordering below copies the backend's atc-sorting.ts. Manila (RPLL) is where distances are measured from. */
const MANILA = { lat: 14.5086, lon: 121.02 };
/** The Manila FIR centre is not an airport; it covers the whole country and is listed first. */
const PHILIPPINE_FIR = 'RPHI';
/** Main airport of each international group; the group's distance from the Philippines is measured to it. */
const GROUP_HUBS: Readonly<Record<string, { lat: number; lon: number }>> = {
  China: { lat: 23.3924, lon: 113.2988 },
  'Guam, Palau & Micronesia': { lat: 13.4834, lon: 144.796 },
  'Hong Kong': { lat: 22.308, lon: 113.9185 },
  Indonesia: { lat: -6.1256, lon: 106.6559 },
  Japan: { lat: 35.5494, lon: 139.7798 },
  'Malaysia & Brunei': { lat: 2.7456, lon: 101.7099 },
  Taiwan: { lat: 25.0777, lon: 121.2328 },
  Vietnam: { lat: 10.8188, lon: 106.652 },
};
/** Position within an airport: CTR, then DEP/APP, TWR, GND and DEL. Anything else goes last. */
const ROLE_ORDER: Readonly<Record<string, number>> = { CTR: 0, DEP: 1, APP: 1, TWR: 2, GND: 3, DEL: 4 };
const OTHER_ROLE = 5;

function groupDistanceKm(country: string): number {
  const hub = GROUP_HUBS[country];
  return hub ? distanceBetween(MANILA.lat, MANILA.lon, hub.lat, hub.lon) : Number.POSITIVE_INFINITY;
}

/** Larger = further north: the FIR first, then the airports, then anything unknown. */
function airportLatitude(icao: string): number {
  if (icao === PHILIPPINE_FIR) {
    return Number.POSITIVE_INFINITY;
  }
  return PHILIPPINE_AIRPORTS.find((airport) => airport.icao === icao)?.lat ?? Number.NEGATIVE_INFINITY;
}

function roleRank(callsign: string): number {
  const parts = callsign.split('_');
  return parts.length > 1 ? (ROLE_ORDER[parts[parts.length - 1]] ?? OTHER_ROLE) : OTHER_ROLE;
}

/** Airport by airport (north to south in the Philippines, alphabetical elsewhere), then by position. */
function compareCallsigns(philippines: boolean, a: string, b: string): number {
  const airportA = a.split('_')[0];
  const airportB = b.split('_')[0];
  if (airportA !== airportB) {
    if (philippines) {
      const latitudeA = airportLatitude(airportA);
      const latitudeB = airportLatitude(airportB);
      if (latitudeA !== latitudeB) {
        return latitudeA > latitudeB ? -1 : 1;
      }
    }
    return airportA.localeCompare(airportB);
  }
  return roleRank(a) - roleRank(b) || a.localeCompare(b);
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
        vid: vidOf(atc.userId),
        name: null,
        sessionId: typeof atc.id === 'number' ? atc.id : null,
        callsign,
        position: typeof position === 'string' ? position : '',
        frequency: typeof frequency === 'number' && frequency > 0 ? frequency : null,
        rating: RATING_LABELS[rating] ?? (rating > 10 ? 'STAFF' : 'OBS'),
        onlineSeconds: typeof atc.time === 'number' && atc.time > 0 ? atc.time : 0,
      },
    ]);
  }

  // The Philippines first (airports north to south), then the other countries from the nearest to the farthest.
  const groups = [...byCountry.entries()]
    .map(([country, controllers]) => ({
      country,
      controllers: controllers.sort((a, b) => compareCallsigns(country === HOME_COUNTRY, a.callsign, b.callsign)),
    }))
    .sort((a, b) => {
      if (a.country === HOME_COUNTRY || b.country === HOME_COUNTRY) {
        return a.country === HOME_COUNTRY ? -1 : 1;
      }
      const distanceA = groupDistanceKm(a.country);
      const distanceB = groupDistanceKm(b.country);
      return distanceA === distanceB ? a.country.localeCompare(b.country) : distanceA < distanceB ? -1 : 1;
    });
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

interface DemoEvent {
  id: number;
  day_offset: number;
  start_gmt: string;
  end_gmt: string;
  [field: string]: unknown;
}

/** "12:00" on the calendar day that starts at `dayStart` (UTC midnight), as an ISO string. */
function atGmtTime(dayStart: number, time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return dayStart + (hours * 60 + minutes) * 60 * 1000;
}

/** Turns the day offset and GMT clock times of a dummy event into real dates, counted from `philippineDate`. */
function toDatedEvent({ day_offset, start_gmt, end_gmt, ...rest }: DemoEvent, philippineDate: number) {
  const dayStart = philippineDate + day_offset * DAY_MS;
  return {
    ...rest,
    start_at: new Date(atGmtTime(dayStart, start_gmt)).toISOString(),
    end_at: new Date(atGmtTime(dayStart, end_gmt)).toISOString(),
  };
}

/** Events the demo user approved or dismissed; forgotten when the page is reloaded. */
const handledApprovals = new Set<number>();

/** The notifications of the demo user, without those already approved or dismissed. */
function buildApprovals(snapshot: unknown) {
  if (!Array.isArray(snapshot)) {
    throw new Error('Unexpected event approvals file');
  }

  const philippineDate = Math.floor((Date.now() + PHILIPPINE_OFFSET_MS) / DAY_MS) * DAY_MS;
  const items = (snapshot as DemoEvent[])
    .filter((row) => !handledApprovals.has(row.id))
    .map((row) => toDatedEvent(row, philippineDate));
  return { approver_type: 'REQUIRED', items };
}

/**
 * Same sections as the backend's EventsService.findPublic: "today" is the Philippine calendar day, an event that
 * starts after today is upcoming, one that ended before today is past (most recently ended first).
 */
function buildEvents(snapshot: unknown) {
  if (!Array.isArray(snapshot)) {
    throw new Error('Unexpected events file');
  }

  const now = Date.now();
  const todayStart = Math.floor((now + PHILIPPINE_OFFSET_MS) / DAY_MS) * DAY_MS - PHILIPPINE_OFFSET_MS;
  const tomorrowStart = todayStart + DAY_MS;
  // The GMT clock times of an event are on the same calendar date as its Philippine day (UTC midnight of that date).
  const philippineDate = todayStart + PHILIPPINE_OFFSET_MS;

  const rows = (snapshot as DemoEvent[]).map((row) => toDatedEvent(row, philippineDate));

  const startOf = (row: { start_at: string }) => Date.parse(row.start_at);
  const endOf = (row: { end_at: string }) => Date.parse(row.end_at);
  return {
    today: rows.filter((row) => startOf(row) < tomorrowStart && endOf(row) > todayStart).sort((a, b) => startOf(a) - startOf(b)),
    upcoming: rows.filter((row) => startOf(row) >= tomorrowStart).sort((a, b) => startOf(a) - startOf(b)),
    past: rows.filter((row) => endOf(row) <= todayStart).sort((a, b) => endOf(b) - endOf(a)),
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

/** The members, then the online pilots who are not among them (the live feed has no country or division). */
function addOnlinePilots(members: unknown, online: { vid: string }[]) {
  if (!Array.isArray(members)) {
    throw new Error('Unexpected members file');
  }
  const knownVids = new Set((members as { vid: string }[]).map((member) => member.vid));
  const others = [...new Set(online.map((pilot) => pilot.vid))]
    .filter((vid) => vid !== '' && !knownVids.has(vid))
    .sort((a, b) => a.localeCompare(b))
    .map((vid) => ({
      vid,
      name: vid,
      first_name: null,
      last_name: null,
      suffix: null,
      role_title: null,
      role_description: null,
      contact_email: null,
      contact_number: null,
      photo_version: null,
      country: null,
      division: null,
      is_pilot: true,
      is_atc: false,
      is_staff: false,
      is_real_world_pilot: false,
      is_real_world_atc: false,
    }));
  return [...members, ...others];
}

/** The dummy flight plan shown for a Pilot ID or username: the same one every time it is typed. */
function pickFlightPlan(plans: unknown, lookup: string): unknown {
  if (!Array.isArray(plans) || plans.length === 0) {
    throw new Error('Unexpected flight plans file');
  }
  const sum = [...lookup.toLowerCase()].reduce((total, character) => total + character.charCodeAt(0), 0);
  return plans[sum % plans.length];
}

/** The profile photo uploaded in the demo, kept in this browser only (the round picture, as a data URL). */
const DEMO_PHOTO_KEY = 'ivao_demo_profile_photo';

function readDemoPhoto(): { version: string; dataUrl: string } | null {
  try {
    const stored = JSON.parse(localStorage.getItem(DEMO_PHOTO_KEY) || 'null');
    return typeof stored?.version === 'string' && typeof stored?.dataUrl === 'string' ? stored : null;
  } catch {
    return null;
  }
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(',');
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: header.slice('data:'.length).split(';')[0] });
}

/**
 * Demo account (so Profile Settings can be opened): there is no backend, so any email and password
 * logs in as a dummy non-admin user, and the profile page saves into the session that is kept in this
 * browser's localStorage. Nothing is sent anywhere.
 */
const DEMO_SESSION_HOURS = 12;
const DEMO_THEMES: readonly string[] = ['light', 'dark', 'system'];
const DEMO_NAME_FIELDS = ['nickname', 'first_name', 'middle_name', 'last_name', 'suffix'] as const;

function demoUser(loginEmail: string): Record<string, unknown> {
  return {
    login_email: loginEmail,
    nickname: 'Demo',
    first_name: 'Juan',
    middle_name: 'Santos',
    last_name: 'Dela Cruz',
    suffix: null,
    is_admin: false,
    manage_all_data: false,
    manage_data_codes: [],
    is_event_approver: false,
    can_edit_events_on_approval: false,
    ui_theme: 'light',
    photo_version: readDemoPhoto()?.version ?? null,
  };
}

function readDemoSessionUser(): Record<string, unknown> | null {
  try {
    const stored = JSON.parse(localStorage.getItem(environment.sessionStorageKey) || 'null');
    return stored?.user && typeof stored.user === 'object' ? stored.user : null;
  } catch {
    return null;
  }
}

function demoAccountResponse(method: string, path: string, body: unknown): Observable<HttpEvent<unknown>> | null {
  const ok = (payload: unknown) => of(new HttpResponse({ status: 200, body: payload }));
  const unauthorized = () =>
    throwError(() => new HttpErrorResponse({ status: 401, error: { message: 'Please log in again.' } }));

  if (method === 'POST' && path === '/admin-auth/login') {
    const submitted = new URLSearchParams(typeof body === 'string' ? body : '').get('login_email')?.trim();
    const now = Date.now();
    return ok({
      token: 'demo-session',
      expires_at: new Date(now + DEMO_SESSION_HOURS * 3600 * 1000).toISOString(),
      server_time: new Date(now).toISOString(),
      user: demoUser(submitted || 'demo@example.com'),
    });
  }

  if (method === 'GET' && path === '/admin-auth/session') {
    const user = readDemoSessionUser();
    return user ? ok({ valid: true, user }) : unauthorized();
  }

  if (method === 'PUT' && path === '/admin-auth/profile') {
    const user = readDemoSessionUser();
    if (!user) {
      return unauthorized();
    }
    const changes = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const updated: Record<string, unknown> = { ...user };
    for (const field of DEMO_NAME_FIELDS) {
      const value = changes[field];
      if (typeof value === 'string') {
        updated[field] = value.trim() || null;
      }
    }
    const theme = changes['ui_theme'];
    if (typeof theme === 'string' && DEMO_THEMES.includes(theme)) {
      updated['ui_theme'] = theme;
    }
    return ok({ success: true, user: updated });
  }

  if (path === '/admin-auth/profile/photo') {
    return demoPhotoResponse(method, body);
  }

  return null;
}

/** Shows, saves and removes the demo account's profile photo. */
function demoPhotoResponse(method: string, body: unknown): Observable<HttpEvent<unknown>> {
  const fail = (status: number, message: string) =>
    throwError(() => new HttpErrorResponse({ status, error: { message } }));
  const user = readDemoSessionUser();
  if (!user) {
    return fail(401, 'Please log in again.');
  }
  const answer = (photoVersion: string | null) =>
    new HttpResponse({ status: 200, body: { success: true, user: { ...user, photo_version: photoVersion } } });

  if (method === 'GET') {
    const photo = readDemoPhoto();
    return photo ? of(new HttpResponse({ status: 200, body: dataUrlToBlob(photo.dataUrl) })) : fail(404, 'Photo not found.');
  }

  if (method === 'DELETE') {
    try {
      localStorage.removeItem(DEMO_PHOTO_KEY);
    } catch {
      // Nothing was stored.
    }
    return of(answer(null));
  }

  const avatar = body instanceof FormData ? body.get('avatar') : null;
  if (method !== 'PUT' || !(avatar instanceof Blob)) {
    return fail(400, 'Choose a photo.');
  }
  return from(readAsDataUrl(avatar)).pipe(
    switchMap((dataUrl) => {
      const version = String(Date.now());
      try {
        localStorage.setItem(DEMO_PHOTO_KEY, JSON.stringify({ version, dataUrl }));
      } catch {
        return fail(400, 'The photo could not be saved in this browser.');
      }
      return of(answer(version));
    }),
  );
}

export const demoDataInterceptor: HttpInterceptorFn = (req, next) => {
  const apiBase = environment.apiUrl.replace(/\/$/, '');
  const path = req.url.startsWith(apiBase) ? req.url.slice(apiBase.length).split('?')[0] : null;

  const account = path === null ? null : demoAccountResponse(req.method, path, req.body);
  if (account !== null) {
    return account;
  }

  const approvalAction = path === null ? null : /^\/event-approvals\/(\d+)\/(approve|dismiss)$/.exec(path);
  if (req.method === 'POST' && approvalAction !== null) {
    handledApprovals.add(Number(approvalAction[1]));
    return of(new HttpResponse({ status: 200, body: null }));
  }

  if (req.method !== 'GET') {
    return next(req);
  }

  if (path === '/event-approvals') {
    return next(req.clone({ url: APPROVALS_FILE, headers: new HttpHeaders() })).pipe(
      filter((event): event is HttpResponse<unknown> => event instanceof HttpResponse),
      map((event) => new HttpResponse({ status: 200, body: buildApprovals(event.body) })),
    );
  }

  if (path === '/manage-integrations') {
    return of(new HttpResponse({ status: 200, body: EMPTY_INTEGRATIONS }));
  }

  // A request to another site must not carry the API credentials.
  const download = () => next(req.clone({ url: IVAO_WHAZZUP_API, headers: new HttpHeaders() }));

  if (path === '/members') {
    const members$ = next(req.clone({ url: MEMBERS_FILE, headers: new HttpHeaders() })).pipe(
      filter((event): event is HttpResponse<unknown> => event instanceof HttpResponse),
      map((event) => event.body),
    );
    // Like the backend, only the members are listed when IVAO cannot be reached.
    const online$ = loadFeed(download).pipe(
      map((feed) => buildPilots(feed).pilots),
      catchError(() => of([])),
    );
    return forkJoin([members$, online$]).pipe(
      map(([members, online]) => new HttpResponse({ status: 200, body: addOnlinePilots(members, online) })),
    );
  }

  const simbrief = path === null ? null : /^\/simbrief\/([^/]+)$/.exec(path);
  if (simbrief !== null) {
    return next(req.clone({ url: SIMBRIEF_FILE, headers: new HttpHeaders() })).pipe(
      filter((event): event is HttpResponse<unknown> => event instanceof HttpResponse),
      map(
        (event) =>
          new HttpResponse({ status: 200, body: pickFlightPlan(event.body, decodeURIComponent(simbrief[1])) }),
      ),
    );
  }

  if (path === '/pilots/online' || path === '/atc/online') {
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

  if (path === '/events') {
    return next(req.clone({ url: EVENTS_FILE, headers: new HttpHeaders() })).pipe(
      filter((event): event is HttpResponse<unknown> => event instanceof HttpResponse),
      map((event) => new HttpResponse({ status: 200, body: buildEvents(event.body) })),
    );
  }

  // Dummy files (event pictures, document and chart PDFs): the request keeps its response type (blob).
  for (const route of path === null ? [] : DEMO_FILE_ROUTES) {
    if (route.pattern.test(path!)) {
      return next(req.clone({ url: path!.replace(route.pattern, route.file), headers: new HttpHeaders() }));
    }
  }

  const file = path === null ? undefined : DEMO_RESPONSES[path];

  // Drop the API credentials: the static file needs none.
  return next(file ? req.clone({ url: file, headers: req.headers.delete('Authorization') }) : req);
};
