import { CommonModule } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { SimbriefService } from '../../services/simbrief.service';
import { PopupMessageComponent } from '../../shared/popup/popup-message';
import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import { ChartSearchComponent } from '../../shared/chart-search/chart-search';
import { OnlineTrafficComponent } from '../../shared/online-traffic/online-traffic';
import { ParkingSearchComponent } from '../../shared/parking-search/parking-search';
import { WeatherComponent } from '../../shared/weather/weather';

/** Where a pilot goes to file a flight plan; both open in a new tab. */
const SIMBRIEF_URL = 'https://dispatch.simbrief.com/options/custom';
const IVAO_FLIGHT_PLAN_URL = 'https://fpl.ivao.aero/flight-plans/create';
const COPY_FAILED_MESSAGE =
  'It could not be copied automatically. Click the flight plan text, select all (Ctrl+A) and copy it (Ctrl+C).';

@Component({
  selector: 'app-pilots-lounge',
  standalone: true,
  imports: [
    CommonModule,
    PlaceholderBannerComponent,
    ChartSearchComponent,
    OnlineTrafficComponent,
    WeatherComponent,
    ParkingSearchComponent,
    PopupMessageComponent,
  ],
  templateUrl: './pilots-lounge.html',
  styleUrl: './pilots-lounge.css',
})
export class PilotsLoungeComponent {
  private readonly title = inject(Title);
  readonly simbrief = inject(SimbriefService);

  /** The Pilot ID / username field of "File a flight plan in IVAO" stays hidden until that button is clicked. */
  readonly ivaoFormOpen = signal(false);
  /** Whether the ICAO flight plan reached the clipboard; "failed" shows the text so it can be copied by hand. */
  readonly copyState = signal<'idle' | 'copied' | 'failed'>('idle');

  readonly copyFailedMessage = COPY_FAILED_MESSAGE;
  readonly simbriefUrl = SIMBRIEF_URL;
  readonly ivaoFlightPlanUrl = IVAO_FLIGHT_PLAN_URL;

  constructor() {
    this.title.setTitle("IVAO Philippines - Pilot's Lounge");

    // Each time a flight plan is loaded, bring it into view (the card appears below the fold on most screens).
    effect(() => {
      if (this.simbrief.flightPlan()) {
        // Wait for the card to be drawn before scrolling to it.
        setTimeout(() => this.scrollToFlightPlan());
      }
    });
  }

  /**
   * Scrolls so the whole flight plan card (title down to "Open IVAO Flight Plans") is visible; when the card is taller
   * than the screen, its title is put at the top instead.
   */
  private scrollToFlightPlan(): void {
    const card = document.getElementById('ofp-card');
    if (!card) {
      return;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fits = card.getBoundingClientRect().height <= window.innerHeight;
    card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: fits ? 'center' : 'start' });
  }

  /** Loads the typed Pilot ID / username; the copy message of a previous plan is cleared. */
  loadFlightPlan(): void {
    this.copyState.set('idle');
    this.simbrief.fetch();
  }

  /**
   * IVAO's flight plan page cannot be filled by another site, so the ICAO flight plan is shown on this page: the pilot
   * copies it first (this button, or by hand from the text box when the browser blocks the clipboard), then opens IVAO's
   * flight plan page and pastes it into the ICAO import.
   */
  copyIcaoText(): void {
    const text = this.simbrief.flightPlan()?.icaoFlightPlan;
    if (!text) {
      return;
    }

    // navigator.clipboard is missing on non-secure pages, so a missing API also counts as a failed copy.
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('No clipboard')))
      .then(() => this.copyState.set('copied'))
      .catch(() => this.copyState.set('failed'));
  }

  /** Smoothly scrolls to a section of the page (instantly for people who prefer reduced motion). */
  scrollToSection(event: Event, sectionId: string): void {
    event.preventDefault();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(sectionId)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }
}
