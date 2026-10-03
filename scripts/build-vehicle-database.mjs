#!/usr/bin/env node
// Erzeugt vehicle-database.json aus den offenen EEA-CO2-Monitoringdaten (Discodata).
// Quelle: https://discodata.eea.europa.eu – Tabelle [CO2Emission].[latest].[co2cars_2023Fv28]
// Aufruf (Node >= 18, keine Abhängigkeiten):  node scripts/build-vehicle-database.mjs
// Ausgabe: vehicle-database.json im Repo-Root (neben index.html)

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ENDPOINT = 'https://discodata.eea.europa.eu/sql';
const PAGE_SIZE = 1000;
const MIN_COUNT = 5;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'vehicle-database.json');

// Marke/Modell werden normalisiert (Großschreibung, Leerzeichen getrimmt), damit
// Schreibvarianten wie "Tesla"/"TESLA " nicht als getrennte Einträge zählen.
// ORDER BY sorgt für stabile Paginierung.
const QUERY = `
SELECT UPPER(LTRIM(RTRIM(Mk))) AS Mk,
       UPPER(LTRIM(RTRIM(Cn))) AS Cn,
       AVG(CAST([z (Wh/km)] AS FLOAT)) AS verbrauch_wh_km,
       COUNT(*) AS n
FROM [CO2Emission].[latest].[co2cars_2023Fv28]
WHERE Ft = 'electric' AND [z (Wh/km)] IS NOT NULL
  AND Mk IS NOT NULL AND Cn IS NOT NULL
GROUP BY UPPER(LTRIM(RTRIM(Mk))), UPPER(LTRIM(RTRIM(Cn)))
HAVING COUNT(*) >= ${MIN_COUNT}
ORDER BY Mk, Cn`;

async function fetchPage(p) {
  const url = `${ENDPOINT}?query=${encodeURIComponent(QUERY)}&p=${p}&nrOfHits=${PAGE_SIZE}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const body = await res.json();
      if (body.errors) throw new Error(JSON.stringify(body.errors));
      return body.results ?? [];
    } catch (err) {
      if (attempt >= 4) throw err;
      const wait = 2 ** attempt * 1000;
      console.warn(`Seite ${p}: ${err.message} – neuer Versuch in ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

const rows = [];
for (let p = 1; ; p++) {
  const page = await fetchPage(p);
  rows.push(...page);
  console.log(`Seite ${p}: ${page.length} Zeilen`);
  if (page.length < PAGE_SIZE) break;
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
const vehicles = rows
  .filter(r => Number(r.n) >= MIN_COUNT && Number.isFinite(Number(r.verbrauch_wh_km)) && Number(r.verbrauch_wh_km) > 0)
  .map(r => ({
    marke: String(r.Mk).trim(),
    modell: String(r.Cn).trim(),
    verbrauchKWh100: Math.round(Number(r.verbrauch_wh_km)) / 10, // Wh/km ÷ 10, auf 0,1 gerundet
  }))
  .sort((a, b) => collator.compare(a.marke, b.marke) || collator.compare(a.modell, b.modell));

if (!vehicles.length) throw new Error('Keine Fahrzeuge erhalten – Abfrage/Tabelle prüfen.');

await writeFile(OUT, JSON.stringify(vehicles, null, 2) + '\n');
console.log(`${vehicles.length} Modelle → ${OUT}`);
