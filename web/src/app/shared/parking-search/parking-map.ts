import {
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  effect,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import * as L from 'leaflet';

import {
  AirportParkingSpot,
  airlinesSourceLabel,
  isSimulatorSource,
  parkingSourceLabel,
  standTypeLabel,
  standUseLabel,
} from '../airport-parking';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
/** The closest the map zooms in by itself (a single spot would otherwise fill the whole view). */
const FIT_ZOOM = 18;
const MAX_ZOOM = 19;
const AIRLINES_IN_A_POPUP = 8;

/**
 * The map of one airport's parking spots on OpenStreetMap tiles: a circle per spot, colored by source (a terminal gate is
 * a ring). Choosing a spot in the list (`focused`) brings the map to it. Styles: parking-map.css.
 */
@Component({
  selector: 'app-parking-map',
  standalone: true,
  template: `<div #host class="parking-map" role="region" aria-label="Map of the parking spots"></div>`,
  styleUrl: './parking-map.css',
})
export class ParkingMapComponent implements OnDestroy {
  readonly spots = input.required<readonly AirportParkingSpot[]>();
  /** The spot to show, as a new object each time it is chosen. */
  readonly focused = input<{ id: number } | null>(null);

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly ready = signal(false);
  private map: L.Map | null = null;
  private layer: L.LayerGroup | null = null;
  private readonly markers = new Map<number, L.CircleMarker>();

  constructor() {
    afterNextRender(() => {
      this.map = L.map(this.host().nativeElement, { maxZoom: MAX_ZOOM });
      L.tileLayer(TILE_URL, { maxZoom: MAX_ZOOM, attribution: TILE_ATTRIBUTION }).addTo(this.map);
      this.layer = L.layerGroup().addTo(this.map);
      this.ready.set(true);
    });

    effect(() => {
      const spots = this.spots();
      if (this.ready()) {
        untracked(() => this.draw(spots));
      }
    });

    effect(() => {
      const focused = this.focused();
      if (focused && this.ready()) {
        untracked(() => this.show(focused.id));
      }
    });
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
  }

  private draw(spots: readonly AirportParkingSpot[]): void {
    if (!this.map || !this.layer) {
      return;
    }

    this.layer.clearLayers();
    this.markers.clear();
    for (const spot of spots) {
      const isGate = spot.stand_type === 'GATE';
      const marker = L.circleMarker([spot.latitude, spot.longitude], {
        radius: 7,
        weight: isGate ? 3 : 2,
        fillOpacity: isGate ? 0.15 : 0.85,
        className: isSimulatorSource(spot.source) ? 'parking-spot parking-spot--simulator' : 'parking-spot',
      })
        // Leaflet reads a text as HTML, so names and notes are handed over as elements holding plain text.
        .bindTooltip(this.textElement('span', spot.stand_name ?? ''))
        .bindPopup(this.popupContent(spot))
        .addTo(this.layer);
      this.markers.set(spot.id, marker);
    }

    if (spots.length > 0) {
      this.map.fitBounds(L.latLngBounds(spots.map((spot) => [spot.latitude, spot.longitude])), {
        padding: [30, 30],
        maxZoom: FIT_ZOOM,
        // Leaflet fails when the map is removed (another page opened) in the middle of a zoom animation.
        animate: false,
      });
    }
  }

  private show(id: number): void {
    const marker = this.markers.get(id);
    if (!this.map || !marker) {
      return;
    }

    this.map.setView(marker.getLatLng(), FIT_ZOOM);
    marker.openPopup();
    this.host().nativeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  private popupContent(spot: AirportParkingSpot): HTMLElement {
    const content = document.createElement('div');
    const simulated = (isSimulated: boolean) => (isSimulated ? ' (simulator data)' : '');
    const airlines = spot.shown_airlines.map((airline) => airline.code);
    const lines = [
      [spot.terminal_name, standTypeLabel(spot.stand_type)].filter(Boolean).join(', '),
      spot.shown_use && `Use: ${standUseLabel(spot.shown_use)}${simulated(spot.use_is_simulated)}`,
      spot.shown_size && `Aircraft size: ${spot.shown_size}${simulated(spot.size_is_simulated)}`,
      // A long list would cover the map: the table has it in full.
      airlines.length > 0 &&
        `Airlines ${airlinesSourceLabel(spot.airlines_source)}: ${airlines.slice(0, AIRLINES_IN_A_POPUP).join(', ')}` +
          (airlines.length > AIRLINES_IN_A_POPUP ? ` and ${airlines.length - AIRLINES_IN_A_POPUP} more` : ''),
      `Source: ${parkingSourceLabel(spot.source)}`,
      spot.note,
    ];

    content.append(this.textElement('strong', spot.stand_name ?? ''));
    for (const line of lines) {
      if (line) {
        content.append(this.textElement('div', line));
      }
    }
    return content;
  }

  private textElement(tag: 'div' | 'span' | 'strong', text: string): HTMLElement {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
  }
}
