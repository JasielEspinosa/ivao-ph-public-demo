import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { PlaceholderBannerAdminComponent } from '../../../placeholders/banner/placeholder-banner-admin';
import { AdminAuthService } from '../../../services/admin-auth.service';
import { DATA_MANAGE_MESSAGES } from '../../../shared/data-manage-messages';
import { getAuthErrorMessage, NETWORK_UNAVAILABLE_MESSAGE } from '../../../shared/submit-error-utils';
import { VALIDATION_MESSAGES } from '../../../shared/validation-messages';
import { VALIDATION_PATTERNS } from '../../../shared/validation-patterns';
import { environment } from '../../../../environments/environment';
import { PopupMessageComponent } from '../../../shared/popup/popup-message';

const MANAGE_INTEGRATIONS_API = `${environment.apiUrl.replace(/\/$/, '')}/manage-integrations`;
const DISCORD_WEBHOOK_URL_PATTERN = new RegExp(VALIDATION_PATTERNS.discordWebhookUrl);
const FACEBOOK_PAGE_ID_PATTERN = new RegExp(VALIDATION_PATTERNS.facebookPageId);
const FACEBOOK_PAGE_ACCESS_TOKEN_PATTERN = new RegExp(VALIDATION_PATTERNS.facebookPageAccessToken);

interface IntegrationSettings {
  discord_webhook_url: string;
  facebook_page_id: string;
  facebook_page_access_token: string;
}

type IntegrationField = keyof IntegrationSettings;

const EMPTY_SETTINGS: IntegrationSettings = {
  discord_webhook_url: '',
  facebook_page_id: '',
  facebook_page_access_token: '',
};

/** Admin page: the Discord webhook and the Facebook Page the events are posted to. Changes apply on Save; Cancel restores the saved values. */
@Component({
  selector: 'app-manage-integrations',
  standalone: true,
  imports: [PopupMessageComponent, CommonModule, PlaceholderBannerAdminComponent],
  templateUrl: './manage_integrations.html',
  styleUrl: './manage_integrations.css',
})
export class ManageIntegrationsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AdminAuthService);
  private readonly title = inject(Title);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  readonly messages = DATA_MANAGE_MESSAGES;
  readonly invalidDiscordWebhookUrlMessage = VALIDATION_MESSAGES.invalidDiscordWebhookUrl;
  readonly invalidFacebookPageIdMessage = VALIDATION_MESSAGES.invalidFacebookPageId;
  readonly invalidFacebookPageAccessTokenMessage = VALIDATION_MESSAGES.invalidFacebookPageAccessToken;
  readonly requiredFieldMessage = VALIDATION_MESSAGES.required;

  /** The values as shown on screen. */
  values: IntegrationSettings = { ...EMPTY_SETTINGS };
  /** The last saved values; Cancel puts the fields back to them. */
  private savedValues: IntegrationSettings = { ...EMPTY_SETTINGS };
  /** The secret field whose value is shown while its eye button is held down. */
  peekedField: IntegrationField | null = null;
  isLoading = true;
  isSaving = false;
  /** Errors show only after the first Save click or once a field was edited, so the page does not open full of red. */
  showErrors = false;
  errorMessage = '';
  successMessage = '';

  constructor() {
    this.title.setTitle('IVAO Philippines - Manage Integrations');
  }

  ngOnInit(): void {
    this.http
      .get<IntegrationSettings>(MANAGE_INTEGRATIONS_API, { headers: this.authService.getAdminApiHeaders() })
      .subscribe({
        next: (settings) => {
          this.applySaved(settings);
          this.isLoading = false;
          this.changeDetectorRef.detectChanges();
        },
        error: (error: HttpErrorResponse) => {
          this.isLoading = false;
          this.errorMessage = this.buildErrorMessage(error, 'Unable to load the integration settings.');
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  get hasChanges(): boolean {
    return (Object.keys(this.values) as IntegrationField[]).some(
      (field) => this.values[field].trim() !== this.savedValues[field],
    );
  }

  /** Facebook needs both its Page ID and its token: fill in both, or leave both empty. */
  isFacebookPairIncomplete(field: 'facebook_page_id' | 'facebook_page_access_token'): boolean {
    const other = field === 'facebook_page_id' ? 'facebook_page_access_token' : 'facebook_page_id';
    return this.values[field].trim() === '' && this.values[other].trim() !== '';
  }

  isInvalid(field: IntegrationField): boolean {
    const value = this.values[field].trim();
    if (!value) {
      return false;
    }

    switch (field) {
      case 'discord_webhook_url':
        return !DISCORD_WEBHOOK_URL_PATTERN.test(value);
      case 'facebook_page_id':
        return !FACEBOOK_PAGE_ID_PATTERN.test(value);
      case 'facebook_page_access_token':
        return !FACEBOOK_PAGE_ACCESS_TOKEN_PATTERN.test(value);
    }
  }

  showInvalidError(field: IntegrationField): boolean {
    return this.showErrors && this.isInvalid(field);
  }

  showRequiredError(field: 'facebook_page_id' | 'facebook_page_access_token'): boolean {
    return this.showErrors && this.isFacebookPairIncomplete(field);
  }

  get hasValidationErrors(): boolean {
    return (
      (Object.keys(this.values) as IntegrationField[]).some((field) => this.isInvalid(field)) ||
      this.isFacebookPairIncomplete('facebook_page_id') ||
      this.isFacebookPairIncomplete('facebook_page_access_token')
    );
  }

  onInput(field: IntegrationField, value: string): void {
    this.values = { ...this.values, [field]: value };
    this.showErrors = true;
    this.errorMessage = '';
    this.successMessage = '';
  }

  /** Restores the saved values and stays on the page. */
  cancel(): void {
    this.values = { ...this.savedValues };
    this.peekedField = null;
    this.showErrors = false;
    this.errorMessage = '';
    this.successMessage = '';
  }

  /** Applies the changes and stays on the page. */
  save(): void {
    if (this.isSaving || !this.hasChanges) {
      return;
    }

    this.showErrors = true;
    this.errorMessage = '';
    this.successMessage = '';

    if (this.hasValidationErrors) {
      return;
    }

    this.isSaving = true;

    this.http
      .put<IntegrationSettings>(
        MANAGE_INTEGRATIONS_API,
        {
          discord_webhook_url: this.values.discord_webhook_url.trim(),
          facebook_page_id: this.values.facebook_page_id.trim(),
          facebook_page_access_token: this.values.facebook_page_access_token.trim(),
        },
        { headers: this.authService.getAdminApiHeaders() },
      )
      .subscribe({
        next: (settings) => {
          this.applySaved(settings);
          this.isSaving = false;
          this.successMessage = 'Integration settings saved.';
          this.changeDetectorRef.detectChanges();
        },
        error: (error: HttpErrorResponse) => {
          this.isSaving = false;
          this.errorMessage = this.buildErrorMessage(error, 'Unable to save the integration settings.');
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  activatePeek(field: IntegrationField, event: PointerEvent): void {
    event.preventDefault();
    this.peekedField = field;

    const target = event.currentTarget as HTMLElement | null;
    if (target && typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // Ignore capture failures on unsupported browsers/devices.
      }
    }
  }

  deactivatePeek(): void {
    this.peekedField = null;
  }

  onPeekKeydown(field: IntegrationField, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    this.peekedField = field;
  }

  onPeekKeyup(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    this.peekedField = null;
  }

  private applySaved(settings: IntegrationSettings): void {
    this.savedValues = {
      discord_webhook_url: settings.discord_webhook_url ?? '',
      facebook_page_id: settings.facebook_page_id ?? '',
      facebook_page_access_token: settings.facebook_page_access_token ?? '',
    };
    this.values = { ...this.savedValues };
    this.showErrors = false;
  }

  private buildErrorMessage(error: HttpErrorResponse, fallback: string): string {
    if (error.status === 0) {
      return NETWORK_UNAVAILABLE_MESSAGE;
    }

    if (error.status === 401) {
      this.authService.logout();
      return 'Session timed out. Please log in again.';
    }

    if (error.status === 403) {
      return getAuthErrorMessage(error.status);
    }

    // Validation errors come back as a list of messages.
    const responseMessage = Array.isArray(error.error?.message) ? error.error.message[0] : error.error?.message;
    if (typeof responseMessage === 'string' && responseMessage.trim()) {
      return responseMessage;
    }

    return fallback;
  }
}
