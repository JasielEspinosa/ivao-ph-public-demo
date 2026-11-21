import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, NgZone, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { TimeoutError, finalize, timeout } from 'rxjs';

import { environment } from '../../../environments/environment';
import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import { AdminAuthService } from '../../services/admin-auth.service';
import {
  getServerStatusMessage,
  NETWORK_UNAVAILABLE_MESSAGE,
  NOT_FOUND_MESSAGE,
} from '../../shared/submit-error-utils';

const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_NOT_SET_CODE = 'PASSWORD_NOT_SET';
const PASSWORD_DECRYPTION_FAILED_CODE = 'PASSWORD_DECRYPTION_FAILED';
const PASSWORD_DECRYPTION_ERROR = 'unsupported state or unable to authenticate data';
/** The way out of an unverifiable password depends on whether email password reset is switched on. */
const PASSWORD_NOT_VERIFIED_MESSAGE = environment.forgotPasswordEnabled
  ? 'Your password could not be verified. Please use the "Forgot password?" link to set a new password, then try again.'
  : 'Your password could not be verified. Please ask an administrator to reset your password, then try again.';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, PlaceholderBannerComponent],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class LoginComponent {
  private static readonly LOGIN_REQUEST_TIMEOUT_MS = 10000;
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AdminAuthService);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly ngZone = inject(NgZone);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  readonly form = this.fb.nonNullable.group({
    login_email: ['', [Validators.required, this.loginEmailOrAdminValidator]],
    login_password: ['', [Validators.required]],
  });

  /** The "Forgot password?" link is hidden while email sending is off (see environment.forgotPasswordEnabled). */
  readonly forgotPasswordEnabled = environment.forgotPasswordEnabled;
  isLoading = false;
  isCheckingSession = true;
  feedbackMessage = '';
  isSuccess = false;
  isPasswordPeekActive = false;

  constructor() {
    this.title.setTitle('IVAO Philippines - Log In');

    this.authService.revalidateSession(true).subscribe((isValid) => {
      if (isValid) {
        // Defer past the initial navigation: this can emit while the login route is still activating,
        // where a router.navigate() may be dropped and leave the loading overlay stuck.
        setTimeout(() => {
          this.ngZone.run(() => {
            this.router.navigate(['/home'], { replaceUrl: true }).then((navigated) => {
              if (!navigated) {
                this.showLoginForm();
              }
            });
          });
        });
        return;
      }

      this.showLoginForm();
    });
  }

  private showLoginForm(): void {
    this.ngZone.run(() => {
      this.isCheckingSession = false;
      this.changeDetectorRef.markForCheck();
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
      .login(payload.login_email, payload.login_password)
      .pipe(
        timeout(LoginComponent.LOGIN_REQUEST_TIMEOUT_MS),
        finalize(() => {
          this.setLoading(false);
        }),
      )
      .subscribe({
        next: () => {
          this.ngZone.run(() => {
            this.router.navigate(['/home']);
          });
        },
        error: (error: unknown) => {
          if (error instanceof TimeoutError) {
            this.setFeedbackMessage('Login request timed out. Please check your connection and try again.', false);
            return;
          }

          if (!(error instanceof HttpErrorResponse)) {
            this.setFeedbackMessage('Unable to log in right now. Please try again.', false);
            return;
          }

          if (error.error?.code === PASSWORD_DECRYPTION_FAILED_CODE) {
            this.setFeedbackMessage(PASSWORD_NOT_VERIFIED_MESSAGE, false);
            return;
          }

          if (error.error?.code === PASSWORD_NOT_SET_CODE) {
            this.ngZone.run(() => {
              this.router.navigate(['/set-password'], {
                fragment: `token=${encodeURIComponent(error.error.setup_token)}`,
              });
            });
            return;
          }

          this.setFeedbackMessage(this.buildLoginErrorMessage(error), false);
        },
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

  private buildLoginErrorMessage(error: HttpErrorResponse): string {
    const serverStatusMessage = getServerStatusMessage(error.status);
    if (serverStatusMessage) {
      return serverStatusMessage;
    }

    const rawError = error.error;
    const backendMessage =
      typeof rawError === 'string' ? this.extractHtmlErrorMessage(rawError) : String(rawError?.message || '').trim();

    if (backendMessage) {
      const normalizedMessage = backendMessage.toLowerCase();

      if (normalizedMessage.includes(PASSWORD_DECRYPTION_ERROR)) {
        return PASSWORD_NOT_VERIFIED_MESSAGE;
      } else if (normalizedMessage.includes('must be an email')) {
        return 'Enter a valid email address.';
      } else if (normalizedMessage.includes('failed to fetch')) {
        return NETWORK_UNAVAILABLE_MESSAGE;
      } else if (normalizedMessage.includes('cannot post') && normalizedMessage.includes('/api/admin-auth/login')) {
        return 'Unable to authenticate. Please try again.';
      } else {
        return backendMessage;
      }
    } else if (error.status === 0) {
      return NETWORK_UNAVAILABLE_MESSAGE;
    } else if (error.status === 401 || error.status === 403) {
      return 'Invalid login credentials.';
    } else if (error.status === 404) {
      return NOT_FOUND_MESSAGE;
    } else {
      return 'Unable to log in right now. Please try again.';
    }
  }

  private extractHtmlErrorMessage(rawError: string): string {
    const trimmedError = rawError.trim();
    const preMatch = trimmedError.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i);

    if (!preMatch) {
      // Full HTML pages (e.g. nginx 502 Bad Gateway) are not user-friendly; fall back to status-based messages.
      return /^<(!doctype|html)\b/i.test(trimmedError) ? '' : trimmedError;
    }

    const template = document.createElement('template');
    template.innerHTML = preMatch[1];
    return (template.content.textContent || '').trim();
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
}
