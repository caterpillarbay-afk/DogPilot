import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dialValue } from '../js/clock.js';

test('Zifferblatt: außen 1–12, innen 13–00, Minuten in 5er-Schritten', () => {
  assert.equal(dialValue(0, -0.8, 'hour'), 12);   // oben außen
  assert.equal(dialValue(0, -0.5, 'hour'), 0);    // oben innen
  assert.equal(dialValue(0.8, 0, 'hour'), 3);
  assert.equal(dialValue(0, 0.5, 'hour'), 18);    // unten innen
  assert.equal(dialValue(-0.8, 0, 'hour'), 9);
  assert.equal(dialValue(0.75, -0.43, 'hour'), 2); // ~60°
  assert.equal(dialValue(0, 0.8, 'minute'), 30);
  assert.equal(dialValue(-0.8, 0, 'minute'), 45);
  assert.equal(dialValue(0.05, -0.8, 'minute'), 0);
});
