import { CommonModule, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';

/** A sample "Upcoming Event" card. Dummy content until the events calendar exists. */
interface UpcomingEvent {
  readonly title: string;
  /** Day of the event (UTC); always in the future because it is computed from today. */
  readonly date: Date;
  readonly time: string;
  readonly summary: string;
  readonly image: string;
  readonly imageAlt: string;
}

/** A sample row of the "Online Pilots" list. Dummy content until live IVAO data is connected. */
interface OnlinePilot {
  readonly callsign: string;
  readonly name: string;
  readonly aircraft: string;
  readonly departure: string;
  readonly arrival: string;
  readonly altitude: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, DatePipe, PlaceholderBannerComponent],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class HomeComponent {
  private readonly title = inject(Title);

  readonly events: readonly UpcomingEvent[] = HomeComponent.buildEvents();

  readonly onlinePilots: readonly OnlinePilot[] = [
    {
      callsign: 'PAL101',
      name: 'Juan Dela Cruz',
      aircraft: 'A320',
      departure: 'RPLL',
      arrival: 'RPVM',
      altitude: 'FL340',
    },
    {
      callsign: 'CEB624',
      name: 'Maria Reyes',
      aircraft: 'A321',
      departure: 'RPLL',
      arrival: 'RPMD',
      altitude: 'FL360',
    },
    { callsign: 'APG887', name: 'Jose Rizal', aircraft: 'A320', departure: 'RPVM', arrival: 'RPLL', altitude: 'FL280' },
    {
      callsign: 'PAL2873',
      name: 'Andres Bonifacio',
      aircraft: 'A330',
      departure: 'RPLL',
      arrival: 'RJAA',
      altitude: 'FL380',
    },
    {
      callsign: 'CEB542',
      name: 'Hans Becker',
      aircraft: 'A320',
      departure: 'RPLC',
      arrival: 'RPLL',
      altitude: 'FL120',
    },
    {
      callsign: 'RPC312',
      name: 'Mei Tanaka',
      aircraft: 'C172',
      departure: 'RPLB',
      arrival: 'RPLB',
      altitude: '2,500 ft',
    },
  ];

  constructor() {
    this.title.setTitle('IVAO Philippines');
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

    return [
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
  }
}
