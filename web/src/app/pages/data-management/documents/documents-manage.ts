import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PlaceholderBannerDataManagementComponent } from '../../../placeholders/banner/placeholder-banner-data-management';
import { AdminAuthService } from '../../../services/admin-auth.service';
import { DATA_MANAGE_MESSAGES } from '../../../shared/data-manage-messages';
import { LINK_URL_ERROR, LINK_URL_MAX_LENGTH, linkUrlValidator } from '../../../shared/link-url';
import { injectCurrentPage } from '../../../shared/page-titles';
import { QrUploadComponent } from '../../../shared/qr-upload/qr-upload';
import { buildSubmitErrorMessage } from '../../../shared/submit-error-utils';
import { TablePagination, TablePaginationComponent } from '../../../shared/table-pagination/table-pagination';
import {
  DOCUMENT_RULES,
  formatFileSize,
  formatIsoDate,
  getAcceptAttribute,
  getUploadFileError,
} from '../../../shared/upload-files';
import { VALIDATION_MESSAGES } from '../../../shared/validation-messages';

const DOCUMENTS_API = `${environment.apiUrl.replace(/\/$/, '')}/data-management/documents`;

interface DocumentRow {
  id: number;
  name: string;
  description: string | null;
  /** The page a link document opens; null for a document that holds a file. */
  link_url: string | null;
  /** The file fields are null for a link. */
  file_name: string | null;
  file_mimetype: string | null;
  file_size: number | null;
  use_validity_dates: boolean;
  /** YYYY-MM-DD */
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

type DocumentColumnKey = 'id' | 'name' | 'description' | 'file_name' | 'validity' | 'is_active';
type SortDirection = 'asc' | 'desc';
/** A document is a file chosen on this device / sent from a phone, or a link to a page. */
type DocumentSource = 'file' | 'link';

const EMPTY_FILTERS: Record<DocumentColumnKey, string> = {
  id: '',
  name: '',
  description: '',
  file_name: '',
  validity: '',
  is_active: '',
};

/** The End Date cannot be earlier than the Start Date (the same day is fine). ISO dates compare as text. */
function endNotBeforeStart(control: AbstractControl): ValidationErrors | null {
  const start = String(control.parent?.get('start_date')?.value ?? '');
  const end = String(control.value ?? '');
  return start && end && end < start ? { endBeforeStart: true } : null;
}

/**
 * Data management page for the documents shown on the public Documents page: a Word, Excel or PDF file (chosen on
 * this device or sent from a phone through a QR code), its name, optional validity dates and the Enabled switch.
 * Instead of a file a document can be a link: the public page then sends the visitor to that web address (it cannot be
 * downloaded). Unlike the other data management pages it has no template import/export: a file cannot travel in a CSV.
 */
@Component({
  selector: 'app-documents-manage',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    PlaceholderBannerDataManagementComponent,
    QrUploadComponent,
    TablePaginationComponent,
  ],
  templateUrl: './documents-manage.html',
  styleUrl: './documents-manage.css',
})
export class DocumentsManageComponent implements OnInit {
  readonly pager = new TablePagination();
  readonly page = injectCurrentPage();

  private readonly http = inject(HttpClient);
  private readonly authService = inject(AdminAuthService);
  private readonly fb = inject(FormBuilder);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  readonly VALIDATION_MESSAGES = VALIDATION_MESSAGES;
  readonly messages = DATA_MANAGE_MESSAGES;
  readonly documentAccept = getAcceptAttribute(DOCUMENT_RULES);
  readonly documentHelperText = DOCUMENT_RULES.helperText;
  readonly formatFileSize = formatFileSize;
  readonly endBeforeStartMessage = 'End Date cannot be earlier than Start Date.';
  readonly linkUrlMaxLength = LINK_URL_MAX_LENGTH;
  readonly linkUrlErrorMessage = LINK_URL_ERROR;

  readonly form = this.fb.nonNullable.group({
    source: ['file' as DocumentSource],
    // Off until "Link to a web page" is chosen; a disabled field is neither validated nor saved.
    link_url: [
      { value: '', disabled: true },
      [Validators.required, Validators.maxLength(LINK_URL_MAX_LENGTH), linkUrlValidator],
    ],
    name: ['', [Validators.required, Validators.maxLength(255)]],
    description: ['', [Validators.maxLength(1000)]],
    use_validity_dates: [false],
    // Off until "Use Start Date and End Date" is ticked; a disabled field is neither validated nor saved.
    start_date: [{ value: '', disabled: true }, [Validators.required]],
    end_date: [{ value: '', disabled: true }, [Validators.required, endNotBeforeStart]],
    // A new document is enabled by default (unlike the other data management pages).
    is_active: [true],
  });

  documents: DocumentRow[] = [];
  editingId: number | null = null;
  /** The file chosen on this device or received from the phone; null keeps the saved file when editing. */
  selectedFile: File | null = null;
  fileTouched = false;
  isModalOpen = false;
  isLoading = false;
  isSaving = false;
  errorMessage = '';
  successMessage = '';
  columnFilters: Record<DocumentColumnKey, string> = { ...EMPTY_FILTERS };

  sortColumn: DocumentColumnKey | null = 'name';
  sortDirection: SortDirection = 'asc';

  constructor() {
    const { source, use_validity_dates, start_date, end_date } = this.form.controls;
    source.valueChanges.subscribe((value) => this.setLinkFieldEnabled(value === 'link'));
    use_validity_dates.valueChanges.subscribe((useDates) => this.setValidityFieldsEnabled(useDates));
    // A new Start Date can make the End Date invalid (or valid again).
    start_date.valueChanges.subscribe(() => end_date.updateValueAndValidity({ emitEvent: false }));
  }

  ngOnInit(): void {
    this.loadDocuments();
  }

  get isEditMode(): boolean {
    return this.editingId !== null;
  }

  get editingDocument(): DocumentRow | undefined {
    return this.documents.find((item) => item.id === this.editingId);
  }

  get isLinkSource(): boolean {
    return this.form.controls.source.value === 'link';
  }

  /** The document being edited holds a stored file (not a link): choosing a new file is then optional. */
  get hasSavedFile(): boolean {
    return !!this.editingDocument?.file_name;
  }

  get useValidityDates(): boolean {
    return this.form.controls.use_validity_dates.value;
  }

  /** The Start Date is the earliest day the End Date picker allows. */
  get minEndDate(): string | null {
    return this.form.controls.start_date.value || null;
  }

  /**
   * Why the chosen file cannot be used ('' when it is fine, nothing was tried yet, or the document is a link). A file is
   * required unless the document being edited already holds one.
   */
  get fileErrorMessage(): string {
    if (!this.fileTouched || this.isLinkSource) {
      return '';
    }

    return getUploadFileError(this.selectedFile, DOCUMENT_RULES, this.hasSavedFile ? '' : VALIDATION_MESSAGES.required);
  }

  get hasActiveFilters(): boolean {
    return Object.values(this.columnFilters).some((value) => value);
  }

  get filteredDocuments(): DocumentRow[] {
    const filters = {
      id: this.columnFilters.id.trim().toLowerCase(),
      name: this.columnFilters.name.trim().toLowerCase(),
      description: this.columnFilters.description.trim().toLowerCase(),
      file_name: this.columnFilters.file_name.trim().toLowerCase(),
      validity: this.columnFilters.validity.trim().toLowerCase(),
      is_active: this.columnFilters.is_active.trim().toLowerCase(),
    };

    const filtered = this.documents.filter((item) => {
      if (filters.id && !String(item.id).includes(filters.id)) {
        return false;
      }
      if (filters.name && !item.name.toLowerCase().includes(filters.name)) {
        return false;
      }
      if (filters.description && !(item.description ?? '').toLowerCase().includes(filters.description)) {
        return false;
      }
      if (filters.file_name && !this.formatFile(item).toLowerCase().includes(filters.file_name)) {
        return false;
      }
      if (filters.validity && !this.formatValidity(item).toLowerCase().includes(filters.validity)) {
        return false;
      }

      const activeText = item.is_active ? 'yes enabled active true' : 'no disabled inactive false';
      return !filters.is_active || activeText.includes(filters.is_active);
    });

    if (!this.sortColumn) {
      return filtered;
    }

    const sortColumn = this.sortColumn;
    const directionMultiplier = this.sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((left, right) => {
      if (sortColumn === 'id') {
        return (left.id - right.id) * directionMultiplier;
      }
      if (sortColumn === 'is_active') {
        return (Number(left.is_active) - Number(right.is_active)) * directionMultiplier;
      }
      if (sortColumn === 'validity') {
        // Documents without dates ("Always") come first when ascending; the others by Start Date, then End Date.
        const leftKey = left.use_validity_dates ? `${left.start_date}|${left.end_date}` : '';
        const rightKey = right.use_validity_dates ? `${right.start_date}|${right.end_date}` : '';
        return leftKey.localeCompare(rightKey) * directionMultiplier;
      }

      const leftValue = this.getTextSortValue(left, sortColumn);
      const rightValue = this.getTextSortValue(right, sortColumn);
      return (
        leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: 'base' }) * directionMultiplier
      );
    });
  }

  private getTextSortValue(item: DocumentRow, column: DocumentColumnKey): string {
    if (column === 'name') {
      return item.name;
    }
    return column === 'description' ? (item.description ?? '') : this.formatFile(item);
  }

  /** "report.pdf (1.2 MB)" for a file, or "Link: https://example.com" for a link. */
  formatFile(item: DocumentRow): string {
    return item.link_url
      ? `Link: ${item.link_url}`
      : `${item.file_name ?? ''} (${formatFileSize(item.file_size ?? 0)})`;
  }

  /** "Always" or "Nov 1, 2026 - Nov 30, 2026". */
  formatValidity(item: DocumentRow): string {
    if (!item.use_validity_dates || !item.start_date || !item.end_date) {
      return 'Always';
    }

    return `${formatIsoDate(item.start_date)} - ${formatIsoDate(item.end_date)}`;
  }

  loadDocuments(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.http.get<DocumentRow[]>(DOCUMENTS_API, { headers: this.authService.getAdminApiHeaders() }).subscribe({
      next: (rows) => {
        this.documents = Array.isArray(rows) ? rows : [];
        this.isLoading = false;
        this.changeDetectorRef.detectChanges();
      },
      error: (error: HttpErrorResponse) => {
        this.isLoading = false;
        this.errorMessage = this.buildErrorMessage(error, DATA_MANAGE_MESSAGES.unableToLoad('documents'));
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  openAddModal(): void {
    this.resetForm();
    this.errorMessage = '';
    this.successMessage = '';
    this.isModalOpen = true;
  }

  edit(item: DocumentRow): void {
    this.resetForm();
    this.editingId = item.id;
    this.errorMessage = '';
    this.successMessage = '';

    this.form.controls.name.setValue(item.name);
    this.form.controls.description.setValue(item.description ?? '');
    // Choosing the source enables the link field, which can then be filled.
    this.form.controls.source.setValue(item.link_url ? 'link' : 'file');
    if (item.link_url) {
      this.form.controls.link_url.setValue(item.link_url);
    }
    this.form.controls.is_active.setValue(item.is_active);
    // Ticking the box enables the date fields, which can then be filled.
    this.form.controls.use_validity_dates.setValue(item.use_validity_dates);
    if (item.use_validity_dates) {
      this.form.controls.start_date.setValue(item.start_date ?? '');
      this.form.controls.end_date.setValue(item.end_date ?? '');
    }

    this.isModalOpen = true;
  }

  closeModal(): void {
    if (this.isSaving) {
      return;
    }

    this.isModalOpen = false;
    this.resetForm();
    this.errorMessage = '';
  }

  onFileChange(file: File | null): void {
    this.selectedFile = file;
    this.fileTouched = true;
    this.changeDetectorRef.detectChanges();
  }

  showInvalid(controlName: 'name' | 'link_url' | 'start_date' | 'end_date'): boolean {
    const control = this.form.controls[controlName];
    return control.invalid && (control.touched || control.dirty);
  }

  save(): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.fileTouched = true;
    if (this.form.invalid || this.fileErrorMessage) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const isLink = value.source === 'link';
    const name = value.name.trim();
    if (!name) {
      this.form.controls.name.setErrors({ required: true });
      this.form.controls.name.markAsTouched();
      return;
    }

    // multipart/form-data: the text fields and, when one was chosen, the file. Unused date fields are not sent.
    const body = new FormData();
    body.append('name', name);
    // Always sent: an empty text tells the server this document is a file (it drops a saved link).
    body.append('link_url', isLink ? value.link_url.trim() : '');
    // Always sent: an empty text clears the description of a document being edited.
    body.append('description', value.description.trim());
    body.append('use_validity_dates', String(value.use_validity_dates));
    if (value.use_validity_dates) {
      body.append('start_date', value.start_date);
      body.append('end_date', value.end_date);
    }
    body.append('is_active', String(value.is_active));
    if (!isLink && this.selectedFile) {
      body.append('file', this.selectedFile, this.selectedFile.name);
    }

    const headers = this.authService.getAdminApiHeaders();
    const isEditing = this.editingId !== null;
    const request = isEditing
      ? this.http.put(`${DOCUMENTS_API}/${this.editingId}`, body, { headers })
      : this.http.post(DOCUMENTS_API, body, { headers });

    this.isSaving = true;
    request.subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = isEditing
          ? DATA_MANAGE_MESSAGES.updated('Document')
          : DATA_MANAGE_MESSAGES.added('Document');
        this.isModalOpen = false;
        this.resetForm();
        this.loadDocuments();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving = false;
        this.errorMessage = this.buildErrorMessage(
          error,
          isEditing ? 'Unable to update document.' : 'Unable to add document.',
        );
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  deleteDocument(): void {
    if (this.editingId === null) {
      return;
    }

    if (!window.confirm(DATA_MANAGE_MESSAGES.confirmDelete(this.editingDocument?.name ?? ''))) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.isSaving = true;
    this.http
      .delete(`${DOCUMENTS_API}/${this.editingId}`, { headers: this.authService.getAdminApiHeaders() })
      .subscribe({
        next: () => {
          this.isSaving = false;
          this.successMessage = DATA_MANAGE_MESSAGES.deleted('Document');
          this.isModalOpen = false;
          this.resetForm();
          this.loadDocuments();
        },
        error: (error: HttpErrorResponse) => {
          this.isSaving = false;
          this.errorMessage = this.buildErrorMessage(error, 'Unable to delete document.');
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  setColumnFilter(column: DocumentColumnKey, value: string): void {
    this.columnFilters[column] = value;
  }

  clearFilters(): void {
    this.columnFilters = { ...EMPTY_FILTERS };
  }

  toggleSort(column: DocumentColumnKey): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      return;
    }

    this.sortColumn = column;
    this.sortDirection = 'asc';
  }

  getSortIndicator(column: DocumentColumnKey): string {
    if (this.sortColumn !== column) {
      return '';
    }

    return this.sortDirection === 'asc' ? '↑' : '↓';
  }

  /** Turns the link field on (required) or off (emptied, not validated, not saved). */
  private setLinkFieldEnabled(enabled: boolean): void {
    const { link_url } = this.form.controls;
    if (enabled) {
      link_url.enable({ emitEvent: false });
    } else {
      link_url.reset('', { emitEvent: false });
      link_url.disable({ emitEvent: false });
    }
  }

  /** Turns the Start Date and End Date fields on (required) or off (emptied, not validated, not saved). */
  private setValidityFieldsEnabled(enabled: boolean): void {
    const { start_date, end_date } = this.form.controls;
    for (const control of [start_date, end_date]) {
      if (enabled) {
        control.enable({ emitEvent: false });
      } else {
        control.reset('', { emitEvent: false });
        control.disable({ emitEvent: false });
      }
    }
  }

  private resetForm(): void {
    this.editingId = null;
    this.selectedFile = null;
    this.fileTouched = false;
    this.form.reset({
      source: 'file',
      link_url: '',
      name: '',
      description: '',
      use_validity_dates: false,
      start_date: '',
      end_date: '',
      is_active: true,
    });
    this.setLinkFieldEnabled(false);
    this.setValidityFieldsEnabled(false);
    this.form.markAsPristine();
    this.form.markAsUntouched();
  }

  private buildErrorMessage(error: HttpErrorResponse, fallback: string): string {
    return buildSubmitErrorMessage(error, { fallbackMessage: fallback });
  }
}
