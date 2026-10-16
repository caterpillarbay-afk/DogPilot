// Baustellen & Sperrungen: Fahrtrichtung, Gültigkeit, Zusammenfassen, Alltagssprache, Autobahnwechsel
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, openApp, onboard, planTrip, text } from './helpers.mjs';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.server.close());

test('Meldungen der Autobahn GmbH entlang der Route', async () => {
  const app = await openApp(srv.url);
  const { page } = app;
  try {
    await onboard(page);
    await planTrip(page);
    await page.waitForSelector('#traffic .ev');
    const card = await text(page, '#traffic');
    assert.match(card, /1 Sperrung/);
    assert.match(card, /1 Meldung dort, wo du auf-, ab- oder auf eine andere Autobahn fährst/);
    assert.match(card, /1 an Auf- und Abfahrten/);
    // drei Überleitungen am selben Kreuz: ein Eintrag mit drei Richtungen
    const wechsel = page.locator('#traffic .ev', { hasText: 'Test Wechsel' });
    assert.equal(await wechsel.count(), 1);
    assert.equal(await wechsel.locator('.ev-parts li').count(), 3);
    assert.match(await wechsel.textContent(), /Überleitung im Autobahnkreuz.*an deinem Autobahnwechsel/s);
    // Gegenrichtung und künftige Baustelle fehlen, „Rampe“ ist übersetzt
    assert.doesNotMatch(card, /Gegenrichtung|Zukunft|Rampe/);
    assert.match(card, /Erneuerung der Auf- und Abfahrten/);
    assert.match(card, /Vollsperrung.*gesperrt · bis /);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
