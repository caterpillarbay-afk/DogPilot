import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, decodePolyline, encodePolyline, RouteLine, simplifyByDistance } from '../js/geo.js';

test('haversine: Hamburg–München ~612 km Luftlinie', () => {
  const d = haversineKm(53.5511, 9.9937, 48.1374, 11.5755);
  assert.ok(d > 600 && d < 625, d);
});

test('Polyline: kodieren und dekodieren ergibt dieselben Punkte', () => {
  const pts = [[53.5511, 9.9937], [52.3759, 9.732], [48.1374, 11.5755]];
  const back = decodePolyline(encodePolyline(pts, 6), 6);
  back.forEach((p, i) => { assert.ok(Math.abs(p[0] - pts[i][0]) < 1e-6); assert.ok(Math.abs(p[1] - pts[i][1]) < 1e-6); });
});

test('RouteLine: Projektion liefert Routen-km und seitlichen Abstand', () => {
  // Gerade Linie entlang des Breitengrads 50°, ~71,5 km pro Längengrad
  const route = new RouteLine([[50, 8], [50, 9], [50, 10]]);
  assert.ok(Math.abs(route.lengthKm - 143) < 1.5, route.lengthKm);
  const p = route.project(50.01, 8.5, 2);           // ~1,1 km nördlich, auf halber Strecke des 1. Segments
  assert.ok(p && Math.abs(p.offsetKm - 1.11) < 0.05, JSON.stringify(p));
  assert.ok(Math.abs(p.alongKm - route.lengthKm / 4) < 0.5, p.alongKm);
  assert.equal(route.project(50.1, 8.5, 2), null);  // 11 km entfernt → außerhalb des Korridors
});

test('RouteLine: Punkte abseits der Luftlinie werden entlang der echten Route gefunden', () => {
  // Route macht einen Bogen über 51° – eine Luftlinien-Suche fände diese Säule nicht
  const route = new RouteLine([[50, 8], [51, 9], [50, 10]]);
  const p = route.project(51, 9, 1);
  assert.ok(p && p.offsetKm < 0.01);
  assert.ok(Math.abs(p.alongKm - route.lengthKm / 2) < 0.5);
});

test('simplifyByDistance behält Start und Ende', () => {
  const pts = Array.from({ length: 100 }, (_, i) => [50, 8 + i * 0.001]);
  const s = simplifyByDistance(pts, 1);
  assert.deepEqual(s[0], pts[0]);
  assert.deepEqual(s.at(-1), pts.at(-1));
  assert.ok(s.length < 15);
});

test('RouteLine: Seite in Fahrtrichtung (nach Norden: Osten = rechts)', () => {
  const north = new RouteLine([[50, 8], [51, 8]]);
  assert.equal(north.project(50.5, 8.002, 1).side, 'right');
  assert.equal(north.project(50.5, 7.998, 1).side, 'left');
  const south = new RouteLine([[51, 8], [50, 8]]);
  assert.equal(south.project(50.5, 8.002, 1).side, 'left');
});

test('parseCoordinates: Formate aus Google Maps und Handy', async () => {
  const { parseCoordinates } = await import('../js/geo.js');
  const near = (r, lat, lon) => { assert.ok(r, 'nicht erkannt'); assert.ok(Math.abs(r[0] - lat) < 1e-4 && Math.abs(r[1] - lon) < 1e-4, String(r)); };
  near(parseCoordinates('54.7886, 8.8291'), 54.7886, 8.8291);
  near(parseCoordinates('54.7886,8.8291'), 54.7886, 8.8291);
  near(parseCoordinates(' 54.7886 8.8291 '), 54.7886, 8.8291);
  near(parseCoordinates('54,7886 8,8291'), 54.7886, 8.8291);
  near(parseCoordinates('54,7886, 8,8291'), 54.7886, 8.8291);
  near(parseCoordinates('54,7886; 8,8291'), 54.7886, 8.8291);
  near(parseCoordinates('N 54.7886 E 8.8291'), 54.7886, 8.8291);
  near(parseCoordinates('54.7886° N, 8.8291° O'), 54.7886, 8.8291);
  near(parseCoordinates(`54°47'19.0"N 8°49'44.8"E`), 54.78861, 8.82911);
  near(parseCoordinates('54°47′19″N, 8°49′45″E'), 54.78861, 8.82917);
  near(parseCoordinates('40.7128, -74.0060'), 40.7128, -74.006);
  near(parseCoordinates('https://www.google.com/maps/place/Niebüll/@54.7886,8.8291,15z'), 54.7886, 8.8291);
  near(parseCoordinates('https://maps.google.com/?q=54.7886,8.8291'), 54.7886, 8.8291);
  for (const no of ['Niebüll', 'Hauptstraße 5, 25899 Niebüll', '25899', '12 34', '95.1, 8.2', 'https://maps.app.goo.gl/abc123', '']) assert.equal(parseCoordinates(no), null, no);
});
