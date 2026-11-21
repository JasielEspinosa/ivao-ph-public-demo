import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { finalize } from 'rxjs';

import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import {
  AdminAuthService,
  AdminSessionUser,
  OwnProfilePayload,
  ThemePreference,
} from '../../services/admin-auth.service';
import { ThemeService } from '../../services/theme.service';
import { NETWORK_UNAVAILABLE_MESSAGE } from '../../shared/submit-error-utils';
import { VALIDATION_MESSAGES } from '../../shared/validation-messages';
import { VALIDATION_PATTERNS } from '../../shared/validation-patterns';

type PasswordField = 'current_password' | 'new_password' | 'confirm_password';

const MIN_PASSWORD_LENGTH = 8;

/** Password fields are optional as a group: once any one is filled, all three are required and must be consistent. */
function passwordChangeValidator(group: AbstractControl): ValidationErrors | null {
  const current = String(group.get('current_password')?.value || '');
  const next = String(group.get('new_password')?.value || '');
  const confirm = String(group.get('confirm_password')?.value || '');

  if (!current && !next && !confirm) {
    return null;
  }

  const errors: ValidationErrors = {};
  if (!current) {
    errors['currentRequired'] = true;
  }
  if (!next) {
    errors['newRequired'] = true;
  } else if (next.length < MIN_PASSWORD_LENGTH) {
    errors['newTooShort'] = true;
  }
  if (!confirm) {
    errors['confirmRequired'] = true;
  } else if (next && confirm !== next) {
    errors['mismatch'] = true;
  }

  return Object.keys(errors).length ? errors : null;
}

@Component({
  selector: 'app-profile-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, PlaceholderBannerComponent],
  templateUrl: './profile-settings.html',
  styleUrl: './profile-settings.css',
})
export class ProfileSettingsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AdminAuthService);
  private readonly title = inject(Title);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly themeService = inject(ThemeService);

  readonly themeOptions: { value: ThemePreference; label: string; description: string }[] = [
    { value: 'light', label: 'Light', description: 'Bright and clean' },
    { value: 'dark', label: 'Dark', description: 'Easy on the eyes' },
    { value: 'system', label: 'System', description: 'Match this device' },
  ];
  isThemeSaving = false;
  themeError = '';

  readonly requiredFieldMessage = VALIDATION_MESSAGES.required;
  readonly invalidSuffixMessage = VALIDATION_MESSAGES.invalidSuffixShort;
  readonly suffixPattern = new RegExp(VALIDATION_PATTERNS.suffix);
  readonly minPasswordLength = MIN_PASSWORD_LENGTH;

  readonly form = this.fb.nonNullable.group(
    {
      nickname: [''],
      first_name: [''],
      middle_name: [''],
      last_name: [''],
      suffix: ['', [Validators.pattern(this.suffixPattern)]],
      current_password: [''],
      new_password: [''],
      confirm_password: [''],
    },
    { validators: [passwordChangeValidator] },
  );

  isEditing = false;
  isSaving = false;
  isChangePasswordModalOpen = false;
  submitAttempted = false;
  successMessage = '';
  errorMessage = '';
  readonly visiblePasswords: Record<PasswordField, boolean> = {
    current_password: false,
    new_password: false,
    confirm_password: false,
  };

  constructor() {
    this.title.setTitle('IVAO Philippines - Profile Settings');
    this.resetFormFromSession();
  }

  get user(): AdminSessionUser | null {
    return this.authService.getCurrentUser();
  }

  get loginEmail(): string {
    return this.user?.login_email || '';
  }

  get roleLabel(): string {
    return this.user?.is_admin ? 'Administrator' : 'User';
  }

  /** Full name as saved (first, middle initial, last, suffix); falls back to the nickname, then the login email. */
  get fullName(): string {
    const user = this.user;
    if (!user) {
      return '';
    }

    const middleInitial = String(user.middle_name || '')
      .trim()
      .charAt(0)
      .toUpperCase();
    const name = [user.first_name, middleInitial ? `${middleInitial}.` : '', user.last_name]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(' ');
    const suffix = String(user.suffix || '').trim();

    if (!name) {
      return String(user.nickname || '').trim() || this.loginEmail;
    }

    return suffix ? `${name}, ${suffix}` : name;
  }

  get initials(): string {
    const user = this.user;
    const first = String(user?.first_name || '').trim();
    const last = String(user?.last_name || '').trim();
    const source =
      first && last ? `${first.charAt(0)}${last.charAt(0)}` : first || last || user?.nickname || this.loginEmail;

    return String(source).trim().slice(0, 2).toUpperCase() || '?';
  }

  get themePreference(): ThemePreference {
    return this.themeService.getPreference();
  }

  /** Applies the theme right away and saves it to the account; works outside the Modify/edit mode. */
  selectTheme(preference: ThemePreference): void {
    if (this.isThemeSaving || preference === this.themePreference) {
      return;
    }

    this.themeError = '';
    this.isThemeSaving = true;
    this.themeService
      .setPreference(preference)
      .pipe(
        finalize(() => {
          this.isThemeSaving = false;
          this.changeDetectorRef.detectChanges();
        }),
      )
      .subscribe({
        error: (error: unknown) => {
          this.themeError = this.buildErrorMessage(error);
        },
      });
  }

  startEditing(): void {
    this.successMessage = '';
    this.errorMessage = '';
    this.submitAttempted = false;
    this.resetFormFromSession();
    this.form.enable();
    this.isEditing = true;
  }

  cancelEditing(): void {
    if (this.isSaving) {
      return;
    }

    this.errorMessage = '';
    this.resetFormFromSession();
  }

  save(): void {
    if (!this.isEditing || this.isSaving) {
      return;
    }

    this.submitAttempted = true;
    this.errorMessage = '';

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    // The built-in Administrator must confirm before its own password is changed.
    if (this.isAdministratorAccount && this.isChangingPassword) {
      this.isChangePasswordModalOpen = true;
      return;
    }

    this.submitProfile();
  }

  closeChangePasswordModal(): void {
    this.isChangePasswordModalOpen = false;
  }

  confirmChangePassword(): void {
    this.isChangePasswordModalOpen = false;
    this.submitProfile();
  }

  private get isAdministratorAccount(): boolean {
    return this.loginEmail.trim().toLowerCase() === 'admin';
  }

  private get isChangingPassword(): boolean {
    const values = this.form.getRawValue();
    return Boolean(values.current_password || values.new_password || values.confirm_password);
  }

  private submitProfile(): void {
    if (!this.isEditing || this.isSaving) {
      return;
    }

    const values = this.form.getRawValue();
    const payload: OwnProfilePayload = {
      nickname: values.nickname.trim(),
      first_name: values.first_name.trim(),
      middle_name: values.middle_name.trim(),
      last_name: values.last_name.trim(),
      suffix: values.suffix.trim(),
    };

    // Only send password fields when the user is changing the password; blank keeps the current one.
    const isChangingPassword = this.isChangingPassword;
    if (isChangingPassword) {
      payload.current_password = values.current_password;
      payload.new_password = values.new_password;
      payload.confirm_password = values.confirm_password;
    }

    this.isSaving = true;
    this.authService
      .updateOwnProfile(payload)
      .pipe(
        finalize(() => {
          this.isSaving = false;
          // The app runs without zone.js, so the response must refresh the view itself.
          this.changeDetectorRef.detectChanges();
        }),
      )
      .subscribe({
        next: () => {
          this.successMessage = isChangingPassword
            ? 'Your profile and password were updated.'
            : 'Your profile was updated.';
          this.resetFormFromSession();
        },
        error: (error: unknown) => {
          this.errorMessage = this.buildErrorMessage(error);
        },
      });
  }

  togglePasswordVisibility(field: PasswordField): void {
    this.visiblePasswords[field] = !this.visiblePasswords[field];
  }

  showSuffixError(): boolean {
    const control = this.form.controls.suffix;
    return control.hasError('pattern') && (control.touched || this.submitAttempted);
  }

  showPasswordError(error: string, field: PasswordField): boolean {
    const control = this.form.controls[field];
    return this.form.hasError(error) && (control.touched || this.submitAttempted);
  }

  /** Back to the read-only view with the saved values; also clears any typed password. */
  private resetFormFromSession(): void {
    const user = this.user;

    this.form.reset({
      nickname: user?.nickname || '',
      first_name: user?.first_name || '',
      middle_name: user?.middle_name || '',
      last_name: user?.last_name || '',
      suffix: user?.suffix || '',
      current_password: '',
      new_password: '',
      confirm_password: '',
    });
    this.form.disable();
    this.isEditing = false;
    this.submitAttempted = false;
    this.visiblePasswords.current_password = false;
    this.visiblePasswords.new_password = false;
    this.visiblePasswords.confirm_password = false;
  }

  private buildErrorMessage(error: unknown): string {
    const fallback = 'Unable to save your profile right now. Please try again.';
    if (!(error instanceof HttpErrorResponse)) {
      return fallback;
    }

    if (error.status === 0) {
      return NETWORK_UNAVAILABLE_MESSAGE;
    }

    if (error.status === 401) {
      this.authService.logout();
      return fallback;
    }

    const message = error.error?.message;
    const backendMessage = Array.isArray(message) ? message.join(' ') : String(message || '').trim();

    return backendMessage || fallback;
  }
}
