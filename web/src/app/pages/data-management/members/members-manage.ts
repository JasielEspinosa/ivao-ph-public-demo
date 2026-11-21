import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AdminAuthService } from '../../../services/admin-auth.service';
import { PlaceholderBannerDataManagementComponent } from '../../../placeholders/banner/placeholder-banner-data-management';
import { VALIDATION_MESSAGES } from '../../../shared/validation-messages';
import { VALIDATION_PATTERNS } from '../../../shared/validation-patterns';
import { injectCurrentPage } from '../../../shared/page-titles';
import { DATA_MANAGE_MESSAGES } from '../../../shared/data-manage-messages';
import { TemplateImportExportService } from '../../../shared/template-import-export.service';
import { environment } from '../../../../environments/environment';
import { TablePagination, TablePaginationComponent } from '../../../shared/table-pagination/table-pagination';
import { getAuthErrorMessage, NETWORK_UNAVAILABLE_MESSAGE } from '../../../shared/submit-error-utils';

const MEMBERS_API = `${environment.apiUrl.replace(/\/$/, '')}/data-management/members`;
/** Columns of the import/export template, in order. `country` holds the country name. */
const TEMPLATE_HEADERS = [
  'id',
  'vid',
  'last_name',
  'first_name',
  'middle_name',
  'suffix',
  'country',
  'division',
  'is_pilot',
  'is_atc',
  'is_staff',
  'role_description',
  'is_active',
] as const;

interface MemberRow {
  id: number;
  vid: string;
  name: string;
  last_name: string;
  first_name: string;
  middle_name: string | null;
  suffix: string | null;
  country_id: number | null;
  country: string | null;
  division: string | null;
  is_pilot: boolean;
  is_atc: boolean;
  is_staff: boolean;
  role_description: string | null;
  is_active: boolean;
}

interface CountryOption {
  id: number;
  country_name: string;
}

type MemberColumnKey =
  | 'vid'
  | 'name'
  | 'last_name'
  | 'first_name'
  | 'middle_name'
  | 'suffix'
  | 'country'
  | 'division'
  | 'is_pilot'
  | 'is_atc'
  | 'is_staff'
  | 'role_description'
  | 'is_active';

interface MemberColumn {
  readonly key: MemberColumnKey;
  readonly label: string;
  readonly isBoolean: boolean;
}

type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-members-manage',
  standalone: true,
  imports: [TablePaginationComponent, CommonModule, ReactiveFormsModule, PlaceholderBannerDataManagementComponent],
  templateUrl: './members-manage.html',
  styleUrl: './members-manage.css',
})
export class MembersManageComponent implements OnInit {
  readonly pager = new TablePagination();
  readonly page = injectCurrentPage();

  private readonly http = inject(HttpClient);
  private readonly authService = inject(AdminAuthService);
  private readonly fb = inject(FormBuilder);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly templateService = inject(TemplateImportExportService);
  readonly VALIDATION_MESSAGES = VALIDATION_MESSAGES;
  readonly messages = DATA_MANAGE_MESSAGES;
  readonly vidMessage = 'Enter a valid VID (3 to 10 digits).';
  readonly suffixPattern = VALIDATION_PATTERNS.suffix;

  /** Table columns, in display order. */
  readonly columns: readonly MemberColumn[] = [
    { key: 'vid', label: 'VID', isBoolean: false },
    { key: 'name', label: 'Name', isBoolean: false },
    { key: 'last_name', label: 'Last Name', isBoolean: false },
    { key: 'first_name', label: 'First Name', isBoolean: false },
    { key: 'middle_name', label: 'Middle Name', isBoolean: false },
    { key: 'suffix', label: 'Suffix', isBoolean: false },
    { key: 'country', label: 'Country', isBoolean: false },
    { key: 'division', label: 'Division', isBoolean: false },
    { key: 'is_pilot', label: 'Is Pilot', isBoolean: true },
    { key: 'is_atc', label: 'Is ATC', isBoolean: true },
    { key: 'is_staff', label: 'Is Staff', isBoolean: true },
    { key: 'role_description', label: 'Role Description', isBoolean: false },
    { key: 'is_active', label: 'Active', isBoolean: true },
  ];

  readonly form = this.fb.nonNullable.group({
    vid: ['', [Validators.required, Validators.pattern(/^\d{3,10}$/)]],
    last_name: [
      '',
      [Validators.required, Validators.maxLength(255), Validators.pattern(VALIDATION_PATTERNS.personNameFull)],
    ],
    first_name: [
      '',
      [Validators.required, Validators.maxLength(255), Validators.pattern(VALIDATION_PATTERNS.personNameFull)],
    ],
    middle_name: ['', [Validators.maxLength(255), Validators.pattern(VALIDATION_PATTERNS.personNameFull)]],
    suffix: ['', [Validators.pattern(VALIDATION_PATTERNS.suffix)]],
    country_id: [null as number | null],
    division: ['', [Validators.maxLength(10)]],
    is_pilot: [false],
    is_atc: [false],
    is_staff: [false],
    role_description: ['', [Validators.maxLength(255)]],
    // "Enable this Member" is off by default when adding new data.
    is_active: [false],
  });

  members: MemberRow[] = [];
  countryOptions: CountryOption[] = [];
  editingId: number | null = null;
  isModalOpen = false;
  isLoading = false;
  isSaving = false;
  errorMessage = '';
  successMessage = '';
  isExportOptionsModalOpen = false;
  isTemplateUploading = false;
  isTemplateUpdatedModalOpen = false;
  pendingImportFile: File | null = null;
  columnFilters: Record<MemberColumnKey, string> = this.emptyFilters();

  sortColumn: MemberColumnKey | null = 'last_name';
  sortDirection: SortDirection = 'asc';

  ngOnInit(): void {
    this.loadMembers();
    this.loadCountryOptions();
  }

  get isEditMode(): boolean {
    return this.editingId !== null;
  }

  get hasActiveFilters(): boolean {
    return Object.values(this.columnFilters).some((value) => value.trim().length > 0);
  }

  /** The text a cell shows (booleans as Yes / No); also what the column filter matches. */
  cellText(row: MemberRow, key: MemberColumnKey): string {
    const value = row[key];
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }

    return String(value ?? '');
  }

  get filteredMembers(): MemberRow[] {
    const activeFilters = this.columns
      .map((column) => ({ key: column.key, needle: this.columnFilters[column.key].trim().toLowerCase() }))
      .filter((filter) => filter.needle.length > 0);

    const filtered = this.members.filter((row) =>
      activeFilters.every((filter) => this.cellText(row, filter.key).toLowerCase().includes(filter.needle)),
    );

    if (!this.sortColumn) {
      return filtered;
    }

    const sortKey = this.sortColumn;
    const directionMultiplier = this.sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((left, right) => {
      const leftValue = left[sortKey];
      const rightValue = right[sortKey];
      if (typeof leftValue === 'boolean' && typeof rightValue === 'boolean') {
        return (Number(leftValue) - Number(rightValue)) * directionMultiplier;
      }

      return (
        String(leftValue ?? '').localeCompare(String(rightValue ?? ''), undefined, {
          numeric: true,
          sensitivity: 'base',
        }) * directionMultiplier
      );
    });
  }

  loadMembers(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.http.get<MemberRow[]>(MEMBERS_API, { headers: this.authService.getAdminApiHeaders() }).subscribe({
      next: (rows) => {
        this.members = Array.isArray(rows) ? rows : [];
        this.isLoading = false;
        this.changeDetectorRef.detectChanges();
      },
      error: (error: HttpErrorResponse) => {
        this.isLoading = false;
        this.errorMessage = this.buildErrorMessage(error, DATA_MANAGE_MESSAGES.unableToLoad('members'));
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  private loadCountryOptions(): void {
    this.http
      .get<CountryOption[]>(`${MEMBERS_API}/country-options`, { headers: this.authService.getAdminApiHeaders() })
      .subscribe({
        next: (rows) => {
          this.countryOptions = Array.isArray(rows) ? rows : [];
          this.changeDetectorRef.detectChanges();
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage = this.buildErrorMessage(error, 'Unable to load the countries.');
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

  edit(item: MemberRow): void {
    this.editingId = item.id;
    this.errorMessage = '';
    this.successMessage = '';

    // A country that was switched off since is still offered, so saving does not silently clear it.
    if (item.country_id !== null && !this.countryOptions.some((option) => option.id === item.country_id)) {
      this.countryOptions = [...this.countryOptions, { id: item.country_id, country_name: item.country ?? '' }];
    }

    this.form.setValue({
      vid: item.vid,
      last_name: item.last_name,
      first_name: item.first_name,
      middle_name: item.middle_name ?? '',
      suffix: item.suffix ?? '',
      country_id: item.country_id,
      division: item.division ?? '',
      is_pilot: item.is_pilot,
      is_atc: item.is_atc,
      is_staff: item.is_staff,
      role_description: item.role_description ?? '',
      is_active: item.is_active,
    });

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

  save(): void {
    this.errorMessage = '';
    this.successMessage = '';
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const payload = {
      vid: value.vid.trim(),
      last_name: value.last_name.trim(),
      first_name: value.first_name.trim(),
      middle_name: value.middle_name.trim(),
      suffix: value.suffix.trim(),
      country_id: value.country_id === null || (value.country_id as unknown) === '' ? null : Number(value.country_id),
      division: value.division.trim(),
      is_pilot: value.is_pilot,
      is_atc: value.is_atc,
      is_staff: value.is_staff,
      // The role only applies to staff: a hidden role description is not saved.
      role_description: value.is_staff ? value.role_description.trim() : '',
      is_active: value.is_active,
    };

    this.isSaving = true;
    if (this.editingId !== null) {
      this.http
        .put(`${MEMBERS_API}/${this.editingId}`, payload, { headers: this.authService.getAdminApiHeaders() })
        .subscribe({
          next: () => {
            this.isSaving = false;
            this.successMessage = DATA_MANAGE_MESSAGES.updated('Member');
            this.isModalOpen = false;
            this.resetForm();
            this.loadMembers();
          },
          error: (error: HttpErrorResponse) => {
            this.isSaving = false;
            this.errorMessage = this.buildErrorMessage(error, 'Unable to update member.');
            this.changeDetectorRef.detectChanges();
          },
        });

      return;
    }

    this.http.post(MEMBERS_API, payload, { headers: this.authService.getAdminApiHeaders() }).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = DATA_MANAGE_MESSAGES.added('Member');
        this.isModalOpen = false;
        this.resetForm();
        this.loadMembers();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving = false;
        this.errorMessage = this.buildErrorMessage(error, 'Unable to add member.');
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  deleteMember(): void {
    if (this.editingId === null) {
      return;
    }

    const member = this.members.find((item) => item.id === this.editingId);
    const shouldDelete = window.confirm(
      DATA_MANAGE_MESSAGES.confirmDelete(member ? `${member.name} (${member.vid})` : ''),
    );
    if (!shouldDelete) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.isSaving = true;
    this.http.delete(`${MEMBERS_API}/${this.editingId}`, { headers: this.authService.getAdminApiHeaders() }).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = DATA_MANAGE_MESSAGES.deleted('Member');
        this.isModalOpen = false;
        this.resetForm();
        this.loadMembers();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving = false;
        this.errorMessage = this.buildErrorMessage(error, 'Unable to delete member.');
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  /* ---------- Export / import template ---------- */

  exportTemplate(): void {
    this.isExportOptionsModalOpen = true;
  }

  closeExportOptionsModal(): void {
    this.isExportOptionsModalOpen = false;
  }

  downloadTemplateFromServer(): void {
    this.isExportOptionsModalOpen = false;
    this.http
      .get(`${MEMBERS_API}/export-template`, {
        headers: this.authService.getAdminApiHeaders(),
        responseType: 'blob',
        observe: 'response',
      })
      .subscribe({
        next: (response) => {
          const name = this.templateService.getExportFilenameFromDisposition(
            response.headers.get('content-disposition'),
            'members-template.csv',
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
    this.templateService.downloadCsv(`members-template-${this.templateService.getCurrentDateStamp()}.csv`, [
      TEMPLATE_HEADERS,
      ...this.members.map((row) => [
        String(row.id),
        row.vid,
        row.last_name,
        row.first_name,
        row.middle_name ?? '',
        row.suffix ?? '',
        row.country ?? '',
        row.division ?? '',
        row.is_pilot ? 'true' : 'false',
        row.is_atc ? 'true' : 'false',
        row.is_staff ? 'true' : 'false',
        row.role_description ?? '',
        row.is_active ? 'true' : 'false',
      ]),
    ]);
  }

  openImportTemplatePicker(fileInput: HTMLInputElement): void {
    fileInput.value = '';
    fileInput.click();
  }

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
      // The server checks every value (VID, names, country name, yes/no flags) and reports the row of any mistake.
      const rows = values.map((cells) =>
        Object.fromEntries(TEMPLATE_HEADERS.map((header, index) => [header, cells[index] ?? ''])),
      );
      this.http
        .post(`${MEMBERS_API}/import-template`, { rows }, { headers: this.authService.getAdminApiHeaders() })
        .subscribe({
          next: () => {
            this.isTemplateUploading = false;
            this.isTemplateUpdatedModalOpen = true;
            this.loadMembers();
            this.changeDetectorRef.detectChanges();
          },
          error: (error: HttpErrorResponse) => {
            this.isTemplateUploading = false;
            this.errorMessage = this.buildErrorMessage(error, 'Unable to import template.');
            this.changeDetectorRef.detectChanges();
          },
        });
    } catch (error) {
      this.isTemplateUploading = false;
      this.errorMessage = error instanceof Error ? error.message : 'Unable to import template file.';
      this.changeDetectorRef.detectChanges();
    }
  }

  closeTemplateUpdatedModal(): void {
    this.isTemplateUpdatedModalOpen = false;
  }

  /* ---------- Filter / sort ---------- */

  setColumnFilter(column: MemberColumnKey, value: string): void {
    this.columnFilters[column] = value;
  }

  clearFilters(): void {
    this.columnFilters = this.emptyFilters();
  }

  toggleSort(column: MemberColumnKey): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      return;
    }

    this.sortColumn = column;
    this.sortDirection = 'asc';
  }

  getSortIndicator(column: MemberColumnKey): string {
    if (this.sortColumn !== column) {
      return '';
    }

    return this.sortDirection === 'asc' ? '↑' : '↓';
  }

  /* ---------- Form helpers ---------- */

  showInvalid(controlName: keyof MembersManageComponent['form']['controls']): boolean {
    const control = this.form.controls[controlName];
    return control.invalid && control.touched;
  }

  private emptyFilters(): Record<MemberColumnKey, string> {
    return {
      vid: '',
      name: '',
      last_name: '',
      first_name: '',
      middle_name: '',
      suffix: '',
      country: '',
      division: '',
      is_pilot: '',
      is_atc: '',
      is_staff: '',
      role_description: '',
      is_active: '',
    };
  }

  private resetForm(): void {
    this.editingId = null;
    this.form.reset({
      vid: '',
      last_name: '',
      first_name: '',
      middle_name: '',
      suffix: '',
      country_id: null,
      division: '',
      is_pilot: false,
      is_atc: false,
      is_staff: false,
      role_description: '',
      is_active: false,
    });

    this.form.markAsPristine();
    this.form.markAsUntouched();
  }

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
