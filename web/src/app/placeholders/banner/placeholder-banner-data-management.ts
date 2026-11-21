import { Component, Input } from '@angular/core';

import { PlaceholderBannerComponent } from './placeholder-banner';

/** The banner of a data management page: the standard banner with the "DATA MANAGEMENT" line above the page title. */
@Component({
  selector: 'app-placeholder-banner-data-management',
  standalone: true,
  imports: [PlaceholderBannerComponent],
  template: `
    <app-placeholder-banner
      subheading="DATA MANAGEMENT"
      [title]="title"
      [secondTitle]="secondTitle"
      [subtitle]="subtitle"
      [showBackLink]="showBackLink"
      [backLinkRoute]="backLinkRoute"
      [backLinkText]="backLinkText"
    ></app-placeholder-banner>
  `,
})
export class PlaceholderBannerDataManagementComponent {
  /** Leave title unset on a data management page and it comes from the generated page titles (manageCode). */
  @Input() title?: string;
  @Input() secondTitle = '';
  @Input() subtitle = '';
  @Input() showBackLink = true;
  @Input() backLinkRoute = '/data-management';
  @Input() backLinkText = '← Back to Data Management';
}
