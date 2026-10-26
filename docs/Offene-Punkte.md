# Offene Punkte

Aus der Gesamtprüfung des Forks (Oktober 2026, Branch `review/gesamtpruefung`): alles, was
größer ist, unsicher ist oder Host-Code bräuchte. Kleine, eindeutige Fehler sind direkt
behoben, siehe PR. Lenk-, Regel- und Sicherheitslogik ist nicht geändert; Befunde dort stehen
nur hier.

Priorität: **hoch** = Sicherheit oder Daten, **mittel** = Fehlfunktion, **niedrig** = Kosmetik.
Wo „unsicher“ steht, ist der Befund aus dem Code abgeleitet, aber nicht nachgestellt.
Board und Motor sind nicht auf echter Hardware getestet; kein Punkt hier sagt etwas über sie.

## Stand

Nach `sync/upstream` (Merge von upstream bis #357) sind die Punkte 1, 2, 8, 16 und 18 erledigt,
17 und 30 teilweise. Zu 3, 4 und 5 gibt es einen englischen Issue-Text für upstream. Punkt 31
ist für die nächste UI-Runde vorgemerkt. Die Einträge unten bleiben zum Nachlesen stehen.

## Übersicht

| Nr. | Titel | Priorität | Host | Stand |
|---|---|---|---|---|
| 1 | Sicherheitsfixes von upstream fehlen (25 PRs Rückstand) | hoch | ja (upstream-Code) | erledigt (sync/upstream: Merge) |
| 2 | Nach dem Upstream-Merge: U-Turn- und Fahrgassenwerte bestehender Geräteprofile werden Standardwerte | hoch | ja | erledigt (sync/upstream: Migration) |
| 3 | Beobachter können Geometrie und Profile ändern, auch bei eingeschalteter Lenkung | hoch | ja | Issue-Text an upstream |
| 4 | Zwei Geräte speichern gleichzeitig: Befehle mischen sich, fremdes Profil wird beschrieben | hoch | ja | Issue-Text an upstream |
| 5 | NTRIP-Passwörter und AgShare-Schlüssel gehen an jeden Browser im LAN | hoch | ja | Issue-Text an upstream |
| 6 | Lizenz uneinheitlich (`LICENSE.md`, README, Dateiköpfe, Info-Seite) | hoch | nein | erledigt: upstream Apache 2.0 (#360, #363), der Fork folgt (sync/upstream-2) |
| 7 | Host liest Befehle in 1-KB-Stücken (WebSocket) | mittel | ja | offen |
| 8 | Unvollständiges Speichern lässt sich nicht verwerfen | mittel | nein | erledigt (sync/upstream: Verwerfen in Sackgassen) |
| 9 | Speicher-Merker gilt pro Adresse, nicht pro Lenkrechner | mittel | ja | offen |
| 10 | Deutsch als Standard überstimmt eine bewusste Sprachwahl | mittel | ja | offen |
| 11 | Host-Meldungen als Toast bleiben englisch, auch sicherheitsnahe | mittel | nein | erledigt (tablet-feedback-1): 62 feste Host-Meldungen deutsch; Meldungen mit Werten bleiben englisch |
| 12 | Bei Verbindungsverlust frieren upstream-Anzeigen ein (Fix-Chip, Lichtleiste, Rollanzeige) | mittel | nein | erledigt (tablet-feedback-1): Fix „Keine Daten“, Lichtleiste, Rollanzeige und Ein/Aus-Zustände ausgeblendet, solange keine Daten kommen |
| 13 | `GpsService.CurrentData` veraltet nie, wenn das GPS verstummt | mittel | ja | offen |
| 14 | Neues Feld ohne GPS bekommt den Ursprung New York | mittel | ja | offen |
| 15 | Network IO: Subnetz-Ersatz 192.168.5 wird gesendet | mittel | nein | erledigt (tablet-feedback-1): Beispielwert 192.168.5 wird ohne Eingabe nicht gesendet |
| 16 | Nach dem Upstream-Merge: Schnellleiste bricht (#339, #318) | mittel | nein | erledigt (sync/upstream) |
| 17 | Nach dem Upstream-Merge: i18n-Prüfung rot, `de.json` kollidiert bei jedem Merge | mittel | nein | teils: Prüfung grün; `de.json` kollidiert weiter |
| 18 | Nach dem Upstream-Merge: „Report on GitHub“ führt zum Upstream-Repo | mittel | nein | erledigt (sync/upstream: ausgeblendet) |
| 19 | Dauerlast: Beobachter auf Bild-für-Bild-Texten, 9 Intervalle, erzwungene Layouts | mittel | nein | offen: erst auf einem echten Tablet messen (wie vorgeschlagen) |
| 20 | Binärdateien ohne Lizenzdatei und ohne Hinweise auf Fremdkomponenten | mittel | nein | offen |
| 21 | „Gespeichert“ beweist nicht, dass der Host auf die Platte geschrieben hat | niedrig | ja | offen |
| 22 | Gesperrter localStorage: das rote Band überlebt kein Neuladen, ohne Hinweis | niedrig | nein | erledigt (tablet-feedback-1) |
| 23 | Profilnamen und Eingaben: Kleinigkeiten | niedrig | teils | teils (tablet-feedback-1): Windows-Namen, Teilbreiten runden, „Geladen“ erst nach Bestätigung; gleichzeitiges Anlegen nur im Host |
| 24 | NTRIP: kleinere Punkte (HDOP, Fix 7/8, Rest-Wettlauf, Backoff) | niedrig | ja | offen |
| 25 | Anzeige: kleine Ersatz-Nullen und Ausblendungen | niedrig | nein | teils (tablet-feedback-1): Zustand 3 zählt als an, kein „NaN m“; Rest (Platz, Vorzeichen) offen |
| 26 | Hilfslinien und Raster rechnen mit 6 m ohne Teilbreiten | niedrig | nein | offen: nach deiner Vorgabe aus Phase 2c nicht angefasst (Issue-Text Punkt 3) |
| 27 | Doppelte Hilfsfunktionen im tablet-ui-Block | niedrig | nein | offen: reiner Umbau ohne Nutzen für die Bedienung; mit eigenem Testlauf in einer späteren Runde |
| 28 | i18n: Fast-Dubletten und ein unübersetzter upstream-Text | niedrig | nein | erledigt (tablet-feedback-1): upstream-Schlüssel wiederverwendet; „Current: “ bleibt upstream |
| 29 | Name auf Desktop/iOS und in den Artefakten weiter „AgOpenWeb“ | niedrig | ja | offen |
| 30 | Kleinigkeiten nach dem Upstream-Merge (#350, #352) | niedrig | teils | teils: #350 erledigt, #352 offen |
| 31 | 7 Zoll, Handschuh: Bildschirmknöpfe verdecken die Vorgewende-Anzeige | mittel | nein | erledigt (tablet-feedback-1): Knöpfe rücken unter die Vorgewende-Anzeige; Audit 1024×600 Handschuh 0 Überlappungen |
| 32 | IMU-Kurs aus PGN 253: eine 0 der AiO-Firmware gilt als gültiger Kurs (upstream #357) | hoch | ja | Firmware geprüft: v4 (auch v4.5) sendet 9999, v26 sendet 0; Anzeige im Einrichtungsmodus; Issue-Text an upstream |
| 34 | Gezogene Geräte: Drehpunkt-Abstand wirkt umgekehrt zur Beschriftung; TBT: „Arbeitsmitte“ wirkt nicht | mittel | ja | Fork: Anzeige an das Host-Verhalten angepasst (`docs/Host-Aenderungen.md` Punkt 7); Host offen |

---

### 1. Sicherheitsfixes von upstream fehlen (25 PRs Rückstand)
- **Priorität:** hoch (Sicherheit)
- **Dateien:** upstream `develop` (b16ac17) gegen den Fork-Punkt 565a259; betrifft Host-Dateien zu Teilbreiten, U-Turn und GPS.
- **Beschreibung:** Seit dem Fork hat upstream 25 PRs gemergt, darunter:
  - #319: Fällt das GPS aus, werden auch einzeln eingeschaltete Teilbreiten abgeschaltet.
  - #320: Nur konfigurierte Teilbreiten werden als „an“ gesendet.
  - #315: Teilbreiten-Bits gehen aus der 100-Hz-Schleife an den PGN-Sender.
  - #323: Ein U-Turn-Pfad, der im Vorgewende beginnt, gilt nicht mehr als verpasste Wende.

  Der Fork hat diese Stellen nicht verändert. Ein Probe-Merge hatte nur 3 Textkonflikte
  (`build-and-release.yml` Kommentar, `en.json`, `de.json`); danach baute alles, und die
  Services-Tests liefen durch (1584 bestanden).
- **Vorschlag:** Bald als eigene Phase upstream mergen, zusammen mit den Punkten 2, 16, 17
  und 18. Nicht auf echter Hardware geprüft.
- **Host-Änderung nötig:** ja (upstream-Code übernehmen, keine eigene Änderung)

### 2. Nach dem Upstream-Merge: U-Turn- und Fahrgassenwerte bestehender Geräteprofile werden Standardwerte
- **Priorität:** hoch (Wendegeometrie)
- **Dateien:** upstream #331 `ToolProfileJsonService.cs`, `VehicleProfileJsonService.cs`; Fork `app.js` TabletProfiles (Laden, Duplizieren).
- **Beschreibung:**
  - Upstream speichert U-Turn (Radius, Verlängerung, Abstand zur Grenze, Stil, Glättung)
    und Fahrgassen jetzt mit dem Geräteprofil.
  - Ein Geräteprofil ohne diesen Abschnitt, also jedes heute vorhandene, lädt die
    Standardwerte (`dto.YouTurn?.TurnRadius ?? dg.UTurnRadius`, z. B. Radius 8 m). Aus dem
    Fahrzeugprofil wird nichts übernommen.
  - Die Profilkarten und der Assistent des Forks zeigen keine U-Turn-Werte. Der Fahrer merkt
    die Änderung also nicht.
- **Vorschlag:**
  - Beim Merge eine einmalige Übernahme der alten Werte aus dem Fahrzeugprofil, wenn dem
    Geräteprofil der Abschnitt fehlt. Upstream fragen, ob das als PR gewollt ist.
  - Bis dahin nach dem Merge jede Kombination prüfen und einmal speichern.
  - Den U-Turn-Radius auf der Gerätekarte und der Prüfseite anzeigen (nur Client).
- **Host-Änderung nötig:** ja (Übernahme beim Laden)

### 3. Beobachter können Geometrie und Profile ändern, auch bei eingeschalteter Lenkung
- **Priorität:** hoch (Sicherheit)
- **Dateien:** `RemoteServerWiring.cs` `IsRestrictedCommand` (674–683), `config.set` und `profile.*` sind Tier-1; Fork `app.js` `lockReason()`.
- **Beschreibung:**
  - Der Host lässt `config.set|vehicle.wheelbase:…`, `profile.load` usw. von jedem Gerät
    zu, auch während ein anderes Gerät lenkt.
  - Der Fork sperrt das jetzt in seiner Profiloberfläche: ein Beobachter, Lenkung an, Fahrt,
    alte Daten. Die klassischen upstream-Dialoge und jeder andere Client können es weiter.
  - Das ist upstream-Verhalten, kein Fork-Fehler. Es ist Regel- und Sicherheitslogik, deshalb
    nur eingetragen.
- **Vorschlag:** Upstream-Issue: Geometrie-Schlüssel von `config.set` und `profile.load` bei
  eingeschalteter Lenkung ablehnen, oder als Tier-2 behandeln. Die Klassische Ansicht im Fork ist
  nur über die gesperrte Profiloberfläche erreichbar; die upstream-Menüs nicht.
- **Host-Änderung nötig:** ja

### 4. Zwei Geräte speichern gleichzeitig: Befehle mischen sich, fremdes Profil wird beschrieben
- **Priorität:** hoch (Daten)
- **Dateien:** `WebSocketHub.cs` 118, `RemoteServerWiring.cs` 47 (jede Nachricht einzeln an den Dispatcher), `RemoteServerWiring.Helpers.cs` `profile.save`; Fork `app.js` `startJob`.
- **Beschreibung:**
  - Der Assistent schickt seine Befehle hintereinander. Lädt ein anderes Gerät dazwischen ein
    anderes Profil, gehen die restlichen Werte und `profile.save` an dieses Profil und werden
    dort gespeichert.
  - Das eigene Gerät meldet nur „nicht bestätigt“.
  - Mit der Beobachter-Sperre (Punkt 3) ist das Fenster kleiner, aber zwei Clients ohne
    Bediener oder die Klassische Ansicht bleiben möglich. Unsicher, wie oft das vorkommt.
- **Vorschlag:** Ein Host-Befehl, der alles in einem Dispatcher-Durchlauf erledigt und abbricht,
  wenn das Zielprofil nicht aktiv ist, z. B. `profile.apply|<art>\t<name>\t<k:v>…`. Das ist ein
  neuer Befehl und braucht eine Freigabe.
- **Host-Änderung nötig:** ja

### 5. NTRIP-Passwörter und AgShare-Schlüssel gehen an jeden Browser im LAN
- **Priorität:** hoch (Daten)
- **Dateien:** `SceneProjector.cs` 450–453 und 629, `WireCodec.cs` (NtripProfiles- und AgShare-Frame), `RemoteServerHost.cs` 331 (`/bugreports/` ohne Anmeldung).
- **Beschreibung:**
  - Jede Seite im LAN bekommt ohne Anmeldung alle NTRIP-Passwörter im Klartext und den
    AgShare-API-Schlüssel.
  - Bug-Report-ZIPs mit Schlag und GPS-Daten kann laden, wer den Dateinamen kennt; der
    Dateiname steht im Status, den alle Clients bekommen.
  - Upstream-Verhalten. Der Fork schreibt keine Zugangsdaten in Logs, ZIP oder localStorage
    (geprüft); die Diagnose schwärzt sie.
- **Vorschlag:** Upstream-Issue: Passwort nicht projizieren (Platzhalter; leer = unverändert),
  Bug-Reports nur für das Gerät mit Bedienung.
- **Host-Änderung nötig:** ja

### 6. Lizenz uneinheitlich (erledigt)
- **Priorität:** hoch (rechtlich)
- **Stand:** erledigt. Upstream hat sich mit #360 und #363 auf die Apache License 2.0 festgelegt:
  `LICENSE.md`, README, alle Dateiköpfe (SPDX `Apache-2.0`) und die About-Seite; die CI prüft das
  (`Tools/license-headers.py --check`). Der Fork folgt (Branch `sync/upstream-2`):
  - die Fork-eigenen Dateien haben den SPDX-Kopf;
  - die Info-Seite nennt Apache 2.0, „geänderte Fassung, basiert auf AgOpenWeb“, das Copyright
    der AgOpenWeb-Mitwirkenden und der Änderungen sowie den Gewährleistungsausschluss;
  - mitgeliefert wird nur noch der Apache-Text (`LICENSE.md`);
  - der Release-Text-Fuß nennt Apache 2.0.

  Eine `NOTICE`-Datei hat upstream nicht.
- **Host-Änderung nötig:** nein

### 7. Host liest Befehle in 1-KB-Stücken (WebSocket)
- **Priorität:** mittel
- **Dateien:** `Shared/AgOpenWeb.RemoteServer/WebSocketHub.cs` 66–76.
- **Beschreibung:**
  - `new byte[1024]`, `EndOfMessage` wird nicht geprüft. Jedes Stück läuft einzeln durch
    `Dispatch()`, das Ende einer langen Nachricht als eigener „Befehl“.
  - Die Fork-Diagnose ist jetzt unter 1 KB gekürzt; Logs und RTCM-Bericht stehen ohnehin im
    ZIP.
  - Upstreams eigenes Bug-Report-Formular mit langer Beschreibung hat denselben Fehler. Ein
    langes `ntrip.save` (sehr lange Felder) auch.
- **Vorschlag:** Stücke bis `EndOfMessage` sammeln, mit Obergrenze (z. B. 64 KB). Guter
  upstream-PR.
- **Host-Änderung nötig:** ja

### 8. Unvollständiges Speichern lässt sich nicht verwerfen
- **Priorität:** mittel
- **Dateien:** `app.js` TabletProfiles `fillResult`, `loadTarget`.
- **Beschreibung:** In diesen Fällen kommt man aus dem roten Band nur heraus, wenn man die
  Website-Daten löscht:
  - Das Profil hinter dem Speichern wurde inzwischen gelöscht oder umbenannt.
  - Der Datensatz stammt von einem anderen Lenkrechner (Punkt 9).
  - Der Host bestätigt einen Wert nie (negative Gerätelängen werden jetzt im Assistenten
    abgelehnt; andere Klemmungen sind nicht bekannt).

  Das Band hat bewusst kein X (deine Vorgabe).
- **Vorschlag:** In der Wiederherstellungsansicht „Verwerfen (nicht speichern)“ mit Rückfrage
  anbieten, nur in diesen Sackgassen. Braucht deine Entscheidung, weil es die Vorgabe
  „nicht wegklickbar“ berührt.
- **Host-Änderung nötig:** nein

### 9. Speicher-Merker gilt pro Adresse, nicht pro Lenkrechner
- **Priorität:** mittel
- **Dateien:** `app.js` `aow.ui.profilePending`.
- **Beschreibung:**
  - localStorage gilt pro Ursprung (Schema, Host, Port).
  - Haben mehrere Kits dieselbe Hotspot-IP oder wird der Rechner getauscht, sieht ein Tablet
    am neuen Rechner den Merker vom alten.
  - Im Bearbeiten-Modus mit gleichem Profilnamen (z. B. „Default“) würde „Erneut senden“ die
    alten Werte dort schreiben.
  - Der Merker wird jetzt auf Form geprüft, aber nicht auf Herkunft.
- **Vorschlag:** Eine Host-Kennung (z. B. Maschinen-GUID in `appInfo`) im Merker speichern und
  vergleichen. Bis dahin: Alter des Merkers anzeigen, ältere als 24 h nur mit Rückfrage
  senden.
- **Host-Änderung nötig:** ja (Kennung)

### 10. Deutsch als Standard überstimmt eine bewusste Sprachwahl
- **Priorität:** mittel
- **Dateien:** `app.js` TabletPolish (Sprachvorgabe), Host `SetLanguageCommand`.
- **Beschreibung:** Die Sprache gilt für den ganzen Host. Hat jemand bewusst Englisch gewählt,
  stellt ein neues Gerät (oder eines mit gelöschtem Speicher) beim Übernehmen der Bedienung
  wieder für alle auf Deutsch. Der Fall „Speicher gesperrt, jede Sekunde neu“ ist behoben.
- **Vorschlag:** Ein Host-Merker „Sprache bewusst gewählt“ in den AppSettings, den die
  Sprachvorgabe beachtet.
- **Host-Änderung nötig:** ja

### 11. Host-Meldungen als Toast bleiben englisch, auch sicherheitsnahe
- **Priorität:** mittel
- **Dateien:** `Shared/AgOpenWeb.ViewModels/*.cs` (`ReportFailure("…")`, etwa 58 feste Texte), `app.js` `showToast`, `TabletHostText`.
- **Beschreibung:** Beispiele:
  - „Steer module stopped steering (kickout, switch or button)“
  - „AutoSteer off: no GPS/guidance update for over 1 s“
  - „AutoSteer not available - no active track“

  Keiner dieser Texte steht in `en.json`; der Seitenübersetzer kennt sie nicht.
- **Vorschlag:** Die festen Texte als `tr('…')`-Liste in `TabletHostText` aufnehmen (wie die
  Fix-Texte), dann extrahieren und übersetzen. Texte mit eingebetteter Fehlermeldung bleiben
  englisch. Fleißarbeit, nur Client.
- **Host-Änderung nötig:** nein

### 12. Bei Verbindungsverlust frieren upstream-Anzeigen ein
- **Priorität:** mittel
- **Dateien:** `app.js` upstream `renderStatusBar` (`sb-fix`, Alter), `lightbarSk`, `updateLightbarText`, Rollanzeige; Fork `TabletTerminal.frame`.
- **Beschreibung:**
  - Die Fork-Anzeigen zeigen jetzt „Getrennt“ bzw. „Keine Daten“ und „—“.
  - Die upstream-Anzeigen behalten den letzten Stand, z. B. „RTK Fix“ im Fix-Chip, die
    Lichtleiste und die Rollanzeige.
  - Der rote Lenk-Chip „GETRENNT“ ist deutlich, der Fix-Chip daneben aber irreführend.
- **Vorschlag:** Im Block den Fix-Chip bei `!tuiLive()` auf „—“/kein Fix setzen und die
  Lichtleiste ausblenden. Das berührt die Darstellung upstream-gezeichneter Elemente; vorher
  abstimmen. Upstream-Issue für die eigenen Anzeigen.
- **Host-Änderung nötig:** nein

### 13. `GpsService.CurrentData` veraltet nie, wenn das GPS verstummt
- **Priorität:** mittel
- **Dateien:** `Shared/AgOpenWeb.Services/GpsService.cs` 91–97; `NtripClientService.UsableGgaFix`.
- **Beschreibung:** Bleiben die GPS-Sätze aus, gilt das letzte `GpsData` (z. B. Fix 4) weiter
  als aktuell. Die NTRIP-GGA schickt dann diese Position mit der aktuellen Uhrzeit, ohne die
  neue 5-Minuten-Grenze. Schon upstream so. Ob andere Verbraucher betroffen sind, ist nicht
  geprüft (die Lenkung hat eine eigene „GPS lost“-Erkennung).
- **Vorschlag:** In `UsableGgaFix` Daten älter als etwa 5 s verwerfen (`GpsData.Timestamp`);
  das liegt in der NTRIP-Ausnahme. `GpsService` selbst nur mit upstream.
- **Host-Änderung nötig:** ja

### 14. Neues Feld ohne GPS bekommt den Ursprung New York
- **Priorität:** mittel
- **Dateien:** `RemoteServerWiring.Helpers.cs` 496, `MainViewModel.Commands.Fields.cs` 196 (40.7128 / −74.0060); `app.js` `renderNewField` (zeigt den Hinweis).
- **Beschreibung:** Ohne Fix legt der Host ein Feld am Ersatz-Ursprung an. Der Dialog zeigt
  „No GPS fix — a default origin will be used“, man kann aber trotzdem anlegen. Upstream-Verhalten.
- **Vorschlag:** Im Client das Anlegen ohne Fix nur mit Rückfrage erlauben (upstream-Teil,
  außerhalb des Blocks), oder upstream-Issue.
- **Host-Änderung nötig:** ja (für eine echte Lösung)

### 15. Network IO: Subnetz-Ersatz 192.168.5 wird gesendet
- **Priorität:** mittel
- **Dateien:** `app.js` 2782–2784 (upstream).
- **Beschreibung:** Leere Subnetz-Felder werden mit 192.168.5 gefüllt und beim Senden übertragen.
  Liegen die Module in einem anderen Netz, sind sie danach eventuell nicht mehr erreichbar.
- **Vorschlag:** Platzhalter statt Wert; leere Felder nicht senden. Upstream-Teil, daher
  zusammen mit upstream (#341 behält den Ersatzwert).
- **Host-Änderung nötig:** nein

### 16. Nach dem Upstream-Merge: Schnellleiste bricht (#339, #318)
- **Priorität:** mittel
- **Dateien:** `app.js` TabletTerminal `QPOOL`, `applyQuick`, `countSlots`, `RN_LABELS`.
- **Beschreibung:**
  - Upstream entfernt `#bn-autotrack`; der Schnellknopf „Auto-Spur“ wäre dauerhaft aus.
  - Die neuen `rn-cycle`, `rn-cycleback`, `rn-autotrack` und `rn-isobus` kennt die
    Schnellleiste nicht: Sie stehen ungeordnet, ohne Beschriftung, und sprengen das
    Platzbudget im Handschuh-Modus.
- **Vorschlag:** Beim Merge `QPOOL` auf `rn-autotrack` umstellen, die neuen Knöpfe aufnehmen,
  nur sichtbare zählen.
- **Host-Änderung nötig:** nein

### 17. Nach dem Upstream-Merge: i18n-Prüfung rot, `de.json` kollidiert bei jedem Merge
- **Priorität:** mittel
- **Dateien:** `i18n/de.json`, `Tools/i18n-extract.py`, `.github/workflows/build-and-release.yml`.
- **Beschreibung:** Nach dem Probe-Merge fehlen 40 deutsche Texte (#314, #318, #322, #338–#341,
  #349, #351), 4 sind veraltet. Weblate schreibt weiter in die upstream-`de.json`.
- **Vorschlag:** Beim Merge übersetzen. Auf Dauer die Fork-Übersetzungen über Weblate
  einbringen, dann entfallen die Konflikte.
- **Host-Änderung nötig:** nein

### 18. Nach dem Upstream-Merge: „Report on GitHub“ führt zum Upstream-Repo
- **Priorität:** mittel
- **Dateien:** upstream #349 (`#br-github`, `#br-github-hint`, `.github/ISSUE_TEMPLATE`, `bug-report-check.yml`).
- **Beschreibung:** Fehler aus dem Fork landen sonst bei upstream, auch mit dem eigenen Namen.
- **Vorschlag:** Bei aktivem Branding ausblenden
  (`:root[data-tb] :is(#br-github, #br-github-hint) { display: none !important; }`) oder auf
  `BRAND.source + '/issues/new'` umleiten. Den Workflow im Fork prüfen.
- **Host-Änderung nötig:** nein

### 19. Dauerlast: Beobachter auf Bild-für-Bild-Texten, 9 Intervalle, erzwungene Layouts
- **Priorität:** mittel (Akku, Wärme, Ruckeln auf einfachen Tablets; unsicher, wie stark)
- **Dateien:** `app.js` TabletPolish `decObs`, `TabletHostText` (MutationObserver auf Elementen, die `renderStatusBar` jedes Bild neu schreibt); Intervalle in TabletUi (400 ms), TabletTerminal (300 ms, 1 s), TabletPolish (1 s, 300 ms `placeUTurn`), TabletProfiles (250 ms, 300 ms), TabletBrand (400 ms, 300 ms); zwei zusätzliche rAF-Schleifen; `labelled()` setzt `innerHTML` jedes Bild.
- **Beschreibung:** Geschätzt etwa 9 bis 12 erzwungene Layouts pro Sekunde und einige hundert
  Observer-Einträge pro Sekunde, grob 1–4 % eines Kerns. Nicht gemessen.
- **Vorschlag:**
  - Die Render-Funktionen umhüllen statt beobachten.
  - Die Layout-Timer zu einem 500-ms-Takt mit `ResizeObserver` zusammenlegen (erst messen,
    dann schreiben).
  - Menü-Kacheln beim Öffnen bauen statt pollen.
  - `labelled()` über ein `data-`Attribut und CSS `::before`.

  Vorher auf einem echten Tablet messen.
- **Host-Änderung nötig:** nein

### 20. Binärdateien ohne Lizenzdatei und ohne Hinweise auf Fremdkomponenten
- **Priorität:** mittel (rechtlich; unsicher)
- **Dateien:** `.github/workflows/fork-prerelease.yml`, `deploy/windows/package.sh`.
- **Beschreibung:** Der Release-Text hat jetzt einen festen Lizenz- und Quellcode-Fußtext. Im
  Windows-ZIP und in der APK liegt aber keine Lizenzdatei. Hinweise auf CanvasKit (BSD-3),
  Photino (Apache 2.0) und SkiaSharp (MIT) fehlen; das ist auch upstream so.
- **Vorschlag:** `COPYING` und `SOURCE.txt` ins Windows-ZIP; eine Seite „Drittkomponenten“ in
  der Info-Seite.
- **Host-Änderung nötig:** nein

### 21. „Gespeichert“ beweist nicht, dass der Host auf die Platte geschrieben hat
- **Priorität:** niedrig
- **Dateien:** `app.js` TabletProfiles `watchJob`; Host `profile.save`.
- **Beschreibung:** „Gespeichert“ heißt: Der Config-Frame zeigt die Werte, die Verbindung steht
  seit 1 s. Einen Schreibfehler (voller Speicher) sieht der Client nicht.
- **Vorschlag:** Der Host meldet `HasUnsavedChanges` oder einen Speicherzähler im Profil-Frame.
- **Host-Änderung nötig:** ja

### 22. Gesperrter localStorage: das rote Band überlebt kein Neuladen, ohne Hinweis
- **Priorität:** niedrig
- **Dateien:** `app.js` `setPending`, `lsSet`.
- **Beschreibung:** In der laufenden Sitzung erscheint das Band. Kann der Browser nichts
  speichern, ist es nach dem Neuladen still weg.
- **Vorschlag:** Nach dem Schreiben zurücklesen; wenn das scheitert, im Band „Dieses Tablet
  kann sich das nicht über einen Neustart merken“ zeigen.
- **Host-Änderung nötig:** nein

### 23. Profilnamen und Eingaben: Kleinigkeiten
- **Priorität:** niedrig
- **Dateien:** `app.js` TabletProfiles `nameProblem`, Teilbreiten-Anzahl, `selectField`, Laden-Meldung.
- **Beschreibung:**
  - Windows-Sonderfälle fehlen: Punkt oder Leerzeichen am Ende, CON/NUL/PRN …
  - Zwei Geräte können gleichzeitig denselben Namen anlegen; der Host überschreibt dann.
  - „3.7“ Teilbreiten wird zu 3 abgeschnitten (der Dialog rundet auf 4).
  - „Geladen: …“ erscheint vor der Bestätigung.
  - Ein Kupplungstyp außerhalb der Liste ergäbe einen leeren Wert (nur bei kaputten Daten).
- **Vorschlag:** Regex ergänzen, `Math.round(parseFloat())`, Meldung erst nach dem Profil-Frame.
  Gleichzeitiges Anlegen nur im Host lösbar.
- **Host-Änderung nötig:** teils (gleichzeitiges Anlegen)

### 24. NTRIP: kleinere Punkte
- **Priorität:** niedrig
- **Dateien:** `Shared/AgOpenWeb.Services/NtripClientService.cs`.
- **Beschreibung:**
  - Die GGA sendet HDOP fest 1.0, obwohl `Hdop` vorliegt.
  - Fix-Qualität 7 (manuell) und 8 (Simulation) gelten als brauchbar; mit laufendem Simulator
    geht die Simulator-Position an den Caster (Simulator meldet 4, schon upstream).
  - Rest-Wettlauf beim Profilwechsel innerhalb von `ConnectCoreAsync` (der Fall vor dem
    Verbinden ist behoben).
  - Ein Caster, der „200“ antwortet und sofort schließt (falsches Konto), wird für immer alle
    15 s versucht (schon upstream).
  - `_ggaSentThisSession` und `_earlyBody` sind nicht synchronisiert (betrifft nur
    Diagnosetexte).
  - Eine IPv6-Adresse im `Host`-Kopf steht ohne Klammern.
- **Vorschlag:** HDOP mitnehmen; nur Qualität 1–6; Token in `ConnectCoreAsync` prüfen; längerer
  Backoff nach wiederholtem Schließen vor RTCM (ändert upstream-Verhalten, abstimmen).
- **Host-Änderung nötig:** ja (in der NTRIP-Ausnahme)

### 25. Anzeige: kleine Ersatz-Nullen und Ausblendungen
- **Priorität:** niedrig
- **Dateien:** `app.js` (upstream-Teil und Block), `index.html` tablet-ui-Block.
- **Beschreibung:**
  - Vor dem ersten Tick zeigt die upstream-Statusleiste „0,0 km/h“.
  - Ein fehlender Config-Wert erscheint als 0 (`wzVal`, `totalWidth || 0`) oder „NaN m“
    (`activePreview`).
  - Die Geschwindigkeitskarte zeigt den Betrag (beim Rückwärtsfahren ohne Vorzeichen; das
    REVERSE-Schild bleibt).
  - Wird die Karte wegen Platzmangel ausgeblendet, ist die Geschwindigkeit nirgends zu sehen.
  - `#sb-age` (Korrekturalter) ist unter 1200 px ausgeblendet.
  - Die Teilbreiten-Karte zählt Zustand 3 („schaltet ab“) nicht als an.
- **Vorschlag:** Einzeln beim nächsten Durchgang der Anzeigen.
- **Host-Änderung nötig:** nein

### 26. Hilfslinien und Raster rechnen mit 6 m ohne Teilbreiten
- **Priorität:** niedrig
- **Dateien:** `app.js` `toolWidthM()`, `drawExtraGuidelinesSk`, Raster.
- **Beschreibung:** Ohne Teilbreiten zeichnen die Hilfslinien Spuren im Abstand von erfundenen
  6 m. Nach deiner Vorgabe aus Phase 2c nicht angefasst.
- **Vorschlag:** Upstream-Issue (Text liegt im PR von Phase 2c), oder `sectionsWidthM()`
  verwenden.
- **Host-Änderung nötig:** nein

### 27. Doppelte Hilfsfunktionen im tablet-ui-Block
- **Priorität:** niedrig
- **Dateien:** `app.js` TabletUi, TabletTerminal, TabletPolish, TabletProfiles, TabletBrand.
- **Beschreibung:**
  - `lsGet`/`lsSet` gibt es fünfmal; nur eine Fassung löscht bei `null`.
  - `el` gibt es dreimal.
  - `onTap` gibt es dreimal; die TabletTerminal-Fassung prüft `disabled` nicht.
  - Zwei Scrims und zwei `openSheet`.
  - Den Lenkzustand und die Beschriftungen gibt es doppelt.
- **Vorschlag:** Ein gemeinsames `TUI`-Objekt vor TabletUi, ohne Verhaltensänderung.
- **Host-Änderung nötig:** nein

### 28. i18n: Fast-Dubletten und ein unübersetzter upstream-Text
- **Priorität:** niedrig
- **Dateien:** `app.js` (Fork-Schlüssel), `app.js` 3782–3783 `refreshHub`.
- **Beschreibung:**
  - Der Fork hat eigene Schlüssel angelegt, wo upstream schon welche hat: „AB line“ (upstream
    „AB Line“), „Delete profile“, „Front fixed“/„Rear fixed“, „Max steer angle“, „Add“.
  - `refreshHub` setzt „Current: “ ohne `tr()` (upstream, nur in der Klassischen Ansicht).
- **Vorschlag:** Upstream-Schlüssel wiederverwenden; „Current: “ als upstream-PR.
- **Host-Änderung nötig:** nein

### 29. Name auf Desktop/iOS und in den Artefakten weiter „AgOpenWeb“
- **Priorität:** niedrig
- **Dateien:** `Platforms/AgOpenWeb.Desktop/Launcher/LauncherEntry.cs` 38, `Platforms/AgOpenWeb.iOS/Info.plist`, Workflow-Artefakte `agopenweb-*.zip/.apk`.
- **Beschreibung:** Nur Android ist umbenannt (genehmigte Ausnahme). Die Weboberfläche zeigt
  überall den Markennamen. Der Produktname ist noch der Platzhalter `[PRODUKTNAME]`; der
  Workflow warnt jetzt.
- **Vorschlag:** Nach der Namenswahl entscheiden, ob Desktop und Artefakte mitziehen (neue
  Ausnahme).
- **Host-Änderung nötig:** ja (Desktop-Kopf)

### 30. Kleinigkeiten nach dem Upstream-Merge (#350, #352)
- **Priorität:** niedrig
- **Dateien:** `app.js` TabletProfiles (Kommentar „the preview's Width is not the working width“), upstream `LauncherEntry.cs`.
- **Beschreibung:**
  - Nach #350 ist „Width“ in der Vorschau die echte Arbeitsbreite; die Gerätekarte kann sie
    dann auch für inaktive Geräte zeigen.
  - #352 fragt am Desktop „Exit AgOpenWeb?“ mit festem Namen.
- **Vorschlag:** Beim Merge mitnehmen.
- **Host-Änderung nötig:** teils (#352)

### 31. 7 Zoll, Handschuh: Bildschirmknöpfe verdecken die Vorgewende-Anzeige
- **Priorität:** mittel
- **Dateien:** `index.html` tablet-ui-Block (`#onscreenbtns`, `#headland-hud` Lage), `app.js` TabletTerminal `stackTop`, `fitOverlays`.
- **Beschreibung:** Bei 1024×600 im Handschuh-Modus legen sich die upstream-Knöpfe „Wende
  links/rechts“ und „Spur links/rechts“ (sichtbar, solange gelenkt wird) über die
  Vorgewende-Anzeige: Ihr Abstand ist halb verdeckt. Der UI-Audit misst das in jeder Ansicht
  mit eingeschalteter Lenkung (108×47 px), vor und nach der Gesamtprüfung gleich.
- **Nachtrag (Audit nach dem Upstream-Merge):** In einer Ansicht (7 Zoll, Handschuh, Lenkung an,
  Wende in Annäherung) lag einmal auch die U-Turn-Anzeige 47×53 px unter der rechten Leiste.
  Das hängt vom Zeitpunkt im Szenario ab; in der nächsten UI-Runde mit ansehen.
- **Vorschlag:** Die Knöpfe unter die HUD-Zeile setzen (`--tui-y-hud` + Höhe) oder auf 7 Zoll
  in die Spalte rechts neben der Querablage; danach Audit bei 1024×600 Handschuh.
- **Host-Änderung nötig:** nein

### 32. IMU-Kurs aus PGN 253: eine 0 der AiO-Firmware gilt als gültiger Kurs (upstream #357)
- **Priorität:** hoch (Sicherheit; Lenklogik, deshalb im Fork nur angezeigt, nicht geändert)
- **Dateien:** Host `Shared/AgOpenWeb.Services/AutoSteer/PgnBuilder.cs:669` (`hasImuHeading = headingRaw != 9999`), `AutoSteerService.PublishGpsData` (Übernahme, wenn der Satz keinen IMU-Kurs hat), `Gps/GpsHeadingFusionService.cs:258` (Versatz mit Gewicht nachziehen), 243–244 (Rückwärtserkennung).
- **Firmware-Befund** (Stand Oktober 2026):
  - **AiO v4-Firmware** (`AgOpenGPS-Official/Boards`, Commit 60e8d89; für AiO v4.x, also auch v4.5):
    - Keya-/CAN-Build `TeensyModules/AIO v4 Firmware/AIO_v4_Firmware_Keya_CANBUS_HPR_Dual_27.04.2025/Autosteer.ino:655–660`: PGN 253 trägt **immer** Kurs 9999 und Roll 8888, mit oder ohne IMU. Der Standard-Build ist gleich (`AIO_v4_Firmware/Autosteer.ino:603–608`).
    - Der IMU-Kurs geht im `$PANDA` raus: im RVC-Modus `bnoData.yawX10` (`zHandlers.ino:148`), ohne IMU 65535 (`zHandlers.ino:101`).
    - **Mit dieser Firmware ändert #357 nichts.**
  - **AiO v26-Firmware** (`Firmware_Teensy_AiO_26`, Commit 2551bff):
    - `AutosteerProcessor.cpp:1148–1149` setzt Kurs und Roll in PGN 253 fest auf 0 („Deprecated - sent by GNSS“).
    - Ohne IMU trägt `$PANDA` 65535 (`NAVProcessor.cpp:150`). Mit GPS-Durchreichung wird gar kein `$PANDA` gesendet (`NAVProcessor.cpp:298`).
    - In beiden Fällen nimmt der Host 0° als IMU-Kurs.
    - Ob v26 für AiO v4.5 gedacht ist, steht im Repo nicht.
- **Nachgestellt im Host** (Prüfstand ohne Hardware: GGA/VTG und PGN 253 per UDP, 90°-Kurve):
  - mit 0: IMU-Kurs „gültig“ 0°; nach der Kurve bis 9° Kursfehler, der über mehrere Sekunden abklingt;
  - mit 9999: kein IMU-Kurs, höchstens 1,8° Abweichung.
- **Einstellungen ohne Codeänderung:**
  - Keine Einstellung schaltet die Übernahme aus PGN 253 ab.
  - „Kursfusion“ (`gps.headingFusionWeight`, 0–1, Gewicht = Wert × 0,2) beschleunigt nur die Korrektur; auch bei 1,0 bleibt es eine gleitende Korrektur. Kleiner wird es schlimmer.
  - „Rückwärtserkennung“ aus verhindert nur ein mögliches 180°-Umklappen, nicht den Nachlauf.
  - Dual-GPS ist kein Ausweg bei einer Antenne.
- **Im Fork umgesetzt (nur Anzeige):** Im Einrichtungsmodus zeigt die Karte „Kurs-Prüfung“:
  - GPS-Kurs, IMU-Kurs empfangen, IMU-Kurs mit Versatz und die Abweichung;
  - eine gelbe Warnung bei IMU-Kurs genau 0° für 5 s während der Fahrt;
  - eine gelbe Warnung bei mehr als 20° Abweichung für 1 s.
- **Vorschlag:**
  - Firmware v26 soll 9999/8888 senden.
  - Der Host soll einen Modul-Kurs erst übernehmen, wenn er sich bewegt hat, oder nur nach Opt-in.
  - Der englische Issue-Text an upstream ist geschrieben.
  - Vor dem ersten Lenken auf dem Prüfstand die Kurs-Prüfung ansehen.
- **Host-Änderung nötig:** ja (Lenklogik, nur upstream)

### 34. Gezogene Geräte: Drehpunkt-Abstand umgekehrt; TBT: „Arbeitsmitte“ ohne Wirkung
- **Priorität:** mittel (Teilbreiten und Bearbeitung, nicht die Lenkung des Traktors)
- **Befund:** `ToolPositionService.cs:223` legt die Arbeitslinie bei positivem Drehpunkt-Abstand **vor** die Geräteachse; der Dialog nannte + „hinter“. Der AgOpenGPS-Import dreht nur die Anhängelänge (`ProfileJsonServiceV1.cs:256`). Bei TBT nimmt der Host die Zugpunkt-Länge des Fahrzeugs (`ToolPositionService.cs:113–115`), „Arbeitsmitte“ wirkt nicht.
- **Im Fork (nur Anzeige):** Knöpfe, Skizze und Satz im Drehpunkt-Tab folgen dem Host; „Arbeitsmitte“ bei TBT ausgeblendet. Nach einem Fix upstream zurücknehmen.
- **Host-Änderung nötig:** ja (upstream)
