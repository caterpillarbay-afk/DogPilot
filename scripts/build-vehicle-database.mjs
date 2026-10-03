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
// Plausibilitätsgrenzen für kWh/100 km – außerhalb davon sind es Meldefehler in den Rohdaten
const MIN_KWH100 = 8;
const MAX_KWH100 = 40;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'vehicle-database.json');

// Grobe Normalisierung (Großschreibung, Leerzeichen) schon in SQL; die feinere
// Bereinigung und der Filter n >= MIN_COUNT folgen in JS (siehe cleanMarke/cleanModell),
// weil sich viele Schreibvarianten erst danach zu einem Modell zusammenfassen.
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

// Herstellernamen, die in den Rohdaten in mehreren Schreibweisen vorkommen
const MARKE_ALIAS = {
  'BMW I': 'BMW',
  'FIAT ABARTH': 'ABARTH',
  'DFSK SERES SOKON': 'DFSK',
  'GREAT WALL MOTOR COMPANY': 'GREAT WALL',
  'GREAT WALL MOTOR COMPANY LIMITED': 'GREAT WALL',
  'MERCEDES-BENZ AG': 'MERCEDES-BENZ',
  'MG ROEWE': 'MG',
  'MGROEWE': 'MG',
  'OPELVAUXHALL': 'OPEL',
  'VOLKSWAGEN VW': 'VOLKSWAGEN',
  'VOLKSWAGENVW': 'VOLKSWAGEN',
  'VW': 'VOLKSWAGEN',
  'ZHIDOU ZD ELARIS': 'ZHIDOU',
};

function squash(str){
  return String(str).replace(/\s+/g, ' ').trim();
}

function cleanMarke(mk){
  const m = squash(mk);
  return MARKE_ALIAS[m] || m;
}

function cleanModell(cn){
  return squash(
    squash(cn)
      .replace(/(\s*\/)+\s*$/, '')            // "ID3 PRO / /" → "ID3 PRO"
      .replace(/\s*\/\s*\/\s*/g, ' ')           // "MODEL Y / / RWD" → "MODEL Y RWD"
      .replace(/(\d)\s*KW\b/g, '$1 KW')         // "150KW" → "150 KW"
      .replace(/\bE[\s-]?TRON\b/g, 'E-TRON')     // "E TRON"/"ETRON" → "E-TRON"
      .replace(/\bID\.?\s*(\d|BUZZ)\b/g, 'ID.$1') // "ID3"/"ID 3"/"ID. 3" → "ID.3"
  );
}

// Varianten zusammenführen; Verbrauch nach Anzahl Datensätze gewichtet
const groups = new Map();
for (const r of rows) {
  const wh = Number(r.verbrauch_wh_km), n = Number(r.n);
  if (!Number.isFinite(wh) || wh <= 0 || !n) continue;
  const marke = cleanMarke(r.Mk), modell = cleanModell(r.Cn);
  if (!marke || !modell) continue;
  const key = `${marke}\u0000${modell}`;
  const g = groups.get(key) || { marke, modell, whSum: 0, n: 0 };
  g.whSum += wh * n; g.n += n;
  groups.set(key, g);
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
const vehicles = [...groups.values()]
  .filter(g => g.n >= MIN_COUNT)
  .map(g => ({
    marke: g.marke,
    modell: g.modell,
    verbrauchKWh100: Math.round(g.whSum / g.n) / 10, // Wh/km ÷ 10, auf 0,1 gerundet
  }))
  .filter(v => v.verbrauchKWh100 >= MIN_KWH100 && v.verbrauchKWh100 <= MAX_KWH100)
  .sort((a, b) => collator.compare(a.marke, b.marke) || collator.compare(a.modell, b.modell));

if (!vehicles.length) throw new Error('Keine Fahrzeuge erhalten – Abfrage/Tabelle prüfen.');

await writeFile(OUT, JSON.stringify(vehicles, null, 2) + '\n');
console.log(`${vehicles.length} Modelle → ${OUT}`);
