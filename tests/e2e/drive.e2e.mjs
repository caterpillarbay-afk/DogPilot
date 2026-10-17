// Fahrt-Modus: simulierte Fahrt (GPS wandert die Route entlang), Ansagen, Lade-Timer, Ankunft und Verbrauch lernen
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, openApp, onboard, planTrip, PTS, PLACES, text } from './helpers.mjs';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.server.close());

test('Fahrt-Modus von Hamburg bis München', async () => {
  const app = await openApp(srv.url, { fakeClock: true });
  const { page, ctx } = app;
  try {
    await onboard(page);
    await planTrip(page);
    await page.waitForSelector('#traffic .ev');
    await page.click('[data-action="drive-start"]');
    for (let i = 0; i < PTS.length - 40; i += 6) {
      await ctx.setGeolocation({ latitude: PTS[i][0], longitude: PTS[i][1] });
      await page.waitForTimeout(60);
    }
    // am ersten Ladestopp stehen bleiben und die Ladezeit vorspulen
    const st = await page.evaluate(async () => (await import('/js/store.js')).loadSettings().then(s => s.lastTrip.stops.find(x => x.kind === 'charge')));
    await ctx.setGeolocation({ latitude: st.lat, longitude: st.lon }); await page.waitForTimeout(300);
    assert.match(await text(page, '#drive-status'), /noch ca\./);
    await page.clock.fastForward((st.stopMin - 4) * 60000); await page.waitForTimeout(200);
    await page.clock.fastForward(5 * 60000); await page.waitForTimeout(200);
    // Ziel
    await ctx.setGeolocation({ latitude: PLACES.München[0], longitude: PLACES.München[1] }); await page.waitForTimeout(500);
    const said = await page.evaluate(() => window.__said);
    const all = said.join('\n');
    assert.match(said[0], /^Fahrt-Modus an\. Ich melde mich vor Pausen/);
    assert.match(all, /Minuten Ladestopp: .*Kilowatt\./);
    assert.match(all, /Achtung: In etwa \d+ Kilometern Sperrung auf der A7/);
    assert.match(all, /An deinem Autobahnwechsel .*Überleitung im Autobahnkreuz gesperrt/);
    assert.match(all, /Noch etwa 5 Minuten Laden/);
    assert.match(all, /Du kannst weiterfahren\. Nächster Halt: /);
    assert.match(said.at(-1), /^Du bist am Ziel: München/);
    // „Angekommen?“ → Verbrauch lernen
    await page.fill('#fbSoc', '14');
    await page.click('[data-action="fb-save"]');
    assert.match(await text(page, '#toast'), /als geplant|wie geplant|zu kurz/);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('Zeitplan zählt ab der tatsächlichen Abfahrt – App lange offen bzw. später losgefahren', async () => {
  const app = await openApp(srv.url, { fakeClock: true });
  const { page, ctx } = app;
  const said = () => page.evaluate(() => window.__said.join('\n'));
  try {
    await onboard(page);
    // App seit zwei Stunden offen, erst dann geplant: Abfahrt ist „jetzt“, nicht die Zeit beim Öffnen
    await page.clock.fastForward(2 * 3600000);
    await planTrip(page);
    const dep = await page.evaluate(async () => (await import('/js/store.js')).loadSettings().then(s => new Date(s.lastTrip.departure).getTime()));
    assert.ok(Math.abs(dep - await page.evaluate(() => Date.now())) < 2 * 60000, 'Abfahrt = jetzt');
    // 80 Minuten später losgefahren: keine Verspätungsansage
    await page.clock.fastForward(80 * 60000);
    await page.click('[data-action="drive-start"]');
    for (let i = 0; i < 40; i += 4) {
      await ctx.setGeolocation({ latitude: PTS[i][0], longitude: PTS[i][1] });
      await page.waitForTimeout(60);
    }
    assert.doesNotMatch(await said(), /hinter dem Plan/);
    // Dann 30 Minuten im Stau: das wird angesagt
    await page.clock.fastForward(30 * 60000);
    await ctx.setGeolocation({ latitude: PTS[44][0], longitude: PTS[44][1] }); await page.waitForTimeout(300);
    assert.match(await said(), /Du liegst etwa [1-3]\d Minuten hinter dem Plan/);
  } finally { await app.close(); }
});
