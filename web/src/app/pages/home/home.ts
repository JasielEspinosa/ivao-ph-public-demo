import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';

import { environment } from '../../../environments/environment';
import { getAuthHeader } from '../../app';
import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import { AdminAuthService } from '../../services/admin-auth.service';
import { EventApprovalService } from '../../shared/approval-notifications/event-approval.service';
import { DATA_MANAGE_MESSAGES } from '../../shared/data-manage-messages';
import { EventCardsComponent, PublicEvent } from '../../shared/event-cards/event-cards';
import { OnlineTrafficComponent } from '../../shared/online-traffic/online-traffic';
import { PopupMessageComponent } from '../../shared/popup/popup-message';
import { buildSubmitErrorMessage } from '../../shared/submit-error-utils';

/** The events of the Home page, as GET /api/events returns them (Data Management > Events Creation). */
interface HomeEvents {
  /** Taking place today (Philippine date). */
  today: PublicEvent[];
  /** Starting after today, soonest first. */
  upcoming: PublicEvent[];
  /** Ended before today: all of the last 31 days, or the latest 3 if fewer; most recently ended first. */
  past: PublicEvent[];
}

const EVENTS_API = `${environment.apiUrl.replace(/\/$/, '')}/events`;

/**
 * One announcement line. Untagged items are shown to everyone, signed in or not; tagged items are shown to admins
 * and to users who match at least one tag.
 */
interface AnnouncementItem {
  text: string;
  /** Data management codes (as in data-management.ts); shown if the user can manage any of these pages. */
  dataPages?: string[];
  /** Generic Data Management changes; shown if the user can open at least one data management page. */
  scope?: 'data-management'[];
  /** Admin Settings changes (Manage Users, Manage Integrations); shown to admins only. */
  adminOnly?: boolean;
}

interface AnnouncementGroup {
  title: string;
  items?: AnnouncementItem[];
  categories?: { title: string; items: AnnouncementItem[] }[];
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [PlaceholderBannerComponent, EventCardsComponent, OnlineTrafficComponent, PopupMessageComponent],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly title = inject(Title);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AdminAuthService);

  readonly messages = DATA_MANAGE_MESSAGES;
  readonly events = signal<HomeEvents>({ today: [], upcoming: [], past: [] });
  readonly isLoading = signal(true);
  readonly errorMessage = signal('');
  readonly showAnnouncements = signal(false);

  readonly announcements: AnnouncementGroup[] = [
    {
      title: 'Latest Updates',
      categories: [
        {
          title: 'Home Page',
          items: [
            {
              text: 'Added Events Today, Upcoming Events and Past Events to the Home page, with a picture, the date and time in Philippine Time and GMT, and the airports of each event. Click an event picture to see it larger.',
            },
            {
              text: 'Added the live Online Pilots and Online Air Traffic Controllers, with a link on each flight to follow it on Webeye, and a jump bar at the top to go straight to a section.',
            },
          ],
        },
        {
          title: "Pilot's Lounge",
          items: [
            {
              text: "Added Airport Parking to the Pilot's Lounge, the same search as on the ATC Lounge page, so an airport searched on one page is shown on the other.",
            },
            {
              text: "Added File a Flight Plan to the Pilot's Lounge, so you can look up your SimBrief flight plan, and the Weather & NOTAMs section, where you type an airport to see its METAR, TAF and NOTAMs.",
            },
          ],
        },
        {
          title: 'ATC Lounge',
          items: [
            {
              text: 'Added the ATC Lounge page with Airport Parking, where you search a Philippine airport to see a map and a list of its parking stands, hangars and terminal gates and the airlines that use them, with simulator data only where real-world data is missing.',
            },
            {
              text: "Added the live Online Air Traffic Controllers to the ATC Lounge page, the same list as on the Home page and the Pilot's Lounge.",
            },
          ],
        },
        {
          title: 'Documents, Charts, Sceneries and Contacts',
          items: [
            {
              text: "Added the airport chart search to the Charts page, and the search there and in the Pilot's Lounge now points you to the charts this website has for that airport.",
            },
            {
              text: 'Added the Documents and Charts pages, where you can open or download the files shared by IVAO Philippines, the Sceneries page with the recommended airport sceneries and a download link for each flight simulator, and the Contacts page with the contact details of our staff.',
            },
          ],
        },
        {
          title: 'Data Management Pages',
          items: [
            {
              text: 'Added event approval, so a new event, or one with a new title, date, time or airports, shows on the Home page only after one approver approves it from the notification button at the top of the website or on the Events Creation page, and the other approvers are notified of who approved it.',
              dataPages: ['EVENTS'],
            },
            {
              text: 'Added Event Approver settings to the Members page, where you choose which staff approve events and whether they can edit them while approving (export a new template before your next import).',
              dataPages: ['MEMBERS'],
            },
            {
              text: 'Added staff contact details to the Members page, which are shown on the Contacts page and need at least an email or a number for each listed staff member.',
              dataPages: ['MEMBERS'],
            },
            {
              text: 'Added the Airport Parking page under Data Management, where you can add, edit, enable, export and import the parking spots of each airport, with their terminal, use, aircraft size and airlines.',
              dataPages: ['AIRPORT_PARKING'],
            },
            {
              text: 'Added the Airport Terminals page under Data Management, where you can list the airlines of each terminal, which Airport Parking shows.',
              dataPages: ['AIRPORT_TERMINALS'],
            },
            {
              text: 'Added the Charts and Documents pages under Data Management, so you can upload and manage the files, including sending a file from your phone by scanning a QR code.',
              dataPages: ['CHARTS', 'DOCUMENTS'],
            },
            {
              text: 'Added the Events Creation page, where you can add, edit, clone and archive events in Philippine Time or GMT, add a picture, set reminders that are posted to Discord and to the Facebook Page, and see who created and last changed each event, with only the title, times and picture editable once an event has started.',
              dataPages: ['EVENTS'],
            },
            {
              text: 'Added the Sceneries page under Data Management, where you can add airport sceneries with a download link for each flight simulator, a picture and a note.',
              dataPages: ['SCENERIES'],
            },
          ],
        },
        {
          title: 'Admin Settings',
          items: [
            {
              text: 'Added Event Approver settings to the Manage User page for staff and the admin account, and required an email or a number for anyone shown in the Contacts list.',
              adminOnly: true,
            },
            {
              text: 'Added the Manage Integrations page, where you set up the Discord and Facebook Page connections used by the event reminders.',
              adminOnly: true,
            },
          ],
        },
        {
          title: 'General',
          items: [
            { text: 'Added a link to the IVAO Regulations in the Rules and Policies menu of the header.' },
            {
              text: 'Added profile photos: upload yours in Profile Settings and adjust it before saving. Staff who have a photo are shown with it on the Members and Contacts pages.',
            },
            {
              text: "Added this What's New window, which you can open with the megaphone button at the bottom right of the Home page.",
            },
            {
              text: 'Improved the messages and confirmation questions across the website, which now appear in pop-up windows so they are harder to miss.',
            },
            {
              text: 'Updated the Privacy Policy to explain how profile photos, event history and the Airport Parking map are used.',
            },
          ],
        },
      ],
    },
    {
      title: 'New Pages',
      items: [
        { text: 'Airport Parking', dataPages: ['AIRPORT_PARKING'] },
        { text: 'Airport Terminals', dataPages: ['AIRPORT_TERMINALS'] },
        { text: 'ATC Lounge' },
        { text: 'Charts' },
        { text: 'Contacts' },
        { text: 'Documents' },
        { text: 'Events Creation', dataPages: ['EVENTS'] },
        { text: 'Manage Integrations', adminOnly: true },
        { text: 'Sceneries' },
      ],
    },
  ];

  constructor() {
    this.title.setTitle('IVAO Philippines');
    // An approval publishes an event, which adds it to the lists of this page.
    inject(EventApprovalService)
      .approved$.pipe(takeUntilDestroyed())
      .subscribe(() => this.loadEvents());
  }

  ngOnDestroy(): void {
    document.body.classList.remove('has-announcement-btn');
  }

  ngOnInit(): void {
    document.body.classList.add('has-announcement-btn');
    this.loadEvents();
  }

  private loadEvents(): void {
    this.http.get<HomeEvents>(EVENTS_API, { headers: new HttpHeaders({ Authorization: getAuthHeader() }) }).subscribe({
      next: (events) => {
        this.events.set({
          today: events?.today ?? [],
          upcoming: events?.upcoming ?? [],
          past: events?.past ?? [],
        });
        this.isLoading.set(false);
      },
      error: (error) => {
        this.errorMessage.set(
          buildSubmitErrorMessage(error, { fallbackMessage: DATA_MANAGE_MESSAGES.unableToLoad('events') }),
        );
        this.isLoading.set(false);
      },
    });
  }

  /** Announcements filtered to what the user can access; admins see everything. */
  visibleAnnouncements(): AnnouncementGroup[] {
    if (this.authService.hasAdminRole()) {
      return this.announcements;
    }

    return this.announcements
      .map((group) => ({
        title: group.title,
        items: group.items?.filter((item) => this.isItemVisible(item)),
        categories: group.categories
          ?.map((category) => ({
            title: category.title,
            items: category.items.filter((item) => this.isItemVisible(item)),
          }))
          .filter((category) => category.items.length > 0),
      }))
      .filter((group) => (group.items?.length ?? 0) > 0 || (group.categories?.length ?? 0) > 0);
  }

  private isItemVisible(item: AnnouncementItem): boolean {
    if (item.adminOnly) {
      return false;
    }

    if (!item.dataPages?.length && !item.scope?.length) {
      return true;
    }

    return (
      (item.dataPages ?? []).some((code) => this.authService.canAccessDataManagementCode(code)) ||
      (!!item.scope?.includes('data-management') && this.authService.hasDataManagementAccess())
    );
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeAnnouncements();
  }

  openAnnouncements(): void {
    this.showAnnouncements.set(true);
  }

  closeAnnouncements(): void {
    this.showAnnouncements.set(false);
  }

  /** Smoothly scrolls to a section of the page (instantly for people who prefer reduced motion). */
  scrollToSection(event: Event, sectionId: string): void {
    event.preventDefault();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(sectionId)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }
}
