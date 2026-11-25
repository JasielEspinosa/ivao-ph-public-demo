import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { AuthImageDirective } from '../auth-image';
import { DATA_MANAGE_MESSAGES } from '../data-manage-messages';
import { getStaffAvatarUrl, getStaffPhotoUrl } from '../profile-photo';

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
  /** Set when the staff member uploaded a profile photo. */
  photo_version: string | null;
}

/**
 * The "Staff" section: one card per staff member with the picture, then the role title, the name, the role description,
 * the email (a mailto link) and the number. The Members page and the Contacts page both place this component; each page
 * decides which staff it passes in and which picture style it shows:
 * - `portrait` (Members): the head to chest photo, only for those who uploaded one.
 * - `circle` (Contacts): the round profile picture, with the initials for those without one.
 */
@Component({
  selector: 'app-staff-cards',
  standalone: true,
  imports: [AuthImageDirective, CommonModule],
  templateUrl: './staff-cards.html',
  styleUrl: './staff-cards.css',
})
export class StaffCardsComponent {
  @Input() staff: readonly StaffContact[] = [];
  @Input() photoStyle: 'portrait' | 'circle' = 'portrait';

  readonly emptyMessage = DATA_MANAGE_MESSAGES.noRecords('Staff');

  /** "First Last Suffix"; a staff member without a first or last name keeps the display name. */
  displayName(member: StaffContact): string {
    const name = [member.first_name, member.last_name, member.suffix]
      .map((part) => (part ?? '').trim())
      .filter((part) => part.length > 0)
      .join(' ');
    return name || member.name;
  }

  /** The address of the member's picture in this style, or '' without one. */
  photoUrl(member: StaffContact): string {
    if (!member.photo_version) {
      return '';
    }
    const getUrl = this.photoStyle === 'circle' ? getStaffAvatarUrl : getStaffPhotoUrl;
    return getUrl(member.vid, member.photo_version);
  }

  /** The first letters of the first and last name, shown in the circle without a picture. */
  initials(member: StaffContact): string {
    const first = (member.first_name ?? '').trim();
    const last = (member.last_name ?? '').trim();
    const source = first && last ? `${first.charAt(0)}${last.charAt(0)}` : first || last || member.name;
    return source.trim().slice(0, 2).toUpperCase() || '?';
  }

  trackByVid(_index: number, member: StaffContact): string {
    return member.vid;
  }
}
