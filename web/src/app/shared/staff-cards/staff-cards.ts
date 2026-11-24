import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { DATA_MANAGE_MESSAGES } from '../data-manage-messages';

/**
 * A staff member as the public API returns it. The role and contact fields are set only for a staff member who is
 * shown in the Contacts list (Data Management > Members, or Manage User).
 */
export interface StaffContact {
  vid: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  suffix: string | null;
  role_title: string | null;
  role_description: string | null;
  contact_email: string | null;
  contact_number: string | null;
}

/**
 * The "Staff" section: one card per staff member with the role title first, then the name, the role description, the
 * email (a mailto link) and the number. The Members page and the Contacts page both place this component, so the
 * staff always look the same; each page only decides which staff it passes in.
 */
@Component({
  selector: 'app-staff-cards',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './staff-cards.html',
  styleUrl: './staff-cards.css',
})
export class StaffCardsComponent {
  @Input() staff: readonly StaffContact[] = [];

  readonly emptyMessage = DATA_MANAGE_MESSAGES.noRecords('Staff');

  /** "First Last Suffix"; a staff member without a first or last name keeps the display name. */
  displayName(member: StaffContact): string {
    const name = [member.first_name, member.last_name, member.suffix]
      .map((part) => (part ?? '').trim())
      .filter((part) => part.length > 0)
      .join(' ');
    return name || member.name;
  }

  trackByVid(_index: number, member: StaffContact): string {
    return member.vid;
  }
}
