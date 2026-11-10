# Unabhängiges Review: Fork „LM Steering Solutions“ (10.11.2026)

Stand: `feature/installer` b9797aaa (enthält #20–#27), dazu `feature/eama-import` (#19).
Nur gelesen und ausgeführt, nichts geändert. Noten 1 (sehr gut) bis 5 (nicht genügend).

**Wie geprüft wurde.** Code gelesen (Diff gegen upstream `develop`), ein Probe-Merge mit dem
aktuellen upstream in einem Wegwerf-Arbeitsbaum, die App im Simulator mit echten Touch-Ereignissen
bedient (Chromium, 1280×800, Handschuhgröße, Deutsch) und Bildschirmfotos ausgewertet.
**Nicht geprüft:** echtes Tablet, Windows-Installer in Betrieb, Kit, Board, Motor, echtes GPS.
Alles, was Hardware betrifft, ist deshalb Einschätzung. **Board und Motor sind nicht getestet.**

Kennzeichnung: **[B]** = belegt (Datei:Zeile, Messung oder Bildschirmfoto), **[E]** = Einschätzung.
`tablet.js` = `Shared/AgOpenWeb.RemoteServer/wwwroot/js/tablet.js`, `index.html` im selben `wwwroot`.

| Nr. | Bereich | Note |
|---|---|---|
| 1 | Architektur des Forks | 3 |
| 2 | Sicherheit | 3 |
| 3 | Bedienung in der Kabine (UX) | 3 |
| 4 | Oberfläche (UI) | 2 |
| 5 | Robustheit | 3 |
| 6 | Tests und Qualitätssicherung | 3 |
| 7 | Auslieferung | 4 |
| 8 | Vergleich mit kommerziellen Terminals | 4 |

Kurzurteil: Die Software ist für einen Ein-Mann-Fork ungewöhnlich sorgfältig gebaut und
dokumentiert. Die Schwächen liegen nicht im Fleiß, sondern an drei Stellen: (a) der Aus-Knopf der
Lenkung ist nicht immer erreichbar, (b) nichts davon ist am echten Kit bewiesen, (c) Auslieferung
und Rechtliches sind noch auf dem Stand „Testversion eines privaten Forks“, nicht „Produkt, das
ich verkaufe“.

---

## 1. Architektur des Forks: Note 3

**Belegt**
- [B] Umfang: 279 Dateien, +19 627/−788 Zeilen gegen upstream. Davon `wwwroot` +9 461, Host-C#
  (Services, ViewModels, RemoteWiring, RemoteServer, Desktop) rund +1 400, der Rest Tests, Werkzeuge, Doku.
- [B] Textuelle Trennung ist gut. Probe-Merge mit upstream `develop` 5a2c4251 (86 Commits,
  156 Dateien, +13 205 Zeilen voraus): **3 Konfliktdateien** (`WebViewLauncher.cs` 3 Stellen,
  `de.json` 8, `en.json` 1). Keine der 54 upstream-IDs und 20 upstream-Funktionen, die `tablet.js`
  benutzt, fehlt danach.
- [B] Upstream ist schnell: 86 Commits in 3 Tagen (01.–04.11.). Der Fork war am Prüftag schon wieder
  so weit zurück.
- [B] Die Kopplung ist unsichtbar statt textuell. `tablet.js` überschreibt 13 upstream-Funktionen zur
  Laufzeit (`tablet.js:211, 216, 218, 923, 1039–1041, 1090, 1094, 2644, 2661, 2802, 2965`), hängt an
  54 upstream-IDs und drückt upstream-Knöpfe per Code (`tuiPress`, 18 Stellen). Ein Merge ohne
  Konflikt sagt deshalb nichts darüber, ob es noch funktioniert. Beispiel aus dieser Runde: upstreams
  Filter #465 kam konfliktfrei herein und machte jede zweite Menükachel wirkungslos
  (`docs/Testbefunde-moritz31.md`, Punkt 1).
- [B] `tablet.js` ist ein Klumpen: 5 538 Zeilen, 38 Module in einer Datei, 37 `setInterval`, kein
  gemeinsamer Zustand. Jedes Modul definiert `el`, `onTap`, `T`, `lsGet` neu (z. B. `tablet.js:4005–4007`,
  `4130`, `4224–4226`). Die Module sind in sich ordentlich und kommentiert, aber es gibt kein
  gemeinsames Ereignis „Sprache geladen“, „Modus gewechselt“, „Blatt offen“. Folge: derselbe Fehler
  taucht mehrfach auf (siehe 2: Richtungskarte englisch; vorher Sicherheitshinweis, Ampel).
- [B] Fork-CSS steht in `index.html` (+1 347 Zeilen in einer upstream-Datei), nicht in einer eigenen Datei.
- [B] `de.json`: +1 683/−646 gegen upstream. Der Fork hat upstreams deutsche Texte umgeschrieben;
  das kollidiert bei jedem Abgleich (auch `docs/Offene-Punkte.md` Nr. 17).
- [B] Draht-Format: Fork-Felder sind „hinten angehängt“ (`transport.js`: `backupStatus`, `firstSetup`,
  `minFixQuality`, Toast-Schlüssel). Eine Ausnahme liegt **mitten** im Datensatz: `startedMs`/`endedMs`
  je Auftrag. Hängt upstream an denselben Rahmen etwas an, muss an zwei Stellen (C# und JS) gleich
  aufgelöst werden; ein Fehler dort verschiebt alle folgenden Felder still.
- [B] Host-Ausnahmen: 23 Einträge in `docs/Host-Aenderungen.md`, sauber begründet. Lenk- und
  Regelcode ist unberührt. Die Ausnahmen sind aber mehr geworden als „Ausnahme“: Profil-Backup
  (424 Zeilen), Arbeitsprotokoll, ETag-Cache, Autostart, Einzelinstanz, NTRIP-GGA, keyed Fehlertexte
  an rund 12 upstream-Aufrufstellen (`MainViewModel.Commands.*.cs`).
- [B] Acht gestapelte Zweige (#20–#27, dazu #19). In dieser Sitzung brauchte jede Korrektur sieben
  Merges, mehrfach mit Handarbeit.

**Einschätzung**
- [E] Der nächste Abgleich kostet textuell wenig (Stunden). Teuer ist die Nachprüfung, und die hängt
  an `ui-sweep`/`sim-soak`, die nicht in der CI laufen.
- [E] Sicher brechen wird: `de.json` (jedes Mal), `WebViewLauncher.cs` (jedes Mal, solange upstream
  dort arbeitet), und jede upstream-Umstellung an Statusleiste, rechter Leiste oder Menüs (still, ohne
  Konflikt). Der große Umbau `app.js` → `js/*` hat schon einmal Sonderskripte gebraucht.
- [E] Die Regel „nur wwwroot“ hat den Lenkcode geschützt. Sie hat aber auch Dinge in den Client
  gedrückt, die auf den Host gehören (Sperren, Speicher), siehe 2 und 5.

## 2. Sicherheit: Note 3

**Einschalten durch Fork-Code: kein Weg gefunden**
- [B] `tablet.js` sendet nirgends `autosteer.toggle`. Alle Sendestellen: Profile, Sprache,
  Simulator, `heading.resetDirection`, Backup, Ersteinrichtung, Diagnose, und zweimal nur „aus“
  (`tablet.js:4031`).
- [B] Langes Drücken hält nur Knöpfe aus einer festen Liste zurück (`tablet.js:4132–4167`). Lenken,
  Teilbreiten, Wende, Vorgewende stehen nicht darin und wirken sofort.
- [B] „Arbeit starten“ schaltet nichts (`tablet.js:4310–4315`). Die Ampel ist nur Anzeige.
- [B] `autosteer.off`/`sections.alloff` rufen nur vorhandene Aus-Wege und nur, wenn etwas an ist
  (`MainViewModel.SwitchOff.cs:21–35`, Test `SwitchOffTests.cs`).
- [B] Der Vorführmodus startet nicht, wenn ein Modul gehört wird, und beendet sich, sobald eines
  auftaucht (`tablet.js:4023, 4039`).
- [B] Der Totmann wird vom Fork nicht berührt (`control.presence` nur in upstreams `control.js:48`).

**Abschaltung erschwert: zwei belegte Befunde**
- **[B] Der Lenk-Knopf ist bei offenem Menü oder Blatt verdeckt.** Menü und alle Fork-Blätter liegen
  mit z-index 34/35 über allem (`index.html:582–584, 708`), die rechte Leiste darunter. Nachgestellt
  mit eingeschalteter Lenkung: Menü öffnen geht; ein Tipp auf die Stelle des Lenk-Knopfs trifft eine
  Menükachel und öffnet das Arbeitsprotokoll; vier weitere Tipps dort tun nichts, die Lenkung bleibt
  an. Bildschirmfoto: oben rechts steht „Lenkung EIN“, der Knopf fehlt. Die Anzeige „Lenkung EIN“ in
  der Statusleiste ist ein `div` ohne Funktion (`tablet.js:315`). Aus per Bildschirm braucht dann
  Schließen und danach Lenken, also mindestens zwei gezielte Tipps. Upstreams eigene Seitenleisten
  verdecken den Knopf nicht.
- **[B] Die Richtungskarte kann auf einem deutschen Tablet englisch bleiben** („Does the vehicle face
  the way it drives?“, „Yes“, „No – learn the direction again“; Bildschirmfoto). Ursache:
  `tablet.js:3474` erneuert die Texte nur bei Sprachwechsel, nicht wenn das Wörterbuch später ankommt.
  Das ist die Karte, die vor der Richtungsfalle schützen soll. Dieselbe Fehlerklasse wurde beim
  Sicherheitshinweis und bei der Ampel schon einzeln behoben; „Arbeit starten“ hat sie noch
  (`tablet.js:4280`).
- [B] Die Richtungskarte liegt mit z-index 59 über dem Menü (`index.html:981`) und überdeckt dort Kacheln.

**Weitere Punkte**
- [B] Die Sperren „Lenkung an / Fahrzeug fährt“ für Profile sitzen im Client (`tablet.js:1234–1242`).
  Der Host prüft das für Profilbefehle nicht (`RemoteServerWiring.cs:557–561`,
  `RemoteServerWiring.Helpers.cs:371–412`); nur der
  Backup-Import wird auf dem Host nochmal geprüft. Upstream-Lücke (`docs/Offene-Punkte.md` Nr. 3),
  aber der Fork verlässt sich darauf.
- [B] Jede Verbindungsunterbrechung setzt die Richtungsbestätigung zurück (`tablet.js:3460`).
  Fachlich vertretbar, führt aber zu Wegklicken aus Gewohnheit.
- [B] Erster Start mit leerem Datenordner: Simulator ist an, die Statusleiste zeigt grün „RTK Fix“
  (Bildschirmfoto). Die Ampel sagt richtig „Simulator: keine echte Position“, das Fix-Feld nicht.
- [E] Der Fork lastet den Hauptthread zusätzlich aus (37 Intervalle, pro Bild `buildPage`,
  `renderCards`, `renderProxies`, `tablet.js:941–946`). Upstreams Totmann (1,5 s) schaltet bei
  Hängern ab. Das fällt zur sicheren Seite, wird auf einem schwachen Tablet aber als „Lenkung geht
  von selbst aus“ erlebt. Im 32-Minuten-Lauf: 0 Auslösungen, größte Lücke 1,2 s. Knapp.
- [E] Die Ampel sagt „Bereit“. Sie prüft GPS, Lenkmodul, IMU, Linie, Richtung, aber nicht
  Lenkwinkelsensor, Kalibrierung, Maße. Mit dem Wort übernimmst du eine Aussage, die das System nicht
  ganz deckt.
- [E] Das eigentliche Sicherheitsnetz ist das Kit (Übersteuern am Lenkrad, Schalter). Genau das ist
  nicht getestet.

## 3. Bedienung in der Kabine (UX): Note 3

- [B] Gut: Handschuhgröße ab Werk, Lenk-Knopf 96×84 px, Statusleiste mit Ampel und Lenkstatus,
  „Arbeit starten“ in vier Schritten mit Klartext, Ampel-Liste mit Gründen, Toasts auf Deutsch.
- [B] Tipp bis Seite offen: 160–250 ms, bei 6-fach gedrosselter CPU bis 0,8 s
  (`docs/Testbefunde-moritz31.md`, Punkt 9). In Ordnung.
- [B] Das Menü hat 26 Kacheln in drei Gruppen. Darunter Händlerwerkzeuge: Prüfstand-Checkliste,
  Abnahmeprotokoll, Vorführmodus, Diagnose für Support, Sichern und Wiederherstellen. Ein Bauer
  braucht davon im Alltag vier oder fünf.
- [B] Zwei Modi („Fahren“/„Einrichtung“) plus zwei Layouts („Terminal“/„Klassisch“). Der gelbe
  Menüknopf heißt im Einrichtungsmodus „Fahren“ und schließt ihn, statt das Menü zu öffnen.
- [B] Langes Drücken erklärt, kurzes wirkt erst beim Loslassen (`tablet.js:4187–4207`). Bei Vibration
  rutscht der Finger leicht über 12 px, dann passiert gar nichts.
- [B] „Arbeit starten“ kennt keinen Auftrag; das Arbeitsprotokoll hängt aber am Auftrag
  (`tablet.js:4243–4251`).
- [B] Profil „Default“ zeigt im Menü „Radstand 2,50 m“ und „Arbeitsbreite 1,00 m“ wie echte Werte.
- [B] Simulator wieder einschalten: Menü → App & Dateien → Experte → Simulator, vier Ebenen.
- [E] Fehler verstehen ist die Stärke. Schnell abschalten ist die Schwäche (siehe 2).
- [E] Nach jedem Neustart und jedem Verbindungsabriss kommt die Richtungsfrage. In der Saison
  nervt das, und wer genervt ist, tippt blind „Ja“.

## 4. Oberfläche (UI): Note 2

- [B] Einheitliche Karten, Farben und Schrift in den Fork-Teilen; Tag und Nacht durchgezogen;
  Statusleiste passt nach der letzten Runde von 800 bis 1280 px.
- [B] Sichtprüfung (`ui-sweep`): 64 Kontrast-Befunde und 10 englische Reste bleiben stehen (fast
  alle in upstream-Seiten), ein „A“ im Dialog Lat/Lon-Linie nachts mit Kontrast 1,2.
- [B] Zwei Welten sichtbar: Fork-Blätter (lila, große Kacheln) und upstream-Einstellungsseiten
  (blau, PNG-Symbole, kleinere Schrift). Die untere Leiste hat zwei Knöpfe ohne Beschriftung neben
  zwei mit.
- [B] Erste Seite der Ersteinrichtung: 28 Sprachen als gleich große Knöpfe.
- [B] Fahrzeugsymbol auf der Karte im Startzustand winzig (Bildschirmfoto „Hauptbild“).
- [E] Für ein nachgerüstetes System ist das überdurchschnittlich. Sonnentauglichkeit ist nur am
  Bildschirm beurteilt, nicht in der Kabine.

## 5. Robustheit: Note 3

- [B] Gut: Arbeitsprotokoll und Backup schreiben über `.tmp` und Umbenennen
  (`WorkLogStore.cs:71–73`, `ProfileBackupService.cs:221–223`), kaputte Dateien werden weggelegt
  (`WorkLogStore.cs:68`), „Zündung aus“ mit `kill -9` im Soak ohne Datenverlust, Anzeigen werden bei
  Datenstille grau (`index.html:289–294`).
- [B] Einiges liegt nur im Browser-Speicher des Tablets: Prüfstand-Ergebnis (`tablet.js:3496`),
  Bestätigung des Sicherheitshinweises (`:4612`), Update-Kanal (`:4515`), Seiten- und Leisten-Einstellung. WebView2-Daten
  liegen in `%LOCALAPPDATA%\Photino` (`installer.iss:17–18`): Tabletwechsel oder Profil löschen, und
  es ist weg. Arbeits- und Abnahmeprotokoll werden zusätzlich auf dem Host gehalten.
- [B] `/backups/` und `/worklog` (lesen) sind ohne Anmeldung für jedes Gerät im Subnetz abrufbar
  (`RemoteServerHost.cs`, Fork-Routen). Passwörter sind nicht im Backup, Schläge schon.
- [B] Bekannte upstream-Lücken, offen: GPS-Daten veralten nie (`Offene-Punkte` Nr. 13), neuer Schlag
  ohne GPS bekommt einen falschen Ursprung (Nr. 14).
- [B] Volle Platte: kein Test, keine Meldung gefunden.
- [E] Am echten Gerät unbekannt: Standby/Aufwachen von Windows, Windows-Updates mitten in der Arbeit,
  Spannungseinbruch beim Motorstart, WLAN/LTE-Wechsel für NTRIP.

## 6. Tests und Qualitätssicherung: Note 3

- [B] Vorhanden: 71 Web-Tests in 14 Dateien, 12 neue oder erweiterte C#-Testdateien (Backup, Migration, Aus-Befehle,
  GGA), `ui-sweep` (Sicht und Touch), `sim-soak` (32 min, 60 Schritte, 0 Fehler), CI grün auf allen Zweigen.
- [B] Abgedeckt sind die kleinen, reinen Module. **Nicht** abgedeckt sind die größten und heikelsten:
  `TabletTerminal` (rund 750 Zeilen, das ganze Layout samt Schnellleiste), `TabletProfiles` (rund
  1 500 Zeilen, schreibt Fahrzeugmaße), `TabletSteerConfirm` (Richtungskarte, hat den Fehler aus 2),
  `TabletSimGuard`, `TabletBench`, `TabletBackup`.
- [B] `ui-sweep` und `sim-soak` laufen nur von Hand, nicht in der CI. Der Fehler „jede zweite Kachel“
  kam deshalb mit dem Abgleich unbemerkt herein und fiel erst am Tablet auf.
- [B] Es gibt keinen Test „Lenk-Knopf ist bei eingeschalteter Lenkung immer antippbar“ und keinen
  „kein englischer Text bei deutscher Sprache nach spätem Wörterbuch“.
- [B] Kein einziger Test am echten Kit. Die Doku sagt das an vier Stellen ehrlich.
- [E] Die Testmenge ist ordentlich, die Testverteilung nicht: viel Prüfung dort, wo wenig schiefgehen
  kann, wenig dort, wo es teuer wird.

## 7. Auslieferung: Note 4

- [B] Installer mit Firewall-Regeln, Autostart, WebView2-Prüfung; Datenordner bleibt bei Update und
  Deinstallation; zwei Kanäle; Kurzanleitung (91 Zeilen), Einbauanleitung (100), Testtag-Liste (68).
- [B] **Nicht signiert**: Windows SmartScreen warnt bei jedem Kunden (`docs/Installer.md:80`).
- [B] Update ist Handarbeit: Die App zeigt nur „neuere Version“ und öffnet die GitHub-Seite
  („Installing stays with you“, `tablet.js`, Block `update`). Kein Zurück auf die Vorversion.
- [B] Der Kanal und „ist das eine Testversion“ stehen im Browser-Speicher und kommen von der
  GitHub-API (60 Abfragen pro Stunde ohne Anmeldung, im Soak schon einmal 403).
- [B] Rechtliches: `docs/Rechtliches-Entwurf.md` ist als „rechtlich ungeprüft“ markiert, acht offene
  Fragen (Produkthaftung, CE/Maschinenrecht, Straße, Datenschutz). Der Hinweis in der App sagt „Diese
  Version ist eine Testversion“.
- [B] Keine `NOTICE`-Datei im Paket; ob die Drittlizenzen im Download liegen müssen, ist offen
  (`Offene-Punkte` Nr. 20).
- [B] Die Einbauanleitung hat kein eigenes Kapitel zu Motor, Lenkschalter und Übersteuern; es steht
  nur als Zeile in der Abnahme.
- [E] Für einen Test mit zwei, drei befreundeten Betrieben reicht das. Für ein Geschäft mit zahlenden
  Kunden ist die rechtliche Seite das größte offene Risiko des ganzen Projekts, größer als jeder
  Softwarefehler in diesem Bericht.

## 8. Vergleich mit kommerziellen Terminals: Note 4

Einschätzung, aus Kenntnis üblicher Terminals (keine Messung):
- Besser als gewohnt: Klartext-Fehlermeldungen, Ampel mit Gründen, Ersteinrichtung, Arbeitsprotokoll,
  eAMA-Import (für Österreich ein echtes Argument), Preis.
- Was ein Kunde nach einer Woche vermisst oder nervig findet:
  1. Ein fester, immer sichtbarer Ein/Aus-Knopf (oder Fußtaster/Armlehnen-Taster) für die Lenkung.
  2. Die Richtungsfrage bei jedem Start. Kommerzielle Systeme lösen das ohne Frage.
  3. Startzeit und Windows: Anmeldung, Updates, Benachrichtigungen, Bildschirmtastatur, Standby.
  4. Updates per Download von GitHub mit SmartScreen-Warnung.
  5. RTK „einfach da“. Hier: NTRIP-Profil, Mobilfunk, APOS-Zugang selbst einrichten.
  6. Zu viele Wege: zwei Layouts, zwei Modi, 26 Kacheln, dazu upstreams Seiten dahinter.
  7. Ein Ansprechpartner mit Fernwartung. Die Diagnose-Datei ist ein guter Anfang, aber kein Fernzugriff.
  8. Geprüfte Zusagen (Genauigkeit, Zulassung, Gewährleistung).

---

## Die 10 wichtigsten Maßnahmen (nach Nutzen, dann Aufwand)

| # | Maßnahme | Nutzen | Aufwand |
|---|---|---|---|
| 1 | Lenkung aus immer mit einem Tipp: Lenk-Knopf über allen Blättern halten, oder bei Lenkung EIN die Statusanzeige zum Aus-Knopf machen; Menü bei Lenkung EIN nur als schmale Leiste. Dazu ein Test. | sehr hoch | klein |
| 2 | Tag am echten Kit: Prüfstand, Hof, Feld nach `docs/Testtag.md`; Übersteuern, Schalter, Verbindungsabriss, Zündung aus. Vorher kein Kunde. | sehr hoch | 1–2 Tage |
| 3 | Rechtliche Prüfung (Produkthaftung, CE/Maschinenrecht, AGB, Versicherung) vor dem ersten Verkauf. | sehr hoch | extern |
| 4 | Ein gemeinsames Signal „Wörterbuch geladen/Sprache gewechselt“; alle Module zeichnen darauf neu. Behebt Richtungskarte und „Arbeit starten“ und verhindert die nächste Wiederholung. | hoch | klein |
| 5 | `ui-sweep --touch` und ein kurzer `sim-soak` in die CI, bei jedem Upstream-Abgleich Pflicht. | hoch | klein–mittel |
| 6 | Installer signieren. | hoch | klein, laufende Kosten |
| 7 | Menü teilen: Alltag (5–6 Kacheln) und „Händler/Service“ hinter einem eigenen Eingang. | hoch | mittel |
| 8 | Die acht Zweige zu einem Hauptzweig zusammenführen; neue Arbeit in kurzen Zweigen davon. | mittel | klein |
| 9 | Abgleich mit upstream als feste Routine (z. B. alle zwei Wochen) mit Checkliste; die upstream-fähigen Fixes (GGA, F/V-Tasten, NTRIP-Test) wirklich einreichen, damit Host-Ausnahmen wieder verschwinden. | mittel | laufend |
| 10 | `tablet.js` in Dateien je Bereich teilen, gemeinsame Helfer einmal, Fork-CSS aus `index.html` in eine eigene Datei. | mittel | mittel |

Danach: Prüfstand-Ergebnis und die Bestätigung des Sicherheitshinweises auf den Host legen; Sperren für Profiländerungen
auch im Host prüfen (als upstream-Beitrag); Richtungsfrage seltener stellen (nur nach Host-Neustart).

## Was wir nicht tun sollten

- **Keine Kunden beliefern, bevor Punkt 1 bis 3 erledigt sind.** Auch nicht „nur zum Probieren“.
- Keine weiteren Funktionen, bis Kit-Test und Aus-Knopf erledigt sind. Der Fork hat genug Funktionen
  und zu wenig Beweis.
- Lenk-, Regel- und Sicherheitslogik weiter nicht anfassen. Die Regel hat sich bewährt.
- Keine weiteren Host-Ausnahmen für Bequemlichkeit. Jede neue zuerst als upstream-Beitrag versuchen.
- Keine weiteren Laufzeit-Überschreibungen von upstream-Funktionen und keine Drücke per Code auf
  schaltende Knöpfe (Lenken, Teilbreiten, Wende).
- Die Ampel nicht zu einer Freigabe ausbauen („grün = sicher“). Sie bleibt ein Hinweis.
- Kein automatisches Update, das ohne Zutun installiert. Erst signieren und einen Weg zurück haben.
- upstreams deutsche Texte nicht weiter umschreiben; Verbesserungen über upstreams Weblate einbringen.
- Den Simulator nicht noch tiefer verstecken; besser deutlich kennzeichnen, wenn er läuft.
- Sich nicht auf Messungen aus der VM verlassen, wenn es um Geschwindigkeit und Lesbarkeit geht.
