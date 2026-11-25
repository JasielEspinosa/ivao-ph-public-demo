import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AdminAuthService } from '../../../services/admin-auth.service';
import { PlaceholderBannerDataManagementComponent } from '../../../placeholders/banner/placeholder-banner-data-management';
import { PopupMessageComponent } from '../../../shared/popup/popup-message';
import { PopupService } from '../../../shared/popup/popup.service';
import { eitherContactRequired } from '../../../shared/either-contact-required';
import { ApproverType, toApproverType } from '../../../shared/event-approver';
import { sanitizePhilippineContactNumber } from '../../../shared/philippine-contact-number';
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
  'nickname',
  'country',
  'division',
  'is_pilot',
  'is_atc',
  'is_staff',
  'is_real_world_pilot',
  'is_real_world_atc',
  'approver_type',
  'can_edit_on_approval',
  'show_in_contacts',
  'role_title',
  'role_description',
  'contact_email',
  'contact_number',
  'is_active',
] as const;

const APPROVER_LABELS: Record<ApproverType, string> = { NONE: '', REQUIRED: 'Required', OPTIONAL: 'Optional' };

interface MemberRow {
  id: number;
  vid: string;
  name: string;
  last_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  suffix: string | null;
  nickname: string | null;
  country_id: number | null;
  country: string | null;
  division: string | null;
  is_pilot: boolean;
  is_atc: boolean;
  is_staff: boolean;
  is_real_world_pilot: boolean;
  is_real_world_atc: boolean;
  approver_type: ApproverType;
  /** Approvers only: they may change an event's details while approving it. */
  can_edit_on_approval: boolean;
  /** Linked to an enabled user account: an approver without one cannot approve events. */
  has_active_user: boolean;
  show_in_contacts: boolean;
  role_title: string | null;
  role_description: string | null;
  contact_email: string | null;
  contact_number: string | null;
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
  | 'nickname'
  | 'country'
  | 'division'
  | 'is_pilot'
  | 'is_atc'
  | 'is_staff'
  | 'is_real_world_pilot'
  | 'is_real_world_atc'
  | 'approver_type'
  | 'show_in_contacts'
  | 'role_title'
  | 'role_description'
  | 'contact_email'
  | 'contact_number'
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
  imports: [
    PopupMessageComponent,
    TablePaginationComponent,
    CommonModule,
    ReactiveFormsModule,
    PlaceholderBannerDataManagementComponent,
  ],
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
  private readonly popups = inject(PopupService);
  private readonly templateService = inject(TemplateImportExportService);
  readonly VALIDATION_MESSAGES = VALIDATION_MESSAGES;
  readonly messages = DATA_MANAGE_MESSAGES;
  readonly suffixPattern = VALIDATION_PATTERNS.suffix;
  private readonly emailPattern = VALIDATION_PATTERNS.email;
  private readonly contactNumberPattern = VALIDATION_PATTERNS.contactNumber_ph;

  /** Table columns, in display order. */
  readonly columns: readonly MemberColumn[] = [
    { key: 'vid', label: 'VID', isBoolean: false },
    { key: 'name', label: 'Name', isBoolean: false },
    { key: 'nickname', label: 'Nickname', isBoolean: false },
    { key: 'country', label: 'Country', isBoolean: false },
    { key: 'division', label: 'Division', isBoolean: false },
    { key: 'is_pilot', label: 'Is Pilot', isBoolean: true },
    { key: 'is_atc', label: 'Is ATC', isBoolean: true },
    { key: 'is_staff', label: 'Is Staff', isBoolean: true },
    { key: 'is_real_world_pilot', label: 'Real-World Pilot', isBoolean: true },
    { key: 'is_real_world_atc', label: 'Real-World ATC', isBoolean: true },
    { key: 'approver_type', label: 'Event Approver', isBoolean: false },
    { key: 'role_title', label: 'Role Title', isBoolean: false },
    { key: 'is_active', label: 'Active', isBoolean: true },
  ];

  readonly form = this.fb.nonNullable.group({
    vid: ['', [Validators.required, Validators.pattern(/^\d{3,10}$/)]],
    last_name: ['', [Validators.maxLength(255), Validators.pattern(VALIDATION_PATTERNS.personNameFull)]],
    first_name: ['', [Validators.maxLength(255), Validators.pattern(VALIDATION_PATTERNS.personNameFull)]],
    middle_name: ['', [Validators.maxLength(255), Validators.pattern(VALIDATION_PATTERNS.personNameFull)]],
    suffix: ['', [Validators.pattern(VALIDATION_PATTERNS.suffix)]],
    nickname: ['', [Validators.maxLength(255)]],
    country_id: [null as number | null],
    division: ['', [Validators.maxLength(10)]],
    is_pilot: [false],
    is_atc: [false],
    is_staff: [false],
    // In real life, whatever the IVAO roles above are.
    is_real_world_pilot: [false],
    is_real_world_atc: [false],
    // Staff only: whether the member approves new events. At most one of the two is on.
    is_required_approver: [false],
    is_optional_approver: [false],
    // Approvers only: may change an event's details while approving it.
    can_edit_on_approval: [false],
    // Staff only: Role Title is required for staff. While "Show in Contacts List" is on, an email or a number is too.
    show_in_contacts: [false],
    role_title: ['', [Validators.maxLength(255)]],
    role_description: ['', [Validators.maxLength(255)]],
    contact_email: ['', [Validators.maxLength(255)]],
    contact_number: [''],
    // "Enable this Member" is on by default when adding new data.
    is_active: [true],
  });

  members: MemberRow[] = [];
  countryOptions: CountryOption[] = [];
  editingId: number | null = null;
  isModalOpen = false;
  isLoading = false;
  isSaving = false;
  errorMessage = '';
  successMessage = '';
  /** The list could not be loaded, so there is no table to show. */
  loadFailed = false;
  isExportOptionsModalOpen = false;
  isTemplateUploading = false;
  isTemplateUpdatedModalOpen = false;
  pendingImportFile: File | null = null;
  columnFilters: Record<MemberColumnKey, string> = this.emptyFilters();

  sortColumn: MemberColumnKey | null = 'last_name';
  sortDirection: SortDirection = 'asc';

  constructor() {
    // The role and real-world toggles only apply to an enabled member.
    this.syncRoleToggles(this.form.controls.is_active.value);
    this.form.controls.is_active.valueChanges.pipe(takeUntilDestroyed()).subscribe((isActive) => {
      this.syncRoleToggles(isActive);
    });

    // Required and Optional exclude each other: switching one on switches the other off.
    const { is_required_approver, is_optional_approver } = this.form.controls;
    for (const [toggle, other] of [
      [is_required_approver, is_optional_approver],
      [is_optional_approver, is_required_approver],
    ]) {
      toggle.valueChanges.pipe(takeUntilDestroyed()).subscribe((isOn) => {
        if (isOn) {
          other.setValue(false);
        }
      });
    }

    // The contact fields are validated only while they are shown.
    this.form.controls.is_staff.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.syncContactValidators());
    this.form.controls.show_in_contacts.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.syncContactValidators());

    // Email or Number: filling in one clears the "required" error of the other.
    const { contact_email, contact_number } = this.form.controls;
    contact_email.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => contact_number.updateValueAndValidity({ emitEvent: false }));
    contact_number.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => contact_email.updateValueAndValidity({ emitEvent: false }));
  }

  /** Staff who are shown in the Contacts list: the Email and Number fields show. */
  get showContactFields(): boolean {
    const value = this.form.getRawValue();
    return value.is_staff && value.show_in_contacts;
  }

  /** One of the two approver toggles is on: "Edit Events Before Approving" shows. */
  get isEventApproverChosen(): boolean {
    const value = this.form.getRawValue();
    return value.is_staff && (value.is_required_approver || value.is_optional_approver);
  }

  /** An approver who cannot sign in cannot approve: the form says so. */
  get showNoAccountNote(): boolean {
    return this.isEventApproverChosen && !this.members.find((item) => item.id === this.editingId)?.has_active_user;
  }

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
    if (key === 'approver_type') {
      return APPROVER_LABELS[row.approver_type] ?? '';
    }

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
    this.loadFailed = false;
    this.http.get<MemberRow[]>(MEMBERS_API, { headers: this.authService.getAdminApiHeaders() }).subscribe({
      next: (rows) => {
        this.members = Array.isArray(rows) ? rows : [];
        this.isLoading = false;
        this.changeDetectorRef.detectChanges();
      },
      error: (error: HttpErrorResponse) => {
        this.isLoading = false;
        this.loadFailed = true;
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
      last_name: item.last_name ?? '',
      first_name: item.first_name ?? '',
      middle_name: item.middle_name ?? '',
      suffix: item.suffix ?? '',
      nickname: item.nickname ?? '',
      country_id: item.country_id,
      division: item.division ?? '',
      is_pilot: item.is_pilot,
      is_atc: item.is_atc,
      is_staff: item.is_staff,
      is_real_world_pilot: item.is_real_world_pilot,
      is_real_world_atc: item.is_real_world_atc,
      is_required_approver: item.approver_type === 'REQUIRED',
      is_optional_approver: item.approver_type === 'OPTIONAL',
      can_edit_on_approval: item.can_edit_on_approval,
      show_in_contacts: item.show_in_contacts,
      role_title: item.role_title ?? '',
      role_description: item.role_description ?? '',
      contact_email: item.contact_email ?? '',
      contact_number: item.contact_number ?? '',
      is_active: item.is_active,
    });
    this.syncContactValidators();

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
    const showContact = value.is_staff && value.show_in_contacts;
    const approverType = toApproverType(value.is_staff, value.is_required_approver, value.is_optional_approver);
    const payload = {
      vid: value.vid.trim(),
      last_name: value.last_name.trim(),
      first_name: value.first_name.trim(),
      middle_name: value.middle_name.trim(),
      suffix: value.suffix.trim(),
      nickname: value.nickname.trim(),
      country_id: value.country_id === null || (value.country_id as unknown) === '' ? null : Number(value.country_id),
      division: value.division.trim(),
      is_pilot: value.is_pilot,
      is_atc: value.is_atc,
      is_staff: value.is_staff,
      is_real_world_pilot: value.is_real_world_pilot,
      is_real_world_atc: value.is_real_world_atc,
      approver_type: approverType,
      can_edit_on_approval: approverType !== 'NONE' && value.can_edit_on_approval,
      // The role only applies to staff, the email and number to staff shown in the Contacts list: hidden fields are
      // not saved.
      show_in_contacts: showContact,
      role_title: value.is_staff ? value.role_title.trim() : '',
      role_description: value.is_staff ? value.role_description.trim() : '',
      contact_email: showContact ? value.contact_email.trim() : '',
      contact_number: showContact ? value.contact_number.trim() : '',
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

  async deleteMember(): Promise<void> {
    if (this.editingId === null) {
      return;
    }

    const member = this.members.find((item) => item.id === this.editingId);
    const shouldDelete = await this.popups.ask({
      title: 'Delete Member',
      message: DATA_MANAGE_MESSAGES.confirmDelete(member ? `${member.name} (${member.vid})` : ''),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!shouldDelete) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.isSaving = true;
    this.changeDetectorRef.detectChanges();
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
          this.changeDetectorRef.detectChanges();
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
        row.last_name ?? '',
        row.first_name ?? '',
        row.middle_name ?? '',
        row.suffix ?? '',
        row.nickname ?? '',
        row.country ?? '',
        row.division ?? '',
        row.is_pilot ? 'true' : 'false',
        row.is_atc ? 'true' : 'false',
        row.is_staff ? 'true' : 'false',
        row.is_real_world_pilot ? 'true' : 'false',
        row.is_real_world_atc ? 'true' : 'false',
        row.approver_type,
        row.can_edit_on_approval ? 'true' : 'false',
        row.show_in_contacts ? 'true' : 'false',
        row.role_title ?? '',
        row.role_description ?? '',
        row.contact_email ?? '',
        row.contact_number ?? '',
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

  /** Asked for after both fields were visited (or on save), not while moving from Email to Number. */
  get showContactRequiredError(): boolean {
    const { contact_email, contact_number } = this.form.controls;
    return Boolean(contact_email.errors?.['contactRequired']) && contact_email.touched && contact_number.touched;
  }

  showContactPatternError(controlName: 'contact_email' | 'contact_number'): boolean {
    const control = this.form.controls[controlName];
    return Boolean(control.errors?.['pattern']) && control.touched;
  }

  /** Keeps the digits (and a leading "+") of the number only, as it is typed. */
  onContactNumberInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const sanitized = sanitizePhilippineContactNumber(input.value);
    if (sanitized !== input.value) {
      input.value = sanitized;
    }
    this.form.controls.contact_number.setValue(sanitized);
  }

  /**
   * Role Title is required for staff. While the email and number are shown, one of them is required and both are
   * checked.
   */
  private syncContactValidators(): void {
    const { role_title, role_description, contact_email, contact_number } = this.form.controls;
    const isShown = this.showContactFields;

    role_title.setValidators(
      this.form.controls.is_staff.value
        ? [Validators.required, Validators.maxLength(255)]
        : [Validators.maxLength(255)],
    );
    contact_email.setValidators(
      isShown
        ? [eitherContactRequired('contact_number'), Validators.maxLength(255), Validators.pattern(this.emailPattern)]
        : [Validators.maxLength(255)],
    );
    contact_number.setValidators(
      isShown ? [eitherContactRequired('contact_email'), Validators.pattern(this.contactNumberPattern)] : [],
    );

    for (const control of [role_title, role_description, contact_email, contact_number]) {
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  /** The role, real-world and approver toggles can be switched only while the member is enabled. */
  private syncRoleToggles(isActive: boolean): void {
    const controls = this.form.controls;
    const toggles = [
      controls.is_pilot,
      controls.is_atc,
      controls.is_staff,
      controls.is_real_world_pilot,
      controls.is_real_world_atc,
      controls.is_required_approver,
      controls.is_optional_approver,
      controls.can_edit_on_approval,
    ];
    for (const toggle of toggles) {
      if (isActive) {
        toggle.enable({ emitEvent: false });
      } else {
        toggle.disable({ emitEvent: false });
      }
    }
  }

  private emptyFilters(): Record<MemberColumnKey, string> {
    return {
      vid: '',
      name: '',
      last_name: '',
      first_name: '',
      middle_name: '',
      suffix: '',
      nickname: '',
      country: '',
      division: '',
      is_pilot: '',
      is_atc: '',
      is_staff: '',
      is_real_world_pilot: '',
      is_real_world_atc: '',
      approver_type: '',
      show_in_contacts: '',
      role_title: '',
      role_description: '',
      contact_email: '',
      contact_number: '',
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
      nickname: '',
      country_id: null,
      division: '',
      is_pilot: false,
      is_atc: false,
      is_staff: false,
      is_real_world_pilot: false,
      is_real_world_atc: false,
      is_required_approver: false,
      is_optional_approver: false,
      can_edit_on_approval: false,
      show_in_contacts: false,
      role_title: '',
      role_description: '',
      contact_email: '',
      contact_number: '',
      is_active: true,
    });
    this.syncContactValidators();

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
