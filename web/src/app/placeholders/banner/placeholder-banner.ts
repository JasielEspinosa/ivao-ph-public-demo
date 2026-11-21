import { CommonModule } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { currentPage } from '../../shared/page-titles';

/** The page banner: the page title on the left, Philippine island artwork behind. */
@Component({
  selector: 'app-placeholder-banner',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './placeholder-banner.html',
  styleUrl: './placeholder-banner.css',
})
export class PlaceholderBannerComponent {
  private readonly route = inject(ActivatedRoute, { optional: true });

  /** On a data management page, leave the title unset and it comes from the generated page titles (by manageCode). */
  @Input() title?: string;
  @Input() secondTitle = '';
  @Input() subtitle = '';
  /** Small line above the title (e.g. "WELCOME TO", "DATA MANAGEMENT"); nothing is shown when empty. */
  @Input() subheading = '';
  @Input() showBackLink = false;
  @Input() backLinkRoute = '/home';
  @Input() backLinkText = '← Back to Home';

  get displayTitle(): string {
    return this.title ?? currentPage(this.route)?.entry.title ?? 'IVAO Philippines';
  }
}
