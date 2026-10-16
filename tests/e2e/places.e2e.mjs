// Ortssuche: langsame Antwort, Ausfall mit Ersatzsuche, eingetippter Text bleibt stehen, aktueller Standort
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, openApp, onboard, choosePlace, text } from './helpers.mjs';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.server.close());

test('Langsame Ortssuche: „Suche läuft …“ und Planen ohne angetippten Vorschlag', async () => {
  const app = await openApp(srv.url, { photonDelayMs: 2500 });
  const { page } = app;
  try {
    await onboard(page);
    await choosePlace(page, 'from', 'Hamb');
    await page.fill('#to', 'Münch');
    await page.waitForTimeout(400);
    assert.match(await text(page, '#to-list'), /Suche läuft/);
    await page.evaluate(() => document.activeElement.blur());
    await page.click('#planBtn');
    await page.waitForSelector('.timeline', { timeout: 30000 });
    assert.match(await text(page, '.route-head .title'), /Hamburg → München/);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('Ortssuche fällt aus: Vorschlag kommt aus Nominatim', async () => {
  const app = await openApp(srv.url, { photonDown: true });
  try {
    await onboard(app.page);
    await app.page.fill('#to', 'Prien');
    await app.page.waitForSelector('#to-list button');
    assert.match(await text(app.page, '#to-list'), /Prien am Chiemsee.*Bayern/);
  } finally { await app.close(); }
});

test('Eingetippter Ort bleibt beim Umschalten Abfahrt/Ankunft, Beladung und Tauschen stehen', async () => {
  const app = await openApp(srv.url);
  const { page } = app;
  try {
    await onboard(page);
    await choosePlace(page, 'from', 'Hamb');
    await page.fill('#to', 'Prien am Chiemsee');
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForTimeout(300);
    for (const sel of ['[data-tmode="arrive"]', '[data-tmode="depart"]', '[data-load="roof"]']) {
      await page.click(sel);
      assert.equal(await page.inputValue('#to'), 'Prien am Chiemsee', sel);
    }
    await page.click('#swap');
    assert.equal(await page.inputValue('#from'), 'Prien am Chiemsee');
    assert.match(await page.inputValue('#to'), /^Hamburg/);
  } finally { await app.close(); }
});

test('„Aktueller Standort“ wird als Ort beschriftet', async () => {
  const app = await openApp(srv.url);
  try {
    await onboard(app.page);
    await app.page.click('#from');
    await app.page.click('#from-list button:has-text("Aktueller Standort")');
    await app.page.waitForFunction(() => document.querySelector('#from').value.startsWith('Alzey'));
    assert.equal(await app.page.inputValue('#from'), 'Alzey, Carl-Theodor-Straße 12');
  } finally { await app.close(); }
});

test('Zuhause: einmal festlegen, dann in Start oder Ziel mit einem Tipp übernehmen', async () => {
  const app = await openApp(srv.url);
  const { page } = app;
  try {
    await onboard(page);
    await page.fill('#to', 'Münch');
    await page.click('#to-list button >> nth=0');
    // Enter im leeren Feld übernimmt nicht ungefragt die Schnellauswahl
    await page.focus('#from');
    await page.keyboard.press('Enter');
    assert.ok(await page.$('#from'), 'bleibt auf der Planung');
    assert.equal(await page.inputValue('#from'), '');
    // Noch kein Zuhause: Hinweis führt in die Einstellungen
    await page.focus('#from');
    await page.click('#from-list button:has-text("Zuhause festlegen")');
    await page.waitForSelector('#home');
    await choosePlace(page, 'home', 'Hamb');
    await page.waitForSelector('#homeClear');
    assert.equal(await page.inputValue('#home'), 'Hamburg');
    // Zurück zur Planung: Ziel bleibt, Zuhause steht ganz oben
    await page.click('#tabbar [data-tab="plan"]');
    await page.waitForSelector('#from');
    assert.match(await page.inputValue('#to'), /München/);
    await page.focus('#from');
    const first = await page.textContent('#from-list button >> nth=0');
    assert.match(first, /Zuhause\s*Hamburg/);
    await page.click('#from-list button >> nth=0');
    assert.equal(await page.inputValue('#from'), 'Hamburg');
    // Auch bei gefülltem Feld (z. B. Rückfahrt): antippen → Zuhause
    await page.click('#swap');
    await page.focus('#to');
    await page.click('#to-list button:has-text("Zuhause")');
    assert.equal(await page.inputValue('#to'), 'Hamburg');
    await page.click('#planBtn');
    await page.waitForSelector('.stop-card');
  } finally { await app.close(); }
});
