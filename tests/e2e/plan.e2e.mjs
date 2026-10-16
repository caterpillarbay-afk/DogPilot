// Planen: Einrichtung, Fahrtübersicht, Tageskacheln und runde Uhr, Ankunftszeit, „Mit Hunden“, Teilen
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, openApp, onboard, planTrip, choosePlace, text } from './helpers.mjs';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.server.close());

test('Fahrt Hamburg → München planen: Ladestopps mit Belegung, ohne Hunde nur Mensch-Bewertung', async () => {
  const app = await openApp(srv.url);
  try {
    await onboard(app.page);
    assert.equal(await app.page.getAttribute('[data-dogs]', 'aria-pressed'), 'false');   // standardmäßig ohne Hunde
    await planTrip(app.page);
    const stops = await app.page.$$('.stop-card');
    assert.ok(stops.length >= 2, `${stops.length} Stopps`);
    await app.page.waitForFunction(() => [...document.querySelectorAll('.stop-card .live')].every(e => !/abgerufen/.test(e.textContent)));
    assert.match(await text(app.page, '.stop-card .live'), /frei|belegt|gestört|Keine Live/);
    assert.doesNotMatch(await text(app.page, '.timeline'), /Hund \d/);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('Mit Hunden: Hinweis auf Gassi-Pausen und Hund-Bewertung', async () => {
  const app = await openApp(srv.url);
  try {
    await onboard(app.page);
    await app.page.click('[data-dogs]');
    assert.match(await text(app.page, '.field:has([data-dogs])'), /Gassi-Pausen spätestens nach 2 Stunden/);
    await planTrip(app.page);
    assert.match(await text(app.page, '.timeline'), /Hund \d/);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('Tageskacheln mit Wochentag und runde Uhr; Ankunftszeit mit Puffer', async () => {
  const app = await openApp(srv.url);
  const { page } = app;
  try {
    await onboard(page);
    const chips = await page.$$eval('.day:not(.other)', e => e.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
    assert.match(chips[0], /^Heute/); assert.match(chips[1], /^Morgen/); assert.match(chips[2], /^(Mo|Di|Mi|Do|Fr|Sa|So)\s?\d\d\.\d\d\.$/);
    await page.click('.day >> nth=3');
    assert.equal(await page.getAttribute('.day >> nth=3', 'aria-checked'), 'true');
    // Uhr: Stunde 7 außen, dann Minute 30
    await page.click('#tripTime');
    const tap = async (x, y) => { const b = await page.locator('.clock-dial').boundingBox(); await page.mouse.click(b.x + b.width / 2 + x * b.width / 2, b.y + b.height / 2 + y * b.height / 2); };
    await tap(Math.sin(7 * Math.PI / 6) * 0.8, -Math.cos(7 * Math.PI / 6) * 0.8);
    assert.ok(await page.isVisible('[data-c="minute"].on'));
    await tap(0, 0.8);
    await page.click('[data-c="ok"]');
    assert.equal(await text(page, '#tripTime'), '07:30 Uhr');
    assert.match(await text(page, '#daySummary'), /, 07:30 Uhr$/);
    // Schnellwahl
    await page.click('#tripTime'); await page.click('[data-p="3"]');
    assert.equal(await text(page, '#tripTime'), '08:00 Uhr');
    // Ankunft bis morgen 14:00 → Banner „Spätestens losfahren“
    await page.click('[data-tmode="arrive"]');
    assert.match(await text(page, '.field-label >> nth=0'), /Ankommen am|Start/);
    await page.click('.day >> nth=2');
    await page.click('#tripTime'); await page.click('[data-p="1"]');   // 14:00
    await choosePlace(page, 'from', 'Hamb'); await choosePlace(page, 'to', 'Münch');
    await page.click('#planBtn');
    await page.waitForSelector('.timeline', { timeout: 30000 });
    assert.match(await text(page, '.notice'), /Spätestens losfahren.*Puffer bis .*14:00 Uhr/);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('Uhr passt auf kleine Bildschirme mit großer Schrift', async () => {
  const app = await openApp(srv.url);
  try {
    await onboard(app.page);
    await app.page.setViewportSize({ width: 320, height: 568 });
    await app.page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    await app.page.click('#tripTime');
    const ok = await app.page.locator('[data-c="ok"]').boundingBox();
    assert.ok(ok.y + ok.height <= 568 && ok.x + ok.width <= 320, JSON.stringify(ok));
  } finally { await app.close(); }
});

test('Menü: „DogPilot teilen“ schickt Link und Kurzanleitung', async () => {
  const app = await openApp(srv.url);
  try {
    await onboard(app.page);
    await app.page.click('#menuBtn');
    await app.page.click('[data-action="share-app"]');
    const shared = await app.page.evaluate(() => window.__shared);
    assert.equal(shared.url, srv.url + '/');
    assert.match(shared.text, /App installieren/);
  } finally { await app.close(); }
});
