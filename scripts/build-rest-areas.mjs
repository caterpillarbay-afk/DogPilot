#!/usr/bin/env node
// Erzeugt rest-areas.json aus OpenStreetMap: alle Rastanlagen und Rastplätze in Deutschland samt
// Ausstattung im Umkreis – für Mensch (WC, Essen, Shop) und Hund (Hundewiese, Park, Wald, Wiese,
// Picknickplatz, Trinkwasser).
//
// Eingabe: GeoJSON-Sequenz, erzeugt aus dem Geofabrik-Deutschland-Extrakt mit osmium
// (siehe .github/workflows/rest-areas.yml):
//   osmium tags-filter germany-latest.osm.pbf <Filter> -o filtered.osm.pbf
//   osmium export filtered.osm.pbf -f geojsonseq -o features.geojsonseq
// Aufruf (Node >= 18, keine Abhängigkeiten):  node scripts/build-rest-areas.mjs features.geojsonseq
// Ausgabe: rest-areas.json im Repo-Root. Daten © OpenStreetMap-Mitwirkende, ODbL.

import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'rest-areas.json');
const INPUT = process.argv[2];
const AMENITY_RADIUS_M = 250; // Einrichtungen, die zur Anlage selbst gehören
const GREEN_RADIUS_M = 600;   // Grün und Hundewiesen in Gassi-Entfernung
const M_PER_DEG = 111320;

// Ausstattungs-Bits (gleiche Reihenfolge wie FEATURES in js/data.js der App)
const F = {
  toilets: 1, food: 2, shop: 4, fuel: 8, water: 16, picnic: 32,
  playground: 64, dogPark: 128, park: 256, forest: 512, meadow: 1024,
};

function distM(a, b) {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad, dLon = (b[1] - a[1]) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Einrichtungen (Punkt, kleiner Radius) und Grünflächen (Umriss-Rechteck, großer Radius)
function featureOf(t) {
  const a = t.amenity, l = t.leisure, lu = t.landuse, n = t.natural;
  if (a === 'toilets') return [F.toilets, AMENITY_RADIUS_M];
  if (a === 'restaurant' || a === 'fast_food' || a === 'cafe') return [F.food, AMENITY_RADIUS_M];
  if (a === 'fuel') return [F.fuel, AMENITY_RADIUS_M];
  if (a === 'drinking_water') return [F.water, AMENITY_RADIUS_M];
  if (t.shop === 'convenience' || t.shop === 'kiosk') return [F.shop, AMENITY_RADIUS_M];
  if (l === 'picnic_table' || t.tourism === 'picnic_site') return [F.picnic, AMENITY_RADIUS_M];
  if (l === 'playground') return [F.playground, AMENITY_RADIUS_M];
  if (l === 'dog_park') return [F.dogPark, GREEN_RADIUS_M];
  if (l === 'park' || lu === 'recreation_ground') return [F.park, GREEN_RADIUS_M];
  if (lu === 'forest' || n === 'wood') return [F.forest, GREEN_RADIUS_M];
  if (lu === 'meadow' || n === 'grassland' || n === 'heath') return [F.meadow, GREEN_RADIUS_M];
  return null;
}

// Ausstattung, die direkt an der Anlage getaggt ist
function ownFlags(t) {
  let f = 0;
  if (t.toilets === 'yes') f |= F.toilets;
  if (t.drinking_water === 'yes') f |= F.water;
  if (t.picnic_table === 'yes') f |= F.picnic;
  if (t.fuel === 'yes') f |= F.fuel;
  return f;
}

// Umriss-Rechteck einer GeoJSON-Geometrie: [minLat, minLon, maxLat, maxLon]
function bbox(geometry) {
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  const walk = c => {
    if (typeof c[0] === 'number') {
      if (c[1] < minLat) minLat = c[1];
      if (c[1] > maxLat) maxLat = c[1];
      if (c[0] < minLon) minLon = c[0];
      if (c[0] > maxLon) maxLon = c[0];
    } else for (const x of c) walk(x);
  };
  walk(geometry.coordinates);
  return minLat === Infinity ? null : [minLat, minLon, maxLat, maxLon];
}

if (!INPUT) throw new Error('Aufruf: node scripts/build-rest-areas.mjs features.geojsonseq');

const areas = [], items = [];
let lines = 0;
const rl = createInterface({ input: createReadStream(INPUT), crlfDelay: Infinity });
for await (let line of rl) {
  line = line.replace(/^\x1e/, '').trim();   // GeoJSON-Sequenz: optionales Record-Separator-Zeichen
  if (!line) continue;
  lines++;
  const feat = JSON.parse(line);
  const t = feat.properties || {};
  const b = feat.geometry && bbox(feat.geometry);
  if (!b) continue;
  const center = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  if (t.highway === 'services' || t.highway === 'rest_area') {
    const name = (t.name || '').trim();
    areas.push({
      p: center, flags: ownFlags(t), name,
      services: t.highway === 'services',
      autohof: /autohof|truck ?stop/i.test(name),
    });
    continue;
  }
  const f = featureOf(t);
  if (f) items.push({ b, bit: f[0], radius: f[1] });
}
console.log(`${lines} Objekte gelesen: ${areas.length} Anlagen, ${items.length} Einrichtungen/Grünflächen`);
if (areas.length < 500) throw new Error(`Nur ${areas.length} Anlagen – Eingabe unvollständig?`);

// Raster-Index der Anlagen (0,05°), damit jede Einrichtung nur Anlagen in ihrer Nähe prüft
const CELL = 0.05;
const grid = new Map();
for (const a of areas) {
  const k = `${Math.floor(a.p[0] / CELL)}:${Math.floor(a.p[1] / CELL)}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(a);
}
for (const it of items) {
  const [minLat, minLon, maxLat, maxLon] = it.b;
  const padLat = it.radius / M_PER_DEG, padLon = padLat / Math.cos(minLat * Math.PI / 180);
  const i0 = Math.floor((minLat - padLat) / CELL), i1 = Math.floor((maxLat + padLat) / CELL);
  const j0 = Math.floor((minLon - padLon) / CELL), j1 = Math.floor((maxLon + padLon) / CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    for (const a of grid.get(`${i}:${j}`) || []) {
      if (a.flags & it.bit) continue;
      // Abstand zum Umriss-Rechteck (0 innerhalb); bei Punkten ist das Rechteck der Punkt selbst
      const q = [Math.min(maxLat, Math.max(minLat, a.p[0])), Math.min(maxLon, Math.max(minLon, a.p[1]))];
      if (distM(a.p, q) <= it.radius) a.flags |= it.bit;
    }
  }
}

// Doppelte Objekte (gleicher Name, < 80 m) zusammenfassen
const merged = [];
const byName = new Map();
for (const a of areas) {
  const same = byName.get(a.name) || [];
  const dup = same.find(m => distM(m.p, a.p) < 80);
  if (dup) { dup.flags |= a.flags; continue; }
  same.push(a);
  byName.set(a.name, same);
  merged.push(a);
}

const names = [...new Set(merged.map(a => a.name))].sort();
const nIdx = new Map(names.map((n, i) => [n, i]));
const round5 = x => Math.round(x * 1e5) / 1e5;
const data = {
  quelle: 'OpenStreetMap (Geofabrik-Extrakt Deutschland), © OpenStreetMap-Mitwirkende, ODbL',
  stand: new Date().toISOString().slice(0, 10),
  felder: ['lat', 'lon', 'nameIndex', 'typ (0=Rastplatz, 1=Rastanlage, 2=Autohof)', 'ausstattungBits'],
  ausstattungBits: F,
  namen: names,
  punkte: merged.map(a => [round5(a.p[0]), round5(a.p[1]), nIdx.get(a.name), a.autohof ? 2 : a.services ? 1 : 0, a.flags]),
};
const json = JSON.stringify(data);
await writeFile(OUT, json + '\n');
const count = bit => merged.filter(a => a.flags & bit).length;
console.log(`${merged.length} Rastanlagen, davon mit WC ${count(F.toilets)}, Essen ${count(F.food)}, Grün/Hund ${count(F.dogPark | F.park | F.forest | F.meadow)}, ${(json.length / 1e6).toFixed(2)} MB → ${OUT}`);
