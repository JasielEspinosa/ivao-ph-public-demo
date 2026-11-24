import { AbstractControl, ValidationErrors } from '@angular/forms';

/**
 * The link option of the Documents and Charts data management pages: an entry can point to a page instead of holding a
 * file. The backend checks the same rules again (`data-management/shared/link-url.ts`).
 */
export const LINK_URL_MAX_LENGTH = 2048;

export const LINK_URL_ERROR = 'Enter a web address that starts with http:// or https://.';

/** True for an http or https address with a host. Anything else (javascript:, file:, plain text) is not a link. */
export function isValidLinkUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname;
  } catch {
    return false;
  }
}

/** Form validator: an empty value is left to `Validators.required`. */
export function linkUrlValidator(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '').trim();
  return value && !isValidLinkUrl(value) ? { linkUrl: true } : null;
}

/** "example.com" for "https://www.example.com/page", for the line under a link on the public pages. */
export function getLinkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
