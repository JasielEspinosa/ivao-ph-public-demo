import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PlaceholderBannerDataManagementComponent } from '../../../placeholders/banner/placeholder-banner-data-management';
import { AdminAuthService } from '../../../services/admin-auth.service';
import { DATA_MANAGE_MESSAGES } from '../../../shared/data-manage-messages';
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
  file_name: string;
  file_mimetype: string;
  file_size: number;
  use_validity_dates: boolean;
  /** YYYY-MM-DD */
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

type DocumentColumnKey = 'id' | 'name' | 'file_name' | 'validity' | 'is_active';
type SortDirection = 'asc' | 'desc';

const EMPTY_FILTERS: Record<DocumentColumnKey, string> = {
  id: '',
  name: '',
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
 * Unlike the other data management pages it has no template import/export: a file cannot travel in a CSV.
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

  readonly form = this.fb.nonNullable.group({
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
    const { use_validity_dates, start_date, end_date } = this.form.controls;
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

  get useValidityDates(): boolean {
    return this.form.controls.use_validity_dates.value;
  }

  /** The Start Date is the earliest day the End Date picker allows. */
  get minEndDate(): string | null {
    return this.form.controls.start_date.value || null;
  }

  /** Why the chosen file cannot be used ('' when it is fine or nothing was tried yet). A new document needs a file. */
  get fileErrorMessage(): string {
    if (!this.fileTouched) {
      return '';
    }

    return getUploadFileError(this.selectedFile, DOCUMENT_RULES, this.isEditMode ? '' : VALIDATION_MESSAGES.required);
  }

  get hasActiveFilters(): boolean {
    return Object.values(this.columnFilters).some((value) => value);
  }

  get filteredDocuments(): DocumentRow[] {
    const filters = {
      id: this.columnFilters.id.trim().toLowerCase(),
      name: this.columnFilters.name.trim().toLowerCase(),
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
      if (filters.file_name && !item.file_name.toLowerCase().includes(filters.file_name)) {
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

      const leftValue = sortColumn === 'name' ? left.name : left.file_name;
      const rightValue = sortColumn === 'name' ? right.name : right.file_name;
      return (
        leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: 'base' }) * directionMultiplier
      );
    });
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

  showInvalid(controlName: 'name' | 'start_date' | 'end_date'): boolean {
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
    const name = value.name.trim();
    if (!name) {
      this.form.controls.name.setErrors({ required: true });
      this.form.controls.name.markAsTouched();
      return;
    }

    // multipart/form-data: the text fields and, when one was chosen, the file. Unused date fields are not sent.
    const body = new FormData();
    body.append('name', name);
    // Always sent: an empty text clears the description of a document being edited.
    body.append('description', value.description.trim());
    body.append('use_validity_dates', String(value.use_validity_dates));
    if (value.use_validity_dates) {
      body.append('start_date', value.start_date);
      body.append('end_date', value.end_date);
    }
    body.append('is_active', String(value.is_active));
    if (this.selectedFile) {
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
      name: '',
      description: '',
      use_validity_dates: false,
      start_date: '',
      end_date: '',
      is_active: true,
    });
    this.setValidityFieldsEnabled(false);
    this.form.markAsPristine();
    this.form.markAsUntouched();
  }

  private buildErrorMessage(error: HttpErrorResponse, fallback: string): string {
    return buildSubmitErrorMessage(error, { fallbackMessage: fallback });
  }
}
