#!/usr/bin/env node
// Erzeugt charging-stations.json aus dem Ladesäulenregister der Bundesnetzagentur.
// Die Download-Adresse der CSV wechselt mit jeder Veröffentlichung, deshalb wird sie
// von der Übersichtsseite gelesen.
// Aufruf (Node >= 18, keine Abhängigkeiten):  node scripts/build-charging-stations.mjs
// Ausgabe: charging-stations.json im Repo-Root (neben index.html)

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PAGES = [
  'https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/Ladesaeulenkarte/start.html',
  'https://www.bundesnetzagentur.de/ladeinfrastruktur.html',
  'https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/start.html',
];
const MIN_KW = 11; // langsamere Ladepunkte (Wallboxen < 11 kW) sind für Reisen irrelevant
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'charging-stations.json');
const UA = { 'User-Agent': 'DogPilot-DataBuilder (+https://github.com/caterpillarbay-afk/DogPilot)' };

async function findCsvUrl() {
  for (const page of PAGES) {
    try {
      const res = await fetch(page, { headers: UA, redirect: 'follow' });
      console.log(`${page} → HTTP ${res.status}`);
      if (!res.ok) continue;
      const html = await res.text();
      const links = [...html.matchAll(/href="([^"]+)"/g)]
        .map(m => m[1].replace(/&amp;/g, '&'))
        .filter(h => /ladesaeulenregister/i.test(h));
      console.log(`  Links mit "Ladesaeulenregister": ${JSON.stringify(links)}`);
      const csv = links.find(h => /\.csv(\?|$)/i.test(h));
      if (csv) return new URL(csv, res.url).href;
    } catch (err) {
      console.warn(`${page}: ${err.message}`);
    }
  }
  throw new Error('Keine CSV-Adresse des Ladesäulenregisters gefunden.');
}

function num(s) {
  return parseFloat(String(s ?? '').replace(',', '.'));
}

// Gleiche Spalten wie parseChargingCSV() in index.html
function parse(text) {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex(l => l.replace(/^﻿/, '').startsWith('Ladeeinrichtungs-ID'));
  if (headerIdx < 0) throw new Error('Header "Ladeeinrichtungs-ID" nicht gefunden');
  const header = lines[headerIdx].replace(/^﻿/, '').split(';').map(c => c.trim());
  console.log(`Spalten: ${JSON.stringify(header)}`);
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  for (const name of ['Breitengrad', 'Längengrad', 'Nennleistung Ladeeinrichtung [kW]', 'Anzahl Ladepunkte', 'Betreiber']) {
    if (!(name in col)) throw new Error(`Spalte "${name}" fehlt`);
  }
  const out = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const r = lines[i].split(';');
    if (r.length < header.length || !r[0]) continue;
    const lat = num(r[col['Breitengrad']]), lon = num(r[col['Längengrad']]);
    const kw = num(r[col['Nennleistung Ladeeinrichtung [kW]']]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(kw) || kw < MIN_KW) continue;
    out.push({
      lat, lon, kw,
      n: parseInt(r[col['Anzahl Ladepunkte']] || '0', 10) || 0,
      betreiber: (r[col['Betreiber']] || '').trim(),
    });
  }
  return out;
}

const url = await findCsvUrl();
console.log(`CSV: ${url}`);
const res = await fetch(url, { headers: UA });
if (!res.ok) throw new Error(`Download fehlgeschlagen: HTTP ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
console.log(`Größe: ${(buf.length / 1e6).toFixed(1)} MB`);
// Die BNetzA liefert die CSV mal als UTF-8, mal als Windows-1252
let text = new TextDecoder('utf-8').decode(buf);
if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
const points = parse(text);
if (points.length < 1000) throw new Error(`Nur ${points.length} Ladepunkte – Datei unvollständig?`);

// Kompakt: Betreiber als Index in eine Namensliste, Koordinaten auf 5 Nachkommastellen (~1 m)
const betreiber = [...new Set(points.map(p => p.betreiber))].sort();
const bIdx = new Map(betreiber.map((b, i) => [b, i]));
const round5 = x => Math.round(x * 1e5) / 1e5;
const data = {
  quelle: url,
  stand: new Date().toISOString().slice(0, 10),
  felder: ['lat', 'lon', 'kw', 'anzahlLadepunkte', 'betreiberIndex'],
  betreiber,
  punkte: points.map(p => [round5(p.lat), round5(p.lon), p.kw, p.n, bIdx.get(p.betreiber)]),
};
const json = JSON.stringify(data);
await writeFile(OUT, json + '\n');
console.log(`${points.length} Ladepunkte (≥ ${MIN_KW} kW), ${betreiber.length} Betreiber, ${(json.length / 1e6).toFixed(2)} MB → ${OUT}`);
