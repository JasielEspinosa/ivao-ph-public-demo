import { VALIDATION_PATTERNS } from './validation-patterns';

export const PHILIPPINE_CONTACT_NUMBER_PATTERN = new RegExp(VALIDATION_PATTERNS.contactNumber_ph);

/** Keeps digits (and a single leading "+"), capped at the longest valid value (+63 + 10 digits). */
export function sanitizePhilippineContactNumber(rawValue: string): string {
  const hasLeadingPlus = rawValue.startsWith('+');
  const digitsOnly = rawValue.replace(/\D/g, '').slice(0, hasLeadingPlus ? 12 : 11);
  return `${hasLeadingPlus ? '+' : ''}${digitsOnly}`;
}

export const PHILIPPINE_LANDLINE_PATTERN = new RegExp(VALIDATION_PATTERNS.landlineNumber_ph);

/** Keeps digits (and a single leading "+"), capped at the longest valid landline (+63 + 9 digits). */
export function sanitizePhilippineLandlineNumber(rawValue: string): string {
  const hasLeadingPlus = rawValue.startsWith('+');
  const digitsOnly = rawValue.replace(/\D/g, '').slice(0, hasLeadingPlus ? 11 : 10);
  return `${hasLeadingPlus ? '+' : ''}${digitsOnly}`;
}
