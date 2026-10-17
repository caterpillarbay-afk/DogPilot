import { test } from 'node:test';
import assert from 'node:assert/strict';
import { houseNumber, keepHouseNumber } from '../js/services.js';

test('houseNumber: Nummer aus der Eingabe, Postleitzahl und Straßennamen mit Zahl zählen nicht', () => {
  assert.equal(houseNumber('Carl-Theodor-Straße 12 Alzey'), '12');
  assert.equal(houseNumber('Carl-Theodor-Straße 12, 55232 Alzey'), '12');
  assert.equal(houseNumber('Landstraße 2b'), '2b');
  assert.equal(houseNumber('Landstraße 2 b, Worms'), '2b');
  assert.equal(houseNumber('55232 Alzey'), null);
  assert.equal(houseNumber('Straße des 17. Juni'), null);
  assert.equal(houseNumber('Garmisch-Partenkirchen'), null);
});

test('keepHouseNumber: Straße ohne bekannte Nummer behält die eingetippte Nummer', () => {
  const street = { main: 'Carl-Theodor-Straße', sub: '55232 Alzey', street: 'Carl-Theodor-Straße', city: 'Alzey', housenumber: null, lat: 49.7, lon: 8.1 };
  // Wie bei Photon für „Carl-Theodor-Straße 12 Alzey“: dieselbe Nummer gibt es nur in einer anderen Straße
  const other = { main: 'Carl-von-Ossietzky-Straße 12', sub: '55232 Alzey', street: null, road: 'Carl-von-Ossietzky-Straße', city: 'Alzey', housenumber: '12', lat: 49.7, lon: 8.1 };
  const [a, b] = keepHouseNumber([street, other], '12');
  assert.equal(a.main, 'Carl-Theodor-Straße 12');
  assert.equal(a.sub, '55232 Alzey', 'Hinweis gehört nicht in die Adresse');
  assert.match(a.note, /^Hausnummer nicht in der Karte/);
  assert.deepEqual(b, other);
  // Kennt die Karte das Haus in derselben Straße, bleibt die Straße wie geliefert
  const house = { main: 'Carl-Theodor-Straße 12', sub: '55232 Alzey', street: null, road: 'Carl-Theodor-Straße', city: 'Alzey', housenumber: '12', lat: 49.7, lon: 8.1 };
  assert.deepEqual(keepHouseNumber([house, street], '12')[1], street);
  // Ohne Nummer in der Eingabe: unverändert
  assert.deepEqual(keepHouseNumber([street], null), [street]);
});

test('keepHouseNumber: gleiche Straße mit Nummer in einem anderen Ort zählt nicht (Hauptstraße 2, Isselbach)', () => {
  // So antwortet Photon: Straße in Isselbach, Haus Nr. 2 nur in Grafling
  const isselbach = { main: 'Hauptstraße', sub: '65558 Isselbach', street: 'Hauptstraße', city: 'Isselbach', housenumber: null, lat: 50.3, lon: 7.9 };
  const grafling = { main: 'Rathaus', sub: 'Hauptstraße 2, 94539 Grafling', street: null, road: 'Hauptstraße', city: 'Grafling', housenumber: '2', lat: 48.9, lon: 13 };
  const [a] = keepHouseNumber([isselbach, grafling], '2');
  assert.equal(a.main, 'Hauptstraße 2');
  assert.equal(a.sub, '65558 Isselbach');
  assert.match(a.note, /Hausnummer nicht in der Karte/);
});

test('googleMapsUrl: Adressen mit Hausnummer als Text, sonst Koordinaten; Stopps immer Koordinaten', async () => {
  const { googleMapsUrl } = await import('../js/navlink.js');
  const url = new URL(googleMapsUrl({
    from: { label: 'Alzey, Carl-Theodor-Straße 12', lat: 49.74658, lon: 8.11621 },
    to: { label: 'Hauptstraße 2, 65558 Isselbach', lat: 50.331, lon: 7.932 },
    stops: [{ lat: 50.1, lon: 8.0 }, { lat: 50.2, lon: 7.95 }],
  }));
  assert.equal(url.searchParams.get('origin'), 'Alzey, Carl-Theodor-Straße 12');
  assert.equal(url.searchParams.get('destination'), 'Hauptstraße 2, 65558 Isselbach');
  assert.equal(url.searchParams.get('waypoints'), '50.10000,8.00000|50.20000,7.95000');
  const city = new URL(googleMapsUrl({ from: { label: 'Hamburg', lat: 53.55, lon: 10 }, to: { label: 'München, Bayern', lat: 48.14, lon: 11.58 }, stops: [] }));
  assert.equal(city.searchParams.get('origin'), '53.55000,10.00000');
  assert.equal(city.searchParams.get('destination'), '48.14000,11.58000');
  const old = new URL(googleMapsUrl({ from: { label: 'Hamburg', lat: 53.55, lon: 10 }, to: { label: 'Carl-Theodor-Straße 12, 55232 Alzey · Hausnummer nicht in der Karte – Ziel ist die Straße', lat: 49.7, lon: 8.1 }, stops: [] }));
  assert.equal(old.searchParams.get('destination'), 'Carl-Theodor-Straße 12, 55232 Alzey');
});
