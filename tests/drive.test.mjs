import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueAnnouncements, delayStep, breakText, chargeText, closureText, delayText, nextUp, stopTimerDue } from '../js/drive.js';
import { FEATURES } from '../js/data.js';

const prefs = { breaks: true, charge: true, closures: true, schedule: true };
const stops = [
  { kind: 'break', name: 'Rastplatz Kraichgau', lat: 49.2, lon: 8.9, alongKm: 100, restArea: { flags: FEATURES.dogPark } },
  { kind: 'charge', name: 'Ionity Feuchtwangen', lat: 49.1, lon: 10.3, alongKm: 200, maxKw: 350, walk: { green: 120 }, alternatives: [{}, {}] },
];
const events = [
  { id: 'z', kind: 'closure', ramp: false, title: 'A6 | Weinsberg - Bretzfeld', alongKm: 130 },
  { id: 'r', kind: 'closure', ramp: true, junction: false, title: 'Rampe', alongKm: 131 },
  { id: 'w', kind: 'roadworks', ramp: false, title: 'Baustelle', alongKm: 132 },
];

test('Ansagen: Vorlauf je Art, nur einmal, Rampen nur am eigenen Wechsel', () => {
  const minPerKm = 0.6;   // 100 km/h
  const done = new Set();
  // km 85: Pause in 9 min (fällig), Sperrung in 27 min (noch nicht)
  let due = dueAnnouncements({ stops, events, km: 85, minPerKm, prefs, done });
  assert.deepEqual(due.map(d => d.kind), ['break']);
  done.add(due[0].key);
  assert.equal(dueAnnouncements({ stops, events, km: 86, minPerKm, prefs, done }).length, 0);
  // km 115: Sperrung in 9 min; die nicht gewechselte Rampe und die Baustelle nicht
  due = dueAnnouncements({ stops, events, km: 115, minPerKm, prefs, done });
  assert.deepEqual(due.map(d => d.key), ['closure:z']);
  // Ladestopp: 15 min Vorlauf
  assert.deepEqual(dueAnnouncements({ stops, events, km: 176, minPerKm, prefs, done: new Set(['closure:z', 'closure:r']) }).map(d => d.kind), ['charge']);
  // abgeschaltete Kategorie
  assert.equal(dueAnnouncements({ stops, events, km: 176, minPerKm, prefs: { ...prefs, charge: false }, done }).length, 0);
  assert.equal(nextUp({ stops, events, km: 50, minPerKm, prefs }).name, 'Rastplatz Kraichgau');
});

test('Verspätung in 10-Minuten-Stufen', () => {
  assert.deepEqual(delayStep(8, 0), { level: 0, announce: false });
  assert.deepEqual(delayStep(12, 0), { level: 1, announce: true });
  assert.deepEqual(delayStep(18, 1), { level: 1, announce: false });
  assert.deepEqual(delayStep(25, 1), { level: 2, announce: true });
  assert.deepEqual(delayStep(3, 2), { level: 0, announce: false });
});

test('Ansage-Texte', () => {
  assert.equal(breakText(stops[0], 9.6), 'In etwa 10 Minuten Gassi-Pause: Rastplatz Kraichgau. Dort gibt es eine Hundewiese.');
  assert.match(chargeText(stops[1], 14, { free: 3, busy: 1, broken: 0, total: 4 }), /Ladestopp: Ionity Feuchtwangen, 350 Kilowatt\. Gerade sind 3 von 4 Ladepunkten frei\. Grün in 120 Metern\./);
  assert.match(chargeText(stops[1], 14, { free: 0, busy: 4, broken: 0, total: 4 }), /alle 4 Ladepunkte belegt\. In der App findest du 2 Alternativen\./);
  assert.equal(closureText(events[0], 9.4), 'Achtung: In etwa 9 Kilometern Sperrung auf der A6 zwischen Weinsberg und Bretzfeld.');
  assert.equal(closureText({ ramp: true, rampType: 'cross', junction: 'change', subtitle: 'AK Ulm/Elchingen (aus Richtung Leibisee)' }, 5),
    'Achtung: An deinem Autobahnwechsel in etwa 5 Kilometern: Überleitung im Autobahnkreuz gesperrt, AK Ulm/Elchingen (aus Richtung Leibisee). Bitte prüfe, ob das dich betrifft.');
  const arr = new Date(2026, 9, 10, 14, 20), by = new Date(2026, 9, 10, 14, 0);
  assert.equal(delayText(15, arr, by), 'Du liegst etwa 15 Minuten hinter dem Plan. Neue Ankunft gegen 14:20 Uhr. Das ist 20 Minuten nach 14:00 Uhr.');
});

test('Timer am Ladestopp und an der Gassi-Pause', () => {
  const t0 = Date.UTC(2026, 9, 10, 10, 0);
  const visit = { stop: { kind: 'charge', name: 'Ionity', stopMin: 25, targetSoc: 80 }, arrivedAt: t0, said: new Set() };
  assert.equal(stopTimerDue(visit, t0 + 10 * 60000).length, 0);
  const warn = stopTimerDue(visit, t0 + 21 * 60000);
  assert.equal(warn[0].text, 'Noch etwa 5 Minuten Laden, dann ist der Akku laut Plan bei 80 Prozent.');
  visit.said.add('warn');
  const done = stopTimerDue(visit, t0 + 26 * 60000, { name: 'München', min: 110 });
  assert.equal(done[0].text, 'Laut Plan ist der Akku jetzt bei 80 Prozent. Du kannst weiterfahren. Nächster Halt: München, in etwa einer Stunde und 50 Minuten.');
  // kurze Pause: keine Vorwarnung, nur Ende
  const pause = { stop: { kind: 'break', stopMin: 8 }, arrivedAt: t0, said: new Set() };
  assert.deepEqual(stopTimerDue(pause, t0 + 7 * 60000), []);
  assert.equal(stopTimerDue(pause, t0 + 8 * 60000)[0].text, "Die Gassi-Pause ist vorbei. Weiter geht's.");
});
