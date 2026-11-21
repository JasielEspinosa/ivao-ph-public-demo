import { HttpErrorResponse } from '@angular/common/http';

export const NETWORK_UNAVAILABLE_MESSAGE =
  'The system is temporarily unavailable. Please try again in a few moments or refresh the browser.';
export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please log in again to continue.';
export const ACCESS_DENIED_MESSAGE = 'Access denied. Please contact Administrator.';
export const NOT_FOUND_MESSAGE = "We couldn't find what you're looking for. Please check and try again.";
export const SERVER_ERROR_MESSAGE =
  'Something went wrong on our end. Please try again in a few moments or refresh the browser.';
export const BAD_GATEWAY_MESSAGE =
  'We hit a snag on our end. Please try again in a few moments or refresh the browser.';
export const REQUEST_TIMEOUT_MESSAGE =
  'This is taking longer than expected. Please wait a moment and try again, or refresh the browser.';
export const TOO_MANY_REQUESTS_MESSAGE = 'Too many requests. Please wait a moment, then try again.';
export const PAYLOAD_TOO_LARGE_MESSAGE =
  'The file or data you are sending is too large. Please reduce its size and try again.';
export const SUBMIT_UNCONFIRMED_SAVE_MESSAGE = 'Your response could not be confirmed as saved. Please try again.';
export const SUBMIT_FAILED_MESSAGE = 'Unable to submit the form. Please try again.';

interface SubmitErrorMessageOptions {
  includeBackendMessage?: boolean;
  networkMessage?: string;
  unauthorizedMessage?: string;
  notFoundMessage?: string;
  fallbackMessage?: string | ((status: number | string) => string);
}

/** Shared message for 401 (session expired) and 403 (access denied). */
export function getAuthErrorMessage(status: number): string {
  return status === 403 ? ACCESS_DENIED_MESSAGE : SESSION_EXPIRED_MESSAGE;
}

/** Shared friendly message for server/gateway statuses (413, 429, 500, 502, 503, 504); null for any other status. */
export function getServerStatusMessage(status: number): string | null {
  switch (status) {
    case 413:
      return PAYLOAD_TOO_LARGE_MESSAGE;
    case 429:
      return TOO_MANY_REQUESTS_MESSAGE;
    case 500:
      return SERVER_ERROR_MESSAGE;
    case 502:
      return BAD_GATEWAY_MESSAGE;
    case 503:
      return NETWORK_UNAVAILABLE_MESSAGE;
    case 504:
      return REQUEST_TIMEOUT_MESSAGE;
    default:
      return null;
  }
}

export function buildSubmitErrorMessage(error: HttpErrorResponse, options: SubmitErrorMessageOptions = {}): string {
  const networkMessage = options.networkMessage ?? NETWORK_UNAVAILABLE_MESSAGE;
  const notFoundMessage = options.notFoundMessage ?? NOT_FOUND_MESSAGE;
  const includeBackendMessage = options.includeBackendMessage ?? true;
  const statusLabel = error.status || 'unknown';

  if (error.status === 0) {
    return networkMessage;
  }

  const serverStatusMessage = getServerStatusMessage(error.status);
  if (serverStatusMessage) {
    return serverStatusMessage;
  }

  if (error.status === 401 || error.status === 403) {
    return options.unauthorizedMessage ?? getAuthErrorMessage(error.status);
  }

  if (error.status === 404) {
    return notFoundMessage;
  }

  if (includeBackendMessage) {
    const backendMessage = extractBackendMessage(error);
    if (backendMessage) {
      if (backendMessage.toLowerCase().includes('failed to fetch')) {
        return networkMessage;
      }

      return backendMessage;
    }
  }

  if (typeof options.fallbackMessage === 'function') {
    return options.fallbackMessage(statusLabel);
  }

  if (options.fallbackMessage) {
    return options.fallbackMessage;
  }

  return `Submission failed (HTTP ${statusLabel}).`;
}

function extractBackendMessage(error: HttpErrorResponse): string | null {
  if (Array.isArray(error.error?.message)) {
    return error.error.message.join('\n');
  }

  if (typeof error.error?.message === 'string' && error.error.message.trim()) {
    return error.error.message;
  }

  if (typeof error.error === 'string' && error.error.trim()) {
    return error.error;
  }

  return null;
}
