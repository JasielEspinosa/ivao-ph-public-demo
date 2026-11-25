import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { environment } from '../../../environments/environment';
import { getAuthHeader } from '../../app';
import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import { DATA_MANAGE_MESSAGES } from '../../shared/data-manage-messages';
import { StaffCardsComponent, StaffContact } from '../../shared/staff-cards/staff-cards';
import { NETWORK_UNAVAILABLE_MESSAGE } from '../../shared/submit-error-utils';
import { PopupMessageComponent } from '../../shared/popup/popup-message';

const CONTACTS_API = `${environment.apiUrl.replace(/\/$/, '')}/members/contacts`;

/**
 * Public Contacts page: the staff who are shown in the Contacts list. Set on Data Management > Members or on Manage
 * User ("Is Staff" > "Show in Contacts List"). The cards are the same component the Members page uses, with the round
 * profile picture.
 */
@Component({
  selector: 'app-contacts',
  standalone: true,
  imports: [PopupMessageComponent, PlaceholderBannerComponent, StaffCardsComponent],
  template: `
    <section class="page-shell">
      <div class="form-shell">
        <app-placeholder-banner title="Contacts" subheading="IVAO PHILIPPINES"></app-placeholder-banner>

        <div class="dashboard-header">
          <p>Get in touch with the staff of IVAO Philippines.</p>
        </div>

        @if (isLoading()) {
          <div
            class="route-loading-overlay route-loading-overlay--inline"
            role="status"
            aria-live="polite"
            [attr.aria-label]="messages.loading('Contacts')"
          >
            <div class="route-loading-spinner"></div>
          </div>
        }

        <app-popup-message type="error" [message]="errorMessage()" />

        @if (!isLoading() && !errorMessage()) {
          <app-staff-cards [staff]="staff()" photoStyle="circle"></app-staff-cards>
        }
      </div>
    </section>
  `,
})
export class ContactsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly title = inject(Title);

  readonly messages = DATA_MANAGE_MESSAGES;
  readonly isLoading = signal(true);
  readonly errorMessage = signal('');
  readonly staff = signal<StaffContact[]>([]);

  constructor() {
    this.title.setTitle('IVAO Philippines - Contacts');
  }

  ngOnInit(): void {
    this.http
      .get<StaffContact[]>(CONTACTS_API, { headers: new HttpHeaders({ Authorization: getAuthHeader() }) })
      .subscribe({
        next: (rows) => {
          this.staff.set(rows ?? []);
          this.isLoading.set(false);
        },
        error: (error: { status?: number }) => {
          this.errorMessage.set(
            error?.status === 0 ? NETWORK_UNAVAILABLE_MESSAGE : DATA_MANAGE_MESSAGES.unableToLoad('contacts'),
          );
          this.isLoading.set(false);
        },
      });
  }
}
