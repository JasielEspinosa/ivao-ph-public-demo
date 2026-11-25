// Public demo only: downloads the Philippine NOTAMs from CAAP AIS into public/demo/notams.json.
//
// The demo has no backend, and the CAAP service sends no CORS headers, so the browser cannot read it directly.
// The deploy workflow runs this script before every build, so each deploy shows the NOTAMs of that moment.
// When the download fails, the snapshot already in public/demo/notams.json is kept and the script still succeeds.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CAAP_NOTAM_API = 'https://ais.caap.gov.ph/notam-admin/api/notams-lazy';
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const REQUEST_TIMEOUT_MS = 20000;
const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/demo/notams.json');

/** Only the fields the demo uses (the browser applies the backend's rules for drafts and ended NOTAMs). */
function toRow(row) {
  return {
    loc_indicator: row.loc_indicator ?? null,
    full_number: row.full_number ?? null,
    notam_type: row.notam_type ?? null,
    begin_effect: row.begin_effect ?? null,
    end_effect: row.end_effect ?? null,
    estperm: row.estperm ?? null,
    additional_txt: row.additional_txt ?? null,
    notam_code: row.notam_code ?? null,
    status: row.status ?? null,
    is_draft: row.is_draft ?? null,
  };
}

async function downloadAll() {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const query = new URLSearchParams({
      page: String(page),
      per_page: String(PAGE_SIZE),
      series: 'all',
      validity_type: 'all',
    });
    const response = await fetch(`${CAAP_NOTAM_API}?${query}`, {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`CAAP answered ${response.status}`);
    }
    const body = await response.json();
    if (body?.success !== true || !Array.isArray(body.notams)) {
      throw new Error('CAAP answered with an unexpected body');
    }
    all.push(...body.notams.map(toRow));
    if (body.pagination?.has_more !== true) {
      return all;
    }
  }
  throw new Error('CAAP listed more pages than expected');
}

try {
  const notams = await downloadAll();
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), notams })}\n`, 'utf8');
  console.log(`Saved ${notams.length} NOTAMs to ${OUTPUT}`);
} catch (error) {
  let hasSnapshot = true;
  try {
    await readFile(OUTPUT, 'utf8');
  } catch {
    hasSnapshot = false;
  }
  console.warn(`NOTAM download failed (${error.message}); ${hasSnapshot ? 'keeping the existing snapshot' : 'no snapshot exists'}.`);
}
