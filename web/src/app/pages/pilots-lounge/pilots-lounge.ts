import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { SimbriefService } from '../../services/simbrief.service';
import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import { OnlineTrafficComponent } from '../../shared/online-traffic/online-traffic';
import { WeatherComponent } from '../../shared/weather/weather';
import { PHILIPPINE_AIRPORTS } from '../../shared/philippine-airports';
import { AIRPORT_CHARTS, AirportChart, CHART_SOURCES, CHART_TYPES, ChartType } from './philippine-charts';

const PHILIPPINE_ICAO_PATTERN = /^RP[A-Z]{2}$/;

/** The charts of one type, as listed in the Charts search results. */
interface ChartGroup {
  readonly type: ChartType;
  readonly charts: readonly AirportChart[];
}

/** Where a pilot goes to file a flight plan; both open in a new tab. */
const SIMBRIEF_URL = 'https://dispatch.simbrief.com/options/custom';
const IVAO_FLIGHT_PLAN_URL = 'https://fpl.ivao.aero/flight-plans/create';

@Component({
  selector: 'app-pilots-lounge',
  standalone: true,
  imports: [CommonModule, PlaceholderBannerComponent, OnlineTrafficComponent, WeatherComponent],
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

  readonly simbriefUrl = SIMBRIEF_URL;
  readonly ivaoFlightPlanUrl = IVAO_FLIGHT_PLAN_URL;

  /** Suggestions for the Charts search's ICAO field. */
  readonly airports = PHILIPPINE_AIRPORTS;
  readonly chartSources = CHART_SOURCES;

  /** The Charts search starts empty: no code typed, nothing shown, no message. */
  readonly chartsIcao = signal('');
  readonly chartsError = signal('');
  /** The airport the results below belong to; empty until a search is done. */
  readonly chartsShownIcao = signal('');

  /** The charts kept on this site for the airport searched, grouped by type. Empty when there are none. */
  readonly chartGroups = computed<readonly ChartGroup[]>(() => {
    const charts = AIRPORT_CHARTS[this.chartsShownIcao()] ?? [];
    return CHART_TYPES.map((type) => ({ type, charts: charts.filter((chart) => chart.type === type) })).filter(
      (group) => group.charts.length > 0,
    );
  });

  /** The name of the airport searched, when it is one of the known Philippine airports. */
  readonly chartsAirportName = computed(
    () => this.airports.find((airport) => airport.icao === this.chartsShownIcao())?.name ?? '',
  );

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

  /** Keeps the field to letters (ICAO codes have no digits or spaces), in capitals, at most 4 of them. */
  onChartsIcaoInput(input: HTMLInputElement): void {
    const icao = input.value
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 4);
    input.value = icao;
    this.chartsIcao.set(icao);
  }

  /** Shows the charts of the typed airport. Only Philippine airports (RP**) have charts here. */
  searchCharts(): void {
    const icao = this.chartsIcao();
    this.chartsShownIcao.set('');

    if (!PHILIPPINE_ICAO_PATTERN.test(icao)) {
      this.chartsError.set('Enter a Philippine airport ICAO code: 4 letters starting with RP, for example RPLL.');
      return;
    }

    this.chartsError.set('');
    this.chartsShownIcao.set(icao);
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
