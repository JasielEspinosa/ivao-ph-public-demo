import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Data, RouterStateSnapshot, TitleStrategy } from '@angular/router';

import { DATA_MANAGE_PAGE_TITLES, PageTitleEntry } from './page-titles.generated';

/**
 * Single place that turns the generated page titles (see backend/scripts/generate-page-titles.js) into the text shown
 * on banners, browser tabs and menu cards. A data management page finds its entry from the route data (`manageCode`),
 * so the page never hard-codes its own title.
 */
export interface ResolvedPage {
  readonly code: string;
  readonly entry: PageTitleEntry;
}

export function resolvePage(data: Data | undefined): ResolvedPage | null {
  const code = String(data?.['manageCode'] ?? '');
  const entry = code ? DATA_MANAGE_PAGE_TITLES[code] : undefined;

  return entry ? { code, entry } : null;
}

/** The browser tab text of a data management page: its tabTitle as is, or "IVAO Philippines - Manage <Title>". */
export function tabTitle(page: ResolvedPage): string {
  const { entry } = page;
  return entry.tabTitle || `IVAO Philippines - Manage ${entry.title}`;
}

/** Banner/page text for the route the component is currently shown on. */
export function currentPage(route: ActivatedRoute | null): ResolvedPage | null {
  return resolvePage(route?.snapshot.data);
}

/** For pages that print the page description themselves (data management toolbar). */
export function injectCurrentPage(): ResolvedPage | null {
  return currentPage(inject(ActivatedRoute, { optional: true }));
}

/** Sets the browser tab from the route's manage code; other routes keep Angular's default behavior. */
@Injectable({ providedIn: 'root' })
export class PageTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    let route = snapshot.root;
    while (route.firstChild) {
      route = route.firstChild;
    }

    const page = resolvePage(route.data);
    if (page) {
      this.title.setTitle(tabTitle(page));
      return;
    }

    const built = this.buildTitle(snapshot);
    if (built !== undefined) {
      this.title.setTitle(built);
    }
  }
}

/** Card shown on the Data Management menu. */
export interface MenuCard {
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
  readonly route: string;
  readonly code: string;
}

export const manageMenuCard = (route: string, code: string): MenuCard => {
  const { title, subtitle, description } = DATA_MANAGE_PAGE_TITLES[code] ?? {
    title: code,
    subtitle: '',
    description: '',
  };
  return { title, subtitle, description, route, code };
};
