// Keep in step with backend/src/nestjs/data-management/airport-parking/airport-parking.constants.ts and
// data-management/shared/airline-codes.ts.

/** A parking stand or a hangar is where an aircraft stands; a gate is a terminal door. */
export const AIRPORT_STAND_TYPES = [
  { value: 'PARKING_STAND', label: 'Parking Stand' },
  { value: 'HANGAR', label: 'Hangar' },
  { value: 'GATE', label: 'Terminal Gate' },
] as const;

/** Where a spot comes from. Every source but XPLANE (simulator data) is a real-world one. */
export const AIRPORT_PARKING_SOURCES = [
  { value: 'OSM', label: 'OpenStreetMap' },
  { value: 'CAAP', label: 'CAAP AIP' },
  { value: 'OTHER', label: 'Other real-world source' },
  { value: 'XPLANE', label: 'X-Plane (simulator)' },
] as const;

/** What a stand is used for. */
export const STAND_USES = [
  { value: 'AIRLINE', label: 'Airline' },
  { value: 'CARGO', label: 'Cargo' },
  { value: 'GENERAL_AVIATION', label: 'General Aviation' },
  { value: 'MILITARY', label: 'Military' },
] as const;

/** The ICAO aerodrome reference code letters of aircraft sizes, with the wingspan of each. */
export const AIRCRAFT_SIZES = [
  { value: 'A', label: 'A (wingspan under 15 m)' },
  { value: 'B', label: 'B (15 to under 24 m)' },
  { value: 'C', label: 'C (24 to under 36 m)' },
  { value: 'D', label: 'D (36 to under 52 m)' },
  { value: 'E', label: 'E (52 to under 65 m)' },
  { value: 'F', label: 'F (65 to under 80 m)' },
] as const;

export const MAX_STAND_NAME_LENGTH = 50;
export const MAX_PARKING_NOTE_LENGTH = 500;
export const MAX_TERMINAL_NAME_LENGTH = 50;
export const MAX_AIRLINES_LENGTH = 500;

/** 3-letter ICAO codes separated by commas or spaces. */
export const AIRLINE_CODES_PATTERN = /^[\s,;]*([A-Za-z]{3}([\s,;]+|$))*$/;
export const AIRLINE_CODES_MESSAGE = 'Enter 3-letter ICAO airline codes separated by commas, for example CEB, PAL.';

export interface Airline {
  code: string;
  /** '' when the website does not know the code. */
  name: string;
}

/** A parking spot as the public API returns it. */
export interface AirportParkingSpot {
  id: number;
  airport_icao: string;
  airport_name: string;
  stand_name: string | null;
  stand_type: string;
  latitude: number;
  longitude: number;
  source: string;
  note: string | null;
  terminal_name: string | null;
  shown_use: string | null;
  /** The use or size comes from a flight simulator scenery. */
  use_is_simulated: boolean;
  shown_size: string | null;
  size_is_simulated: boolean;
  shown_airlines: Airline[];
  /** SPOT (entered for the spot), TERMINAL (those of its terminal) or XPLANE (simulator data); null with no airlines. */
  airlines_source: string | null;
}

/** A terminal as the public API returns it. */
export interface AirportTerminal {
  id: number;
  airport_icao: string;
  terminal_name: string;
  airlines: Airline[];
  note: string | null;
}

export function standTypeLabel(value: string): string {
  return AIRPORT_STAND_TYPES.find((type) => type.value === value)?.label ?? value;
}

export function parkingSourceLabel(value: string): string {
  return AIRPORT_PARKING_SOURCES.find((source) => source.value === value)?.label ?? value;
}

export function isSimulatorSource(value: string): boolean {
  return value === 'XPLANE';
}

export function standUseLabel(value: string | null): string {
  return STAND_USES.find((use) => use.value === value)?.label ?? value ?? '';
}

export function airlinesSourceLabel(value: string | null): string {
  switch (value) {
    case 'SPOT':
      return 'of this spot';
    case 'TERMINAL':
      return 'of the terminal';
    case 'XPLANE':
      return 'simulator data';
    default:
      return '';
  }
}

/** "Cebu Pacific (CEB)", or the code alone when the name is unknown. */
export function airlineLabel(airline: Airline): string {
  return airline.name ? `${airline.name} (${airline.code})` : airline.code;
}
