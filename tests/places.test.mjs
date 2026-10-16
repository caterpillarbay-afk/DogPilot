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
  const street = { main: 'Carl-Theodor-Straße', sub: '55232 Alzey', street: 'Carl-Theodor-Straße', housenumber: null, lat: 49.7, lon: 8.1 };
  // Wie bei Photon für „Carl-Theodor-Straße 12 Alzey“: dieselbe Nummer gibt es nur in einer anderen Straße
  const other = { main: 'Carl-von-Ossietzky-Straße 12', sub: '55232 Alzey', street: null, road: 'Carl-von-Ossietzky-Straße', housenumber: '12', lat: 49.7, lon: 8.1 };
  const [a, b] = keepHouseNumber([street, other], '12');
  assert.equal(a.main, 'Carl-Theodor-Straße 12');
  assert.match(a.sub, /^55232 Alzey · Hausnummer nicht in der Karte/);
  assert.deepEqual(b, other);
  // Kennt die Karte das Haus in derselben Straße, bleibt die Straße wie geliefert
  const house = { main: 'Carl-Theodor-Straße 12', sub: '55232 Alzey', street: null, road: 'Carl-Theodor-Straße', housenumber: '12', lat: 49.7, lon: 8.1 };
  assert.deepEqual(keepHouseNumber([house, street], '12')[1], street);
  // Ohne Nummer in der Eingabe: unverändert
  assert.deepEqual(keepHouseNumber([street], null), [street]);
});
