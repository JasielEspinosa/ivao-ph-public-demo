import { CommonModule, DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import { PlaceholderBannerAdminComponent } from '../../../placeholders/banner/placeholder-banner-admin';
import { AdminAuthService } from '../../../services/admin-auth.service';
import { scrollToFirstValidationError } from '../../../shared/form-validation-scroll';
import { VALIDATION_MESSAGES } from '../../../shared/validation-messages';
import { VALIDATION_PATTERNS } from '../../../shared/validation-patterns';
import { environment } from '../../../../environments/environment';

interface DataManagementPageRecord {
  code: string;
  name: string;
}

interface AdminUserDetails {
  login_email: string;
  nickname: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  suffix: string | null;
  is_active: boolean;
  is_admin: boolean;
  manage_all_data: boolean;
  manage_data_codes: string[];
}

interface AdminUserSummary extends AdminUserDetails {
  login_name?: string | null;
}

const ADMIN_USERS_API = `${environment.apiUrl.replace(/\/$/, '')}/admin-users`;
const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REPLICATE_SEARCH_DEBOUNCE_MS = 300;
const REPLICATE_MAX_RESULTS = 10;

@Component({
  selector: 'app-manage-user',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, PlaceholderBannerAdminComponent],
  templateUrl: './manage_user.html',
  styleUrls: ['./manage_user.css', './manage_user-fields.css'],
})
export class ManageUserComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AdminAuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly document = inject(DOCUMENT);
  readonly requiredFieldMessage = VALIDATION_MESSAGES.required;
  readonly invalidSuffixMessage = VALIDATION_MESSAGES.invalidSuffixShort;
  readonly suffixPattern = new RegExp(VALIDATION_PATTERNS.suffix);

  readonly form = this.fb.nonNullable.group({
    login_email: ['', [Validators.required, this.loginEmailOrAdminValidator]],
    // Required when adding a user (email is off, so the administrator sets the password); edit mode drops it.
    login_password: ['', [Validators.required]],
    nickname: [''],
    first_name: [''],
    middle_name: [''],
    last_name: [''],
    suffix: ['', [Validators.pattern(this.suffixPattern)]],
    is_active: [false],
    is_admin: [false],
    manage_all_data: [false],
  });

  availableDataManagementPages: DataManagementPageRecord[] = [];
  selectedManageCodes = new Set<string>();
  isEditMode = false;
  // Stays true until the data management page list (and, in edit mode, the user) has loaded.
  isLoading = true;
  isSaving = false;
  submitAttempted = false;
  pageTitle = 'Add User';
  originalLoginEmail = '';
  feedbackMessage = '';
  isPasswordPeekActive = false;
  isResettingPassword = false;
  showPasswordResetNotice = false;
  // Admin editing their own record: the password stays locked until they confirm "Change Password".
  isViewOnly = false;
  isPasswordChangeGated = false;
  isPasswordChangeEnabled = false;
  isChangePasswordModalOpen = false;
  replicateSearchTerm = '';
  replicateFilteredUsers: AdminUserSummary[] = [];
  selectedReplicateUser: AdminUserSummary | null = null;
  showReplicateResults = false;
  replicateMessage = '';
  private replicateCandidates: AdminUserSummary[] = [];
  private replicateCandidatesLoaded = false;
  private readonly replicateSearchInput$ = new Subject<string>();

  @ViewChild('loginPasswordInput') private loginPasswordInput?: ElementRef<HTMLInputElement>;

  constructor() {
    this.title.setTitle('IVAO Philippines - Manage User');
    this.pageTitle = this.route.snapshot.paramMap.get('loginEmail') ? 'Edit User' : 'Add User';
  }

  ngOnInit(): void {
    this.form.controls.is_active.valueChanges.subscribe(() => {
      this.updateProtectedAdminCheckboxState();
    });

    this.form.controls.is_admin.valueChanges.subscribe(() => {
      this.updateProtectedAdminCheckboxState();
    });

    this.replicateSearchInput$
      .pipe(debounceTime(REPLICATE_SEARCH_DEBOUNCE_MS), distinctUntilChanged())
      .subscribe((term) => {
        this.applyReplicateFilter(term);
        this.changeDetectorRef.detectChanges();
      });

    // Load the data management pages the user can be given access to.
    this.http
      .get<DataManagementPageRecord[]>(`${ADMIN_USERS_API}/data-management-pages`, {
        headers: this.authService.getAdminApiHeaders(),
      })
      .subscribe({
        next: (pages) => {
          this.availableDataManagementPages = pages || [];
          this.resolveModeAndLoadUser();
          this.changeDetectorRef.detectChanges();
        },
        error: (error: HttpErrorResponse) => {
          this.isLoading = false;

          if (error?.status === 401) {
            this.authService.logout();
            this.changeDetectorRef.detectChanges();
            return;
          }

          this.feedbackMessage = 'Unable to load the data management pages.';
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  onManageCodeToggle(code: string, checked: boolean): void {
    this.toggleCode(this.selectedManageCodes, code, checked);
  }

  private toggleCode(codeSet: Set<string>, code: string, checked: boolean): void {
    if (checked) {
      codeSet.add(code);
      return;
    }

    codeSet.delete(code);
  }

  isAllManagePagesSelected(): boolean {
    if (!this.availableDataManagementPages.length) {
      return false;
    }

    return this.selectedManageCodes.size === this.availableDataManagementPages.length;
  }

  onSelectAllManagePages(checked: boolean): void {
    if (!checked) {
      this.selectedManageCodes.clear();
      return;
    }

    const codes = this.availableDataManagementPages.map((pageRecord) => pageRecord.code);
    this.selectedManageCodes.clear();
    codes.forEach((code) => this.selectedManageCodes.add(code));
  }

  onReplicateSearchInput(value: string): void {
    this.replicateSearchTerm = value;
    this.selectedReplicateUser = null;
    this.replicateMessage = '';

    if (!value.trim()) {
      this.replicateFilteredUsers = [];
      this.showReplicateResults = false;
      return;
    }

    const loginEmail = String(this.form.controls.login_email.value || '')
      .trim()
      .toLowerCase();
    if (value.trim().toLowerCase() === loginEmail) {
      this.replicateFilteredUsers = [];
      this.showReplicateResults = false;
      return;
    }

    this.showReplicateResults = true;
    this.loadReplicateCandidates();
    this.replicateSearchInput$.next(value);
  }

  onReplicateSearchFocus(): void {
    this.showReplicateResults = true;
    this.loadReplicateCandidates();
  }

  onReplicateSearchBlur(): void {
    // Delay so a result click is registered before the list is hidden.
    setTimeout(() => {
      this.showReplicateResults = false;
      this.changeDetectorRef.detectChanges();
    }, 150);
  }

  selectReplicateUser(candidate: AdminUserSummary): void {
    this.selectedReplicateUser = candidate;
    this.replicateSearchTerm = candidate.login_email;
    this.replicateFilteredUsers = [];
    this.showReplicateResults = false;
    this.replicateMessage = '';
  }

  buildReplicateUserName(candidate: AdminUserSummary): string {
    const parts = [candidate.first_name, candidate.middle_name, candidate.last_name, candidate.suffix];
    return parts
      .map((part) => (part || '').trim())
      .filter(Boolean)
      .join(' ');
  }

  replicateRole(): void {
    const source = this.selectedReplicateUser;
    if (!source) {
      return;
    }

    this.form.controls.manage_all_data.setValue(Boolean(source.manage_all_data));
    this.replaceCodes(this.selectedManageCodes, source.manage_data_codes);

    this.replicateMessage = `Role permissions replicated from ${source.login_email}.`;
  }

  private replaceCodes(codeSet: Set<string>, codes: string[] | null | undefined): void {
    codeSet.clear();
    (codes || []).forEach((code) => codeSet.add(code));
  }

  private loadReplicateCandidates(): void {
    if (this.replicateCandidatesLoaded) {
      return;
    }

    this.replicateCandidatesLoaded = true;
    this.http
      .get<AdminUserSummary[]>(ADMIN_USERS_API, {
        headers: this.authService.getAdminApiHeaders(),
      })
      .subscribe({
        next: (users) => {
          this.replicateCandidates = users || [];
          this.applyReplicateFilter(this.replicateSearchTerm);
          this.changeDetectorRef.detectChanges();
        },
        error: (error: HttpErrorResponse) => {
          this.replicateCandidatesLoaded = false;

          if (error.status === 401) {
            this.authService.logout();
            this.changeDetectorRef.detectChanges();
            return;
          }

          this.replicateMessage = 'Unable to load users to replicate.';
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  private applyReplicateFilter(term: string): void {
    const needle = (term || '').trim().toLowerCase();

    if (!needle) {
      this.replicateFilteredUsers = [];
      return;
    }

    const currentEmail = this.originalLoginEmail.toLowerCase();

    this.replicateFilteredUsers = this.replicateCandidates
      .filter((candidate) => candidate.login_email.toLowerCase() !== currentEmail)
      .filter((candidate) => {
        const haystack = [candidate.login_email, candidate.nickname, this.buildReplicateUserName(candidate)]
          .map((part) => (part || '').toLowerCase())
          .join(' ');

        return haystack.includes(needle);
      })
      .slice(0, REPLICATE_MAX_RESULTS);
  }

  cancel(): void {
    this.router.navigate(['/admin/manage_users']);
  }

  save(): void {
    if (this.isViewOnly) {
      return;
    }

    this.submitAttempted = true;
    this.feedbackMessage = '';

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      scrollToFirstValidationError(this.document, { formSelector: 'form.manage-user-form' });
      return;
    }

    const payload = {
      ...this.form.getRawValue(),
      manage_data_codes: Array.from(this.selectedManageCodes),
    };

    this.isSaving = true;

    if (!this.isEditMode) {
      this.http
        .post(ADMIN_USERS_API, payload, {
          headers: this.authService.getAdminApiHeaders(),
        })
        .subscribe({
          next: () => {
            this.isSaving = false;
            this.router.navigate(['/admin/manage_users']);
          },
          error: (error: HttpErrorResponse) => {
            this.isSaving = false;
            this.feedbackMessage = this.buildSaveErrorMessage(error);
            this.changeDetectorRef.detectChanges();
          },
        });
      return;
    }

    this.http
      .put(`${ADMIN_USERS_API}/${encodeURIComponent(this.originalLoginEmail)}`, payload, {
        headers: this.authService.getAdminApiHeaders(),
      })
      .subscribe({
        next: () => {
          this.authService.updateCurrentUserProfile(this.originalLoginEmail, payload);
          this.isSaving = false;
          this.router.navigate(['/admin/manage_users']);
        },
        error: (error: HttpErrorResponse) => {
          this.isSaving = false;
          this.feedbackMessage = this.buildSaveErrorMessage(error);
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  deleteUser(): void {
    if (!this.isEditMode) {
      return;
    }

    const shouldDelete = window.confirm('Delete this user?');
    if (!shouldDelete) {
      return;
    }

    this.isSaving = true;
    this.http
      .delete(`${ADMIN_USERS_API}/${encodeURIComponent(this.originalLoginEmail)}`, {
        headers: this.authService.getAdminApiHeaders(),
      })
      .subscribe({
        next: () => {
          this.isSaving = false;
          this.router.navigate(['/admin/manage_users']);
        },
        error: (error: HttpErrorResponse) => {
          this.isSaving = false;
          this.feedbackMessage = this.buildSaveErrorMessage(error);
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  canShowDeleteButton(): boolean {
    return this.isEditMode && !this.isProtectedAdminEditRecord() && !this.isViewOnly;
  }

  resetPassword(): void {
    if (!this.isEditMode || this.isResettingPassword) {
      return;
    }

    const shouldReset = window.confirm(
      "Clear this user's password? They will be required to set a new password on their next login.",
    );
    if (!shouldReset) {
      return;
    }

    this.isResettingPassword = true;
    this.showPasswordResetNotice = false;
    this.feedbackMessage = '';

    this.http
      .post(
        `${ADMIN_USERS_API}/${encodeURIComponent(this.originalLoginEmail)}/reset-password`,
        {},
        {
          headers: this.authService.getAdminApiHeaders(),
        },
      )
      .subscribe({
        next: () => {
          this.isResettingPassword = false;
          this.form.controls.login_password.setValue('');
          this.triggerPasswordResetNotice();
          this.changeDetectorRef.detectChanges();
        },
        error: (error: HttpErrorResponse) => {
          this.isResettingPassword = false;

          if (error.status === 401) {
            this.authService.logout();
            this.changeDetectorRef.detectChanges();
            return;
          }

          this.feedbackMessage = 'Unable to reset password.';
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  openChangePasswordModal(): void {
    this.isChangePasswordModalOpen = true;
  }

  closeChangePasswordModal(): void {
    this.isChangePasswordModalOpen = false;
  }

  confirmChangePassword(): void {
    this.isChangePasswordModalOpen = false;
    this.isPasswordChangeEnabled = true;
    this.form.controls.login_password.enable({ emitEvent: false });
    this.changeDetectorRef.detectChanges();
    this.loginPasswordInput?.nativeElement.focus();
  }

  cancelPasswordChange(): void {
    this.isPasswordChangeEnabled = false;
    this.isPasswordPeekActive = false;
    this.form.controls.login_password.setValue('');
    this.form.controls.login_password.disable({ emitEvent: false });
  }

  private triggerPasswordResetNotice(): void {
    this.showPasswordResetNotice = false;
    this.changeDetectorRef.detectChanges();

    setTimeout(() => {
      this.showPasswordResetNotice = true;
      this.changeDetectorRef.detectChanges();
    });
  }

  activatePasswordPeek(event: PointerEvent): void {
    event.preventDefault();
    this.isPasswordPeekActive = true;

    const target = event.currentTarget as HTMLElement | null;
    if (target && typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // Ignore capture failures on unsupported browsers/devices.
      }
    }
  }

  deactivatePasswordPeek(): void {
    this.isPasswordPeekActive = false;
  }

  onPasswordPeekKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    this.isPasswordPeekActive = true;
  }

  onPasswordPeekKeyup(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    this.isPasswordPeekActive = false;
  }

  isManageCodeChecked(code: string): boolean {
    return this.selectedManageCodes.has(code);
  }

  showLoginEmailFieldError(): boolean {
    const control = this.form.controls.login_email;
    return control.invalid && (control.touched || this.submitAttempted);
  }

  showLoginEmailRequiredError(): boolean {
    const control = this.form.controls.login_email;
    return Boolean(control.errors?.['required']) && (control.touched || this.submitAttempted);
  }

  showLoginEmailInvalidError(): boolean {
    const control = this.form.controls.login_email;
    return (
      Boolean(control.errors?.['email']) &&
      !Boolean(control.errors?.['required']) &&
      (control.touched || this.submitAttempted)
    );
  }

  showSuffixInvalidError(): boolean {
    const control = this.form.controls.suffix;
    return Boolean(control.errors?.['pattern']) && (control.touched || this.submitAttempted);
  }

  private loginEmailOrAdminValidator(control: AbstractControl): ValidationErrors | null {
    const value = String(control.value || '').trim();

    if (!value) {
      return null;
    }

    if (value.toLowerCase() === 'admin') {
      return null;
    }

    return BASIC_EMAIL_PATTERN.test(value) ? null : { email: true };
  }

  showLoginPasswordRequiredError(): boolean {
    if (this.isEditMode) {
      return false;
    }

    const control = this.form.controls.login_password;
    return Boolean(control.errors?.['required']) && (control.touched || this.submitAttempted);
  }

  private resolveModeAndLoadUser(): void {
    const encodedLoginEmail = this.route.snapshot.paramMap.get('loginEmail');
    if (!encodedLoginEmail) {
      this.isEditMode = false;
      this.pageTitle = 'Add User';
      this.title.setTitle('IVAO Philippines - Add User');
      this.form.controls.login_email.enable({ emitEvent: false });
      this.updateProtectedAdminCheckboxState();
      this.isLoading = false;
      return;
    }

    this.isEditMode = true;
    this.pageTitle = 'Edit User';
    this.title.setTitle('IVAO Philippines - Edit User');
    this.form.controls.login_password.clearValidators();
    this.form.controls.login_password.updateValueAndValidity({ emitEvent: false });

    const loginEmail = decodeURIComponent(encodedLoginEmail);
    this.originalLoginEmail = loginEmail;

    this.isLoading = true;
    this.http
      .get<AdminUserDetails>(`${ADMIN_USERS_API}/${encodeURIComponent(loginEmail)}`, {
        headers: this.authService.getAdminApiHeaders(),
      })
      .subscribe({
        next: (user) => {
          this.form.patchValue({
            login_email: user.login_email,
            login_password: '',
            nickname: user.nickname || '',
            first_name: user.first_name || '',
            middle_name: user.middle_name || '',
            last_name: user.last_name || '',
            suffix: user.suffix || '',
            is_active: Boolean(user.is_active),
            is_admin: user.is_admin,
            manage_all_data: user.manage_all_data,
          });

          this.updateLoginEmailEditableState(user.login_email);
          this.updateProtectedAdminCheckboxState();
          this.updatePasswordChangeGate();

          this.selectedManageCodes = new Set((user.manage_data_codes || []).map((code) => String(code).toUpperCase()));
          this.isLoading = false;
          this.changeDetectorRef.detectChanges();
        },
        error: (error: HttpErrorResponse) => {
          this.isLoading = false;

          if (error.status === 401) {
            this.authService.logout();
            this.changeDetectorRef.detectChanges();
            return;
          }

          this.feedbackMessage = 'Unable to load user details.';
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  private updateLoginEmailEditableState(loginEmail: string): void {
    const control = this.form.controls.login_email;
    const isAdminLogin =
      String(loginEmail || '')
        .trim()
        .toLowerCase() === 'admin';

    if (this.isEditMode && isAdminLogin) {
      control.disable({ emitEvent: false });
      return;
    }

    control.enable({ emitEvent: false });
  }

  // The Administrator ("admin") editing its own record gets the gated Change Password flow; any other admin user
  // opening the Administrator record gets a view-only page (all inputs disabled, no Save).
  // Call after the other enable/disable helpers, since this disables the whole form in view-only mode.
  private updatePasswordChangeGate(): void {
    const currentLogin = String(this.authService.getCurrentUser()?.login_email || '')
      .trim()
      .toLowerCase();
    const isAdminRecord = this.isProtectedAdminEditRecord();

    this.isViewOnly = isAdminRecord && currentLogin !== 'admin';
    this.isPasswordChangeGated = isAdminRecord && currentLogin === 'admin';
    this.isPasswordChangeEnabled = false;

    if (this.isViewOnly) {
      this.pageTitle = 'View User';
      this.title.setTitle('IVAO Philippines - View User');
      this.form.disable({ emitEvent: false });
    } else if (this.isPasswordChangeGated) {
      this.form.controls.login_password.disable({ emitEvent: false });
    }
  }

  private updateProtectedAdminCheckboxState(): void {
    const shouldLockEnabledCheckbox = this.isProtectedAdminEditRecord() && Boolean(this.form.controls.is_active.value);
    const shouldLockAdminCheckbox = this.isProtectedAdminEditRecord() && Boolean(this.form.controls.is_admin.value);

    if (shouldLockEnabledCheckbox) {
      this.form.controls.is_active.disable({ emitEvent: false });
    } else {
      this.form.controls.is_active.enable({ emitEvent: false });
    }

    if (shouldLockAdminCheckbox) {
      this.form.controls.is_admin.disable({ emitEvent: false });
    } else {
      this.form.controls.is_admin.enable({ emitEvent: false });
    }
  }

  private isProtectedAdminEditRecord(): boolean {
    return this.isEditMode && this.originalLoginEmail.trim().toLowerCase() === 'admin';
  }

  private buildSaveErrorMessage(error: HttpErrorResponse): string {
    if (error.status === 401) {
      this.authService.logout();
      return 'Session timed out. Please log in again.';
    }

    const errorMessage = String(error.error?.message || '').trim();
    if (error.status === 409 && errorMessage) {
      return errorMessage;
    }

    if (errorMessage) {
      return errorMessage;
    }

    return 'Unable to save user details.';
  }
}
