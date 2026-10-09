// Impressum, Datenschutz, Quellen.

const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

export const LEGAL = {
  impressum: {
    title: 'Impressum',
    html: `
<p>Angaben gemäß § 5 DDG</p>
<p>Klaus Stumm<br>Carl-Theodor-Straße 12<br>55232 Alzey<br>Deutschland</p>
<p>E-Mail: <a href="mailto:caterpillar.bay@gmx.de">caterpillar.bay@gmx.de</a></p>
<p>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV: Klaus Stumm, Anschrift wie oben</p>
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
  <li><b>Nahverkehrsgesellschaft Baden-Württemberg mbH (Deutschland), MobiData BW</b> – Koordinaten deiner Ladestopps, um die aktuelle Belegung abzurufen</li>
  <li><b>Die Autobahn GmbH des Bundes (Deutschland)</b> – nur die Namen der Autobahnen auf deiner Route (z. B. „A61“), um Baustellen, Sperrungen und Verkehrsmeldungen abzurufen</li>
</ul>
<p><b>Deine Rechte:</b> Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Widerspruch und Beschwerde bei einer Datenschutz-Aufsichtsbehörde. Kontakt: siehe Impressum.</p>
<p class="hint">Stand: 9. Oktober 2026. Entwurf – vor der Veröffentlichung rechtlich prüfen lassen.</p>`,
  },
  quellen: {
    title: 'Quellen und Lizenzen',
    html: `
<ul>
  <li><b>Fahrzeugverbrauch:</b> Europäische Umweltagentur (EEA), CO2-Monitoringdaten Pkw – ${link('https://www.eea.europa.eu/en/legal-notice', 'Nutzungsbedingungen der EEA')}; Werte aufbereitet und zusammengefasst, monatlich aktualisiert.</li>
  <li><b>Akku und Ladeleistung je Variante:</b> ${link('https://github.com/KilowattApp/open-ev-data', 'Open EV Data')} (KilowattApp), MIT-Lizenz mit Namensnennung; monatlich aktualisiert.</li>
  <li><b>Ladesäulen:</b> Ladesäulenregister der Bundesnetzagentur – ${link('https://www.bundesnetzagentur.de/ladesaeulenkarte', 'bundesnetzagentur.de/ladesaeulenkarte')}, Lizenz ${link('https://creativecommons.org/licenses/by/4.0/deed.de', 'CC BY 4.0')}. Daten verändert: auf Ladepunkte ab 11 kW gefiltert, Standorte zusammengefasst; monatlich aktualisiert. Ohne Gewähr für Richtigkeit und Vollständigkeit.</li>
  <li><b>Rastanlagen und Ausstattung:</b> © ${link('https://www.openstreetmap.org/copyright', 'OpenStreetMap-Mitwirkende')}, ODbL; über die Overpass API, monatlich aktualisiert.</li>
  <li><b>Karte:</b> © ${link('https://www.openstreetmap.org/copyright', 'OpenStreetMap-Mitwirkende')}, Kacheln der OpenStreetMap Foundation.</li>
  <li><b>Ortssuche:</b> ${link('https://photon.komoot.io', 'Photon')} von komoot, Daten © OpenStreetMap-Mitwirkende.</li>
  <li><b>Routing und Höhenprofil:</b> ${link('https://valhalla1.openstreetmap.de', 'Valhalla')} und ${link('https://routing.openstreetmap.de', 'OSRM')}, betrieben von FOSSGIS e.V.; mit eigenem Schlüssel © TomTom.</li>
  <li><b>Wetter:</b> ${link('https://open-meteo.com', 'Open-Meteo.com')}, CC BY 4.0.</li>
  <li><b>Ladesäulen-Belegung (live):</b> Meldungen der Betreiber nach der EU-Verordnung AFIR, gebündelt von ${link('https://api.mobidata-bw.de', 'MobiData BW')} (NVBW, Open ChargePoint DataBase); Betreiberdaten CC0, Daten der Bundesnetzagentur CC BY 4.0.</li>
  <li><b>Baustellen, Sperrungen, Verkehrsmeldungen:</b> ${link('https://verkehr.autobahn.de', 'Die Autobahn GmbH des Bundes')} (offene Schnittstelle von verkehr.autobahn.de); nur Autobahnen, ohne Gewähr.</li>
  <li><b>Kartenbibliothek:</b> Leaflet 1.9.4, BSD-2-Clause.</li>
  <li><b>Symbole:</b> Lucide, ISC-Lizenz.</li>
</ul>`,
  },
};
