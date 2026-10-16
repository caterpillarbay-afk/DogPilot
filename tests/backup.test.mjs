import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, restoreBackup, backupFileName } from '../js/backup.js';
import { feedbackMail, deviceLabel } from '../js/feedback.js';
import { DEFAULT_SETTINGS } from '../js/store.js';

const mine = () => {
  const s = structuredClone(DEFAULT_SETTINGS);
  Object.assign(s.vehicle, { make: 'Audi', model: 'Q4 Sportback e-tron', capacityKWh: 77, consumptionKWh100: 19, carMaxKw: 175, photo: 'data:image/jpeg;base64,AAA', learned: { factor: 1.08, trips: 3 } });
  s.dogs = [{ id: 'a', name: 'Schoko', photo: 'data:image/jpeg;base64,BBB' }, { id: 'b', name: 'Fibi', photo: null }];
  s.charging.minChargerKw = 100;
  s.keys.tomtom = 'GEHEIM';
  s.lastTrip = { from: { label: 'Alzey' } };
  s.onboarded = true;
  return s;
};

test('Sicherung enthält Fahrzeug, Hunde und Vorlieben, aber keinen Schlüssel und keine Fahrt', () => {
  const b = makeBackup(mine(), new Date('2026-10-14T10:00:00Z'));
  const text = JSON.stringify(b);
  assert.equal(b.kind, 'dogpilot-backup');
  assert.equal(b.settings.vehicle.capacityKWh, 77);
  assert.equal(b.settings.dogs.length, 2);
  assert.ok(!text.includes('GEHEIM'));
  assert.ok(!('lastTrip' in b.settings) && !('keys' in b.settings));
  assert.equal(backupFileName(new Date('2026-10-14T10:00:00Z')), 'dogpilot-sicherung-2026-10-14.json');
});

test('Wiederherstellen auf neuem Gerät übernimmt alles, behält eigenen Schlüssel', () => {
  const text = JSON.stringify(makeBackup(mine()));
  const fresh = structuredClone(DEFAULT_SETTINGS);
  fresh.keys.tomtom = 'NEU';
  const s = restoreBackup(text, fresh);
  assert.equal(s.vehicle.make, 'Audi');
  assert.equal(s.vehicle.learned.factor, 1.08);
  assert.deepEqual(s.dogs.map(d => d.name), ['Schoko', 'Fibi']);
  assert.equal(s.charging.minChargerKw, 100);
  assert.equal(s.charging.reserveSoc, DEFAULT_SETTINGS.charging.reserveSoc);
  assert.equal(s.keys.tomtom, 'NEU');
  assert.equal(s.lastTrip, null);
  assert.equal(s.onboarded, true);
  assert.equal(fresh.vehicle.make, '', 'Eingabe bleibt unverändert');
});

test('Wiederherstellen lehnt fremde und kaputte Dateien verständlich ab', () => {
  const cur = structuredClone(DEFAULT_SETTINGS);
  assert.throws(() => restoreBackup('kein json', cur), /keine DogPilot-Sicherung/);
  assert.throws(() => restoreBackup('{"foo":1}', cur), /keine DogPilot-Sicherung/);
  assert.throws(() => restoreBackup(JSON.stringify({ kind: 'dogpilot-backup', version: 9, settings: {} }), cur), /neueren DogPilot-Version/);
  const bad = { kind: 'dogpilot-backup', version: 1, settings: { dogs: [{ name: 'X', photo: 'javascript:alert(1)' }, 'quatsch', { photo: 'x' }], vehicle: { photo: 'http://evil' } } };
  const s = restoreBackup(JSON.stringify(bad), cur);
  assert.deepEqual(s.dogs, [{ name: 'X', id: 'dog0', photo: null }]);
  assert.equal(s.vehicle.photo, null);
});

test('Feedback-Mail: Version, Gerät, letzte Fahrt nur mit Ortsnamen', () => {
  const ua = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
  assert.equal(deviceLabel(ua), 'Android 14 · Chrome 141');
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1'), 'iOS 18.2 · Safari 18');
  const trip = { from: { label: 'Alzey, Carl-Theodor-Straße 12', lat: 49.7, lon: 8.1 }, to: { label: 'Hannover, Niedersachsen' }, departure: new Date(2026, 9, 16, 8, 5).toISOString(), stops: [{}, {}], withDogs: false, provider: 'Valhalla' };
  const href = feedbackMail({ version: '2026.10.14', ua, screen: '412×915', trip });
  assert.ok(href.startsWith('mailto:caterpillar.bay@gmx.de?subject='));
  const body = decodeURIComponent(href.split('body=')[1]);
  assert.match(decodeURIComponent(href.split('subject=')[1].split('&')[0]), /DogPilot-Feedback \(2026\.10\.14\)/);
  assert.match(body, /Gerät: Android 14 · Chrome 141/);
  assert.match(body, /Letzte Fahrt: Alzey → Hannover, Abfahrt 16\.10\.2026 08:05, 2 Stopps, ohne Hunde,/);
  assert.ok(!body.includes('Carl-Theodor') && !body.includes('49.7'));
  assert.match(decodeURIComponent(feedbackMail({ version: 'x', ua, screen: '1×1', trip: null })), /Letzte Fahrt: keine/);
});
