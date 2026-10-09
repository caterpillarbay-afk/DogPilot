import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RouteLine } from '../js/geo.js';
import { autobahnRoads, parsePeriods, eventsAlongRoute } from '../js/traffic.js';

test('Autobahnkennungen aus Straßennamen der Routendienste', () => {
  assert.deepEqual(autobahnRoads(['A 61', 'A7; E 45', 'B 9', 'Alzeyer Straße', 'A1', 'L 401', 'A 7']).sort(), ['A1', 'A61', 'A7']);
});

test('Gültigkeitszeiträume aus dem Beschreibungstext', () => {
  const p = parsePeriods(['Die Baustelle ist zu folgenden Zeiträumen gültig:', '19.10.26 18:00 bis zum 20.10.26 06:00 Uhr.', '09.10.26 von 22:00 bis 05:00 Uhr']);
  assert.equal(p.length, 2);
  assert.equal(p[0].from.getDate(), 19); assert.equal(p[0].to.getHours(), 6);
  assert.equal(p[1].to.getDate(), 10);   // über Mitternacht
});

test('Meldungen: nur in Fahrtrichtung, zur Durchfahrtszeit gültig, sortiert', () => {
  // Route von Süden nach Norden entlang 10° Ost
  const line = new RouteLine([[48, 10], [49, 10], [50, 10]]);
  const dep = new Date(2026, 9, 10, 8, 0);
  const passAt = km => new Date(dep.getTime() + km * 36000);   // 100 km/h
  const base = { coordinate: { lat: 49.5, long: 10 }, subtitle: ' Süd -> Nord', description: [], future: false, isBlocked: 'false' };
  const items = [
    { ...base, kind: 'roadworks', identifier: 'nord', extent: '49.5,10,49.6,10' },
    { ...base, kind: 'roadworks', identifier: 'sued', extent: '49.6,10,49.5,10' },          // Gegenrichtung
    // Gegenrichtung, Ausdehnung endet vor dem Start der Route (nur ein Ende auf der Route)
    { ...base, kind: 'roadworks', identifier: 'sued-rand', coordinate: { lat: 48.05, long: 10 }, extent: '48.05,10,47.9,10' },
    { ...base, kind: 'closure', identifier: 'rampe', coordinate: { lat: 49.8, long: 10.001 }, subtitle: ' AS Musterstadt (aus Richtung Süd)', extent: '49.8,10.001,49.79,10.003' },
    { ...base, kind: 'closure', identifier: 'zu', coordinate: { lat: 48.2, long: 10 }, isBlocked: 'true',
      description: ['10.10.26 von 07:00 bis 12:00 Uhr'] },
    { ...base, kind: 'closure', identifier: 'nachts', description: ['10.10.26 22:00 bis zum 11.10.26 05:00 Uhr.'] },
    { ...base, kind: 'roadworks', identifier: 'weit', coordinate: { lat: 49.5, long: 10.2 } },
    { ...base, kind: 'roadworks', identifier: 'spaeter', future: true },
  ];
  const ev = eventsAlongRoute(items, line, passAt, dep);
  assert.deepEqual(ev.map(e => e.id), ['zu', 'nord', 'rampe']);
  assert.equal(ev[0].blocked, true);
  assert.equal(ev[0].until, new Date(2026, 9, 10, 12, 0).toISOString());
  assert.deepEqual(ev.map(e => e.ramp), [false, false, true]);
  assert.equal(ev[1].subtitle, 'Süd → Nord');
});
