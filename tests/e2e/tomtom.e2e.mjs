// TomTom-Schlüssel: testen in den Einstellungen, Grund anzeigen, wenn ohne Live-Verkehr geplant wurde
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, openApp, onboard, planTrip } from './helpers.mjs';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.server.close());

async function setKey(page, key) {
  await page.click('#tabbar [data-tab="settings"]');
  await page.click('[data-href="#/settings/advanced"]');
  await page.fill('#kTomtom', key);
}

test('Falscher Schlüssel: Testknopf und Fahrt nennen den Grund, Route über Valhalla', async () => {
  const app = await openApp(srv.url);
  const { page } = app;
  try {
    await onboard(page);
    await setKey(page, 'FALSCH');
    await page.click('#testKey');
    await page.waitForSelector('.toast:has-text("TomTom")');
    assert.match(await page.textContent('.toast'), /Schlüssel ungültig oder gesperrt/);
    await page.click('#tabbar [data-tab="plan"]');
    await planTrip(page);
    assert.match(await page.textContent('.route-head'), /Valhalla/);
    assert.match(await page.textContent('.notice.warn'), /TomTom nicht erreichbar: Schlüssel ungültig/);
  } finally { await app.close(); }
});

test('Gültiger Schlüssel: Route mit Live-Verkehr, kein Hinweis', async () => {
  const app = await openApp(srv.url);
  const { page } = app;
  try {
    await onboard(page);
    await setKey(page, 'GUT');
    await page.click('#testKey');
    await page.waitForSelector('.toast:has-text("funktioniert")');
    await page.click('#tabbar [data-tab="plan"]');
    await planTrip(page);
    assert.match(await page.textContent('.route-head'), /TomTom \(mit Live-Verkehr\)/);
    assert.equal(await page.$('.notice.warn:has-text("TomTom")'), null);
  } finally { await app.close(); }
});

test('Hausnummer, die OpenStreetMap nicht kennt: bleibt sichtbar, mit Schlüssel genau von TomTom', async () => {
  const app = await openApp(srv.url);
  const { page } = app;
  const firstHit = async () => {
    await page.fill('#from', '');
    await page.fill('#from', 'Carl-Theodor-Straße 12 Alzey');
    await page.waitForSelector('#from-list button:has-text("Carl")');
    return page.textContent('#from-list button >> nth=0');
  };
  try {
    await onboard(page);
    const plain = await firstHit();
    assert.match(plain, /Carl-Theodor-Straße 12/);
    assert.match(plain, /Hausnummer nicht in der Karte/);
    await setKey(page, 'GUT');
    await page.click('#tabbar [data-tab="plan"]');
    const exact = await firstHit();
    assert.match(exact, /Carl-Theodor-Straße 12\s*55232 Alzey/);
    assert.doesNotMatch(exact, /nicht in der Karte/);
    await page.click('#from-list button >> nth=0');
    assert.equal(await page.inputValue('#from'), 'Carl-Theodor-Straße 12, 55232 Alzey');
  } finally { await app.close(); }
});
