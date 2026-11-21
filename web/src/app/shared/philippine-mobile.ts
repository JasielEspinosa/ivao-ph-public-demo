import { VALIDATION_PATTERNS } from './validation-patterns';

export const PHILIPPINE_MOBILE_PATTERN = new RegExp(VALIDATION_PATTERNS.mobileNumber_ph);
export const PHILIPPINE_MOBILE_FOCUS_DEFAULT = '+63 9';

export function formatPhilippineMobileNumber(rawValue: string): string {
  const digitsOnly = rawValue.replace(/\D/g, '');
  let localDigits = digitsOnly;
  if (localDigits.startsWith('63')) {
    localDigits = localDigits.slice(2);
  }

  if (localDigits.startsWith('0')) {
    localDigits = localDigits.slice(1);
  }

  if (!localDigits.startsWith('9')) {
    localDigits = `9${localDigits}`;
  }

  localDigits = localDigits.slice(0, 10);
  const area = localDigits.slice(0, 3);
  const mid = localDigits.slice(3, 6);
  const tail = localDigits.slice(6, 10);
  let formatted = '+63 ';
  if (area) {
    formatted += area;
  }

  if (mid) {
    formatted += ` ${mid}`;
  }

  if (tail) {
    formatted += ` ${tail}`;
  }

  return formatted;
}

export function normalizePhilippineMobileNumber(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return '';
  }

  return formatPhilippineMobileNumber(trimmed);
}

export function isPhilippineMobileNumberValid(value: string): boolean {
  return PHILIPPINE_MOBILE_PATTERN.test(value.trim());
}
