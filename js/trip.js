// Fahrt berechnen: Route → Wetter/Höhenprofil → Energieprofil → Ladestopps → Gassi-Pausen → Zeitplan

import { RouteLine } from './geo.js';
import { EnergyProfile, temperatureFactor, trafficFactor } from './energy.js';
import { findHubs, attachRestAreas, planTrip, schedule, detourOf, isOppositeSide, FINAL_LEG_TOLERANCE } from './planner.js';
import { dogScore, humanScore } from './data.js';
import { getRoute, getHeights, getTemperature } from './services.js';

const DEFAULT_MAX_DRIVE_MIN = 120;  // spätestens nach 2 h Fahrt eine Pause für die Hunde
// Beladung relativ zum eingetragenen Verbrauch (normal beladen, übliches Autobahntempo):
// Dachbox ≈ +12 % Luftwiderstand; voll beladen (Dachbox, Kofferraum, Rückbank, 2 Personen, Hunde) ≈ +20 %
export const LOAD_FACTORS = { normal: 1, roof: 1.12, full: 1.2 };
const BREAK_CORRIDOR_KM = 1;

// Zeitpuffer für „Ankunft bis …“: Anteil der Fahrzeit (Stau, Baustellen) plus Minuten je Ladestopp
// (besetzte oder gestörte Säule, längere Gassi-Runde). „custom“: feste Minuten vom Nutzer.
export const BUFFER_PRESETS = { tight: { share: 0.05, perStop: 5 }, normal: { share: 0.10, perStop: 10 }, generous: { share: 0.20, perStop: 15 } };
export function bufferMinutes(kind, driveMin, chargeStops, customMin = 45) {
  if (kind === 'custom') return Math.max(0, Math.round(customMin));
  const p = BUFFER_PRESETS[kind] || BUFFER_PRESETS.normal;
  return Math.round((driveMin * p.share + chargeStops * p.perStop) / 5) * 5;
}

export function settingsForPlanner(settings, startSoc) {
  const v = settings.vehicle, c = settings.charging;
  return {
    capacityKWh: v.capacityKWh, carMaxKw: v.carMaxKw, baseKWh100: v.consumptionKWh100, startSoc,
    reserveSoc: c.reserveSoc, arrivalSoc: c.arrivalSoc, maxChargeSoc: c.maxChargeSoc,
    minChargerKw: c.minChargerKw, fallbackMinKw: 22, corridorKm: c.corridorKm, minBreakMin: c.minBreakMin,
    maxDriveMin: c.maxDriveMin || DEFAULT_MAX_DRIVE_MIN,
  };
}

// Rastanlagen entlang der Route (für Gassi-Pausen ohne Laden)
function restAreasAlong(line, restAreas) {
  const out = [];
  for (const r of restAreas) {
    const p = line.project(r.lat, r.lon, BREAK_CORRIDOR_KM);
    if (p && !isOppositeSide(line, r)) out.push({ ...r, ...p, dog: dogScore(r.flags), human: humanScore(r.flags) });
  }
  return out.sort((a, b) => a.alongKm - b.alongKm);
}

// Wo trotzdem länger als die eingestellte Fahrzeit ohne Stopp gefahren würde (keine passende Säule),
// die hundefreundlichste Rastanlage als Gassi-Pause ohne Laden einfügen
function addDogBreaks(stops, line, durationMin, areas, maxDriveMin, breakMin) {
  const minPerKm = durationMin / line.lengthKm;
  const maxKm = maxDriveMin / minPerKm;
  const result = [];
  let pos = 0;
  const marks = [...stops.map(s => s.alongKm), line.lengthKm];
  let i = 0;
  for (let guard = 0; guard < 80 && i < marks.length; guard++) {
    const next = marks[i];
    // Letzter Abschnitt bis zum Ziel: kleine Überschreitung erlaubt (wie im Planer)
    if (next - pos <= maxKm * (i === stops.length ? FINAL_LEG_TOLERANCE : 1)) {
      if (i < stops.length) result.push(stops[i]);
      pos = next; i++;
      continue;
    }
    // Fenster: frühestens nach 60 % der Maximalstrecke, spätestens bei der Maximalstrecke
    const cands = areas.filter(a => a.alongKm > pos + maxKm * 0.6 && a.alongKm <= pos + maxKm);
    const pick = cands.length
      ? cands.reduce((b, a) => (a.dog - detourOf(a).km * 0.1) > (b.dog - detourOf(b).km * 0.1) ? a : b)
      : null;
    if (!pick) { if (i < stops.length) result.push(stops[i]); pos = next; i++; continue; }
    result.push({
      kind: 'break', lat: pick.lat, lon: pick.lon, alongKm: pick.alongKm, offsetKm: pick.offsetKm,
      name: pick.name || 'Rastplatz', restArea: pick, dog: pick.dog, human: pick.human,
      chargeMin: 0, stopMin: breakMin, detour: detourOf(pick), operators: [],
    });
    pos = pick.alongKm;
  }
  return result;
}

function socAt(stops, energy, s, km) {
  let soc = s.startSoc, pos = 0;
  for (const st of stops) {
    if (st.kind === 'break' || st.alongKm > km) continue;
    soc = st.targetSoc; pos = st.alongKm;
  }
  return Math.round(soc - energy.between(pos, km) / s.capacityKWh * 100);
}

// Teil 1: alles, was Netz braucht (Route, Höhen, Wetter) und die Ladesäulen entlang der Route.
// Das Ergebnis bleibt im Speicher, damit ein Wechsel auf eine Alternative ohne neue Abfragen geht.
export async function prepareTrip({ from, to, departure, arriveBy = null, bufferMin = null, startSoc, load = 'normal', settings, chargers, restAreas, sites = [], onProgress = () => {} }) {
  onProgress('Route wird berechnet …');
  const route = await getRoute(from, to, { tomtomKey: settings.keys.tomtom });
  const line = new RouteLine(route.points);

  onProgress('Wetter und Höhenprofil werden abgerufen …');
  const mid = line.pointAt(line.lengthKm / 2);
  const at = f => new Date(departure.getTime() + route.durationMin * f * 60000);
  const [heights, temperature] = await Promise.all([
    getHeights(route.points),
    getTemperature([
      { lat: from.lat, lon: from.lon, at: at(0) },
      { lat: mid[0], lon: mid[1], at: at(0.5) },
      { lat: to.lat, lon: to.lon, at: at(1) },
    ]),
  ]);

  const s = settingsForPlanner(settings, startSoc);
  s.maxDriveKm = s.maxDriveMin / (route.durationMin / line.lengthKm);
  // Linienlänge und Streckenlänge des Routendienstes weichen leicht ab: Verbrauch und angezeigte
  // Kilometer auf die offizielle Streckenlänge beziehen
  const kmScale = Math.min(1.25, Math.max(0.8, route.lengthKm / line.lengthKm));
  const factor = kmScale * temperatureFactor(temperature) * trafficFactor(route.trafficDelayMin, route.durationMin) * (LOAD_FACTORS[load] || 1);
  const energy = new EnergyProfile({ lengthKm: line.lengthKm, baseKWh100: s.baseKWh100, factor, heights });
  const hubs = attachRestAreas(findHubs(line, chargers, { corridorKm: s.corridorKm, minKw: s.minChargerKw }), restAreas, line, sites);
  const fallbackHubs = attachRestAreas(
    findHubs(line, chargers, { corridorKm: s.corridorKm, minKw: s.fallbackMinKw }).filter(h => h.maxKw < s.minChargerKw), restAreas, line, sites);
  return { from, to, departure, arriveBy, bufferMin, startSoc, load, route, line, heights, temperature, s, kmScale, energy, hubs, fallbackHubs, areas: restAreasAlong(line, restAreas) };
}

// Teil 2: Stopps planen. forced: { [Nummer des Ladestopps]: hubKey } – vom Nutzer gewählte Alternativen
export function planFromContext(ctx, forced = {}) {
  const { from, to, departure, arriveBy, bufferMin, startSoc, load, route, line, heights, temperature, s, kmScale, energy, hubs, fallbackHubs, areas } = ctx;
  const plan = planTrip({ route: line, energy, hubs, fallbackHubs, settings: s, forced });

  const chargeStops = plan.stops.map(st => ({ ...st, kind: 'charge' }));
  const stops = addDogBreaks(chargeStops, line, route.durationMin, areas, s.maxDriveMin, s.minBreakMin);
  for (const st of stops) if (st.kind === 'break') st.arriveSoc = socAt(stops, energy, s, st.alongKm);
  const timed = schedule({ plan: { stops }, lengthKm: line.lengthKm, durationMin: route.durationMin, departure });

  return {
    from, to, departure: departure.toISOString(), startSoc, load,
    arriveBy: arriveBy ? arriveBy.toISOString() : null, bufferMin,
    provider: route.provider,
    points: route.points,
    roads: route.roads || [],
    lengthKm: route.lengthKm,
    driveMin: route.durationMin,
    trafficDelayMin: route.trafficDelayMin,
    temperature,
    climbM: heights ? Math.round(energy.climbM) : null,
    energyKWh: energy.totalKWh,
    consumptionKWh100: energy.totalKWh / route.lengthKm * 100,
    hubsOnRoute: hubs.length,
    stops: timed.stops.map(st => ({
      ...st, alongKm: st.alongKm * kmScale, arriveAt: st.arriveAt.toISOString(), departAt: st.departAt.toISOString(),
      alternatives: st.alternatives?.map(a => ({ ...a, shiftKm: a.shiftKm * kmScale })),
    })),
    forced,
    arrivalAt: timed.arrivalAt.toISOString(),
    totalMin: timed.totalMin,
    arrivalSoc: plan.arrivalSoc,
    warnings: plan.warnings,
    feasible: plan.feasible,
  };
}

export async function computeTrip(args) {
  const ctx = await prepareTrip(args);
  args.onProgress?.('Ladestopps werden geplant …');
  return { ctx, trip: planFromContext(ctx, args.forced) };
}
