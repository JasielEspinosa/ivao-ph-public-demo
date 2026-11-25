import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

import { PlaceholderBannerComponent } from '../../../placeholders/banner/placeholder-banner';

interface AdminSettingsCard {
  readonly title: string;
  readonly description: string;
  readonly route: string;
}

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [CommonModule, RouterLink, PlaceholderBannerComponent],
  templateUrl: './admin-settings.html',
})
export class AdminSettingsComponent {
  private readonly title = inject(Title);

  /** Admin-only pages, in display order. */
  readonly cards: readonly AdminSettingsCard[] = [
    {
      title: 'Manage Integrations',
      description: 'Set the Discord webhook and the Facebook Page where the event reminders are posted.',
      route: '/admin/manage_integrations',
    },
    {
      title: 'Manage Users',
      description: 'Add and manage the users who can sign in, and choose which data management pages each can open.',
      route: '/admin/manage_users',
    },
  ];

  constructor() {
    this.title.setTitle('IVAO Philippines - Admin Settings');
  }
}
