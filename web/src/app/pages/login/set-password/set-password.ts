import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, NgZone, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, take } from 'rxjs';

import { PlaceholderBannerComponent } from '../../../placeholders/banner/placeholder-banner';
import { AdminAuthService } from '../../../services/admin-auth.service';
import { NETWORK_UNAVAILABLE_MESSAGE, getServerStatusMessage } from '../../../shared/submit-error-utils';
import { PopupMessageComponent } from '../../../shared/popup/popup-message';

@Component({
  selector: 'app-set-password',
  standalone: true,
  imports: [PopupMessageComponent, CommonModule, ReactiveFormsModule, PlaceholderBannerComponent],
  templateUrl: './set-password.html',
  styleUrl: './set-password.css',
})
export class SetPasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AdminAuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly ngZone = inject(NgZone);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  readonly form = this.fb.nonNullable.group(
    {
      new_password: ['', [Validators.required, Validators.minLength(8)]],
      confirm_password: ['', [Validators.required]],
    },
    { validators: [this.passwordsMatchValidator] },
  );

  setupToken = '';
  isLoading = false;
  isValidatingToken = true;
  isTokenInvalid = false;
  feedbackMessage = '';
  isSuccess = false;
  isConfirmPasswordPeekActive = false;

  constructor() {
    this.title.setTitle('IVAO Philippines - Set Password');
    this.route.fragment.pipe(take(1)).subscribe((fragment) => {
      const browserFragment = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.hash;
      const tokenFragment = fragment || browserFragment;
      this.setupToken = new URLSearchParams(tokenFragment).get('token')?.trim() || '';

      if (!this.setupToken) {
        this.router.navigate(['/login']);
        return;
      }

      this.validateSetupToken();
    });
  }

  backToLogin(): void {
    this.router.navigate(['/login']);
  }

  private validateSetupToken(): void {
    this.authService.validatePasswordSetupToken(this.setupToken).subscribe({
      next: () => {
        this.ngZone.run(() => {
          this.isValidatingToken = false;
          this.changeDetectorRef.markForCheck();
        });
      },
      error: (error: unknown) => {
        this.ngZone.run(() => {
          this.isValidatingToken = false;
          this.isTokenInvalid = true;
          this.changeDetectorRef.markForCheck();
        });
        this.setFeedbackMessage(this.buildErrorMessage(error), false);
      },
    });
  }

  submit(): void {
    if (this.isLoading) {
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.setLoading(true);
    this.setFeedbackMessage('', false);

    const payload = this.form.getRawValue();
    this.authService
      .setNewPassword(this.setupToken, payload.new_password, payload.confirm_password)
      .pipe(finalize(() => this.setLoading(false)))
      .subscribe({
        next: () => {
          this.ngZone.run(() => {
            this.router.navigate(['/login']);
          });
        },
        error: (error: unknown) => {
          this.setFeedbackMessage(this.buildErrorMessage(error), false);
        },
      });
  }

  activateConfirmPasswordPeek(event: PointerEvent): void {
    event.preventDefault();
    this.isConfirmPasswordPeekActive = true;

    const target = event.currentTarget as HTMLElement | null;
    if (target && typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        return;
      }
    }
  }

  deactivateConfirmPasswordPeek(): void {
    this.isConfirmPasswordPeekActive = false;
  }

  onConfirmPasswordPeekKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    this.isConfirmPasswordPeekActive = true;
  }

  onConfirmPasswordPeekKeyup(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    this.isConfirmPasswordPeekActive = false;
  }

  private passwordsMatchValidator(group: AbstractControl): ValidationErrors | null {
    const newPassword = group.get('new_password')?.value;
    const confirmPassword = group.get('confirm_password')?.value;

    if (!newPassword || !confirmPassword) {
      return null;
    }

    return newPassword === confirmPassword ? null : { passwordMismatch: true };
  }

  private buildErrorMessage(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) {
      return 'Unable to set password right now. Please try again.';
    }

    const serverStatusMessage = getServerStatusMessage(error.status);
    if (serverStatusMessage) {
      return serverStatusMessage;
    }

    const backendMessage = typeof error.error === 'string' ? error.error : String(error.error?.message || '').trim();
    if (backendMessage) {
      return backendMessage;
    }

    if (error.status === 0) {
      return NETWORK_UNAVAILABLE_MESSAGE;
    }

    return 'Unable to set password right now. Please try again.';
  }

  private setLoading(isLoading: boolean): void {
    this.ngZone.run(() => {
      this.isLoading = isLoading;
    });
  }

  private setFeedbackMessage(message: string, success: boolean): void {
    this.ngZone.run(() => {
      this.feedbackMessage = message;
      this.isSuccess = success;
      this.changeDetectorRef.markForCheck();
    });
  }
}
