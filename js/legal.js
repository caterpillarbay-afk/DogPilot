// Impressum, Datenschutz, Quellen. Rot markierte Platzhalter vor Veröffentlichung ausfüllen.

const todo = t => `<span class="todo">[${t}]</span>`;
const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

export const LEGAL = {
  impressum: {
    title: 'Impressum',
    html: `
<p>Angaben gemäß § 5 DDG</p>
<p>${todo('Vorname Nachname')}<br>${todo('Straße Hausnummer')}<br>${todo('PLZ Ort')}<br>Deutschland</p>
<p>E-Mail: ${todo('E-Mail-Adresse')}</p>
<p>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV: ${todo('Vorname Nachname, Anschrift wie oben')}</p>
<p><b>Haftungshinweis:</b> Reichweiten, Ladezeiten und Ankunftszeiten sind Schätzungen auf Basis öffentlicher Daten. Verfügbarkeit und Zustand von Ladesäulen und Rastanlagen können abweichen. Bitte plane eine Reserve ein und beachte die Anzeige deines Fahrzeugs.</p>`,
  },
  datenschutz: {
    title: 'Datenschutz',
    html: `
<p><b>Verantwortlich:</b> siehe Impressum.</p>
<p><b>Keine Konten, kein Tracking, keine Cookies.</b> DogPilot setzt keine Analyse- oder Werbedienste ein.</p>
<p><b>Speicherung auf deinem Gerät:</b> Fahrzeug, Hunde (Name, Foto), Ladevorlieben, optionale Schlüssel und deine letzte Fahrt werden ausschließlich lokal im Browser (IndexedDB) gespeichert und nicht an uns übertragen. Du kannst alles unter Einstellungen → „Alle Daten löschen“ entfernen.</p>
<p><b>Standort:</b> Nur wenn du „Aktueller Standort“ oder die Ortung auf der Karte nutzt, fragt der Browser nach Erlaubnis. Die Position wird nur für die jeweilige Funktion verwendet.</p>
<p><b>Hosting:</b> Die App wird über Cloudflare (Cloudflare, Inc., USA) ausgeliefert. Dabei verarbeitet Cloudflare technisch notwendige Verbindungsdaten wie IP-Adresse und Zeitpunkt des Abrufs (Art. 6 Abs. 1 lit. f DSGVO).</p>
<p><b>Externe Dienste:</b> Für ihre Funktionen ruft die App Dienste Dritter direkt von deinem Gerät aus auf. Dabei erhalten diese deine IP-Adresse und die jeweils nötigen Angaben (Art. 6 Abs. 1 lit. b/f DSGVO):</p>
<ul>
  <li><b>komoot GmbH (Deutschland), Photon</b> – eingegebener Suchtext für Start und Ziel</li>
  <li><b>FOSSGIS e.V. (Deutschland), Valhalla und OSRM</b> – Koordinaten von Start und Ziel für Route und Höhenprofil</li>
  <li><b>Open-Meteo (APIs GmbH, Schweiz)</b> – grobe Koordinaten (Start, Mitte, Ziel) für die Temperaturvorhersage</li>
  <li><b>OpenStreetMap Foundation (Großbritannien)</b> – Kartenkacheln für den sichtbaren Kartenausschnitt</li>
  <li><b>TomTom International B.V. (Niederlande)</b> – Koordinaten von Start und Ziel sowie dein Schlüssel, nur wenn du einen TomTom-Schlüssel einträgst</li>
  <li><b>Open Charge Map (Großbritannien)</b> – Koordinaten eines Ladestopps, nur wenn du einen eigenen Schlüssel einträgst</li>
</ul>
<p><b>Deine Rechte:</b> Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Widerspruch und Beschwerde bei einer Datenschutz-Aufsichtsbehörde. Kontakt: siehe Impressum.</p>
<p class="hint">Stand: ${todo('Datum')}. Entwurf – vor der Veröffentlichung rechtlich prüfen lassen.</p>`,
  },
  quellen: {
    title: 'Quellen und Lizenzen',
    html: `
<ul>
  <li><b>Fahrzeugverbrauch:</b> Europäische Umweltagentur (EEA), CO2-Monitoringdaten Pkw – ${link('https://www.eea.europa.eu/en/legal-notice', 'Nutzungsbedingungen der EEA')}; Werte aufbereitet und zusammengefasst, monatlich aktualisiert.</li>
  <li><b>Akku und Ladeleistung je Variante:</b> ${link('https://github.com/KilowattApp/open-ev-data', 'Open EV Data')} (KilowattApp), MIT-Lizenz mit Namensnennung; monatlich aktualisiert.</li>
  <li><b>Ladesäulen:</b> Bundesnetzagentur, Ladesäulenregister – ${link('https://www.bundesnetzagentur.de/ladeinfrastruktur.html', 'bundesnetzagentur.de')}, Lizenz: ${todo('laut Downloadseite prüfen, z. B. CC BY 4.0')}; monatlich aktualisiert.</li>
  <li><b>Rastanlagen und Ausstattung:</b> © ${link('https://www.openstreetmap.org/copyright', 'OpenStreetMap-Mitwirkende')}, ODbL; über die Overpass API, monatlich aktualisiert.</li>
  <li><b>Karte:</b> © ${link('https://www.openstreetmap.org/copyright', 'OpenStreetMap-Mitwirkende')}, Kacheln der OpenStreetMap Foundation.</li>
  <li><b>Ortssuche:</b> ${link('https://photon.komoot.io', 'Photon')} von komoot, Daten © OpenStreetMap-Mitwirkende.</li>
  <li><b>Routing und Höhenprofil:</b> ${link('https://valhalla1.openstreetmap.de', 'Valhalla')} und ${link('https://routing.openstreetmap.de', 'OSRM')}, betrieben von FOSSGIS e.V.; mit eigenem Schlüssel © TomTom.</li>
  <li><b>Wetter:</b> ${link('https://open-meteo.com', 'Open-Meteo.com')}, CC BY 4.0.</li>
  <li><b>Ladesäulen-Status (optional):</b> ${link('https://openchargemap.org', 'Open Charge Map')}, CC BY 4.0.</li>
  <li><b>Kartenbibliothek:</b> Leaflet 1.9.4, BSD-2-Clause.</li>
  <li><b>Symbole:</b> Lucide, ISC-Lizenz.</li>
</ul>`,
  },
};
