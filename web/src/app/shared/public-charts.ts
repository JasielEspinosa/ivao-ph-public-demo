import { environment } from '../../environments/environment';

/** The public routes of the charts managed on Data Management > Charts. */
export const CHARTS_API = `${environment.apiUrl.replace(/\/$/, '')}/charts`;

/** A chart as the public API returns it: enabled charts only. */
export interface PublicChart {
  id: number;
  /** Empty for a chart that belongs to no single airport. */
  airport_icao: string | null;
  chart_name: string;
  description: string | null;
  /** The page a link chart opens in a new tab; null for a chart that holds a PDF. */
  link_url: string | null;
  /** The link points to a PDF: it can be downloaded (the server fetches it) as well as opened. */
  link_is_pdf: boolean;
  /** The file fields are null for a link. */
  file_name: string | null;
  file_size: number | null;
}

/** The id of an airport's heading on the Charts page, so a link can lead to that airport's charts. */
export const airportChartsAnchor = (icao: string): string => `airport-${icao}`;

/** The id of the whole chart list on the Charts page. */
export const CHART_LIST_ANCHOR = 'chart-list';

/** Smoothly scrolls to an element of the page (instantly for people who prefer reduced motion). */
export function scrollToAnchor(anchor: string): void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.getElementById(anchor)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}
