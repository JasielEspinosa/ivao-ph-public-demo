import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { environment } from '../../../environments/environment';
import { getAuthHeader } from '../../app';
import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import { DATA_MANAGE_MESSAGES } from '../../shared/data-manage-messages';
import { EventCardsComponent, PublicEvent } from '../../shared/event-cards/event-cards';
import { OnlineTrafficComponent } from '../../shared/online-traffic/online-traffic';
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

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [PlaceholderBannerComponent, EventCardsComponent, OnlineTrafficComponent],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class HomeComponent implements OnInit {
  private readonly title = inject(Title);
  private readonly http = inject(HttpClient);

  readonly messages = DATA_MANAGE_MESSAGES;
  readonly events = signal<HomeEvents>({ today: [], upcoming: [], past: [] });
  readonly isLoading = signal(true);
  readonly errorMessage = signal('');

  constructor() {
    this.title.setTitle('IVAO Philippines');
  }

  ngOnInit(): void {
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

  /** Smoothly scrolls to a section of the page (instantly for people who prefer reduced motion). */
  scrollToSection(event: Event, sectionId: string): void {
    event.preventDefault();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(sectionId)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }
}
