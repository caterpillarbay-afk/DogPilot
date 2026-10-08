// Fahrt berechnen: Route → Wetter/Höhenprofil → Energieprofil → Ladestopps → Gassi-Pausen → Zeitplan

import { RouteLine } from './geo.js';
import { EnergyProfile, temperatureFactor, trafficFactor } from './energy.js';
import { findHubs, attachRestAreas, planTrip, schedule, detourOf, isOppositeSide } from './planner.js';
import { dogScore, humanScore } from './data.js';
import { getRoute, getHeights, getTemperature } from './services.js';

const MAX_DRIVE_MIN = 150;   // spätestens nach 2,5 h Fahrt eine Pause für den Hund
const BREAK_MIN = 15;
const BREAK_CORRIDOR_KM = 1;

export function settingsForPlanner(settings, startSoc) {
  const v = settings.vehicle, c = settings.charging;
  return {
    capacityKWh: v.capacityKWh, carMaxKw: v.carMaxKw, baseKWh100: v.consumptionKWh100, startSoc,
    reserveSoc: c.reserveSoc, arrivalSoc: c.arrivalSoc, maxChargeSoc: c.maxChargeSoc,
    minChargerKw: c.minChargerKw, fallbackMinKw: 22, corridorKm: c.corridorKm, minBreakMin: c.minBreakMin,
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

// Zwischen zwei Stopps, die mehr als 2,5 h auseinanderliegen, die hundefreundlichste Rastanlage einfügen
function addDogBreaks(stops, line, durationMin, areas) {
  const minPerKm = durationMin / line.lengthKm;
  const maxKm = MAX_DRIVE_MIN / minPerKm;
  const result = [];
  let pos = 0;
  const marks = [...stops.map(s => s.alongKm), line.lengthKm];
  let i = 0;
  for (let guard = 0; guard < 80 && i < marks.length; guard++) {
    const next = marks[i];
    if (next - pos <= maxKm) {
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
      chargeMin: 0, stopMin: BREAK_MIN, detour: detourOf(pick), operators: [],
    });
    pos = pick.alongKm;
  }
  return result;
}

function socAt(plan, stops, energy, s, km) {
  let soc = s.startSoc, pos = 0;
  for (const st of stops) {
    if (st.kind === 'break' || st.alongKm > km) continue;
    soc = st.targetSoc; pos = st.alongKm;
  }
  return Math.round(soc - energy.between(pos, km) / s.capacityKWh * 100);
}

export async function computeTrip({ from, to, departure, startSoc, settings, chargers, restAreas, onProgress = () => {} }) {
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

  onProgress('Ladestopps werden geplant …');
  const s = settingsForPlanner(settings, startSoc);
  const factor = temperatureFactor(temperature) * trafficFactor(route.trafficDelayMin, route.durationMin);
  const energy = new EnergyProfile({ lengthKm: line.lengthKm, baseKWh100: s.baseKWh100, factor, heights });
  const hubs = attachRestAreas(findHubs(line, chargers, { corridorKm: s.corridorKm, minKw: s.minChargerKw }), restAreas, line);
  const fallbackHubs = attachRestAreas(
    findHubs(line, chargers, { corridorKm: s.corridorKm, minKw: s.fallbackMinKw }).filter(h => h.maxKw < s.minChargerKw), restAreas, line);
  const plan = planTrip({ route: line, energy, hubs, fallbackHubs, settings: s });

  const chargeStops = plan.stops.map(st => ({ ...st, kind: 'charge' }));
  const stops = addDogBreaks(chargeStops, line, route.durationMin, restAreasAlong(line, restAreas));
  for (const st of stops) if (st.kind === 'break') st.arriveSoc = socAt(plan, stops, energy, s, st.alongKm);
  const timed = schedule({ plan: { stops }, lengthKm: line.lengthKm, durationMin: route.durationMin, departure });

  return {
    from, to, departure: departure.toISOString(), startSoc,
    provider: route.provider,
    points: route.points,
    lengthKm: route.lengthKm,
    driveMin: route.durationMin,
    trafficDelayMin: route.trafficDelayMin,
    temperature,
    climbM: heights ? Math.round(energy.climbM) : null,
    energyKWh: energy.totalKWh,
    consumptionKWh100: energy.totalKWh / line.lengthKm * 100,
    hubsOnRoute: hubs.length,
    stops: timed.stops.map(st => ({ ...st, arriveAt: st.arriveAt.toISOString(), departAt: st.departAt.toISOString() })),
    arrivalAt: timed.arrivalAt.toISOString(),
    totalMin: timed.totalMin,
    arrivalSoc: plan.arrivalSoc,
    warnings: plan.warnings,
    feasible: plan.feasible,
  };
}
