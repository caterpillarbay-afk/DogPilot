#!/usr/bin/env node
// Erzeugt vehicle-specs.json (nutzbare Akku-Kapazität und max. DC-Ladeleistung je Fahrzeugvariante)
// aus Open EV Data: https://github.com/KilowattApp/open-ev-data – MIT-Lizenz mit Namensnennung.
// Aufruf (Node >= 18, keine Abhängigkeiten):  node scripts/build-vehicle-specs.mjs <pfad/zu/ev-data.json>
// Ausgabe: vehicle-specs.json im Repo-Root (neben index.html)

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'vehicle-specs.json');
const MIN_ENTRIES = 300;

const src = process.argv[2];
if (!src) { console.error('Pfad zu ev-data.json fehlt'); process.exit(1); }
const raw = JSON.parse(await readFile(src, 'utf8'));
const list = Array.isArray(raw) ? raw : raw.data;

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const round1 = n => Math.round(n * 10) / 10;
const seen = new Set();
const out = [];
for (const v of list) {
  if (v.vehicle_type && v.vehicle_type !== 'car') continue;
  const akku = Number(v.usable_battery_size), dc = Number(v.dc_charger?.max_power);
  if (!(akku >= 10 && akku <= 250) || !(dc >= 20 && dc <= 500)) continue;
  const marke = clean(v.brand).replace(/\s*\/.*$/, '');   // "Opel / Vauxhall" → "Opel"
  const variant = clean(v.variant);
  const modell = clean(variant && !clean(v.model).includes(variant) ? `${v.model} ${variant}` : v.model);
  const jahr = Number(v.release_year) || null;
  const key = [marke, modell, jahr, akku, dc].join('|').toLowerCase();
  if (!marke || !modell || seen.has(key)) continue;
  seen.add(key);
  out.push({ marke, modell, jahr, akkuKWh: round1(akku), dcKw: Math.round(dc) });
}
out.sort((a, b) => a.marke.localeCompare(b.marke, 'de') || a.modell.localeCompare(b.modell, 'de', { numeric: true }) || (a.jahr || 0) - (b.jahr || 0));
if (out.length < MIN_ENTRIES) { console.error(`Nur ${out.length} Einträge – Quelle unvollständig, nichts geschrieben`); process.exit(1); }
await writeFile(OUT, JSON.stringify({ quelle: 'Open EV Data (https://github.com/KilowattApp/open-ev-data)', lizenz: 'MIT mit Namensnennung', fahrzeuge: out }) + '\n');
console.log(`${out.length} Varianten von ${new Set(out.map(v => v.marke)).size} Marken geschrieben`);
