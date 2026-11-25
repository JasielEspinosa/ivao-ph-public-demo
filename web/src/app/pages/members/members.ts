import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { environment } from '../../../environments/environment';
import { getAuthHeader } from '../../app';
import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import { DATA_MANAGE_MESSAGES } from '../../shared/data-manage-messages';
import { StaffCardsComponent, StaffContact } from '../../shared/staff-cards/staff-cards';
import { NETWORK_UNAVAILABLE_MESSAGE } from '../../shared/submit-error-utils';
import { TablePagination, TablePaginationComponent } from '../../shared/table-pagination/table-pagination';
import { PopupMessageComponent } from '../../shared/popup/popup-message';

/** A member as the public API returns it: display fields of enabled members only. */
interface PublicMember extends StaffContact {
  country: string | null;
  division: string | null;
  is_pilot: boolean;
  is_atc: boolean;
  is_staff: boolean;
  is_real_world_pilot: boolean;
  is_real_world_atc: boolean;
}

const MEMBERS_API = `${environment.apiUrl.replace(/\/$/, '')}/members`;

/** Public, read-only list of the division's pilots, air traffic controllers and staff. Edited on Data Management. */
@Component({
  selector: 'app-members',
  standalone: true,
  imports: [
    PopupMessageComponent,
    CommonModule,
    PlaceholderBannerComponent,
    TablePaginationComponent,
    StaffCardsComponent,
  ],
  templateUrl: './members.html',
  styleUrl: './members.css',
})
export class MembersComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly title = inject(Title);

  readonly messages = DATA_MANAGE_MESSAGES;
  readonly pilotsPager = new TablePagination();
  readonly atcPager = new TablePagination();

  readonly isLoading = signal(true);
  readonly errorMessage = signal('');
  readonly searchTerm = signal('');
  private readonly members = signal<PublicMember[]>([]);

  /** Members matching the search box (VID, name, country, division, role or contact details). */
  private readonly matching = computed(() => {
    const needle = this.searchTerm().trim().toLowerCase();
    if (!needle) {
      return this.members();
    }

    return this.members().filter((member) =>
      [
        member.vid,
        member.name,
        member.country,
        member.division,
        member.role_title,
        member.role_description,
        member.contact_email,
        member.contact_number,
      ]
        .map((part) => (part ?? '').toLowerCase())
        .join(' ')
        .includes(needle),
    );
  });

  readonly pilots = computed(() => this.matching().filter((member) => member.is_pilot));
  readonly controllers = computed(() => this.matching().filter((member) => member.is_atc));
  readonly staff = computed(() => this.matching().filter((member) => member.is_staff));
  readonly hasAnyMembers = computed(() => this.members().length > 0);

  constructor() {
    this.title.setTitle('IVAO Philippines - Members');
  }

  ngOnInit(): void {
    this.http
      .get<PublicMember[]>(MEMBERS_API, { headers: new HttpHeaders({ Authorization: getAuthHeader() }) })
      .subscribe({
        next: (rows) => {
          this.members.set(rows ?? []);
          this.isLoading.set(false);
        },
        error: (error: { status?: number }) => {
          this.errorMessage.set(
            error?.status === 0 ? NETWORK_UNAVAILABLE_MESSAGE : DATA_MANAGE_MESSAGES.unableToLoad('members'),
          );
          this.isLoading.set(false);
        },
      });
  }

  onSearch(value: string): void {
    this.searchTerm.set(value);
  }
}
