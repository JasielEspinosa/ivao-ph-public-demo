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
  maxBytes: 25 * 1024 * 1024,
  typeMessage: 'Charts must be PDF files.',
  sizeMessage: 'File must be 25 MB or smaller.',
  helperText: 'Accepted file type: PDF (up to 25 MB)',
};

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
