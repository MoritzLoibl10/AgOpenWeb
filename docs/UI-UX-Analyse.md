# UI/UX-Analyse: AgOpenWeb auf dem Traktor-Tablet

Stand: 11.10.2026, Branch `develop` @ `565a259` (v26.7.0). Dieses Dokument ändert keinen Code.
Es beschreibt die Architektur, die Kompatibilität mit AiO v4.5 + Keya-Motor und schlägt
Verbesserungen für die Bedienung im Traktor vor. Jeder Vorschlag ist mit einem Screenshot und
einer Messung belegt.

**Grenze für alle Vorschläge:** Sie betreffen nur den Web-Client
(`Shared/AgOpenWeb.RemoteServer/wwwroot/`: `index.html`, `app.js`, `i18n.js`). Lenkung,
Regelung, Sicherheitslogik, Host-Kommandos und die Tier-2-Freigabe bleiben unverändert (siehe
[Abschnitt 4.4](#44-was-nicht-angefasst-wird)).

Inhalt:
1. [Architektur](#1-architektur)
2. [Build, Start und Screenshots unter Linux](#2-build-start-und-screenshots-unter-linux)
3. [Kompatibilität AiO v4.5 + Keya-CAN-Motor](#3-kompatibilität-aio-v45--keya-can-motor)
4. [UI/UX-Verbesserungen für das Traktor-Tablet](#4-uiux-verbesserungen-für-das-traktor-tablet)
5. [Anhang: Methode und Grenzen](#5-anhang-methode-und-grenzen)

---

## 1. Architektur

### 1.1 Überblick

```mermaid
flowchart LR
  subgraph Client["Web-Client (Browser / WebView)"]
    UI["index.html + CSS<br/>(Panels, Buttons)"]
    APP["app.js<br/>CanvasKit-Karte, Eingaben"]
    TR["transport.js<br/>WebSocket, Binär-Decoder"]
  end
  subgraph Host[".NET-Host (eine Instanz)"]
    RS["RemoteServerHost<br/>HTTP + WebSocket :5174"]
    W["RemoteServerWiring<br/>'id|arg' → VM<br/>ControlAuthority (Tier 2)"]
    P["SceneProjector / CoverageProjector<br/>WireCodec / MapBroadcaster"]
    VM["MainViewModel<br/>Steuer-Gehirn auf HostLoopDispatcher"]
    S["Services: GpsPipeline, TrackGuidance,<br/>YouTurn, SectionControl, AutoSteer,<br/>SteerMachineLoop (100 Hz), NTRIP"]
    UDP["UdpCommunicationService<br/>:9999 / :2211 / :2222 rein, :8888 raus"]
  end
  HW["AiO v4.5 (Teensy 4.1)<br/>GPS, BNO085, Motor/Keya"]
  APP -- "transport.send('autosteer.toggle')" --> TR --> RS --> W --> VM --> S --> UDP <--> HW
  S --> P --> RS -- "Tick 10 Hz, Scene, Config, Status" --> TR --> APP
```

| Schicht | Ort | Aufgabe |
|---|---|---|
| **Web-Client (die einzige UI)** | `Shared/AgOpenWeb.RemoteServer/wwwroot/` | `index.html` (2 844 Zeilen inkl. CSS und aller Panels), `app.js` (6 146 Zeilen: Karte mit CanvasKit/Skia-WASM, Panels, Dialoge, Eingaben), `transport.js` (WebSocket, Binär-Frames), `i18n.js` (Übersetzung). Kein Framework, kein Build-Schritt. |
| **Server und Wiring** | `Shared/AgOpenWeb.RemoteServer/`, `Shared/AgOpenWeb.RemoteWiring/` | `RemoteServerHost` liefert die Seite aus und hält die WebSockets. `RemoteServerWiring` wandelt `id|arg`-Strings in VM-Aufrufe um und prüft für Tier-2-Befehle (Lenkung, Teilbreiten, U-Turn), ob der Absender die Kontrolle hat (`ControlAuthority`, Deadman). `SceneProjector`/`WireCodec` bauen die Frames für den Client. |
| **MainViewModel** | `Shared/AgOpenWeb.ViewModels/` | Hat keine View. Läuft auf einem einzigen `HostLoopDispatcher`-Thread, koordiniert alle Services und ist auf 37 partielle Dateien nach Fachgebiet verteilt (Track, YouTurn, Sections, NTRIP, …). |
| **Services (Steuerlogik)** | `Shared/AgOpenWeb.Services/` | GPS-Pipeline, Pure Pursuit / Stanley (`TrackGuidanceService`), U-Turn, Teilbreitenschaltung, `AutoSteerService` + `PgnBuilder` (PGN 254/239 …), `SteerMachineLoopService` (100-Hz-Sendeschleife), NTRIP/RTCM, UDP. |
| **Plattform-Shells** | `Platforms/` | Nur Prozess-Start, Web-View und Plattformdienste. Desktop: Photino-Fenster (WebView2/WKWebView/WebKitGTK) oder Headless-Daemon (`--headless`, Standard unter Linux). iOS: `WKWebView`. Android: `WebView` + Foreground-`BackendService`. Alle starten denselben `WebBackend`. |

### 1.2 Wo liegt die UI, wo die Steuerlogik?

- **UI:** ausschließlich im Browser. Der Client zeichnet, nimmt Eingaben an und schickt
  Absichten als Strings (`section.master`, `autosteer.toggle`, `config.set|key:value`). Er
  berechnet weder Lenkwinkel noch Schaltzustände. Position zwischen zwei Ticks wird nur für die
  Anzeige extrapoliert (`RENDER_DELAY`).
- **Steuerlogik:** ausschließlich im .NET-Host (Services + MainViewModel). Ob ein Befehl wirkt,
  entscheidet der Host (Tier-2-Prüfung in `RemoteServerWiring`, Kickouts und Freigaben in
  `AutoSteerService`/`GpsPipelineService`).
- **Konsequenz für diese Analyse:** Layout, Größen, Farben, Beschriftung und Menüstruktur
  lassen sich in `wwwroot/` ändern, ohne Lenk- oder Sicherheitsverhalten zu berühren,
  solange dieselben Befehle mit denselben Argumenten gesendet werden.

Mehrere Browser dürfen gleichzeitig verbunden sein; genau einer ist „Operator“, die anderen
sind „Observer“ (Screenshot [16](#u15-beobachter-ansicht)).

Hinweis: `Plans/ARCHITECTURE.md` (Dezember 2025) beschreibt noch die Avalonia-Oberfläche. Die
aktuelle Beschreibung steht in `CLAUDE.md`.

---

## 2. Build, Start und Screenshots unter Linux

| Schritt | Ergebnis |
|---|---|
| .NET SDK | 10.0.112 aus Ubuntu 24.04 `noble-updates` (der Download von `builds.dotnet.microsoft.com` war in dieser Umgebung gesperrt) |
| `dotnet build Platforms/AgOpenWeb.Desktop/AgOpenWeb.Desktop.csproj` | 0 Fehler, 83 Warnungen (Nullability, ungenutzte Felder, veraltete SkiaSharp-API) |
| Start | `AGOPENWEB_DATA=<dir> AgOpenWeb.Desktop --headless` → `ready (v26.7.0+565a259)`, UI unter `http://localhost:5174` |
| Browser | Playwright (Chromium 141, headless, SwiftShader-WebGL), Touch aktiviert, 1280×800 (typisches 10"-Tablet) und 1024×600 (7"-Tablet) |
| Szenario | Simulator, Feld „Demo-Schlag“ (Grenze 240 m × 460 m), Vorgewende 18 m, A+-Linie, 8 Teilbreiten, Teilbreiten-Automatik + AutoSteer + U-Turn im Simulator aktiv |

Satellitenbilder (Bing-Kacheln) waren im Sandbox-Netz gesperrt, daher zeigen alle Karten die
Standard-Bodentextur.

### 2.1 Hauptansichten

| | |
|---|---|
| ![Start ohne Feld](images/ui-ux/01-start-no-field.jpg) **01** Start, kein Feld offen | ![Fahrt Tag](images/ui-ux/13-day-driving-clean.jpg) **13** Fahrt im Feld, Tag-Theme |
| ![Fahrt mit Simleiste](images/ui-ux/06-driving-sections-steer.jpg) **06** Fahrt mit Simulator-Leiste und 8 Teilbreiten | ![Nacht](images/ui-ux/15-night-driving.jpg) **15** Nacht-Theme |
| ![Dateimenü](images/ui-ux/02-left-filemenu.jpg) **02a** Datei-/App-Menü | ![Screen & Alerts](images/ui-ux/02-left-screenalerts.jpg) **02b** Screen & Alerts |
| ![Tools](images/ui-ux/02-left-tools.jpg) **02c** Tools | ![Fahrzeug & Gerät](images/ui-ux/02-left-vehicle.jpg) **02d** Vehicle & Tool |
| ![AutoSteer kompakt](images/ui-ux/02-left-autosteer.jpg) **02e** AutoSteer (kompakt) | ![Field Operations](images/ui-ux/02-left-fieldops.jpg) **02f** Field Operations |
| ![Field Tools](images/ui-ux/02-left-fieldtools.jpg) **02g** Field Tools | ![Network IO](images/ui-ux/02-left-network.jpg) **02h** Network IO |
| ![Module](images/ui-ux/03-status-modules.jpg) **03a** Status: Module | ![GPS](images/ui-ux/03-status-gps.jpg) **03b** Status: GPS |
| ![AB-Flyout](images/ui-ux/07-bottom-ab-flyout.jpg) **07a** AB-Linien-Flyout | ![Flaggen-Flyout](images/ui-ux/07-bottom-flags-flyout.jpg) **07b** Flaggen-Flyout |
| ![Tracks-Dialog](images/ui-ux/08-tracks-dialog.jpg) **08** AB Line Tracks | ![Fields and Jobs](images/ui-ux/09-fields-dialog.jpg) **09** Fields and Jobs |
| ![AutoSteer voll](images/ui-ux/10-autosteer-expanded.jpg) **10** AutoSteer-Konfiguration (voll) | ![Fahrzeug-Konfiguration](images/ui-ux/11-vehicle-config.jpg) **11** Vehicle Configuration |
| ![Lenk-Assistent](images/ui-ux/18-steer-wizard.jpg) **18** AutoSteer-Assistent | ![Beobachter](images/ui-ux/16-follower-readonly.jpg) **16** Zweites Gerät als Observer |
| ![7 Zoll](images/ui-ux/17-7inch-1024x600.jpg) **17** 7"-Tablet 1024×600 | ![7 Zoll AutoSteer](images/ui-ux/17b-7inch-autosteer-panel.jpg) **17b** 7"-Tablet mit AutoSteer-Panel |
| ![Blendung Tag](images/ui-ux/14-day-glare-simulated.jpg) **14** Tag-Theme, simulierte Blendung | ![Blendung Nacht](images/ui-ux/15b-night-glare-simulated.jpg) **15b** Nacht-Theme, simulierte Blendung |

---

## 3. Kompatibilität AiO v4.5 + Keya-CAN-Motor

### 3.1 Wie das AiO-Board angebunden ist

Das AiO v4.5 (Teensy 4.1 mit Ethernet) spricht mit dem Host nur über UDP. AgOpenWeb bringt die
Aufgaben von AgIO selbst mit; ein separates AgIO ist nicht nötig.

| Funktion | AgOpenGPS / AgIO | AgOpenWeb | Fundstelle |
|---|---|---|---|
| Modul-Port (Empfang) | AgIO hört auf 9999 | ✅ 9999, zusätzlich 2211/2222 für getrennte GPS-Bridges | `UdpCommunicationService.cs:51` |
| Senden an Module | Subnetz-Broadcast :8888 | ✅ Subnetz-Broadcast :8888, nach Hello auf das Modul-Subnetz festgelegt | `UdpCommunicationService.cs:710–730` |
| Hello / Scan / Subnetz ändern | PGN 200, 202/203, 201 | ✅ alle drei, inkl. Modul-IP-Erkennung (126 Steer, 123 Machine, 121 IMU, 120 GPS) | `PgnBuilder.cs:375–420`, Network IO ([02h](images/ui-ux/02-left-network.jpg)) |
| GPS vom AiO | `$PANDA` (1 Antenne + IMU), `$PAOGI` (Dual) | ✅ beide, plus Passthrough von KSXT, GGA/VTG/HPR/HDT, INSPVAX (UM981/UM982/F9P) | `Docs/GPS_RECEIVERS.md` |
| IMU (BNO085 auf dem AiO) | in `$PANDA` | ✅ über `$PANDA` | `GpsPipelineService.cs` |
| NTRIP + RTCM | AgIO: NTRIP-Client, RTCM an :2233 | ✅ NTRIP 1/2, GGA für VRS, RTCM-Framing, an die IP des GPS-Moduls (:2233), sonst Broadcast | `NtripClientService.cs`, `RtcmQueue.cs` |
| Lenkdaten an das Board | PGN 254 | ✅ 100 Hz aus der Regelschleife, Status-Bit für Engage | `AutoSteerService.cs:743`, `SteerMachineLoopService.cs` |
| Lenk-Einstellungen | PGN 252 (Gains, PWM, Ackermann), 251 (Invert, Motortreiber, Sensoren) | ✅ beide, werden bei Änderung und beim Start gesendet | `PgnBuilder.cs:447–560` |
| Rückmeldung vom Board | PGN 253 (WAS, Schalter, PWM), 250 (Druck/Strom) | ✅ inkl. Lenkschalter, Arbeitsschalter, Sensor-Kickout | `AutoSteerService.cs:309–400` |
| Textmeldungen vom Board | PGN 221 | ✅ als Hinweis auf der Karte (Schalter „AiO Board Msgs“) | `AutoSteerService.cs:285` |
| Maschine / Teilbreiten | PGN 239, 238, 236, 229 (> 16 Teilbreiten) | ✅ alle | `PgnBuilder.cs:166–330` |
| Motortreiber IBT2 / Cytron, Danfoss-Ventil | PGN 251 | ✅ | `index.html:1812`, `PgnBuilder.cs:501` |

### 3.2 Keya-CAN-Motor

**Befund:** Im Repo gibt es keinen Keya-spezifischen Code (die Treffer für „keya“ sind nur
`HotkeyAction`). Das ist erwartbar: auch bei AgOpenGPS steckt die Keya-Ansteuerung nicht im
Host, sondern in der AiO-Firmware. Der Teensy 4.1 spricht den Keya-Motor über seinen
CAN-Anschluss an und erkennt ihn automatisch. Zum Host sendet er weiterhin die normalen PGNs
253/250. Die Firmware ist nicht Teil dieses Repos; die Aussagen zur Firmware stammen aus der
bekannten AiO-/AgOpenGPS-Firmware und sind hier **nicht am Board geprüft**.

| Punkt | Stand in AgOpenWeb |
|---|---|
| Lenkbefehl (Sollwinkel, Engage) | ✅ Standard-PGN 254; die Firmware setzt ihn in CAN-Befehle für den Keya um |
| Gains / Min-/Max-PWM | ✅ Standard-PGN 252 |
| Kickout über Motorstrom | ✅ Prinzipiell: Die Firmware meldet den Keya-Strom als Sensorwert; AgOpenWeb schickt die Auslöseschwelle in PGN 251 Byte 6 (`SensorTripByte`, `PgnBuilder.cs:556`) und prüft zusätzlich selbst (`AutoSteerService`). Dafür muss „Current Turn“ aktiviert sein ([10](images/ui-ux/10-autosteer-expanded.jpg)). |
| Auswahl „Keya“ in der UI | ❌ Die Motortreiber-Auswahl kennt nur IBT2 und Cytron ([10](images/ui-ux/10-autosteer-expanded.jpg), `app.js:3577`). Keya-Nutzer müssen wissen, dass die Auswahl für Keya egal ist und der Stromsensor zu aktivieren ist. Ein Hinweistext würde reichen (reine Client-Änderung). |
| Keya-Fehler (Überstrom, Encoder, Unterspannung) | ⚠️ Nur sichtbar, wenn die Firmware sie als PGN-221-Text schickt. Keine eigene Diagnoseanzeige. |
| CAN-Diagnose (Bus aktiv, Heartbeat) | ❌ Keine; der Host sieht den CAN-Bus nicht. |

**Fazit Hardware:** Für AiO v4.5 im Ethernet-Betrieb mit Keya-Motor fehlt auf dem Host nach
Code-Lage nichts Wesentliches: alle PGNs, die das Board für GPS, IMU, Lenkung, Maschine und
RTCM braucht, sind implementiert. Vor dem Feldeinsatz sollte trotzdem ein Prüfstandtest
(Board + Motor, ohne Fahrzeugbewegung) gemacht werden: Hello/Scan, PWM-Richtung, Kickout per
Strom und Lenkschalter.

### 3.3 Was im Vergleich zu AgOpenGPS / AgIO fehlt

Eingehende PGNs außer 121/123/126/203/221/250/253 wertet kein Dienst aus:
`AutoSteerService.OnUdpDataReceived` (`AutoSteerService.cs:273`) behandelt nur 250/253/221, und
`UdpCommunicationService.cs:573` schreibt den Rest nur ins Debug-Log.

| Fehlt | Relevanz für AiO v4.5 + Keya |
|---|---|
| Serielle Ports / USB (GPS, AutoSteer per USB, Funk-NTRIP) | gering: AiO läuft über Ethernet. Absichtlich nur UDP (`Docs/GPS_RECEIVERS.md`). |
| PGN 211/212: externes IMU-Modul | gering: das BNO085 des AiO geht über `$PANDA`. |
| PGN 214: binäre Hauptantenne | gering: AiO sendet `$PANDA`/`$PAOGI`. |
| PGN 222: Nudge durch Maschinenmodul | mittel, wenn ein Hardware-Taster zum Versetzen genutzt wird. |
| PGN 234 / 235 / 237: Schaltkasten, Teilbreiten-Rückmeldung vom Maschinenmodul | mittel, wenn ein physischer Teilbreiten-Schaltkasten angeschlossen ist. |
| PGN 215, 230/231/233: Geräte-GPS und Gerätelenkung | nur für aktive Gerätelenkung. |
| GPS-Weitergabe (NMEA an Drittgeräte) | gering bis mittel (Dosierrechner, ISOBUS-Terminal). |
| AgIO-UDP-Monitor | teilweise: Network IO zeigt Module, RTCM-Tabelle und GPS-Systemdaten. |

---

## 4. UI/UX-Verbesserungen für das Traktor-Tablet

### 4.1 Messgrundlage

Alle sichtbaren Bedienelemente wurden in 29 Ansichten automatisch vermessen (Playwright,
`getBoundingClientRect`, nur das oberste Element am Mittelpunkt zählt).

- **211 verschiedene Bedienelemente**, davon **150 (71 %) kleiner als 48 px**, **83 kleiner als
  40 px**, nur **5 mindestens 64 px**.
- Auf einem 10,1"-Tablet mit 1280×800 CSS-px ist 1 px ≈ 0,17 mm. 56 px (Navigationsleisten)
  ≈ 9,5 mm, 26 px (Schließen-Kreuz) ≈ 4,4 mm, 18 px (Checkboxen) ≈ 3 mm.
- Richtwerte: WCAG 2.5.5 verlangt mindestens 44×44 px, Material Design 48 dp. Für Handschuhe
  und Vibration in der Kabine sind 15–20 mm üblich, also **≈ 88–120 px bei 1280×800**. Als
  realistisches Ziel schlage ich **≥ 64 px für alles, ≥ 80 px für Fahrfunktionen** vor.
- Schrift: in den Panels liegen 28–65 % der Textstellen unter 14 px (z. B. Fields and Jobs 44
  von 68, Vehicle Configuration 48 von 73, Network IO 24 von 46).

Anteil der Elemente unter 48 px je Ansicht:

| Ansicht | Elemente | < 48 px | < 40 px | Text < 14 px |
|---|---:|---:|---:|---:|
| Fahrt (13) | 47 | 18 | 13 | 11 / 33 |
| Fahrt mit Simleiste (06) | 59 | 30 | 19 | 24 / 45 |
| Network IO (02h) | 26 | 18 | 18 | 24 / 46 |
| Vehicle & Tool (02d) | 28 | 18 | 17 | 15 / 37 |
| Fields and Jobs (09) | 28 | 20 | 20 | 44 / 68 |
| AutoSteer voll (10) | 39 | 17 | 16 | 40 / 78 |
| Vehicle Configuration (11) | 31 | 20 | 19 | 48 / 73 |

### 4.2 Verbesserungen

Priorität: **P1** = sicherheits- oder fahrrelevant, zuerst umsetzen. **P2** = häufig benutzt.
**P3** = Einrichtung / selten.

#### U1 (P1): Fahrfunktionen rechts größer und beschriftet

![Fahrt Tag](images/ui-ux/13-day-driving-clean.jpg)

- **Befund:** Die rechte Leiste (Kontur, Manuell, Teilbreiten-Automatik, U-Turn, AutoSteer)
  hat 56×56 px große Knöpfe (`.rn-btn`, `index.html:1037`), also ≈ 9,5 mm, nur Piktogramme ohne
  Text. Der Zustand ist nur an der Hintergrundfarbe erkennbar (grün/gelb/blau).
- **Vorschlag:** 80–96 px hoch, Text unter dem Symbol („LENKUNG AN“, „TEILBR. AUTO“), Zustand
  zusätzlich über Rahmen und Text, nicht nur Farbe. Die Leiste hat rechts genug Platz (sie
  belegt im Fahrbild nur 64 px Breite).

#### U2 (P1): Teilbreiten-Knöpfe vergrößern

![Teilbreiten](images/ui-ux/06-driving-sections-steer.jpg)

- **Befund:** Die Teilbreiten-Knöpfe sind 46×38 px (`#sectionbar .sec-btn`, `index.html:285`),
  Schrift 13 px. Der Zustand (Aus/Auto/An) wird nur über die Farbe angezeigt. Bei 8 Teilbreiten
  bleibt die Leiste 400 px breit, obwohl 1280 px zur Verfügung stehen.
- **Vorschlag:** Knöpfe auf die verfügbare Breite strecken (Mindesthöhe 64 px), Zustand als
  Kürzel im Knopf („A“, „EIN“, „AUS“) plus Farbe. Das Verhalten (ein Tipp wechselt Aus → Auto
  → An, Tier-2-gesperrt) bleibt gleich.

#### U3 (P1): Querabweichung und Lightbar als Hauptanzeige

![Fahrt Tag](images/ui-ux/13-day-driving-clean.jpg)

- **Befund:** Die wichtigste Fahrinformation, die Querabweichung („0 cm“), steht in 13–15 px
  unter der Lightbar, deren Kästchen nur ≈ 18 px groß sind. Die Distanz zur Grenze (224,5 m)
  ist dagegen auffällig groß.
- **Vorschlag:** Querabweichung in ≥ 40 px, farbig nach Toleranz, Lightbar ≥ 32 px hoch.
  Reine Darstellungsänderung der Werte, die der Client schon bekommt (`tick`).

#### U4 (P1): Sonnenlicht-Theme mit hohem Kontrast

| Tag-Theme normal | Tag-Theme, simulierte Blendung | Nacht-Theme, simulierte Blendung |
|---|---|---|
| ![](images/ui-ux/13-day-driving-clean.jpg) | ![](images/ui-ux/14-day-glare-simulated.jpg) | ![](images/ui-ux/15b-night-glare-simulated.jpg) |

- **Befund (gemessen, Tag-Theme, Statusleiste):** „Operator“ grün auf hellem Grund 1,2:1,
  Geschwindigkeit orange 2,7:1, Kurs pink 3,9:1, AB-Linien-Info blau 2,9:1. WCAG fordert 4,5:1;
  für direkte Sonne sind ≥ 7:1 sinnvoll. Die Karte ist mittelgrau mit hellgrünen Flächen und
  dünnen Linien; unter Blendung (Screenshot 14, CSS-Simulation von Kontrastverlust)
  verschwinden Teilbreiten-Zustand, Leitlinie und Statuswerte fast vollständig.
- **Vorschlag:** drittes Theme „Sonne“: reines Weiß/Schwarz für Flächen und Text, Schrift
  fett, Statusfarben nur dunkel gesättigt (Grün #006b2d statt #39ff6a), Linien auf der Karte
  doppelt so breit, Bodentextur aus. Umschaltbar in Screen & Alerts neben Day/Night (die
  Theme-Logik existiert schon: `applyTheme()` in `app.js`, Tokens in `index.html:20–69`).

#### U5 (P1): Statusleiste: Tippflächen und Lesbarkeit

![Status GPS](images/ui-ux/03-status-gps.jpg)

- **Befund:** Die Knöpfe in der Statusleiste (Module, Pause, GPS-Fix) sind 23 px hoch
  (≈ 4 mm), Vollbild 34×34 px. Einheiten („kph“, „HDG“) sind 10 px groß. Das GPS-Popup nutzt
  12–13 px für 23 von 39 Textstellen.
- **Vorschlag:** Statusleiste 56–64 px hoch, ganze Segmente antippbar, Geschwindigkeit und Kurs
  ≥ 28 px, Einheiten ≥ 14 px. GPS-Qualität zusätzlich als Text mit Hintergrundfarbe („RTK FIX“
  auf grün), nicht nur als 13-px-Punkt.

#### U6 (P1): Schließen und Zurück: große Ziele, Tippen neben das Panel schließt

![Dateimenü](images/ui-ux/02-left-filemenu.jpg)

- **Befund:** Jedes Panel und jeder Dialog schließt über ein Kreuz mit 26×26 px (`.ln-x`,
  `index.html:826`), der Zurück-Pfeil in Fields and Jobs und Vehicle Configuration ist ebenfalls
  26×26 px ([09](images/ui-ux/09-fields-dialog.jpg), [11](images/ui-ux/11-vehicle-config.jpg)).
  Mit Handschuh ist das kaum zu treffen.
- **Vorschlag:** Kreuz und Zurück ≥ 64 px; Tippen auf die Karte außerhalb eines nicht-modalen
  Panels schließt es; Panels haben unten einen breiten „Fertig“-Knopf.

#### U7 (P2): Checkboxen und Schieberegler ersetzen

| Network IO | AutoSteer |
|---|---|
| ![](images/ui-ux/02-left-network.jpg) | ![](images/ui-ux/10-autosteer-expanded.jpg) |

- **Befund:** Network IO und die Tracks-Liste nutzen native Checkboxen mit 18×18 px
  (`nio-*-cfg`, `nio-ntrip-on`, `trk-vis`). Die AutoSteer-Gains sind Schieberegler mit 16 px
  Höhe (`cfg-slider`), der Simulator-Lenkregler ebenso. Bei Vibration verstellt man
  Schieberegler leicht ungewollt.
- **Vorschlag:** Checkboxen durch Kippschalter-Zeilen ersetzen, bei denen die ganze Zeile
  (≥ 64 px) das Ziel ist (wie schon die Knöpfe in Screen & Alerts). Schieberegler um große −/+
  Knöpfe ergänzen (ein Tipp = ein Schritt) und den Griff auf ≥ 48 px vergrößern. Es bleiben
  dieselben `config.set`-Schlüssel und Wertebereiche.

#### U8 (P2): Dialog-Knöpfe ≥ 64 px, gefährliche Aktionen abtrennen

| Fields and Jobs | Vehicle & Tool | Datei-Menü |
|---|---|---|
| ![](images/ui-ux/09-fields-dialog.jpg) | ![](images/ui-ux/02-left-vehicle.jpg) | ![](images/ui-ux/02-left-filemenu.jpg) |

- **Befund:** In Fields and Jobs sind alle Aktionen 31 px hoch; „Delete Field“ liegt direkt
  neben „Open Field Only“, „Delete Job“ neben „Start New Job“. In Vehicle & Tool sind
  New/Delete/Rename/Reset 88×32 px in einer Reihe. Im Datei-Menü steht „Reset All Settings“
  direkt neben „Language“. Free-Drive „◀ LEFT / 0 / RIGHT ▶“ ist 31 px hoch
  ([10](images/ui-ux/10-autosteer-expanded.jpg)), die Antennen-Auswahl Left/Center/Right ebenso
  ([11](images/ui-ux/11-vehicle-config.jpg)).
- **Vorschlag:** alle Dialog-Knöpfe ≥ 64 px. Löschen/Zurücksetzen räumlich getrennt (eigene
  Zeile, Abstand ≥ 24 px) und nur nach Bestätigung (die Bestätigungsdialoge gibt es teils
  schon, z. B. beim AutoSteer-Reset).

#### U9 (P2): Weniger Menüebenen im Feld

| AB-Flyout | Fields and Jobs |
|---|---|
| ![](images/ui-ux/07-bottom-ab-flyout.jpg) | ![](images/ui-ux/09-fields-dialog.jpg) |

- **Befund:** Im Feld gibt es drei Leisten mit zusammen 25 Knöpfen ohne Beschriftung (8 links,
  5 rechts, 12 unten). Häufige Fahrfunktionen liegen eine Ebene tief: Nudge, A+/B+, Zyklus
  und Glätten im AB-Flyout ([07a](images/ui-ux/07-bottom-ab-flyout.jpg)), Flaggen im
  Flaggen-Flyout ([07b](images/ui-ux/07-bottom-flags-flyout.jpg)). Ein neuer Auftrag braucht
  drei Ebenen (Field Operations → Fields and Jobs → Feld wählen → Start New Job) plus
  Texteingabe. Der Lenk-Assistent ist doppelt erreichbar (Tools und AutoSteer-Panel).
  Einrichtungs-Panels (Vehicle, AutoSteer, Network) stehen während der Fahrt gleichrangig neben
  Feldfunktionen.
- **Vorschlag:**
  1. **Zwei Modi:** „Fahren“ (Standard, sobald ein Feld offen ist) und „Einrichten“. Im
     Fahrmodus wird die linke Leiste auf einen einzigen „Menü“-Knopf reduziert; Fahrzeug,
     AutoSteer, Netzwerk und Tools liegen gemeinsam in „Einrichten“ mit Reitern.
  2. **Fahrfunktionen auf eine Ebene:** Nudge links/rechts und „Linie wechseln“ als
     Dauerknöpfe in der unteren Leiste (die seitlichen Knöpfe auf der Karte gibt es schon als
     Option), A+/B+ und Glätten bleiben im Flyout.
  3. **Schnellstart:** großer Knopf „Letzten Auftrag fortsetzen“ beim Start (die Funktion
     `field.resumeLast` existiert bereits).
  4. Bottom-Leiste mit Text unter den Symbolen; seltene Einträge (Kartenfarbe, Werkzeug-Reset)
     in ein „Mehr“-Flyout.

#### U10 (P2): Mindest-Schriftgrößen

![AutoSteer voll](images/ui-ux/10-autosteer-expanded.jpg)

- **Befund:** Viele Texte sind 10–13 px (Hinweise 10–11 px, Tabellen 12–13 px). Im
  AutoSteer-Panel ist der Text im roten Reset-Kasten kaum lesbar (heller Rot-Ton auf Rosa).
- **Vorschlag:** Fließtext ≥ 16 px, Nebentext ≥ 14 px, Messwerte ≥ 20 px; in `index.html` über
  zentrale Größen-Tokens (`--fs-body`, `--fs-small`) statt fester Pixelwerte.

#### U11 (P2): Globaler „Handschuh-Modus“ (UI-Skalierung)

- **Befund:** Es gibt keine Größeneinstellung, und `user-scalable=no` (`index.html:5`)
  verhindert auch das Zoomen per Geste. Alle Größen sind feste Pixelwerte im CSS.
- **Vorschlag:** CSS-Variablen `--tap` (Standard 56 px, Handschuh 80 px) und `--fs-scale`;
  Schalter in Screen & Alerts, Wert per `localStorage` pro Gerät (die Kabine und das Büro-
  Notebook brauchen verschiedene Größen). Das ist der günstigste Hebel für U1–U8 und U10.

#### U12 (P2): Layout auf 7"-Tablets (1024×600)

| 1024×600 Fahrt | 1024×600 mit AutoSteer-Panel |
|---|---|
| ![](images/ui-ux/17-7inch-1024x600.jpg) | ![](images/ui-ux/17b-7inch-autosteer-panel.jpg) |

- **Befund:** Bei 1024×600 überdeckt die Neigungsanzeige den AutoSteer-Knopf der rechten Leiste
  (Screenshot 17), ein Panel deckt die halbe Karte ab (17b), die untere Leiste reicht fast über
  die volle Breite.
- **Vorschlag:** Media-Query für Höhe ≤ 640 px: Neigungsanzeige verkleinern oder nach links
  verschieben, Panels als Overlay von rechts mit maximal 40 % Breite.

#### U13 (P2, Abstimmung nötig): Auslösen bei Berührung vs. beim Loslassen

- **Befund:** Die Knöpfe der rechten Leiste und die Teilbreiten lösen bei `pointerdown` aus
  (`wireRn`, `app.js:3876`). Das ist schnell, aber bei Erschütterung löst ein abrutschender
  Finger sofort aus, und Wegziehen bricht nicht ab.
- **Vorschlag:** Ausschalten bleibt sofort bei Berührung (darf nicht verzögert werden). Für das
  Einschalten (AutoSteer, Teilbreiten-Automatik) Auslösen beim Loslassen innerhalb des Knopfes
  oder kurzes Halten (≈ 300 ms) mit Fortschrittsring. Das ändert nur die Eingabe im Client;
  die Freigabebedingungen im Host bleiben gleich. Weil es die Bedienung des Lenk-Engage
  betrifft, sollte das mit den Maintainern abgestimmt werden.

#### U14 (P3): Rückmeldung bei Tastendruck

- **Befund:** Es gibt kein `navigator.vibrate` im Client; der Druck-Zustand ist nur ein
  Farbwechsel. Mit Handschuh spürt man nicht, ob der Tipp angekommen ist.
- **Vorschlag:** kurze Vibration (Android-WebView unterstützt sie) und deutlicher
  Druck-Zustand (Rahmen, leichte Skalierung). Für Tier-2-Befehle, die ohne Kontrolle verworfen
  werden, ein kurzer Hinweis „Keine Steuerung“.

#### U15 (P3): Beobachter-Ansicht

![Observer](images/ui-ux/16-follower-readonly.jpg)

- **Befund:** Auf einem zweiten Gerät sind die gesperrten Knöpfe nur auf 40 % Deckkraft gesetzt,
  der Hinweis „observing“ ist 10 px groß. Man erkennt nicht sofort, warum nichts reagiert.
- **Vorschlag:** deutliches Banner „Nur Ansicht – Steuerung liegt bei Gerät X“ und, wenn der
  Platz frei ist, ein großer Knopf „Steuerung übernehmen“ (`control.acquire` gibt es schon).

#### U16 (P3): Kamera-Steuerkreuz und SIM-Knopf

![Start](images/ui-ux/01-start-no-field.jpg)

- **Befund:** Das Kamera-Kreuz hat 44×44 px; der Modus wird nur als Buchstabe gezeigt
  (M/H/N/C). Der SIM-Knopf (58×34 px) liegt mittig direkt über der Teilbreiten-Leiste und kann
  dort versehentlich getroffen werden.
- **Vorschlag:** Kreuz auf 64 px, Modus als Symbol mit Text („Fahrtrichtung oben“). SIM-Knopf
  ausblenden, wenn ein echtes GPS-Modul erkannt ist, oder ins Menü verschieben.

#### U17 (P3): Einrichtungs-Assistent

![Lenk-Assistent](images/ui-ux/18-steer-wizard.jpg)

- **Befund:** Weiter/Zurück/Abbrechen sind 35 px hoch und liegen in den Ecken; 15 Schritte.
- **Vorschlag:** Knöpfe ≥ 64 px, Schritt-Fortschritt als Balken mit Schrittnamen.

### 4.3 Umsetzungsreihenfolge

| Schritt | Inhalt | Dateien | Aufwand |
|---|---|---|---|
| 1 | Größen- und Schrift-Tokens, Handschuh-Modus (U11) | `index.html` (CSS), `app.js` (Schalter) | klein |
| 2 | Fahrbild: rechte Leiste, Teilbreiten, Querabweichung, Statusleiste (U1, U2, U3, U5) | `index.html`, `app.js` (Render der Overlays) | mittel |
| 3 | Sonnen-Theme (U4) | `index.html` (Tokens), `app.js` (`applyTheme`, Kartenfarben) | mittel |
| 4 | Schließen/Zurück, Checkboxen, Schieberegler, Dialog-Knöpfe (U6, U7, U8, U10) | `index.html`, `app.js` | mittel |
| 5 | Fahr-/Einrichtungsmodus, Menüebenen (U9) | `index.html`, `app.js`, `i18n` | groß |
| 6 | 7"-Layout, Beobachter, Feedback, Rest (U12, U14–U17) | `index.html`, `app.js` | klein bis mittel |
| – | U13 erst nach Abstimmung | `app.js` | klein |

Neue Texte laufen über `tr('…')` und `Tools/i18n-extract.py` (siehe `Docs/TRANSLATIONS.md`).

**Stand der Umsetzung**

- **Phase 1** (U1, U2, U4, U5, U11, U12 teilweise, Keya-Hinweis): Größenstufen Normal / Groß /
  Handschuh, Sonnen-Theme, beschriftete Fahrknöpfe, 7"-Layout.
- **Phase 2** (U3, U9, U10, dazu ein Terminal-Layout): Querabweichung oben mittig mit Zahl,
  Pfeil, „L“/„R“ und Text (auch ohne Farbe eindeutig); Mindestgrößen für alle Fahrwerte je
  Stufe; Fahrmodus (linke Leiste aus, Module auf wischbaren Arbeitsseiten, pro Gerät
  gespeichert) und getrennter Einrichtungsmodus (gestreiftes Band, linke Leiste zurück);
  Statusleiste mit Menü, GPS/RTK (Rahmenmuster je Fix-Qualität), Lenkstatus und Uhrzeit;
  belegbare Schnellzugriffsleiste rechts (Lenkung immer unten); Menü als Kachelraster;
  eigene Farbwelt (Petrol / Bernstein / Ziegelrot) und eigene Symbole. Das klassische Layout
  bleibt unter *Screen & Alerts → Classic layout* wählbar.
- **Phase 2b** (Feinschliff und Deutsch): Lenkstatus nur noch oben in der Statusleiste und als
  Knopf rechts, die linke Kachel zeigt die Arbeitsbreite; Distanzen mit Etikett („Vorgewende
  319,0 m“ = Abstand bis zur Vorgewendelinie voraus, „Wende 83 m“ = Weg bis zum Start der
  automatischen Wende); Kamera-Pad im Fahrmodus aus (Tippen auf die Karte zeigt es 5 s);
  untere Leiste beschriftet, selten Gebrauchtes (Überspringen, Wendemuster, Fahrgassen,
  Flächenfarbe, Geräterichtung) unter *Menü → Weitere Feldwerkzeuge*; Wende- und Spurknöpfe auf
  der Karte mit Rahmen und Namen (≥ 64 px); Teilbreiten direkt auf der unteren Leiste.
  Deutsche Oberfläche (`de.json` vollständig, Standardsprache, Sprachkachel im Menü unter
  Einrichtung), Dezimalkomma, km/h, ha/h. Begriffe: [Glossar-DE.md](Glossar-DE.md).
- **Phase 2c** (Fahrzeug- und Geräteprofile, [Analyse](Phase2c-Profile-Analyse.md)): Auswahl als
  Karten mit Symbol und den wichtigsten Werten (beim nicht aktiven Gerät keine Breite, siehe
  Analyse Befund 9); aktives Fahrzeug und Gerät oben im Menü; Assistent Art → Name → Maße →
  Antenne bzw. Anbau → Name → Teilbreiten → Anhängung, dann Prüfen und Speichern, mit Skizze je
  Maß, Einheit an jedem Feld, Erweitertes eingeklappt, gelben Warnungen (nie Korrektur).
  Der Assistent sendet erst beim Speichern, alles in einem Zug, und prüft danach, ob der Host
  alle Werte zeigt; reißt die Verbindung ab, sagt er das und bietet „Erneut senden“ bzw.
  „Alte Werte wiederherstellen“. Ändern nur im Stand und bei Lenkung AUS. Bekannte Host-Texte
  (Fix, NTRIP-Status) auf Deutsch. Arbeitsbreite ohne 6-m-Ersatzwert im Schlag-Editor und in
  der Leistung.
- Offen: U6–U8, U13 (nur nach Abstimmung), U14–U17.

### 4.4 Was nicht angefasst wird

- Keine Änderung an `Shared/AgOpenWeb.Services/`, `Shared/AgOpenWeb.ViewModels/`,
  `Shared/AgOpenWeb.Models/` (Lenkung, Regelung, U-Turn, Teilbreitenlogik, Kickouts, PGNs).
- Keine Änderung an `RemoteServerWiring` (Befehls-Routing, Tier-2-Liste, `ControlAuthority`)
  oder am Wire-Format (`WireCodec.cs` ↔ `transport.js`).
- Der Client sendet weiterhin dieselben Befehle mit denselben Argumenten; neue Knöpfe rufen nur
  bestehende Befehle auf.
- Ausschalten von Lenkung und Teilbreiten bleibt sofort und auf jedem Weg erreichbar.

---

## 5. Anhang: Methode und Grenzen

- **Messung:** Für jede Ansicht wurden alle sichtbaren `button`, `input`, `select`, `a[href]` und
  Teilbreiten-Knöpfe erfasst, die am Mittelpunkt oben liegen (`elementFromPoint`). Schriftgrößen
  per `getComputedStyle` je Textknoten. Kontrast nach WCAG-Formel gegen die nächste deckende
  Hintergrundfarbe; Texte direkt über der Karte (Canvas) sind dabei nicht bewertbar und wurden
  weggelassen.
- **Blendung:** Screenshots 14 und 15b simulieren Sonnenlicht nur grob per CSS-Filter
  (`contrast(0.45) brightness(1.45) saturate(0.6)`). Ein Test mit echtem Tablet in der Sonne
  ersetzt das nicht.
- **Hardware:** Kompatibilität aus dem Code abgeleitet; nicht mit AiO v4.5 oder Keya-Motor
  getestet. Die Firmware-Aussagen in 3.2 beziehen sich auf die AiO-Firmware außerhalb dieses
  Repos.
- **Umgebung:** Headless Chromium mit Software-WebGL; Bing-Satellitenbilder gesperrt.
- **Screenshots:** als JPEG (Qualität 78) unter `docs/images/ui-ux/`.
