// Reiseplanung: sucht Ladestopps entlang der echten Route, simuliert den Akkustand
// und wählt Stopps, die Laden, Hund und Mensch verbinden.

import { haversineKm } from './geo.js';
import { chargeMinutes } from './energy.js';
import { dogScore, humanScore, siteDogScore, siteHumanScore } from './data.js';

export const DEFAULT_PLAN_SETTINGS = {
  capacityKWh: 77,
  carMaxKw: 135,
  startSoc: 80,
  reserveSoc: 10,     // darunter wird unterwegs nicht gefahren
  arrivalSoc: 15,     // gewünschter Akkustand am Ziel
  maxChargeSoc: 80,   // höher wird unterwegs nicht geladen (langsam)
  minChargerKw: 150,  // Wunsch-Ladeleistung
  fallbackMinKw: 22,  // Notlösung, wenn keine schnelle Säule erreichbar ist
  corridorKm: 2,      // max. seitlicher Abstand zur Route
  minBreakMin: 15,    // Mindestpause für Hund und Mensch
  maxDriveKm: Infinity, // spätestens nach so vielen km eine Pause (aus der Fahrzeit berechnet)
  baseKWh100: 20,
};

const REST_AREA_RADIUS_KM = 0.7;
const HUB_MERGE_KM = 0.3;
const MIN_LEG_KM = 5;
export const hubKey = h => `${h.lat.toFixed(5)},${h.lon.toFixed(5)}`;
const ALT_MAX = 3;          // Alternativen je Ladestopp
const ALT_RANGE_KM = 15;    // nur Alternativen in der Nähe des gewählten Stopps (entlang der Route)
const LOW_START_MARGIN = 4;  // % Akku, die bei Abfahrt unter der Reserve bis zum ersten Ladestopp verbraucht werden dürfen
const OPPOSITE_CHECK_KM = 0.6;

// Ladepunkte entlang der Route zu Standorten ("Hubs") zusammenfassen
export function findHubs(route, chargers, { corridorKm, minKw }) {
  const near = [];
  for (const c of chargers) {
    if (c.kw < minKw) continue;
    const p = route.project(c.lat, c.lon, corridorKm);
    if (p) near.push({ ...c, ...p });
  }
  near.sort((a, b) => a.alongKm - b.alongKm);
  const hubs = [];
  for (const c of near) {
    const h = hubs.find(x => Math.abs(x.alongKm - c.alongKm) < 2 && haversineKm(x.lat, x.lon, c.lat, c.lon) < HUB_MERGE_KM);
    if (h) {
      h.points += c.points;
      h.operators.add(c.operator);
      if (c.kw > h.maxKw) Object.assign(h, { maxKw: c.kw, lat: c.lat, lon: c.lon, alongKm: c.alongKm, offsetKm: c.offsetKm });
    } else {
      hubs.push({ lat: c.lat, lon: c.lon, maxKw: c.kw, points: c.points, operators: new Set([c.operator]), alongKm: c.alongKm, offsetKm: c.offsetKm });
    }
  }
  return hubs;
}

// Rastanlage an der Autobahn auf der Gegenfahrbahn? (Rechtsverkehr: erreichbar ist nur die rechte Seite)
export function isOppositeSide(route, area) {
  if (!route || area.type === 'autohof') return false;
  const p = route.project(area.lat, area.lon, OPPOSITE_CHECK_KM);
  return Boolean(p && p.side === 'left');
}

// Nächstgelegene Rastanlage zu jedem Hub zuordnen (für Name, Ausstattung, Hund/Mensch).
// Mit route werden Hubs an Anlagen der Gegenfahrbahn als unerreichbar markiert.
// Mit sites (Fußwege vom Schnelllader) werden Hund/Mensch vom Ladeplatz aus bewertet, nicht vom
// Mittelpunkt der Rastanlage – Schnelllader stehen oft abseits von Restaurant und Grün.
export function attachRestAreas(hubs, restAreas, route = null, sites = []) {
  const grid = new Map();
  const key = (lat, lon) => `${Math.floor(lat * 50)}:${Math.floor(lon * 50)}`;
  const siteGrid = new Map();
  for (const st of sites) {
    const k = key(st.lat, st.lon);
    if (!siteGrid.has(k)) siteGrid.set(k, []);
    siteGrid.get(k).push(st);
  }
  for (const r of restAreas) {
    const k = key(r.lat, r.lon);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(r);
  }
  for (const h of hubs) {
    let best = null, bestD = REST_AREA_RADIUS_KM;
    const [ci, cj] = [Math.floor(h.lat * 50), Math.floor(h.lon * 50)];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const r of grid.get(`${ci + di}:${cj + dj}`) || []) {
        const d = haversineKm(h.lat, h.lon, r.lat, r.lon);
        if (d < bestD) { best = r; bestD = d; }
      }
    }
    h.restArea = best;
    h.dog = best ? dogScore(best.flags) : null;
    h.human = best ? humanScore(best.flags) : null;
    h.name = best?.name || [...h.operators].filter(Boolean)[0] || 'Ladestation';
    h.oppositeSide = Boolean(best) && isOppositeSide(route, best);
    const site = nearestSite(siteGrid, h);
    if (site) {
      h.walk = site.walk;
      h.greenKind = site.greenKind;
      h.dog = siteDogScore(site.walk);
      h.human = siteHumanScore(site.walk);
    }
  }
  return hubs;
}

// Nächster Schnelllade-Standort (≤ 150 m) zu einem Hub
const SITE_MATCH_KM = 0.15;
function nearestSite(siteGrid, h) {
  let best = null, bestD = SITE_MATCH_KM;
  const [ci, cj] = [Math.floor(h.lat * 50), Math.floor(h.lon * 50)];
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    for (const st of siteGrid.get(`${ci + di}:${cj + dj}`) || []) {
      const d = haversineKm(h.lat, h.lon, st.lat, st.lon);
      if (d < bestD) { best = st; bestD = d; }
    }
  }
  return best;
}

// Umweg hin und zurück (Abfahrt, Anfahrt) in km und Minuten
export function detourOf(hub) {
  if (hub.offsetKm < 0.3) return { km: 0, min: 0 };
  const km = hub.offsetKm * 2 * 1.3;
  return { km, min: km / 50 * 60 + 3 };
}

// nearFirst: bei fast leerem Akku zählt Nähe statt Fortschritt – lieber der Schnelllader um die Ecke
function hubScore(hub, fromKm, reachKm, s, nearFirst = false) {
  const along = reachKm > fromKm ? (hub.alongKm - fromKm) / (reachKm - fromKm) : 0;
  const progress = nearFirst ? 1 - Math.min(1, along + detourOf(hub).km / Math.max(1, reachKm - fromKm)) : along;
  const power = Math.min(hub.maxKw, s.carMaxKw) / s.carMaxKw;
  const amen = hub.restArea ? ((hub.dog ?? 2) * 0.6 + (hub.human ?? 2) * 0.4) / 5 : 0.25;
  return 0.5 * progress + 0.25 * power + 0.25 * amen - detourOf(hub).km * 0.02;
}

// Akkustand nach `minutes` Laden (gleiche Ladekurve wie chargeMinutes)
function socAfterCharging({ capacityKWh, socFrom, minutes, chargerKw, carMaxKw, cap }) {
  let soc = socFrom;
  while (soc < cap && chargeMinutes({ capacityKWh, socFrom, socTo: soc + 1, chargerKw, carMaxKw }) <= minutes) soc += 1;
  return soc;
}

// Plant die Fahrt. Liefert { stops, arrivalSoc, totalChargeMin, warnings, feasible }
// forced: { [Nummer des Ladestopps]: hubKey } – vom Nutzer gewählte Alternative statt des Vorschlags
export function planTrip({ route, energy, hubs, fallbackHubs = [], settings, forced = {} }) {
  const s = { ...DEFAULT_PLAN_SETTINGS, ...settings };
  const L = route.lengthKm;
  const socAfter = (soc, kwh) => soc - kwh / s.capacityKWh * 100;
  const stops = [];
  const warnings = [];
  let pos = 0, soc = s.startSoc, feasible = true;

  for (let guard = 0; guard < 40; guard++) {
    const energyOk = socAfter(soc, energy.between(pos, L)) >= s.arrivalSoc;
    if (energyOk && L - pos <= s.maxDriveKm) break;

    // Bis wohin reicht der Akku – und bis wohin darf ohne Pause gefahren werden?
    // Abfahrt schon unter der Reserve: bis knapp über leer fahren dürfen, damit der nächste
    // Schnelllader in der Nähe erreichbar ist statt der allernächsten langsamen Säule
    const lowStart = !stops.length && soc < s.reserveSoc;
    const energyReach = energy.reachKm(pos, soc, s.capacityKWh, lowStart ? Math.max(1, soc - LOW_START_MARGIN) : s.reserveSoc);
    const reach = Math.min(energyReach, pos + s.maxDriveKm);
    // Bei leerem Akku zählen auch Säulen direkt am Start bzw. kurz hinter dem Start (alongKm = 0)
    const inWindow = (list, to) => list.filter(h => !h.oppositeSide && (lowStart ? h.alongKm >= pos : h.alongKm > pos + (stops.length ? MIN_LEG_KM : 0)) && h.alongKm <= to);
    let candidates = inWindow(hubs, reach), fallback = false;
    if (!candidates.length) { candidates = inWindow(fallbackHubs, reach); fallback = candidates.length > 0; }
    if (!candidates.length && reach < energyReach) {
      // Im Pausenfenster keine Säule: weiter bis zur Akkugrenze suchen (Gassi-Pause ohne Laden ergänzt trip.js)
      if (energyOk) break;
      candidates = inWindow(hubs, energyReach);
      if (!candidates.length) { candidates = inWindow(fallbackHubs, energyReach); fallback = candidates.length > 0; }
    }

    if (!candidates.length) {
      // Nichts sicher erreichbar: nächste Säule dahinter nehmen und deutlich warnen
      const next = [...hubs, ...fallbackHubs].filter(h => !h.oppositeSide && h.alongKm > pos).sort((a, b) => a.alongKm - b.alongKm)[0];
      if (!next) {
        feasible = false;
        warnings.push(`Ab km ${Math.round(pos)} ist keine Ladesäule entlang der Route bekannt.`);
        break;
      }
      candidates = [next];
      feasible = false;
      warnings.push(`Der Akku reicht voraussichtlich nicht sicher bis zur nächsten Ladesäule (km ${Math.round(next.alongKm)}).`);
    }

    const score = h => hubScore(h, pos, reach, s, lowStart);
    let hub = candidates.reduce((best, h) => score(h) > score(best) ? h : best);
    const want = forced[stops.length];
    if (want && hubKey(hub) !== want) {
      // Gewählte Alternative: erlaubt, solange sie mit dem Akku erreichbar ist
      const pick = [...hubs, ...fallbackHubs].find(h => hubKey(h) === want && !h.oppositeSide && h.alongKm >= pos && h.alongKm <= Math.max(energyReach, hub.alongKm));
      if (pick) { hub = pick; fallback = !hubs.includes(pick); candidates = candidates.includes(pick) ? candidates : [...candidates, pick]; }
      else warnings.push(`Stopp ${stops.length + 1}: die gewählte Alternative ist mit diesem Akkustand nicht erreichbar – Vorschlag beibehalten.`);
    }
    const alternatives = candidates
      .filter(h => h !== hub && Math.abs(h.alongKm - hub.alongKm) <= ALT_RANGE_KM)
      .sort((a, b) => score(b) - score(a)).slice(0, ALT_MAX)
      .map(h => ({ key: hubKey(h), name: h.name, lat: h.lat, lon: h.lon, maxKw: h.maxKw, points: h.points, operators: [...h.operators].filter(Boolean),
        shiftKm: h.alongKm - hub.alongKm, detour: detourOf(h), dog: h.dog, human: h.human }));
    const detour = detourOf(hub);
    const arriveSoc = socAfter(soc, energy.between(pos, hub.alongKm) + detour.km / 2 * s.baseKWh100 / 100);
    const toDest = energy.between(hub.alongKm, L) / s.capacityKWh * 100;
    const needed = toDest + s.arrivalSoc + 5 + detour.km / 2 * s.baseKWh100 / s.capacityKWh;
    // Mindestens so viel, dass der nächste Pausenabschnitt sicher reicht; während der ohnehin
    // fälligen Pause darf mehr geladen werden – aber nicht mehr, als bis zum Ziel gebraucht wird.
    const nextLeg = Math.min(L, hub.alongKm + s.maxDriveKm);
    const neededNext = energy.between(hub.alongKm, nextLeg) / s.capacityKWh * 100 + s.reserveSoc + 3;
    const breakSoc = socAfterCharging({ capacityKWh: s.capacityKWh, socFrom: Math.max(0, arriveSoc), minutes: s.minBreakMin, chargerKw: hub.maxKw, carMaxKw: s.carMaxKw, cap: s.maxChargeSoc });
    let targetSoc = Math.max(arriveSoc, Math.min(s.maxChargeSoc, needed, Math.max(neededNext, breakSoc, arriveSoc + 10)));
    // Letzter Abschnitt: bis zum Ziel laden – notfalls bis 10 % über das Limit, statt kurz vor dem Ziel
    // noch einmal anzuhalten
    if (L - hub.alongKm <= s.maxDriveKm && needed > targetSoc && needed <= Math.min(100, s.maxChargeSoc + 10)) targetSoc = needed;
    const chargeMin = chargeMinutes({ capacityKWh: s.capacityKWh, socFrom: Math.max(0, arriveSoc), socTo: targetSoc, chargerKw: hub.maxKw, carMaxKw: s.carMaxKw });

    stops.push({
      ...hub,
      key: hubKey(hub),
      chargeIndex: stops.length,
      alternatives,
      operators: [...hub.operators].filter(Boolean),
      fallback,
      arriveSoc: Math.round(arriveSoc),
      targetSoc: Math.round(targetSoc),
      chargeMin: Math.round(chargeMin),
      stopMin: Math.round(Math.max(chargeMin, s.minBreakMin)),
      detour,
    });
    if (lowStart && arriveSoc >= 0) warnings.push(`Akku bei Abfahrt unter der Reserve von ${s.reserveSoc} % – zuerst laden in ${Math.max(1, Math.round(hub.alongKm + detour.km / 2))} km.`);
    if (fallback) warnings.push(`Stopp ${stops.length}: keine Säule mit ${s.minChargerKw} kW erreichbar – Ausweichen auf ${Math.round(hub.maxKw)} kW.`);
    pos = hub.alongKm;
    soc = targetSoc;
    if (arriveSoc < 0) break;
  }

  const arrivalSoc = Math.round(socAfter(soc, energy.between(pos, L)));
  return {
    stops,
    arrivalSoc,
    totalChargeMin: stops.reduce((t, x) => t + x.stopMin, 0),
    totalDetourMin: stops.reduce((t, x) => t + x.detour.min, 0),
    warnings,
    feasible: feasible && arrivalSoc >= 0,
  };
}

// Zeitplan: Abfahrt + Fahrzeit (anteilig nach km) + Stopps
export function schedule({ plan, lengthKm, durationMin, departure }) {
  const t0 = departure.getTime();
  let extra = 0;
  const timed = plan.stops.map(st => {
    const arrive = new Date(t0 + (durationMin * st.alongKm / lengthKm + extra + st.detour.min / 2) * 60000);
    extra += st.stopMin + st.detour.min;
    return { ...st, arriveAt: arrive, departAt: new Date(arrive.getTime() + st.stopMin * 60000) };
  });
  return { stops: timed, arrivalAt: new Date(t0 + (durationMin + extra) * 60000), totalMin: durationMin + extra };
}
