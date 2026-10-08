import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RouteLine } from '../js/geo.js';
import { EnergyProfile } from '../js/energy.js';
import { findHubs, attachRestAreas, planTrip, schedule } from '../js/planner.js';
import { FEATURES } from '../js/data.js';

// Gerade Teststrecke von ~715 km entlang 50° N
const route = new RouteLine(Array.from({ length: 11 }, (_, i) => [50, 5 + i]));
const atKm = km => [50.002, 5 + km / route.lengthKm * 10]; // knapp neben der Route
const charger = (km, kw, op = 'Ionity') => { const [lat, lon] = atKm(km); return { lat, lon, kw, points: 4, operator: op }; };

test('findHubs: nur schnelle Säulen im Korridor, nahe Säulen zusammengefasst', () => {
  const [lat, lon] = atKm(100);
  const hubs = findHubs(route, [charger(100, 150), { lat: lat + 0.001, lon, kw: 300, points: 2, operator: 'Tesla' }, charger(200, 50), { lat: 51, lon: 6, kw: 300, points: 8, operator: 'X' }], { corridorKm: 2, minKw: 150 });
  assert.equal(hubs.length, 1);
  assert.equal(hubs[0].maxKw, 300);
  assert.equal(hubs[0].points, 6);
  assert.deepEqual([...hubs[0].operators].sort(), ['Ionity', 'Tesla']);
});

test('attachRestAreas: Ausstattung und Hund-Bewertung', () => {
  const [lat, lon] = atKm(100);
  const hubs = attachRestAreas(findHubs(route, [charger(100, 150)], { corridorKm: 2, minKw: 150 }),
    [{ lat, lon: lon + 0.002, name: 'Rasthof Test', type: 'rastanlage', flags: FEATURES.toilets | FEATURES.food | FEATURES.dogPark }]);
  assert.equal(hubs[0].name, 'Rasthof Test');
  assert.ok(hubs[0].dog >= 3.5);
  assert.ok(hubs[0].human >= 4);
});

test('planTrip: kurze Strecke ohne Stopp', () => {
  const short = new RouteLine([[50, 8], [50, 9]]);
  const energy = new EnergyProfile({ lengthKm: short.lengthKm, baseKWh100: 20 });
  const plan = planTrip({ route: short, energy, hubs: [], settings: { capacityKWh: 77, startSoc: 80 } });
  assert.equal(plan.stops.length, 0);
  assert.ok(plan.feasible);
  assert.ok(plan.arrivalSoc > 50);
});

test('planTrip: lange Strecke mit Stopps, Akku nie unter Reserve', () => {
  const energy = new EnergyProfile({ lengthKm: route.lengthKm, baseKWh100: 20 });
  const hubs = attachRestAreas(findHubs(route, [50, 150, 250, 350, 450, 550, 650].map(km => charger(km, 150)), { corridorKm: 2, minKw: 150 }), []);
  const plan = planTrip({ route, energy, hubs, settings: { capacityKWh: 77, startSoc: 80, reserveSoc: 10, arrivalSoc: 15 } });
  assert.ok(plan.feasible, plan.warnings.join());
  assert.ok(plan.stops.length >= 2 && plan.stops.length <= 3, plan.stops.length);
  for (const st of plan.stops) {
    assert.ok(st.arriveSoc >= 10, `Ankunft ${st.arriveSoc} %`);
    // höchstens 80 %, im letzten Abschnitt bis 90 %, wenn das einen weiteren Stopp spart
    assert.ok(st.targetSoc <= 80 || (st === plan.stops.at(-1) && st.targetSoc <= 90), `Ziel-Akku ${st.targetSoc} %`);
    assert.ok(st.chargeMin > 0);
  }
  assert.ok(plan.arrivalSoc >= 15, plan.arrivalSoc);
  const sch = schedule({ plan, lengthKm: route.lengthKm, durationMin: 420, departure: new Date('2026-10-10T08:00:00Z') });
  assert.ok(sch.arrivalAt > new Date('2026-10-10T15:00:00Z'));
  assert.ok(sch.stops.every((st, i, a) => i === 0 || st.arriveAt > a[i - 1].departAt));
});

test('planTrip: ohne erreichbare Säule wird gewarnt statt still falsch geplant', () => {
  const energy = new EnergyProfile({ lengthKm: route.lengthKm, baseKWh100: 20 });
  const hubs = attachRestAreas(findHubs(route, [charger(600, 150)], { corridorKm: 2, minKw: 150 }), []);
  const plan = planTrip({ route, energy, hubs, settings: { capacityKWh: 77, startSoc: 80 } });
  assert.equal(plan.feasible, false);
  assert.ok(plan.warnings.length > 0);
});

test('planTrip: Ausweichen auf langsamere Säule, wenn keine schnelle erreichbar ist', () => {
  const energy = new EnergyProfile({ lengthKm: route.lengthKm, baseKWh100: 20 });
  const hubs = attachRestAreas(findHubs(route, [charger(500, 150)], { corridorKm: 2, minKw: 150 }), []);
  const fallbackHubs = attachRestAreas(findHubs(route, [charger(200, 50)], { corridorKm: 2, minKw: 22 }), []);
  const plan = planTrip({ route, energy, hubs, fallbackHubs, settings: { capacityKWh: 77, startSoc: 80 } });
  assert.equal(plan.stops[0].fallback, true);
  assert.ok(plan.warnings.some(w => w.includes('Ausweichen')));
});

test('Rastanlage auf der Gegenfahrbahn wird nicht angefahren, Autohof schon', () => {
  // Route nach Osten: Norden = links = Gegenfahrbahn
  const left = { lat: 50.002, lon: 6, name: 'Gegenseite', type: 'rastanlage', flags: FEATURES.toilets };
  const right = { lat: 49.998, lon: 6.1, name: 'Unsere Seite', type: 'rastanlage', flags: FEATURES.toilets };
  const hof = { lat: 50.002, lon: 6.2, name: 'Autohof', type: 'autohof', flags: FEATURES.toilets };
  const hubs = attachRestAreas([
    { lat: 50.002, lon: 6, maxKw: 300, points: 4, operators: new Set(['A']), alongKm: 71, offsetKm: 0.2 },
    { lat: 49.998, lon: 6.1, maxKw: 300, points: 4, operators: new Set(['B']), alongKm: 79, offsetKm: 0.2 },
    { lat: 50.002, lon: 6.2, maxKw: 300, points: 4, operators: new Set(['C']), alongKm: 86, offsetKm: 0.2 },
  ], [left, right, hof], route);
  assert.deepEqual(hubs.map(h => h.oppositeSide), [true, false, false]);
});

test('Fußwege vom Ladeplatz: Bewertung nach Entfernung, Lader am Rand der Anlage wird schlechter bewertet', async () => {
  const { siteDogScore, siteHumanScore } = await import('../js/data.js');
  const close = { wc: 60, food: 120, shop: 200, water: null, picnic: 50, playground: null, dogPark: null, green: 40 };
  const far = { wc: 450, food: 580, shop: null, water: null, picnic: null, playground: null, dogPark: null, green: 520 };
  assert.ok(siteDogScore(close) >= 3.5 && siteDogScore(far) < 2);
  assert.ok(siteHumanScore(close) >= 4 && siteHumanScore(far) <= 2);
  assert.ok(siteDogScore({ ...far, dogPark: 250 }) >= siteDogScore(far) + 2);
});

test('attachRestAreas: Fußwege vom nächsten Schnelllader überschreiben die Bewertung der Anlage', () => {
  const area = { lat: 49.998, lon: 6, name: 'Große Anlage', type: 'rastanlage', flags: FEATURES.toilets | FEATURES.food | FEATURES.forest };
  const site = { lat: 49.998, lon: 6.0005, walk: { wc: 450, food: 580, shop: null, water: null, picnic: null, playground: null, dogPark: null, green: 520 }, greenKind: 'Wald' };
  const [hub] = attachRestAreas([{ lat: 49.998, lon: 6.0005, maxKw: 300, points: 4, operators: new Set(['A']), alongKm: 71, offsetKm: 0.1 }], [area], null, [site]);
  assert.equal(hub.name, 'Große Anlage');
  assert.deepEqual(hub.walk, site.walk);
  assert.ok(hub.dog < 2 && hub.human <= 2);
  const [noSite] = attachRestAreas([{ lat: 49.998, lon: 6.0005, maxKw: 300, points: 4, operators: new Set(['A']), alongKm: 71, offsetKm: 0.1 }], [area], null, []);
  assert.ok(noSite.dog >= 3 && noSite.walk === undefined);
});

test('planTrip: Pausenrhythmus – spätestens alle 150 km ein Ladestopp, Laden während der Pause', () => {
  const energy = new EnergyProfile({ lengthKm: route.lengthKm, baseKWh100: 20 });
  const kms = Array.from({ length: 14 }, (_, i) => 50 + i * 50);
  const hubs = attachRestAreas(findHubs(route, kms.map(km => charger(km, 150)), { corridorKm: 2, minKw: 150 }), []);
  const plan = planTrip({ route, energy, hubs, settings: { capacityKWh: 77, startSoc: 80, reserveSoc: 10, arrivalSoc: 15, minBreakMin: 15, maxDriveKm: 150 } });
  assert.ok(plan.feasible, plan.warnings.join());
  const marks = [0, ...plan.stops.map(s => s.alongKm), route.lengthKm];
  for (let i = 1; i < marks.length; i++) assert.ok(marks[i] - marks[i - 1] <= 150.5, `Abschnitt ${Math.round(marks[i] - marks[i - 1])} km`);
  assert.ok(plan.stops.length >= 4, plan.stops.length);
  for (const st of plan.stops) assert.ok(st.arriveSoc >= 10 && st.targetSoc <= 80);
  // Ohne Pausenvorgabe reichen weniger Stopps
  const free = planTrip({ route, energy, hubs, settings: { capacityKWh: 77, startSoc: 80, reserveSoc: 10, arrivalSoc: 15 } });
  assert.ok(free.stops.length < plan.stops.length);
});

test('planTrip: kein Mini-Stopp kurz vor dem Ziel – letzter Stopp lädt bis zum Bedarf fürs Ziel', () => {
  const energy = new EnergyProfile({ lengthKm: route.lengthKm, baseKWh100: 24 });
  const kms = Array.from({ length: 19 }, (_, i) => 25 + i * 35);
  const hubs = attachRestAreas(findHubs(route, kms.map(km => charger(km, 300)), { corridorKm: 2, minKw: 150 }), []);
  const plan = planTrip({ route, energy, hubs, settings: { capacityKWh: 77, startSoc: 80, reserveSoc: 10, arrivalSoc: 15, minBreakMin: 15, maxDriveKm: 200 } });
  assert.ok(plan.feasible, plan.warnings.join());
  assert.ok(route.lengthKm - plan.stops.at(-1).alongKm > 60, `letzter Stopp bei km ${Math.round(plan.stops.at(-1).alongKm)}`);
  assert.ok(plan.arrivalSoc >= 15);
});
