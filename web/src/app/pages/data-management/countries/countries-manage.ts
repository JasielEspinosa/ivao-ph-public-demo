import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AdminAuthService } from '../../../services/admin-auth.service';
import { PlaceholderBannerDataManagementComponent } from '../../../placeholders/banner/placeholder-banner-data-management';
import { VALIDATION_MESSAGES } from '../../../shared/validation-messages';
import { injectCurrentPage } from '../../../shared/page-titles';
import { DATA_MANAGE_MESSAGES } from '../../../shared/data-manage-messages';
import { TemplateImportExportService } from '../../../shared/template-import-export.service';
import { environment } from '../../../../environments/environment';
import { TablePagination, TablePaginationComponent } from '../../../shared/table-pagination/table-pagination';
import { getAuthErrorMessage, NETWORK_UNAVAILABLE_MESSAGE } from '../../../shared/submit-error-utils';

const COUNTRIES_API = `${environment.apiUrl.replace(/\/$/, '')}/data-management/countries`;
const TEMPLATE_HEADERS = ['id', 'country_name', 'is_active'] as const;
interface CountryRow {
  id: number;
  country_name: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

type CountryColumnKey = 'id' | 'country_name' | 'is_active';
type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-countries-manage',
  standalone: true,
  imports: [TablePaginationComponent, CommonModule, ReactiveFormsModule, PlaceholderBannerDataManagementComponent],
  templateUrl: './countries-manage.html',
})
export class CountriesManageComponent implements OnInit {
  readonly pager = new TablePagination();
  readonly page = injectCurrentPage();

  private readonly http = inject(HttpClient);
  private readonly authService = inject(AdminAuthService);

  private readonly fb = inject(FormBuilder);

  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly templateService = inject(TemplateImportExportService);
  readonly VALIDATION_MESSAGES = VALIDATION_MESSAGES;
  readonly messages = DATA_MANAGE_MESSAGES;
  readonly form = this.fb.nonNullable.group({
    country_name: ['', [Validators.required, Validators.maxLength(255)]],
    is_active: [false],
  });

  countries: CountryRow[] = [];
  editingId: number | null = null;
  isModalOpen = false;
  isLoading = false;
  isSaving = false;
  errorMessage = '';
  successMessage = '';
  isExportOptionsModalOpen = false;
  isTemplateUploading = false;
  isTemplateUpdatedModalOpen = false;
  columnFilters: Record<CountryColumnKey, string> = {
    id: '',
    country_name: '',
    is_active: '',
  };

  sortColumn: CountryColumnKey | null = 'country_name';
  sortDirection: SortDirection = 'asc';

  ngOnInit(): void {
    this.loadCountries();
  }

  /* =========================================================
       EDIT MODE
       ========================================================= */
  get isEditMode(): boolean {
    return this.editingId !== null;
  }

  /* =========================================================
       FILTERED COUNTRIES
       ========================================================= */
  get filteredCountries(): CountryRow[] {
    const filtered = this.countries.filter((item) => {
      const idFilter = this.columnFilters.id.trim().toLowerCase();
      const nameFilter = this.columnFilters.country_name.trim().toLowerCase();
      const activeFilter = this.columnFilters.is_active.trim().toLowerCase();
      if (idFilter && !String(item.id).toLowerCase().includes(idFilter)) {
        return false;
      }

      if (
        nameFilter &&
        !String(item.country_name || '')
          .toLowerCase()
          .includes(nameFilter)
      ) {
        return false;
      }

      const activeText = item.is_active ? 'yes active true' : 'no inactive false';
      if (activeFilter && !activeText.includes(activeFilter)) {
        return false;
      }

      return true;
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

      const leftValue = left.country_name || '';
      const rightValue = right.country_name || '';
      return (
        leftValue.localeCompare(rightValue, undefined, {
          numeric: true,
          sensitivity: 'base',
        }) * directionMultiplier
      );
    });
  }

  /* =========================================================
       LOAD
       ========================================================= */
  loadCountries(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.http
      .get<CountryRow[]>(COUNTRIES_API, {
        headers: this.authService.getAdminApiHeaders(),
      })
      .subscribe({
        next: (rows) => {
          this.countries = Array.isArray(rows) ? rows : [];
          this.isLoading = false;
          this.changeDetectorRef.detectChanges();
        },

        error: (error: HttpErrorResponse) => {
          this.isLoading = false;
          this.errorMessage = this.buildErrorMessage(error, DATA_MANAGE_MESSAGES.unableToLoad('countries'));
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  /* =========================================================
       ADD MODAL
       ========================================================= */
  openAddModal(): void {
    this.resetForm();
    this.errorMessage = '';
    this.successMessage = '';
    this.isModalOpen = true;
  }

  /* =========================================================
       EDIT
       ========================================================= */
  edit(item: CountryRow): void {
    this.editingId = item.id;
    this.errorMessage = '';
    this.successMessage = '';
    this.form.setValue({
      country_name: item.country_name,
      is_active: item.is_active,
    });

    this.isModalOpen = true;
  }

  /* =========================================================
       CLOSE MODAL
       ========================================================= */
  closeModal(): void {
    if (this.isSaving) {
      return;
    }

    this.isModalOpen = false;
    this.resetForm();
    this.errorMessage = '';
  }

  cancelEdit(): void {
    this.closeModal();
  }

  /* =========================================================
       SAVE
       ========================================================= */
  save(): void {
    this.errorMessage = '';
    this.successMessage = '';
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const formValue = this.form.getRawValue();
    const payload = {
      countryName: formValue.country_name.trim(),
      isActive: formValue.is_active,
    };

    if (!payload.countryName) {
      this.form.controls.country_name.setErrors({
        required: true,
      });

      return;
    }

    this.isSaving = true;
    if (this.editingId !== null) {
      this.http
        .put(`${COUNTRIES_API}/${this.editingId}`, payload, {
          headers: this.authService.getAdminApiHeaders(),
        })
        .subscribe({
          next: () => {
            this.isSaving = false;
            this.successMessage = DATA_MANAGE_MESSAGES.updated('Country');
            this.isModalOpen = false;
            this.resetForm();
            this.loadCountries();
          },

          error: (error: HttpErrorResponse) => {
            this.isSaving = false;
            this.errorMessage = this.buildErrorMessage(error, 'Unable to update country.');
            this.changeDetectorRef.detectChanges();
          },
        });

      return;
    }

    this.http
      .post(COUNTRIES_API, payload, {
        headers: this.authService.getAdminApiHeaders(),
      })
      .subscribe({
        next: () => {
          this.isSaving = false;
          this.successMessage = DATA_MANAGE_MESSAGES.added('Country');
          this.isModalOpen = false;
          this.resetForm();
          this.loadCountries();
        },

        error: (error: HttpErrorResponse) => {
          this.isSaving = false;
          this.errorMessage = this.buildErrorMessage(error, 'Unable to add country.');
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  /* =========================================================
       DELETE
       ========================================================= */
  deleteCountry(): void {
    if (this.editingId === null) {
      return;
    }

    const shouldDelete = window.confirm(
      DATA_MANAGE_MESSAGES.confirmDelete(this.countries.find((item) => item.id === this.editingId)?.country_name ?? ''),
    );
    if (!shouldDelete) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.isSaving = true;
    this.http
      .delete(`${COUNTRIES_API}/${this.editingId}`, {
        headers: this.authService.getAdminApiHeaders(),
      })
      .subscribe({
        next: () => {
          this.isSaving = false;
          this.successMessage = DATA_MANAGE_MESSAGES.deleted('Country');
          this.isModalOpen = false;
          this.resetForm();
          this.loadCountries();
        },

        error: (error: HttpErrorResponse) => {
          this.isSaving = false;
          this.errorMessage = this.buildErrorMessage(error, 'Unable to delete country.');
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  exportTemplate(): void {
    this.isExportOptionsModalOpen = true;
  }
  closeExportOptionsModal(): void {
    this.isExportOptionsModalOpen = false;
  }
  downloadTemplateFromServer(): void {
    this.isExportOptionsModalOpen = false;
    this.http
      .get(`${COUNTRIES_API}/export-template`, {
        headers: this.authService.getAdminApiHeaders(),
        responseType: 'blob',
        observe: 'response',
      })
      .subscribe({
        next: (response) => {
          const name = this.templateService.getExportFilenameFromDisposition(
            response.headers.get('content-disposition'),
            'countries-template.csv',
          );
          const url = URL.createObjectURL(response.body || new Blob());
          const link = document.createElement('a');
          link.href = url;
          link.download = name;
          link.click();
          URL.revokeObjectURL(url);
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage = this.buildErrorMessage(error, 'Unable to export template from server.');
        },
      });
  }
  downloadTemplateFromPage(): void {
    this.isExportOptionsModalOpen = false;
    this.templateService.downloadCsv(`countries-template-${this.dateStamp()}.csv`, [
      TEMPLATE_HEADERS,
      ...this.countries.map((row) => [String(row.id), row.country_name || '', row.is_active ? 'true' : 'false']),
    ]);
  }
  openImportTemplatePicker(fileInput: HTMLInputElement): void {
    fileInput.value = '';
    fileInput.click();
  }
  pendingImportFile: File | null = null;
  onImportTemplateSelected(event: Event): void {
    this.pendingImportFile = (event.target as HTMLInputElement).files?.[0] ?? null;
  }
  cancelImportConfirm(): void {
    this.pendingImportFile = null;
  }
  async confirmImportTemplate(): Promise<void> {
    const file = this.pendingImportFile;
    this.pendingImportFile = null;
    if (!file) return;
    this.isTemplateUploading = true;
    try {
      const values = await this.templateService.parseTemplateFile(file, TEMPLATE_HEADERS);
      const rows = values.map(([id, name, active]) => ({
        id: Number(id),
        country_name: name,
        is_active: ['true', '1', 'yes', 'y'].includes(active.toLowerCase()),
      }));
      this.http
        .post(`${COUNTRIES_API}/import-template`, { rows }, { headers: this.authService.getAdminApiHeaders() })
        .subscribe({
          next: () => {
            this.isTemplateUploading = false;
            this.isTemplateUpdatedModalOpen = true;
            this.loadCountries();
          },
          error: (error: HttpErrorResponse) => {
            this.isTemplateUploading = false;
            this.errorMessage = this.buildErrorMessage(error, 'Unable to import template.');
          },
        });
    } catch (error) {
      this.isTemplateUploading = false;
      this.errorMessage = error instanceof Error ? error.message : 'Unable to import template file.';
    }
  }
  closeTemplateUpdatedModal(): void {
    this.isTemplateUpdatedModalOpen = false;
  }

  /* =========================================================
       COLUMN FILTER
       ========================================================= */
  setColumnFilter(column: CountryColumnKey, value: string): void {
    this.columnFilters[column] = value;
  }

  /* =========================================================
       SORT
       ========================================================= */
  toggleSort(column: CountryColumnKey): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      return;
    }

    this.sortColumn = column;
    this.sortDirection = 'asc';
  }

  getSortIndicator(column: CountryColumnKey): string {
    if (this.sortColumn !== column) {
      return '';
    }

    return this.sortDirection === 'asc' ? '↑' : '↓';
  }

  /* =========================================================
       CLEAR FILTERS
       ========================================================= */
  clearFilters(): void {
    this.columnFilters = {
      id: '',
      country_name: '',
      is_active: '',
    };
  }

  /* =========================================================
       RESET FORM
       ========================================================= */

  private resetForm(): void {
    this.editingId = null;
    this.form.reset({
      country_name: '',
      is_active: false,
    });

    this.form.markAsPristine();
    this.form.markAsUntouched();
  }

  private dateStamp(): string {
    const date = new Date();
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  }

  /* =========================================================
       ERROR
       ========================================================= */

  private buildErrorMessage(error: HttpErrorResponse, fallback: string): string {
    if (error.status === 0) {
      return NETWORK_UNAVAILABLE_MESSAGE;
    }

    if (error.status === 401 || error.status === 403) {
      return getAuthErrorMessage(error.status);
    }

    const responseMessage = error.error?.message;
    if (typeof responseMessage === 'string' && responseMessage.trim()) {
      return responseMessage;
    }

    if (Array.isArray(responseMessage) && responseMessage.length) {
      return responseMessage.join(' ');
    }

    return fallback;
  }
}
