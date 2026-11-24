import { DOCUMENT } from '@angular/common';
import {
  Component,
  ElementRef,
  HostListener,
  Input,
  OnDestroy,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';

import { environment } from '../../../environments/environment';
import { AuthImageDirective } from '../auth-image';
import { EventAirportListComponent } from '../event-airport-list/event-airport-list';
import { EventWhere, formatEventAirports, formatEventWhen } from '../event-format';

/** An event as the public API returns it: shown events only. */
export interface PublicEvent extends EventWhere {
  id: number;
  title: string;
  description: string | null;
  has_image: boolean;
  updated_at: string;
}

const EVENTS_API = `${environment.apiUrl.replace(/\/$/, '')}/events`;
/** An event without a picture shows this one. */
export const EVENT_FALLBACK_IMAGE = 'images/home/event-launch.svg';
/** A description longer than this is cut to a few lines with a "Read more" button. */
const LONG_DESCRIPTION_LENGTH = 180;
/** How long the large view's closing animation lasts; keep in sync with event-cards.css. */
const CLOSE_ANIMATION_MS = 220;
const CLOCK_TICK_MS = 60 * 1000;

/** The Home section a list of cards is in. */
export type EventCardSection = 'today' | 'upcoming' | 'past';
/** How one card looks (see `EventCardsComponent.kind`). */
export type EventCardKind = 'live' | 'today' | 'upcoming' | 'past';

/**
 * The event cards of the Home page (Events Today, Upcoming Events, Past Events): the 16:9 picture, when the event takes
 * place (GMT first, then Philippine Time), the title, the airports and the description. One component so the three
 * sections always look the same.
 */
@Component({
  selector: 'app-event-cards',
  standalone: true,
  imports: [AuthImageDirective, EventAirportListComponent],
  templateUrl: './event-cards.html',
  styleUrl: './event-cards.css',
})
export class EventCardsComponent implements OnDestroy {
  @Input() events: readonly PublicEvent[] = [];
  /** Shown when there is no event. */
  @Input() emptyMessage = '';
  /**
   * Which Home section the cards are in. Today and Upcoming cards are colourful (red for something happening today,
   * blue for something to come); Past cards stay grey, with the picture in grey and an "Ended" tag.
   */
  @Input() section: EventCardSection = 'upcoming';

  readonly fallbackImage = EVENT_FALLBACK_IMAGE;
  readonly formatWhen = formatEventWhen;
  readonly formatAirports = formatEventAirports;

  /** The events whose long description is open. */
  private readonly expanded = signal<ReadonlySet<number>>(new Set());

  /** The event shown in the large view (null: closed). */
  readonly selected = signal<PublicEvent | null>(null);
  /** The large view is playing its closing animation. */
  readonly closing = signal(false);
  /** Where the large view grows from, as the distance in pixels from the centre of the window. */
  readonly originX = signal(0);
  readonly originY = signal(0);

  private readonly document = inject(DOCUMENT);
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private lastTrigger: HTMLElement | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  /** The clock of the cards, ticking every minute so "Live now" turns on and off without a page reload. */
  private readonly now = signal(Date.now());
  private readonly clock = setInterval(() => this.now.set(Date.now()), CLOCK_TICK_MS);

  constructor() {
    // The keyboard starts inside the large view.
    effect(() => this.closeButton()?.nativeElement.focus());
  }

  /**
   * How the card looks: `live` (today, and it is on right now), `today` (today, starts later), `upcoming`, or `past`.
   * An event of Events Today that has already ended today looks like a past one.
   */
  kind(event: PublicEvent): EventCardKind {
    if (this.section === 'upcoming' || this.section === 'past') {
      return this.section;
    }

    const now = this.now();
    if (now >= new Date(event.end_at).getTime()) {
      return 'past';
    }
    return now >= new Date(event.start_at).getTime() ? 'live' : 'today';
  }

  /** The words of the small status pill above the title ('' for a past event: it has the "Ended" tag). */
  statusLabel(event: PublicEvent): string {
    switch (this.kind(event)) {
      case 'live':
        return 'Live now';
      case 'today':
        return 'Later today';
      case 'upcoming':
        return 'Upcoming';
      default:
        return '';
    }
  }

  /** The picture's address; '' for an event without a picture. The version keeps the browser from showing an old one. */
  imageUrl(event: PublicEvent): string {
    return event.has_image ? `${EVENTS_API}/${event.id}/image?v=${encodeURIComponent(event.updated_at)}` : '';
  }

  isLong(event: PublicEvent): boolean {
    return (event.description ?? '').length > LONG_DESCRIPTION_LENGTH;
  }

  isExpanded(event: PublicEvent): boolean {
    return this.expanded().has(event.id);
  }

  /** Opens the event in the large view; it grows out of the picture that was clicked. */
  openEvent(event: PublicEvent, click: Event): void {
    const trigger = (click.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    const view = this.document.defaultView;
    if (trigger && view) {
      // The large view is centred in the window, so this is how far its start point is from the centre.
      this.originX.set(trigger.left + trigger.width / 2 - view.innerWidth / 2);
      this.originY.set(trigger.top + trigger.height / 2 - view.innerHeight / 2);
    }
    this.lastTrigger = click.currentTarget as HTMLElement | null;
    this.clearCloseTimer();
    this.closing.set(false);
    this.selected.set(event);
    this.document.body.style.overflow = 'hidden';
  }

  /** Closes the large view with the same animation backwards, then gives the focus back to the picture. */
  closeEvent(): void {
    if (!this.selected() || this.closing()) {
      return;
    }
    const reduceMotion = this.document.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;
    this.closing.set(true);
    this.closeTimer = setTimeout(() => this.finishClose(), reduceMotion ? 0 : CLOSE_ANIMATION_MS);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeEvent();
  }

  ngOnDestroy(): void {
    clearInterval(this.clock);
    this.clearCloseTimer();
    if (this.selected()) {
      this.document.body.style.overflow = '';
    }
  }

  private finishClose(): void {
    this.closeTimer = null;
    this.selected.set(null);
    this.closing.set(false);
    this.document.body.style.overflow = '';
    this.lastTrigger?.focus();
    this.lastTrigger = null;
  }

  private clearCloseTimer(): void {
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  toggleExpanded(event: PublicEvent): void {
    this.expanded.update((open) => {
      const next = new Set(open);
      if (!next.delete(event.id)) {
        next.add(event.id);
      }
      return next;
    });
  }
}
