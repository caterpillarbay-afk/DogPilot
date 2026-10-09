import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnergyProfile, temperatureFactor, chargeMinutes, trafficFactor, learnFactor } from '../js/energy.js';

test('Temperatur: 15–28 °C neutral, 10 °C +4 %, 0 °C +12 %', () => {
  assert.equal(temperatureFactor(20), 1);
  assert.equal(temperatureFactor(15), 1);
  assert.ok(Math.abs(temperatureFactor(10) - 1.04) < 1e-9);
  assert.ok(Math.abs(temperatureFactor(0) - 1.12) < 1e-9);
  assert.ok(temperatureFactor(35) > 1);
});

test('Stau-Aufschlag ist gedeckelt', () => {
  assert.equal(trafficFactor(0, 100), 1);
  assert.equal(trafficFactor(200, 100), 1.15);
});

test('Flache Strecke: Energie = Strecke × Verbrauch', () => {
  const e = new EnergyProfile({ lengthKm: 100, baseKWh100: 20 });
  assert.ok(Math.abs(e.totalKWh - 20) < 1e-9);
  assert.ok(Math.abs(e.between(25, 75) - 10) < 1e-9);
});

test('Bergauf kostet mehr, bergab wird teilweise zurückgewonnen', () => {
  const up = new EnergyProfile({ lengthKm: 10, baseKWh100: 20, heights: [[0, 0], [10000, 500]], massKg: 2300 });
  const down = new EnergyProfile({ lengthKm: 10, baseKWh100: 20, heights: [[0, 500], [10000, 0]], massKg: 2300 });
  assert.ok(up.totalKWh > 2 + 3, up.totalKWh);       // 2 kWh flach + ~3,5 kWh Höhe
  assert.ok(down.totalKWh < 2 && down.totalKWh > 0, down.totalKWh);
  assert.equal(Math.round(up.climbM), 500);
});

test('Reichweite: 77 kWh, 80 % → 10 %, 20 kWh/100 km ≈ 270 km', () => {
  const e = new EnergyProfile({ lengthKm: 1000, baseKWh100: 20 });
  const r = e.reachKm(0, 80, 77, 10);
  assert.ok(Math.abs(r - 269.5) < 0.5, r);
});

test('Ladezeit: 10→80 % an 150 kW deutlich unter einer Stunde, an 50 kW länger', () => {
  const fast = chargeMinutes({ capacityKWh: 77, socFrom: 10, socTo: 80, chargerKw: 150, carMaxKw: 135 });
  const slow = chargeMinutes({ capacityKWh: 77, socFrom: 10, socTo: 80, chargerKw: 50, carMaxKw: 135 });
  assert.ok(fast > 25 && fast < 50, fast);
  assert.ok(slow > fast + 20, slow);
  assert.equal(chargeMinutes({ capacityKWh: 77, socFrom: 50, socTo: 40, chargerKw: 150, carMaxKw: 135 }), 0);
});

test('Übliches Auf und Ab steckt im Verbrauch, nur Mehr-Höhenmeter kosten extra', () => {
  const wave = (amp, n = 200) => Array.from({ length: n + 1 }, (_, i) => [i * 1000, i % 2 ? amp : 0]);
  // 200 km mit 1,5 m Hügeln je km: unter dem üblichen Maß → wie flach
  const gentle = new EnergyProfile({ lengthKm: 200, baseKWh100: 20, heights: wave(3) });
  assert.ok(Math.abs(gentle.totalKWh - 40) < 0.01, gentle.totalKWh);
  // Berge (20 m je km bergauf): deutlich mehr als flach, aber weniger als ohne Abzug
  const hilly = new EnergyProfile({ lengthKm: 200, baseKWh100: 20, heights: wave(40) });
  const raw = 100 * (2300 * 9.81 * 40 / 3.6e6) * (1 / 0.9 - 0.6);
  assert.ok(hilly.totalKWh > 40 + raw * 0.8 && hilly.totalKWh < 40 + raw, hilly.totalKWh);
  // Abschnitte bergauf bleiben teurer als bergab
  assert.ok(hilly.between(0, 1) > hilly.between(1, 2));
});

test('Puffer für „Ankunft bis …“: Anteil der Fahrzeit plus Minuten je Ladestopp', async () => {
  const { bufferMinutes } = await import('../js/trip.js');
  assert.equal(bufferMinutes('normal', 420, 3), 70);      // 42 + 30 → 72 → auf 5 min gerundet 70
  assert.equal(bufferMinutes('tight', 420, 3), 35);       // 21 + 15 = 36 → 35
  assert.equal(bufferMinutes('generous', 420, 3), 130);   // 84 + 45 = 129 → 130
  assert.equal(bufferMinutes('custom', 420, 3, 45), 45);
  assert.equal(bufferMinutes('unbekannt', 120, 0), 10);   // Vorgabe „Normal“
});

test('Verbrauch lernen: halbe Korrektur, Grenzen, zu kurze Abschnitte', () => {
  // geplant 15 kWh, tatsächlich 80 % → 50 % von 77 kWh = 23,1 kWh → Faktor 1,54 → gekappt auf 1,4, halb übernommen
  let r = learnFactor(1, { fromSoc: 80, actualSoc: 50, plannedKWh: 15, capacityKWh: 77 });
  assert.equal(r.ratio, 1.4); assert.ok(Math.abs(r.factor - 1.2) < 1e-9);
  // 10 % weniger als geplant mit bisherigem Faktor 1,1 → 1,1 · 0,95
  r = learnFactor(1.1, { fromSoc: 80, actualSoc: 35, plannedKWh: 77 * 0.45 / 0.9, capacityKWh: 77 });
  assert.ok(Math.abs(r.factor - 1.045) < 1e-9, r.factor);
  assert.equal(learnFactor(1, { fromSoc: 80, actualSoc: 77, plannedKWh: 3, capacityKWh: 77 }), null);
  assert.equal(learnFactor(1, { fromSoc: 50, actualSoc: 60, plannedKWh: 10, capacityKWh: 77 }), null);
});
