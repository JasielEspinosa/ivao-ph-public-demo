import { Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import { OnlineTrafficComponent } from '../../shared/online-traffic/online-traffic';
import { ParkingSearchComponent } from '../../shared/parking-search/parking-search';

/** The public page for controllers. Its sections are shared components, styled by styles-info-sections.css. */
@Component({
  selector: 'app-atc-lounge',
  standalone: true,
  imports: [PlaceholderBannerComponent, OnlineTrafficComponent, ParkingSearchComponent],
  templateUrl: './atc-lounge.html',
})
export class AtcLoungeComponent {
  private readonly title = inject(Title);

  constructor() {
    this.title.setTitle('IVAO Philippines - ATC Lounge');
  }
}
