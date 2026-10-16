// DogPilot – Einstellungen als Datei sichern und wiederherstellen (Einstellungen und Willkommensseite).

import { native } from '../native.js';
import { makeBackup, backupFileName, restoreBackup } from '../backup.js';
import { $, state, toast, save, go, route, render } from './core.js';

export function saveBackup() {
  const json = JSON.stringify(makeBackup(state.settings), null, 1);
  if (native) { native.saveFile(backupFileName(), 'application/json', json); return; }   // Android-App: Speicherort wählen
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = backupFileName();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('Sicherung gespeichert (Ordner „Downloads“)');
}

// Dateiauswahl #backupFile: Sicherung prüfen, nachfragen, übernehmen
export function bindRestore(root) {
  $('#backupFile', root)?.addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const next = restoreBackup(await file.text(), state.settings);
      if (state.settings.onboarded && !confirm('Fahrzeug, Hunde und Vorlieben durch die Sicherung ersetzen?')) return;
      state.settings = next;
      state.draftDogs = structuredClone(next.dogs);
      await save();
      toast('Sicherung wiederhergestellt');
      // Willkommensseite: gleich weiter zur Planung (oder, falls Angaben fehlen, zur Einrichtung)
      if (route().name === 'settings') render(); else go('#/plan');
    } catch (err) {
      toast(err.message);
    }
  });
}

