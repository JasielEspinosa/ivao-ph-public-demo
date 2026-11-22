import { CommonModule, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { Notam, WeatherService } from '../../services/weather.service';
import { PHILIPPINE_AIRPORTS } from '../philippine-airports';

/**
 * The "Weather & NOTAMs" section. Home and Pilot's Lounge both show this component; the lookup state comes from the
 * shared WeatherService, so an airport looked up on one page is shown on the other.
 */
@Component({
  selector: 'app-weather',
  standalone: true,
  imports: [CommonModule, DatePipe],
  templateUrl: './weather.html',
  styles: ':host { display: block; }',
})
export class WeatherComponent {
  private readonly weather = inject(WeatherService);

  /** Suggestions for the lookup's ICAO field. */
  readonly airports = PHILIPPINE_AIRPORTS;

  readonly weatherIcao = this.weather.icao;
  readonly weatherError = this.weather.error;
  readonly weatherShownIcao = this.weather.shownIcao;
  readonly metarCard = this.weather.metarCard;
  readonly tafCard = this.weather.tafCard;
  readonly modelCard = this.weather.modelCard;
  readonly notamCard = this.weather.notamCard;
  readonly activeNotams = this.weather.activeNotams;
  readonly upcomingNotams = this.weather.upcomingNotams;
  readonly weatherLoading = this.weather.loading;

  onWeatherIcaoInput(input: HTMLInputElement): void {
    this.weather.setIcaoFromInput(input);
  }

  fetchWeather(): void {
    this.weather.fetch();
  }

  /** How long a NOTAM applies: "5 h" up to 48 hours, then whole days ("14 days"). A 23:59 end counts as the full day. */
  formatNotamDuration(notam: Notam): string {
    if (!notam.to) {
      return '';
    }
    const hours = Math.round((Date.parse(notam.to) - Date.parse(notam.from)) / (60 * 60 * 1000));
    if (hours <= 48) {
      return `${Math.max(hours, 1)} h`;
    }
    const days = Math.round(hours / 24);
    return `${days} days`;
  }
}
