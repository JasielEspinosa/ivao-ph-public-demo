import { formatIsoDate } from './upload-files';

/** The time zone the creator types an event's date and time in: Philippine Time or GMT (Zulu, the IVAO standard). */
export type EventZone = 'PHT' | 'GMT';

/**
 * What airports an event names: a From and/or To airport, from the fixed airport to any airport (FROM_ANY), from any
 * airport to the fixed airport (ANY_TO), a list of planned / preferred airports, or any airport.
 */
export type EventAirportMode = 'FROM_TO' | 'FROM_ANY' | 'ANY_TO' | 'MULTIPLE' | 'ANY';

/** Whether the mode uses the From airport. */
export function usesFromAirport(mode: string): boolean {
  return mode === 'FROM_TO' || mode === 'FROM_ANY';
}

/** Whether the mode uses the To airport. */
export function usesToAirport(mode: string): boolean {
  return mode === 'FROM_TO' || mode === 'ANY_TO';
}

/** An airport of an event that is a valid ICAO code, with its name and place (the API looks it up). */
export interface AirportDetail {
  icao: string;
  name: string;
  /** "City, Country" (either part may be missing). */
  place: string;
}

/** The fields of an event that the Home page and the Data Management page both print. */
export interface EventWhere {
  start_at: string;
  end_at: string;
  airport_mode: string;
  from_icao: string | null;
  to_icao: string | null;
  airport_icaos: readonly string[];
  /** Name and place of the airports above that are valid ICAO codes: From, To, then the list. */
  airport_details: readonly AirportDetail[];
}

/** Philippine Time is UTC+8 all year (no daylight saving). */
const OFFSET_MINUTES: Record<EventZone, number> = { PHT: 8 * 60, GMT: 0 };
const MINUTE_MS = 60 * 1000;
const PHT_TIME_ZONE = 'Asia/Manila';

/** A date and a time as the `<input type="date">` and `<input type="time">` use them: "2026-11-30" and "20:00". */
export interface ZoneParts {
  date: string;
  time: string;
}

/** The date and time an exact moment has on the clock of a zone. */
export function toZoneParts(instant: Date | string, zone: EventZone): ZoneParts {
  const shifted = new Date(new Date(instant).getTime() + OFFSET_MINUTES[zone] * MINUTE_MS).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

/** The exact moment of a date and time typed in a zone, or null while either is empty or invalid. */
export function fromZoneParts(date: string, time: string, zone: EventZone): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})/.exec(time);
  if (!dateMatch || !timeMatch) {
    return null;
  }

  const moment =
    Date.UTC(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
      Number(timeMatch[1]),
      Number(timeMatch[2]),
    ) -
    OFFSET_MINUTES[zone] * MINUTE_MS;
  return Number.isNaN(moment) ? null : new Date(moment);
}

/** "= Nov 30, 2026 20:00 PHT": the same moment on the clock of the other zone, so the creator sees what was typed. */
export function formatInOtherZone(date: string, time: string, zone: EventZone): string {
  const instant = fromZoneParts(date, time, zone);
  if (!instant) {
    return '';
  }

  const other: EventZone = zone === 'PHT' ? 'GMT' : 'PHT';
  const parts = toZoneParts(instant, other);
  return `= ${formatIsoDate(parts.date)} ${parts.time} ${other}`;
}

function longDate(instant: Date): string {
  const parts = new Map(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.get('month')} ${parts.get('day')}, ${parts.get('year')} (${parts.get('weekday')})`;
}

/** "1200Z" */
function zulu(instant: Date): string {
  const iso = instant.toISOString();
  return `${iso.slice(11, 13)}${iso.slice(14, 16)}Z`;
}

function phtDay(instant: Date): string {
  return toZoneParts(instant, 'PHT').date;
}

function phtShortDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: PHT_TIME_ZONE, month: 'short', day: 'numeric' }).format(instant);
}

/** "08:00 PM" (newer browsers put a no-break space before AM/PM). */
function phtTime(instant: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PHT_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
    .format(instant)
    .replace(/\s/g, ' ');
}

/** A moment something was done, in Philippine Time: "Nov 30, 2026, 08:00 PM PHT". */
export function formatPhtMoment(moment: string): string {
  const instant = new Date(moment);
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: PHT_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(instant);
  return `${date}, ${phtTime(instant)} PHT`;
}

/**
 * When an event happens, as lines of text: the GMT date and time first (IVAO works in Zulu time), then Philippine Time.
 *  - "November 30, 2026 (Monday)", "1200Z - 1600Z", "Nov 30, 08:00 PM - Dec 1, 12:00 AM PHT"
 *  - an event over several GMT days: "From <date> 1200Z", "To <date> 1600Z", then the PHT line
 */
export function formatEventWhen(startAt: string, endAt: string): string[] {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const sameGmtDay = start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10);
  const gmtLines = sameGmtDay
    ? [longDate(start), `${zulu(start)} - ${zulu(end)}`]
    : [`From ${longDate(start)} ${zulu(start)}`, `To ${longDate(end)} ${zulu(end)}`];

  const phtLine =
    phtDay(start) === phtDay(end)
      ? `${phtShortDate(start)}, ${phtTime(start)} - ${phtTime(end)} PHT`
      : `${phtShortDate(start)}, ${phtTime(start)} - ${phtShortDate(end)}, ${phtTime(end)} PHT`;

  return [...gmtLines, phtLine];
}

/** "RPLL → RPVM", "From RPLL", "To RPVM", "RPLL → any airport", "Any airport → RPVM", "RPLL, RPVM, RPLC" or "Any airport". */
export function formatEventAirports(
  event: Pick<EventWhere, 'airport_mode' | 'from_icao' | 'to_icao' | 'airport_icaos'>,
): string {
  if (event.airport_mode === 'FROM_TO') {
    if (event.from_icao && event.to_icao) {
      return `${event.from_icao} → ${event.to_icao}`;
    }
    return event.from_icao ? `From ${event.from_icao}` : `To ${event.to_icao ?? ''}`;
  }

  if (event.airport_mode === 'FROM_ANY') {
    return `${event.from_icao ?? ''} → any airport`;
  }

  if (event.airport_mode === 'ANY_TO') {
    return `Any airport → ${event.to_icao ?? ''}`;
  }

  return event.airport_mode === 'MULTIPLE' ? event.airport_icaos.join(', ') : 'Any airport';
}
