import { environment } from '../../environments/environment';

// User-agent tokens of the browsers to block, joined with "|" into one case-insensitive regex. An empty list blocks nothing.
// To unblock a browser, remove its line; to block one again, add its code(s) from the list below as a new line.
//
// Browser codes (user-agent tokens):
//   Firefox            Firefox/ (desktop, Android) | FxiOS/ (iOS)    also Waterfox, LibreWolf, etc.
//   Chrome             Chrome/ (desktop, Android) | CriOS/ (iOS)     note: Edge, Opera, Brave, Vivaldi, Samsung also carry Chrome/
//   Safari             Safari/                                       note: Chrome, Edge, Opera, etc. also carry Safari/, so the entry below
//                                                                    matches Version/ + Safari/ and skips user-agents with Chrome-family tokens
//   Edge               Edg/ (desktop) | EdgA/ (Android) | EdgiOS/ (iOS) | Edge/ (legacy EdgeHTML)
//   Opera              OPR/ (desktop, Android) | OPT/ (Opera Touch) | OPiOS/ (iOS)
//   Samsung Internet   SamsungBrowser/
//   Vivaldi            Vivaldi/
//   DuckDuckGo         DuckDuckGo/ | Ddg/
//   UC Browser         UCBrowser/
//   Internet Explorer  MSIE | Trident/
//   Brave              no token of its own (it reports itself as Chrome)
const UNSUPPORTED_BROWSERS: { name: string; pattern: string }[] = [
  // Safari (not Chrome, Firefox, Edge or Opera on iOS, which also end in Safari/)
  { name: 'Safari', pattern: '(?!.*(?:Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPiOS)).*Version/[0-9.]+.*Safari/' },
  { name: 'DuckDuckGo', pattern: 'DuckDuckGo/|Ddg/' },
  { name: 'UC Browser', pattern: 'UCBrowser/' },
  { name: 'Internet Explorer', pattern: 'MSIE |Trident/' },
];

const UNSUPPORTED_BROWSER_PATTERN = UNSUPPORTED_BROWSERS.map((browser) => browser.pattern).join('|');

// Browsers the "browser not supported" page may name as supported (Internet Explorer is never one of them). The page lists
// every name here that is not in UNSUPPORTED_BROWSERS, so unblocking a browser above adds it to the page automatically.
const KNOWN_BROWSER_NAMES = [
  'Google Chrome',
  'Mozilla Firefox',
  'Brave',
  'Microsoft Edge',
  'Safari',
  'Opera',
  'Samsung Internet',
  'Vivaldi',
  'DuckDuckGo',
  'UC Browser',
];

export const SUPPORTED_BROWSER_NAMES: string[] = KNOWN_BROWSER_NAMES.filter(
  (name) => !UNSUPPORTED_BROWSERS.some((browser) => browser.name === name),
);

export function isUnsupportedBrowser(
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
): boolean {
  // An empty pattern must match nothing (an empty RegExp would match every user-agent).
  if (!UNSUPPORTED_BROWSER_PATTERN) {
    return false;
  }
  return new RegExp(`\\b(?:${UNSUPPORTED_BROWSER_PATTERN})`, 'i').test(userAgent);
}

// True when this build blocks the app for unsupported browsers (environment.browserBlockerEnabled) and the visitor is on one.
export function shouldBlockBrowser(): boolean {
  return environment.browserBlockerEnabled && isUnsupportedBrowser();
}
