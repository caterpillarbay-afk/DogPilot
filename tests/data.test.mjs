import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchVariants } from '../js/data.js';

const specs = [
  { marke: 'Audi', modell: 'Q4 e-tron 45', jahr: 2023, akkuKWh: 77, dcKw: 135 },
  { marke: 'Audi', modell: 'Q4 Sportback e-tron 45', jahr: 2023, akkuKWh: 77, dcKw: 150 },
  { marke: 'Audi', modell: 'e-tron GT', jahr: 2021, akkuKWh: 84, dcKw: 270 },
  { marke: 'Mercedes', modell: 'EQA 250', jahr: 2021, akkuKWh: 66.5, dcKw: 100 },
  { marke: 'Opel', modell: 'Corsa-e', jahr: 2020, akkuKWh: 46, dcKw: 100 },
  { marke: 'Tesla', modell: 'Model 3 Long Range', jahr: 2023, akkuKWh: 75, dcKw: 250 },
  { marke: 'Tesla', modell: 'Model Y', jahr: 2023, akkuKWh: 75, dcKw: 250 },
];
const names = r => r.map(v => v.modell);

test('matchVariants: EEA-Schreibweisen finden passende Varianten', () => {
  assert.deepEqual(names(matchVariants(specs, 'AUDI', 'Q4')), ['Q4 e-tron 45', 'Q4 Sportback e-tron 45']);
  assert.deepEqual(names(matchVariants(specs, 'AUDI', 'Q4 45 E-TRON')), ['Q4 e-tron 45', 'Q4 Sportback e-tron 45']);   // kein Präfix → erstes Wort
  assert.deepEqual(names(matchVariants(specs, 'MERCEDES-BENZ', 'EQA')), ['EQA 250']);
  assert.deepEqual(names(matchVariants(specs, 'OPEL', 'CORSA-E')), ['Corsa-e']);
  assert.deepEqual(names(matchVariants(specs, 'TESLA', 'MODEL 3')), ['Model 3 Long Range']);
  assert.deepEqual(names(matchVariants(specs, 'TESLA', 'TESLA MODEL Y')), ['Model Y']);
});

test('matchVariants: nichts Passendes → leere Liste', () => {
  assert.deepEqual(matchVariants(specs, 'BYD', 'DOLPHIN'), []);
  assert.deepEqual(matchVariants(specs, 'AUDI', 'A6'), []);
  assert.deepEqual(matchVariants(specs, 'AUDI', ''), []);
  assert.deepEqual(matchVariants(null, 'AUDI', 'Q4'), []);
});

test('matchVariants: Akzente und mehrteilige Markennamen', () => {
  const more = [{ marke: 'Citroën', modell: 'ë-C3', jahr: 2024, akkuKWh: 44, dcKw: 100 }, { marke: 'Alfa Romeo', modell: 'Junior Elettrica', jahr: 2024, akkuKWh: 51, dcKw: 100 }];
  assert.deepEqual(names(matchVariants(more, 'CITROEN', 'E-C3')), ['ë-C3']);
  assert.deepEqual(names(matchVariants(more, 'ALFA ROMEO', 'ALFA ROMEO JUNIOR')), ['Junior Elettrica']);
});
