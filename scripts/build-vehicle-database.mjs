#!/usr/bin/env node
// Erzeugt vehicle-database.json aus den offenen EEA-CO2-Monitoringdaten (Discodata).
// Quelle: https://discodata.eea.europa.eu – Datenbank [CO2Emission], Schema [latest].
// Die neueste Tabelle co2cars_<Jahr><F|P>v<Version> wird durch Ausprobieren gefunden
// (Discodata erlaubt keine Abfrage der Tabellenliste). Bevorzugt werden endgültige Daten "F"
// (von der EEA geprüft) des neuesten Jahres; vorläufige "P" nur, wenn keine F-Tabelle nutzbar ist.
// Innerhalb eines Jahres gilt die höchste Version. Zuletzt FALLBACK_TABLE.
// Aufruf (Node >= 18, keine Abhängigkeiten):  node scripts/build-vehicle-database.mjs
// Ausgabe: vehicle-database.json im Repo-Root (neben index.html)

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ENDPOINT = 'https://discodata.eea.europa.eu/sql';
const FALLBACK_TABLE = 'co2cars_2023Fv28';
const FALLBACK_YEAR = 2023;
const MAX_TABLE_VERSION = 60;
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
const vehicleQuery = table => `
SELECT UPPER(LTRIM(RTRIM(Mk))) AS Mk,
       UPPER(LTRIM(RTRIM(Cn))) AS Cn,
       AVG(CAST([z (Wh/km)] AS FLOAT)) AS verbrauch_wh_km,
       COUNT(*) AS n
FROM [CO2Emission].[latest].[${table}]
WHERE Ft = 'electric' AND [z (Wh/km)] IS NOT NULL
  AND Mk IS NOT NULL AND Cn IS NOT NULL
GROUP BY UPPER(LTRIM(RTRIM(Mk))), UPPER(LTRIM(RTRIM(Cn)))
ORDER BY Mk, Cn`;

async function fetchPage(query, p) {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&p=${p}&nrOfHits=${PAGE_SIZE}`;
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

async function fetchAll(query) {
  const rows = [];
  for (let p = 1; ; p++) {
    const page = await fetchPage(query, p);
    rows.push(...page);
    console.log(`Seite ${p}: ${page.length} Zeilen`);
    if (page.length < PAGE_SIZE) return rows;
  }
}

// Existiert die Tabelle? Einzelversuch ohne Wiederholung, Fehler = gibt es nicht.
async function tableExists(table) {
  const query = `SELECT TOP 1 Mk FROM [CO2Emission].[latest].[${table}]`;
  try {
    const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}&p=1&nrOfHits=1`);
    if (!res.ok) return false;
    const body = await res.json();
    return !body.errors && Array.isArray(body.results);
  } catch {
    return false;
  }
}

// Höchste vorhandene Version einer Jahr/Status-Kombination (10 Anfragen parallel)
async function newestVersion(year, status) {
  for (let hi = MAX_TABLE_VERSION; hi >= 1; hi -= 10) {
    const names = [];
    for (let v = hi; v > hi - 10 && v >= 1; v--) names.push(`co2cars_${year}${status}v${v}`);
    const found = await Promise.all(names.map(tableExists));
    const idx = found.indexOf(true);
    if (idx >= 0) return names[idx];
  }
  return null;
}

async function candidateTables() {
  const final = [], provisional = [];
  for (let year = new Date().getFullYear(); year > FALLBACK_YEAR; year--) {
    const f = await newestVersion(year, 'F');
    const p = await newestVersion(year, 'P');
    if (f) { console.log(`Gefunden: ${f}`); final.push(f); }
    if (p) { console.log(`Gefunden: ${p}`); provisional.push(p); }
  }
  return [...final, FALLBACK_TABLE, ...provisional];
}

let rows = [], sourceTable = null;
for (const table of await candidateTables()) {
  console.log(`Versuche Tabelle ${table} …`);
  try {
    rows = await fetchAll(vehicleQuery(table));
  } catch (err) {
    console.warn(`${table}: ${err.message}`);
    continue;
  }
  if (rows.length) { sourceTable = table; break; }
  console.warn(`${table}: keine Elektro-Einträge`);
}
if (!sourceTable) throw new Error('Keine nutzbare EEA-Tabelle gefunden.');
console.log(`Quelle: ${sourceTable}`);

// Herstellernamen kommen in vielen Schreibweisen vor ("MERCEDES - BENZ", "B M W",
// "LYNK&AMPCO", "VOLKSWAGEN. VW" …). Verglichen wird ohne Satz- und Leerzeichen.
const MARKE_RULES = [
  [/^ABARTH|^FIATABARTH/, 'ABARTH'],
  [/^AION|^GACAION/, 'AION'],
  [/^BMW/, 'BMW'],
  [/^CHERY/, 'CHERY'],
  [/^DFSK/, 'DFSK'],
  [/^DONGFENG|^DFM$/, 'DONGFENG'],
  [/^DS(AUTOMOBILES)?$/, 'DS'],
  [/^GREATWALL/, 'GREAT WALL'],
  [/^HYUNDAIGENESIS|^GENESIS/, 'GENESIS'],
  [/^KG(M|MOBILITY)$/, 'KGM'],
  [/^LOTUS/, 'LOTUS'],
  [/^LYNK/, 'LYNK & CO'],
  [/^MERCEDES/, 'MERCEDES-BENZ'],
  [/^MG/, 'MG'],
  [/^OPEL/, 'OPEL'],
  [/^SHINERAY/, 'SHINERAY'],
  [/^SSANGYONG/, 'SSANGYONG'],
  [/^(VOLKSWAGEN|VW$)/, 'VOLKSWAGEN'],
  [/^ZEEKR/, 'ZEEKR'],
  [/^ZHIDOU/, 'ZHIDOU'],
];

function squash(str){
  return String(str).replace(/\s+/g, ' ').trim();
}

function cleanMarke(mk){
  const m = squash(String(mk).replace(/&AMP;?/g, '&'));
  const key = m.replace(/[^A-Z0-9&]/g, '');
  const rule = MARKE_RULES.find(([re]) => re.test(key));
  return rule ? rule[1] : m.replace(/[\s,.-]+$/, '');
}

function cleanModell(cn){
  return squash(
    squash(cn)
      .replace(/(\s*\/)+\s*$/, '')            // "ID3 PRO / /" → "ID3 PRO"
      .replace(/\s*\/\s*\/\s*/g, ' ')           // "MODEL Y / / RWD" → "MODEL Y RWD"
      .replace(/(\d)\s*KW\b/g, '$1 KW')         // "150KW" → "150 KW"
      .replace(/\bE[\s-]?TRON\b/g, 'E-TRON')     // "E TRON"/"ETRON" → "E-TRON"
      .replace(/\bID\.?\s*(\d|BUZZ)(?=[A-Z])/g, 'ID.$1 ') // "ID3PRO" → "ID.3 PRO"
      .replace(/\bID\.?\s*(\d|BUZZ)\b/g, 'ID.$1') // "ID3"/"ID 3"/"ID. 3" → "ID.3"
      .replace(/([A-Z])(\d+ KW)\b/g, '$1 $2')     // "PRO107 KW" → "PRO 107 KW"
      .replace(/^UP\s*!?$/, 'UP!')                // "UP"/"UP !" → "UP!"
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
console.log(`${vehicles.length} Modelle aus ${sourceTable} → ${OUT}`);
