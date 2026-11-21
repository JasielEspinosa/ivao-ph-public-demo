import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-placeholder-banner-admin',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './placeholder-banner-admin.html',
  styleUrl: './placeholder-banner-admin.css',
})
export class PlaceholderBannerAdminComponent {
  @Input() title = 'Admin Page';
  @Input() subtitle = '';
  /** Banner artwork: 'users' (Manage Users) or 'user' (Manage User). */
  @Input() art: 'users' | 'user' | '' = '';
  @Input() showBackLink = false;
  @Input() backLinkRoute = '/home';
  @Input() backLinkText = '← Back to Home';
}
