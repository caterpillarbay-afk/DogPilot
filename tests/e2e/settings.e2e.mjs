// Menü „Feedback senden“ sowie Einstellungen sichern und auf einem „neuen Handy“ wiederherstellen
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer, openApp, onboard, planTrip } from './helpers.mjs';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.server.close());

test('Feedback senden: vorbereitete Mail mit Version, Gerät und letzter Fahrt', async () => {
  const app = await openApp(srv.url);
  try {
    await onboard(app.page);
    await planTrip(app.page);
    await app.page.click('#menuBtn');
    const href = await app.page.getAttribute('#feedbackLink', 'href');
    assert.match(href, /^mailto:caterpillar\.bay@gmx\.de\?subject=DogPilot-Feedback/);
    const body = decodeURIComponent(href.split('body=')[1]);
    assert.match(body, /DogPilot \d/);
    assert.match(body, /Bildschirm: \d+×\d+/);
    assert.match(body, /Letzte Fahrt: Hamburg → München, Abfahrt \d\d\.\d\d\.\d{4} \d\d:\d\d, \d+ Stopps, ohne Hunde/);
  } finally { await app.close(); }
});

test('Sichern und auf neuem Gerät über die Willkommensseite wiederherstellen', async () => {
  const app = await openApp(srv.url);
  let file;
  try {
    await onboard(app.page);
    await app.page.goto(srv.url + '/#/settings');
    const [download] = await Promise.all([app.page.waitForEvent('download'), app.page.click('[data-action="backup-save"]')]);
    assert.match(download.suggestedFilename(), /^dogpilot-sicherung-\d{4}-\d\d-\d\d\.json$/);
    file = await download.path();
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(saved.settings.dogs.map(d => d.name), ['Schoko', 'Fibi']);
    assert.ok(!('keys' in saved.settings));
    file = { name: 'sicherung.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) };
  } finally { await app.close(); }

  // Neues Gerät: leerer Speicher, Willkommensseite
  const fresh = await openApp(srv.url);
  try {
    await fresh.page.waitForSelector('#obNext');
    await fresh.page.setInputFiles('#backupFile', file);
    await fresh.page.waitForSelector('#from');
    await fresh.page.goto(srv.url + '/#/settings');
    await fresh.page.waitForSelector('.screen-title');
    const rows = await fresh.page.$$eval('.list-row .value', els => els.map(e => e.textContent));
    assert.ok(rows.some(r => /Q4/.test(r)), rows.join(' | '));
    assert.ok(rows.includes('Schoko, Fibi'), rows.join(' | '));

    // Falsche Datei: verständliche Meldung, nichts geändert
    await fresh.page.setInputFiles('#backupFile', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
    await fresh.page.waitForSelector('.toast');
    assert.match(await fresh.page.textContent('.toast'), /keine DogPilot-Sicherung/);
  } finally { await fresh.close(); }
});
