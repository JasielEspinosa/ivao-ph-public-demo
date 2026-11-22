/** The kinds of chart a Philippine airport can have, in the order the Charts search lists them. */
export const CHART_TYPES = [
  'Aerodrome Information',
  'Airport Chart',
  'Departure Chart',
  'Arrival Chart',
  'Approach Chart',
  'Other',
] as const;

export type ChartType = (typeof CHART_TYPES)[number];

/** A chart file kept on this site. `file` is relative to the site's base href, e.g. "charts/RPLL/ils-06.pdf". */
export interface AirportChart {
  readonly title: string;
  readonly type: ChartType;
  readonly file: string;
}

/**
 * Charts kept on this site, by airport ICAO code. To add one, drop the PDF in web/public/charts/<ICAO>/ and add a line
 * here. Only add charts that may be shared (for example the division's own charts): the official AIP of CAAP is
 * published to subscribers only. Airports without a line here show the links under CHART_SOURCES instead.
 */
export const AIRPORT_CHARTS: Readonly<Record<string, readonly AirportChart[]>> = {};

/** A website that publishes Philippine airport charts or airport information; the Charts search links to it. */
export interface ChartSource {
  readonly name: string;
  readonly description: string;
  readonly url: (icao: string) => string;
}

export const CHART_SOURCES: readonly ChartSource[] = [
  {
    name: 'CAAP eAIP (official)',
    description: 'The Philippine AIP of the Aeronautical Information Service. Needs a CAAP AIS account.',
    url: () => 'https://ais.caap.gov.ph/aip',
  },
  {
    name: 'Navigraph',
    description: 'Airport page with a chart preview. Full charts need a Navigraph subscription.',
    url: (icao) => `https://navigraph.com/airport/${icao}`,
  },
  {
    name: 'SkyVector',
    description: 'Airport information, runways and frequencies on a free map.',
    url: (icao) => `https://skyvector.com/airport/${icao}`,
  },
];
