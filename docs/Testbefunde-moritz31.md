# Testbefunde Tablet-Test moritz.31 (Windows), bearbeitet 04.11.2026

Grundlage: die neun Punkte aus dem Tablet-Test mit 26.7.0-moritz.31. Je Punkt zuerst geklärt, ob
er im unveränderten upstream `develop` (5a2c4251, eigener Build) auch auftritt. Geprüft auf einer
Linux-VM mit Chromium (Playwright), **echte Touch-Ereignisse** (CDP `Input.dispatchTouchEvent`,
Finger 60 ms), CPU gedrosselt (`Emulation.setCPUThrottlingRate` 4 und 6) und für Punkt 2
zusätzlich Browser **und** Host per cgroup auf 0,4 eines Kerns begrenzt (schwaches Tablet).
Software-WebGL (SwiftShader), kein echtes Tablet, keine GPU. **Board und Motor nicht getestet.**
Lenk-, Regel- und Sicherheitslogik unverändert.

| Nr. | Befund | Ursache | Getan |
|---|---|---|---|
| 1 | Menükachel wirkt erst beim zweiten Antippen | **unser Code** im Zusammenspiel mit upstream #465 | behoben, Test |
| 2 | Erstes Öffnen einer Seite langsam | Bilder werden erst beim ersten Anzeigen dekodiert (Browser) | Vordekodieren nach dem Start, vorher/nachher gemessen |
| 3 | Prüfstand-Checkliste (und Backup) gehen gleich wieder zu | **unser Code** | behoben, Test im Touch-Lauf |
| 4 | Ersteinrichtung erscheint nie (Profil „Default“) | **unser Code** (Bedingung der Ersteinrichtung) | behoben, Test |
| 5 | Simulator lässt sich nicht mehr einschalten | **unser Ausblenden** (Kanal „Stabil“), nicht upstream, nicht der Schlag | Hinweis, Weg per Touch geprüft |
| 6 | Ampel nur roter Punkt | **unser Code** (Statusleiste zu voll auf schmalen Tablets) | Symbol, Platzregeln, gemessen |
| 7 | Firewall-Seite bei „nur für mich“? | – | wird in beiden Arten gezeigt; Hinweis korrigiert |
| 8 | NTRIP-Test: erst „no answer“, dann „Erfolg“ | **upstream** (Test ohne Position, 15 s) | Meldungen auf Deutsch, Issue-Entwurf Nr. 8 |
| 9 | Gesamtdurchlauf Touch + CPU | – | `Tools/ui-sweep.mjs --touch --cpu`, 3 weitere Fehler gefunden und behoben |

## 1. Menü: Kachel wirkt erst beim zweiten Antippen

**Ursache.** Upstream hat mit #465 (`js/map-input.js`, beim Abgleich übernommen) einen Filter gegen
Geister-Drücke eingebaut: ein `pointerdown` von einem Zeiger, der schon „unten“ ist, wird verworfen,
und der Zeiger danach vergessen. Unsere Menükacheln drücken die Originalknöpfe per Code
(`new PointerEvent('pointerdown')`, pointerId 0, nie losgelassen); ebenso die Wiederholung beim
langen Drücken (TabletExplain). Folge: 1. Druck geht durch, 2. wird verworfen, 3. geht durch … Das
Menü schloss sich dabei schon, die Seite ging aber nicht auf. Nicht die Ursache: das Tippen beim
Loslassen selbst, der Ladebildschirm, die js/css-Aufteilung.

**Upstream:** hat kein Fork-Menü; die eigenen Tastenkürzel F (Schlagmenü) und V (Fahrzeug) drücken
genauso und wirken nur bei jedem zweiten Druck (nachgemessen: offen, nichts, offen, nichts …) →
Issue-Entwurf Nr. 7 in `docs/Upstream-Issues.md`.

**Fix (bedienung-1, nach oben gemergt):** `tuiPress` gibt jedem Druck per Code eine eigene
pointerId (16 Stellen, langes Drücken eingeschlossen); die zwei Tastenkürzel ebenso, ohne
`map-input.js` zu ändern. Test `Tests/web/press.test.mjs` (läuft gegen den echten upstream-Filter).

| Messung (Touch, je Kachel 4× öffnen und per X schließen) | vorher | nachher |
|---|---|---|
| Fehlversuche (8 Kacheln × 4) | 18 von 32, abwechselnd | 0 |
| alle 26 Kacheln, je frische Seite, CPU 1× und 6× | 10 ohne Wirkung | alle wirken |

## 2. Erstes Öffnen langsam

**Gemessen** (alle 94 Oberflächen von `ui-sweep`, je erstes und zweites Öffnen):
- Netz: Beim ersten Öffnen wird **nichts** geladen; alle 193 Dateien (12,7 MB, davon 6,3 MB
  Symbole) kommen beim Start, mit ETag/304 bei jedem weiteren Start. i18n ist zu dem Zeitpunkt da.
- Hauptthread (Skripte, Stil, Layout): erstes = zweites Öffnen (Tipp bis erstes Bild 250–330 ms,
  CPU 6×: 0,6–0,8 s, beides gleich). Ein Anstieg in der ersten Minute (JIT, Wasm) war nicht zu sehen.
- CPU aller Browser-Threads je Seite (Trace): Summe über 17 Seiten +1019 ms beim ersten, +830 ms
  beim zweiten Öffnen.
- Was **nur** beim ersten Öffnen anfällt: das **Dekodieren der Bilder** (der Browser dekodiert ein
  Bild erst, wenn es zum ersten Mal gezeigt wird). Mit Browser und Host auf 0,4 Kern: 545 ms über
  alle Seiten (z. B. Bildschirm & Hinweise 153 ms, Werkzeuge 154 ms, Fahrzeug-Einstellungen 132 ms),
  beim zweiten Mal 0. Auf dem Tablet kommt das Hochladen in die GPU dazu (hier nicht messbar).

**Fix (installer):** `TabletPreload` dekodiert nach dem Ladebildschirm (2 s später, in Leerlaufzeit,
je 4 Bilder) alle Bilder der Seite; alle 30 s die neu hinzugekommenen.

| | vorher | nachher |
|---|---|---|
| Dekodieren beim ersten Öffnen, Summe (0,4 Kern) | 545 ms | 39 ms |
| Dekodieren beim ersten Öffnen, Summe (volle CPU) | 114 ms | 23 ms |
| Vordekodieren fertig nach dem Laden (0,4 Kern) | – | 94 s (128 Bilder, 6,5 s Arbeit) |

**Offen:** Auf dem Tablet selbst messen (Testtag). Wenn es dort trotzdem langsam bleibt, liegt es
an etwas, das hier nicht nachzustellen ist (GPU-Treiber, WebView2); dann mit `chrome://tracing`
bzw. Edge DevTools am Tablet aufnehmen.

## 3. Prüfstand-Checkliste geht gleich wieder zu

**Ursache (unser Code):** Checkliste und Backup schließen sich, wenn das Terminal nicht im
Einrichtungsmodus ist; ihre Kacheln schalteten aber nicht dorthin. Im Fahrmodus geöffnet → nach
≤ 0,5 s zu. Im klassischen Layout (immer Fahrmodus) gingen sie nie auf. Upstream hat beides nicht.
**Fix (bedienung-1):** beim Öffnen in den Einrichtungsmodus (Terminal-Layout); geschlossen wird nur
noch, wenn der Modus danach wechselt. **Andere Dialoge:** nur diese zwei hatten die Regel; alle
Kacheln und Reiter im Touch-Lauf: kein Schließen von selbst (Punkt 9).

## 4. Ersteinrichtung trotz Profil „Default“

**Ursache (unser Code):** Die Ersteinrichtung öffnete nur, solange kein Fahrzeugprofil existiert.
Der Host speichert sein aktives Profil „Default“ aber, sobald irgendetwas gespeichert wird
(Fahrzeug-Einstellungen verlassen, Profil laden; nachgestellt: frischer Datenordner,
`profile.load` → `Vehicles/Default.json`). Upstream hat keine Ersteinrichtung.

**Erkennen ohne erfundene Werte:** Das unveränderte „Default“ hat genau die Werte, die der Host
jedem neuen Speicher gibt (`VehicleConfig.cs`-Startwerte = `VehicleProfileService.CreateDefaultProfile`:
Traktor, Radstand 2,5 m, Spur 1,8 m, Antenne 3,0 m hoch, Versatz 0, Anhängung 1,8 m, IMU 0). Die
Ersteinrichtung öffnet jetzt auch, wenn das einzige Fahrzeugprofil „Default“ heißt, aktiv ist und
genau diese Werte hat; ein geänderter Wert oder ein zweites Profil → wie bisher nicht. Die Werte
dienen nur dem Erkennen, nichts wird vorgeschlagen. `Tests/web/firstsetup.test.mjs` liest sie aus
beiden C#-Dateien, damit Client und Host nicht auseinanderlaufen.

**Durchgespielt (Host + Browser):** nur unverändertes „Default“ → Ersteinrichtung offen; „Default“
mit Radstand 2,9 m → nicht. Hinweis: Hat der Lenkrechner die Einrichtung schon als „gezeigt/fertig“
gespeichert (Datenordner bleibt bei Neuinstallation erhalten), öffnet sie nicht von selbst; dann
Menü → Ersteinrichtung.

## 5. Simulator mit offenem Schlag

**Ursache (unser Code, nicht upstream, nicht der Schlag):** Im Kanal „Stabil“ blendet
`TabletSimAccess` den SIM-Knopf der Karte aus, sobald der Simulator aus ist. Upstream (nachgespielt,
gleiche Schritte): Knopf bleibt, Simulator lässt sich mit offenem Schlag ein- und ausschalten; der
Host hat keine Schlag-Bedingung. **Fix (installer):** Wird der Simulator ausgeschaltet und der Knopf
verschwindet, sagt eine Meldung: „Simulator aus. Wieder einschalten: Menü → App & Dateien →
Experte → Simulator.“ (nicht nach dem Ende des Vorführmodus). Per Touch geprüft: mit offenem
Schlag Simulator aus → Meldung → über Experte wieder an.

## 6. Ampel nur ein roter Punkt

**Ursache (unser Code):** Die Ampel hatte das Wort schon, wurde aber in der vollen Statusleiste
(Handschuhgröße) zusammengedrückt: bei 853 px Breite (1280-px-Tablet bei 150 %) blieb vom Feld 69 px
(Punkt und Wortanfang), das GPS-Feld bekam 17 px und überlagerte seine Nachbarn; im
Einrichtungsmodus schon bei 1100 px (4 px). **Fix (bedienung-1):** Symbol im Punkt (✓ / ! / ✕), die
Ampel schrumpft nie; unter 1000 px weicht die Uhr, unter 900 px zeigt die Ampel nur ihr Symbol,
größer (32 px), das Wort steht im Titel und in der Liste. Im Einrichtungsmodus dieselben Schritte
schon unter 1200 px, darunter die Geschwindigkeit (< 1000 px), unter 900 px Module nur als Punkt
und das Fix-Feld statt zusammengedrückt ausgeblendet. Gemessen (Handschuhgröße, Fahr- und
Einrichtungsmodus, 800–1280 px): kein Überlauf, Ampel immer 64 bzw. 154 px, Tag und Nacht.

## 7. Setup: Firewall-Seite

Im Skript geprüft (`deploy/windows/installer.iss`): Das Häkchen mit Ports (UDP 9999, 2211, 2222; TCP
5174) und Adminhinweis steht auf der Seite „Zusätzliche Aufgaben“ ohne Bedingung, also bei „nur für
mich“ und „für alle Benutzer“ gleich. **Korrigiert:** Läuft das Setup schon mit Adminrechten („für
alle“), fragt Windows nicht noch einmal; der eigene Hinweis „Gleich fragt Windows nach Adminrechten“
entfällt dann. Nicht unter Windows ausgeführt (Installer wird nur in der CI gebaut).

## 8. NTRIP-Test: erst „no answer“, dann „Erfolg“

**Upstream-Code**, im Fork unverändert (`NtripConnectionTester`, `NtripConnection`). Gemessen mit
einem Test-Caster: Antwort nach 0/5/12/14 s → Erfolg; nach 16 s → „No answer“ nach 15,4 s (Grenze
`NtripTimeouts.Header` 15 s; Verbinden inkl. DNS 10 s); nicht erreichbare Adresse → nach 10,4 s
„No answer“. **Der Test schickt keine Position** (anders als die echte Verbindung): ein Caster, der
erst mit Position antwortet → immer „No answer“; ein Caster, der die erste Verbindung unbeantwortet
lässt → genau das Tablet-Muster. Die Zeitgrenze ist nicht zu knapp (15 s statt üblicher < 1 s
Antwort); für APOS ist ohne Zugang nicht zu klären, welcher Fall es ist → Issue-Entwurf Nr. 8
(Test mit der aktuellen Position). **Meldung auf Deutsch (bedienung-1):** alle Texte des
Verbindungsaufbaus hinter „Error:“, „Connection failed:“, „Rejected:“ (Test, Netzwerk-Karte,
Ersatzdienst-Test), Adresse und Caster-Antwort bleiben wörtlich; Test `Tests/web/hosttext.test.mjs`.

## 9. Gesamtdurchlauf mit Touch und gedrosselter CPU

`Tools/ui-sweep.mjs` hat jetzt `--touch` (jede Menükachel zweimal, je aus geschlossenem Zustand,
und jeder Einstellungs-Reiter zweimal, mit echten Touch-Ereignissen; gemeldet: wirkt erst beim
zweiten Mal, schließt sich selbst innerhalb 1,5 s, Öffnen > 1 s bzw. > 1 s × CPU-Faktor) und
`--cpu N`. Die Drücke per Code des Sweeps gehen über `tuiPress` (vorher prüfte er wegen #465 jeden
zweiten Reiter nicht).

| Lauf (1024×600, Handschuhgröße, Deutsch) | Ergebnis |
|---|---|
| Touch, CPU 1× | 20 Kacheln × 2, alle Reiter: 0 Fehler; Öffnen 160–250 ms |
| Touch, CPU 4× | 0 Fehler; 280–475 ms |
| Touch, CPU 6× | 0 Fehler; 220–790 ms |
| Sichtprüfung Tag/Nacht + Touch CPU 4× | gegenüber dem letzten Lauf 2 neue Befunde (unten) |

Dabei gefunden und behoben:
- **Sicherheitshinweis beim ersten Start auf Englisch** (unser Code, auslieferung): die Sprache
  steht sofort, das Wörterbuch kommt später, der Hinweis (`translate=no`) wurde nie nachübersetzt.
  Jetzt wartet er auf die Übersetzung (höchstens 5 s); Test `Tests/web/legal.test.mjs`; CPU 1× und
  6× sofort deutsch.
- **Statusleiste im Einrichtungsmodus** zu voll (siehe 6).
- **Kontrast** „Experte“ in App & Dateien bei Tag 4,2 → Haupttextfarbe.
- Upstream, nicht geändert: „A“-Beschriftung im Dialog Lat/Lon-Linie nachts Kontrast 1,2.

## Gesamtlauf, Soak, Testversion

`Tools/sim-soak.mjs --minutes 32` mit dem Endstand (Debug-Build, eigener Host, leerer Datenordner):

| | Ergebnis |
|---|---|
| Dauer, Schritte | 32 min, 60 Schritte, **0 fehlgeschlagen** |
| Seitenfehler / Konsolenwarnungen | 0 / 0 |
| Konsolenfehler | 5 (4× Verbindung weg beim gewollten „Zündung aus“, `kill -9`; 1× beim Neustart) |
| Lenkung aus ohne eigenen Befehl, Bedienung verloren, Host unerwartet beendet | 0 / 0 / 0 |
| Tick-Lücken | 8777 Ticks, größte 1,2 s, 5 über 1 s, keine über 1,5 s (Abdeckung zeichnen, upstream, Entwurf Nr. 6) |
| Speicher | Seite 10 → 11 MB; Host 201 → 305 MB (Abdeckungsraster, wie zuvor) |

Gesamtlauf: Web-Tests 71/71 (installer), 31/31 (eama-import); `ui-sweep` Sicht + Touch wie in 9.
CI (`build-and-release.yml`) grün auf allen gemergten Zweigen, dazu von Hand auf installer
(9dd4ff07) und abnahme. **Testversion 26.7.0-moritz.32** gebaut (Workflow „Fork Test Pre-Release“,
Lauf 41921093349, erfolgreich, Stand 9dd4ff07).

## Zweige

Fixes jeweils im Zweig, in dem der Fehler entstand, nach oben gemergt bis `feature/installer` und
in #19 (`feature/eama-import`): bedienung-1 (Punkte 1, 3, 6, 8, ui-sweep), bedienung-2 (4),
auslieferung (Sicherheitshinweis), abnahme (Web-Tests, dort liegt `Tests/web/stubs.mjs`),
installer (2, 5, 7, Kontrast, Upstream-Entwürfe 7 und 8).
