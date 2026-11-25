import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, NgZone, OnDestroy, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, finalize, interval, take } from 'rxjs';

import { PlaceholderBannerComponent } from '../../../placeholders/banner/placeholder-banner';
import { AdminAuthService } from '../../../services/admin-auth.service';
import { NETWORK_UNAVAILABLE_MESSAGE, getServerStatusMessage } from '../../../shared/submit-error-utils';
import { PopupMessageComponent } from '../../../shared/popup/popup-message';
import { PopupTone } from '../../../shared/popup/popup.service';

const CANCELLED_MESSAGE = 'Request cancelled.';
const SEND_DELAY_SECONDS = 3;
const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [PopupMessageComponent, CommonModule, ReactiveFormsModule, PlaceholderBannerComponent],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.css',
})
export class ForgotPasswordComponent implements OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AdminAuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly ngZone = inject(NgZone);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  readonly form = this.fb.nonNullable.group({
    login_email: ['', [Validators.required, this.loginEmailValidator]],
  });

  isLoading = false;
  feedbackMessage = '';
  isSuccess = false;
  countdown = 0;

  private countdownSub?: Subscription;
  private requestSub?: Subscription;

  constructor() {
    this.title.setTitle('IVAO Philippines - Forgot Password');

    const email = this.route.snapshot.queryParamMap.get('email');
    if (email) {
      this.form.controls.login_email.setValue(email);
    }
  }

  get isBusy(): boolean {
    return this.isLoading || this.countdown > 0;
  }

  submit(): void {
    if (this.isBusy) {
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.setFeedbackMessage('', false);
    this.startCountdown();
  }

  cancel(): void {
    this.countdownSub?.unsubscribe();
    this.requestSub?.unsubscribe();
    this.countdown = 0;
    this.setLoading(false);
    this.setFeedbackMessage(CANCELLED_MESSAGE, false);
  }

  ngOnDestroy(): void {
    this.countdownSub?.unsubscribe();
    this.requestSub?.unsubscribe();
  }

  /** What the popup of the message looks like: cancelling is not an error. */
  get feedbackTone(): PopupTone {
    if (this.isSuccess) {
      return 'success';
    }
    return this.feedbackMessage === CANCELLED_MESSAGE ? 'info' : 'error';
  }

  private startCountdown(): void {
    this.countdown = SEND_DELAY_SECONDS;
    this.countdownSub = interval(1000)
      .pipe(take(SEND_DELAY_SECONDS))
      .subscribe({
        next: (tick) => {
          this.countdown = SEND_DELAY_SECONDS - tick - 1;
          this.changeDetectorRef.markForCheck();
        },
        complete: () => this.sendRequest(),
      });
  }

  private sendRequest(): void {
    this.setLoading(true);

    const payload = this.form.getRawValue();
    this.requestSub = this.authService
      .requestPasswordReset(payload.login_email)
      .pipe(finalize(() => this.setLoading(false)))
      .subscribe({
        next: () => {
          this.setFeedbackMessage('A new password has been sent to your email address.', true);
        },
        error: (error: unknown) => {
          this.setFeedbackMessage(this.buildErrorMessage(error), false);
        },
      });
  }

  backToLogin(): void {
    this.router.navigate(['/login']);
  }

  private loginEmailValidator(control: AbstractControl): ValidationErrors | null {
    const value = String(control.value || '').trim();

    if (!value) {
      return null;
    }

    return BASIC_EMAIL_PATTERN.test(value) ? null : { email: true };
  }

  private buildErrorMessage(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) {
      return 'Unable to process your request right now. Please try again.';
    }

    if (error.status === 404) {
      return 'User does not exist.';
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

    return 'Unable to process your request right now. Please try again.';
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
