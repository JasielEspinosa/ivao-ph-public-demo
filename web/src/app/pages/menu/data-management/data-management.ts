import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

import { PlaceholderBannerComponent } from '../../../placeholders/banner/placeholder-banner';
import { AdminAuthService } from '../../../services/admin-auth.service';
import { manageMenuCard } from '../../../shared/page-titles';
import { MenuColumnsDirective } from '../../../shared/menu-columns.directive';

@Component({
  selector: 'app-data-management',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PlaceholderBannerComponent, MenuColumnsDirective],
  templateUrl: './data-management.html',
})
export class DataManagementComponent {
  private readonly title = inject(Title);
  private readonly authService = inject(AdminAuthService);
  searchTerm = '';

  // Codes match the manageCode of each route (app.routes.ts) and the data management pages in backend/scripts.
  readonly cards = [
    manageMenuCard('/members-manage', 'MEMBERS'),
    manageMenuCard('/charts-manage', 'CHARTS'),
    manageMenuCard('/countries-manage', 'COUNTRIES'),
    manageMenuCard('/documents-manage', 'DOCUMENTS'),
    manageMenuCard('/events-manage', 'EVENTS'),
  ];

  constructor() {
    this.title.setTitle('IVAO Philippines - Data Management');
  }

  get sortedCards() {
    const query = this.searchTerm.trim().toLocaleLowerCase();

    return [...this.cards]
      .filter((card) => this.authService.canAccessDataManagementCode(card.code))
      .filter(
        (card) => !query || `${card.title} ${card.subtitle} ${card.description}`.toLocaleLowerCase().includes(query),
      )
      .sort((left, right) => left.title.localeCompare(right.title) || left.subtitle.localeCompare(right.subtitle));
  }
}
