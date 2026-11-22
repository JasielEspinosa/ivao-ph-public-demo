import { DatePipe, NgFor } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import { OnlineTrafficComponent } from '../../shared/online-traffic/online-traffic';

/** A sample "Upcoming Event" card. Dummy content until the events calendar exists. */
interface UpcomingEvent {
  readonly title: string;
  /** Day of the event (UTC); always in the future because it is computed from today. */
  readonly date: Date;
  readonly time: string;
  /** The same time range in Philippine Time, "hh:mm AM - hh:mm PM". */
  readonly timePht: string;
  readonly summary: string;
  readonly image: string;
  readonly imageAlt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [NgFor, DatePipe, PlaceholderBannerComponent, OnlineTrafficComponent],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class HomeComponent {
  private readonly title = inject(Title);

  readonly events: readonly UpcomingEvent[] = HomeComponent.buildEvents();

  constructor() {
    this.title.setTitle('IVAO Philippines');
  }

  /** Smoothly scrolls to a section of the page (instantly for people who prefer reduced motion). */
  scrollToSection(event: Event, sectionId: string): void {
    event.preventDefault();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(sectionId)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  /** The event links go nowhere yet. */
  noEventPageYet(event: Event): void {
    event.preventDefault();
  }

  /** Three sample events 2, 4 and about 6 weeks from today, so they are never in the past. */
  private static buildEvents(): UpcomingEvent[] {
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const inDays = (days: number) => new Date(todayUtc + days * DAY_MS);

    /** "1200Z - 1600Z" -> "08:00 PM - 12:00 AM" (PHT is UTC+8, no daylight saving). */
    const toPht = (zuluRange: string): string =>
      zuluRange
        .split('-')
        .map((part) => {
          const digits = part.replace(/\D/g, '');
          const minutesOfDay = (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)) + 8 * 60) % (24 * 60);
          const hours24 = Math.floor(minutesOfDay / 60);
          const hours12 = hours24 % 12 || 12;
          const minutes = String(minutesOfDay % 60).padStart(2, '0');
          return `${String(hours12).padStart(2, '0')}:${minutes} ${hours24 < 12 ? 'AM' : 'PM'}`;
        })
        .join(' - ');

    const events: Omit<UpcomingEvent, 'timePht'>[] = [
      {
        title: 'Mabuhay IVAO PH Launch Fly-In',
        date: inDays(14),
        time: '1200Z - 1600Z',
        summary: 'Join us for the launch of IVAO Philippines. Fly into Manila and enjoy full ATC coverage.',
        image: 'images/home/event-launch.svg',
        imageAlt: 'An airliner crossing a sunrise over the sea',
      },
      {
        title: 'Friday Flyday: Manila ATC Night',
        date: inDays(28),
        time: '1300Z - 1700Z',
        summary: 'A weekly night of busy Manila airspace. Controllers and pilots welcome, all ratings.',
        image: 'images/home/event-atc-night.svg',
        imageAlt: 'A radar screen at night',
      },
      {
        title: '7,641 Islands Tour: Part 1',
        date: inDays(45),
        time: '0900Z - 1300Z',
        summary: 'A relaxed island-hopping tour across the Philippines with staff-led briefings.',
        image: 'images/home/event-islands-tour.svg',
        imageAlt: 'A route linking islands on a map',
      },
    ];

    return events.map((event) => ({ ...event, timePht: toPht(event.time) }));
  }
}
