import { VALIDATION_MESSAGES } from './validation-messages';

/**
 * What a file upload accepts, for the pages that upload a file (Documents, Charts) and the phone page of the QR code
 * upload. The backend checks the same rules again (`data-management/documents/document-file.ts`, `charts/chart-file.ts`).
 */
export interface UploadRules {
  /** Accepted extensions in lower case, without the dot. */
  readonly extensions: readonly string[];
  readonly maxBytes: number;
  readonly typeMessage: string;
  readonly sizeMessage: string;
  readonly helperText: string;
}

/** Documents are stored in the database, so they stay small. */
export const DOCUMENT_RULES: UploadRules = {
  extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx'],
  maxBytes: 5 * 1024 * 1024,
  typeMessage: 'Documents must be Word (DOC, DOCX), Excel (XLS, XLSX) or PDF files.',
  sizeMessage: 'File must be 5 MB or smaller.',
  helperText: 'Accepted file types: Word (DOC, DOCX), Excel (XLS, XLSX), PDF (up to 5 MB)',
};

/** Flight charts are PDFs kept in a folder on the server, so they may be larger. */
export const CHART_RULES: UploadRules = {
  extensions: ['pdf'],
  maxBytes: 50 * 1024 * 1024,
  typeMessage: 'Charts must be PDF files.',
  sizeMessage: 'File must be 50 MB or smaller.',
  helperText: 'Accepted file type: PDF (up to 50 MB)',
};

/** An event's picture is small (kept in the database) and shown at 16:9. The backend checks type and size again. */
export const EVENT_IMAGE_RULES: UploadRules = {
  extensions: ['jpg', 'jpeg', 'png', 'webp'],
  maxBytes: 2 * 1024 * 1024,
  typeMessage: 'The event image must be a JPG, PNG or WebP file.',
  sizeMessage: 'The event image must be 2 MB or smaller.',
  helperText: 'Recommended: 16:9 ratio (1280 x 720 px), JPG, PNG or WebP, up to 2 MB',
};

/** The picture must be at least this wide (px) to stay sharp on a large screen. */
export const EVENT_IMAGE_MIN_WIDTH = 640;
export const EVENT_IMAGE_RATIO_MESSAGE = 'The event image must have a 16:9 ratio, for example 1280 x 720 pixels.';
export const EVENT_IMAGE_SMALL_MESSAGE = `The event image must be at least ${EVENT_IMAGE_MIN_WIDTH} pixels wide.`;
export const EVENT_IMAGE_UNREADABLE_MESSAGE = 'The event image could not be read. Choose another file.';

/** The width and height of an image file in pixels, or null when the browser cannot read it as a picture. */
export function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    const finish = (size: { width: number; height: number } | null) => {
      URL.revokeObjectURL(objectUrl);
      resolve(size);
    };
    image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => finish(null);
    image.src = objectUrl;
  });
}

/** Why a picture of this size cannot be an event image ('' when it is 16:9 within 2% and wide enough). */
export function getEventImageSizeError(size: { width: number; height: number } | null): string {
  if (!size || size.width === 0 || size.height === 0) {
    return EVENT_IMAGE_UNREADABLE_MESSAGE;
  }
  if (Math.abs(size.width / size.height - 16 / 9) / (16 / 9) > 0.02) {
    return EVENT_IMAGE_RATIO_MESSAGE;
  }

  return size.width < EVENT_IMAGE_MIN_WIDTH ? EVENT_IMAGE_SMALL_MESSAGE : '';
}

/** The `accept` attribute of a file input for these rules (".pdf,.doc,..."). */
export function getAcceptAttribute(rules: Pick<UploadRules, 'extensions'>): string {
  return rules.extensions.map((extension) => `.${extension}`).join(',');
}

/** The extension of a file name in lower case, or '' when it has none. */
export function getFileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/** `requiredMessage` when no file is chosen (pass '' when a file is optional), otherwise the type/size error, or '' when valid. */
export function getUploadFileError(
  file: File | null | undefined,
  rules: Pick<UploadRules, 'extensions' | 'maxBytes' | 'typeMessage' | 'sizeMessage'>,
  requiredMessage: string = VALIDATION_MESSAGES.required,
): string {
  if (!file) {
    return requiredMessage;
  }

  if (!rules.extensions.includes(getFileExtension(file.name))) {
    return rules.typeMessage;
  }

  if (file.size === 0) {
    return 'The file is empty.';
  }

  return file.size > rules.maxBytes ? rules.sizeMessage : '';
}

/** "2.4 MB", "340 KB", "812 B". */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
}

/** "2026-11-22" as "Nov 22, 2026", without going through UTC (which could show the day before). */
export function formatIsoDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
