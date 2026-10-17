// Android-App: Ansagen über die Brücke (Navi-Kanal wählbar), Testansage, Sichern, Teilen, Feedback
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, openApp, onboard, planTrip } from './helpers.mjs';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.server.close());

test('In der Android-App gehen Ansagen über den Navi-Kanal, auf Wunsch über Medien', async () => {
  const app = await openApp(srv.url, { android: true });
  const { page } = app;
  const calls = () => page.evaluate(() => window.__native);
  try {
    await onboard(page);
    await planTrip(page);
    await page.click('[data-action="drive-test"]');
    assert.deepEqual((await calls()).at(-1), ['speak', 'Das ist eine Testansage von DogPilot. Wenn du mich hörst, passt alles.', 'nav', '', 1]);
    assert.deepEqual(await page.evaluate(() => window.__said), [], 'Browser-Sprachausgabe bleibt still');

    // Einstellungen sind zugeklappt; Zusammenfassung zeigt den Kanal
    assert.match(await page.textContent('[data-action="drive-opts"]'), /Alles · über Navi/);
    assert.equal(await page.isVisible('[data-daudio="media"]'), false);
    await page.click('[data-action="drive-opts"]');
    await page.click('[data-daudio="media"]');
    assert.match(await page.textContent('[data-action="drive-opts"]'), /über Medien/);
    await page.click('[data-dpref="schedule"]');
    assert.match(await page.textContent('[data-action="drive-opts"]'), /3 von 4/);
    await page.click('[data-dpref="schedule"]');
    // Stimme und Tempo: Auswahl spricht eine Probe mit genau dieser Stimme
    assert.match(await page.textContent('#driveVoice'), /Stimme 1 · online, natürlicher/);
    await page.selectOption('#driveVoice', 'de-de-x-nfh-network');
    assert.deepEqual((await calls()).at(-1).slice(2), ['media', 'de-de-x-nfh-network', 1]);
    await page.click('[data-drate="1.1"]');
    assert.deepEqual((await calls()).at(-1).slice(2), ['media', 'de-de-x-nfh-network', 1.1]);
    await page.click('[data-action="drive-start"]');
    const c = await calls();
    assert.ok(c.some(x => x[0] === 'speak' && /Fahrt-Modus an/.test(x[1]) && x[2] === 'media'));
    assert.ok(c.some(x => x[0] === 'screen' && x[1] === true));
    await page.click('[data-action="drive-stop"]');
    assert.ok((await calls()).some(x => x[0] === 'screen' && x[1] === false));

    // Menü: Feedback nennt die App-Version, Teilen über Android
    await page.click('#menuBtn');
    const href = await page.getAttribute('#feedbackLink', 'href');
    assert.match(decodeURIComponent(href), /Android-App 1\.7/);
    assert.equal(await page.$('a[href$="DogPilot.apk"]'), null, 'in der App kein Download-Hinweis');
    await page.click('[data-action="share-app"]');
    assert.equal((await calls()).at(-1)[0], 'share');

    // Sichern: Datei über Android speichern
    await page.goto(srv.url + '/#/settings');
    await page.click('[data-action="backup-save"]');
    const save = (await calls()).at(-1);
    assert.equal(save[0], 'save');
    assert.match(save[1], /^dogpilot-sicherung-/);
    assert.equal(JSON.parse(save[3]).kind, 'dogpilot-backup');
  } finally { await app.close(); }
});

test('Im Browser: Testansage über die Sprachausgabe des Browsers', async () => {
  const app = await openApp(srv.url);
  const { page } = app;
  try {
    await onboard(page);
    await planTrip(page);
    await page.click('[data-action="drive-test"]');
    assert.match((await page.evaluate(() => window.__said)).at(-1), /Testansage/);
    assert.equal(await page.$('[data-daudio]'), null);
  } finally { await app.close(); }
});
