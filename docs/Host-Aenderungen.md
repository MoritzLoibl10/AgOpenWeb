# Host-Änderungen im Fork

Die Regel für diesen Fork lautet: nur der Web-Client (`Shared/AgOpenWeb.RemoteServer/wwwroot/`)
wird geändert. Hier steht jede Ausnahme im Host, damit ein Rebase auf upstream planbar bleibt:
welche Dateien, was sich geändert hat und worauf man beim Zusammenführen achten muss.

Lenk-, Regel- und Sicherheitslogik sind in keiner Ausnahme angefasst. Dazu gehören Guidance,
U-Turn, Teilbreiten, Kickouts, PGNs, `ControlAuthority` und die Tier-2-Liste.

## 1. NTRIP: VRS-Caster (APOS), NTRIP 1/2, Caster-Antwort (Oktober 2026)

Anlass: APOS (BEV Österreich, VRS) nahm die Anfrage an und schloss die Verbindung wieder.
Meldung: „Caster closed the connection before sending corrections“.

Ursache: Die GGA an den Caster wurde nur aus einem Fix gebaut, der `GpsData.IsValid` erfüllt.
Das ist das Qualitätstor der Lenkung, und das verlangt standardmäßig RTK fixed
(`ConnectionConfig.MinFixQuality` = 4). Ohne Korrekturen gibt es den nie. Also ging eine
fest eingebaute Ersatzposition in Kansas (USA) raus, und das erst nach 5 s.

**Unverändert:** `GpsData.IsValid`, `MinFixQuality`, `GpsFixQualityValidator` und
`GpsPipelineService` sind nicht angefasst. Für die Lenkung gilt dasselbe Tor wie vorher.
Nur der NTRIP-Client hat jetzt ein eigenes, schwächeres Kriterium für die GGA:
Fix-Qualität 1–8 und plausible Koordinaten.

### Geänderte Host-Dateien

| Datei | Änderung | Rebase-Hinweis |
|---|---|---|
| `Shared/AgOpenWeb.Services/NtripClientService.cs` | GGA-Auswahl (`TryBuildGga`, `UsableGgaFix`, letzte Position mit Fix, keine Ersatzposition); erste GGA sofort nach der Annahme (NTRIP 1 auch direkt nach der Anfrage), dann im Intervall (`StartGgaTimer`); Anfrage über `NtripRequest`; Caster-Antwort und GGA-Zustand in Status und Log (`DescribeCasterReply`, `DescribeGgaState`, `KeepEarlyBody`); Grad/Minuten ohne „60.0000“ (`ToDegreesMinutes`) | Upstream ändert diese Datei oft (RTCM-Weiterleitung). Konflikte erwartet in `ConnectCoreAsync`, `SendNtripRequestAsync`, `ReceiveLoop` (Annahme-, Ablehnungs- und FIN-Zweig), `GgaTimerCallback`. RTCM-Queue, Pacing und Watchdog sind unverändert; dort upstream übernehmen. |
| `Shared/AgOpenWeb.Services/NtripRequest.cs` | **neu**: Anfrage für NTRIP 1 und 2 | keine Konflikte möglich |
| `Shared/AgOpenWeb.Services/NtripResponse.cs` | `Preview()` (erste Zeilen der Antwort, `Authorization`-Wert als `***`); NTRIP 2 „200 OK“ + `Content-Type: gnss/sourcetable` = Mountpoint unbekannt; „ICY 401“ = Anmeldung abgelehnt | kleine Ergänzungen, leicht nachzuziehen |
| `Shared/AgOpenWeb.Services/NtripConnectionTester.cs` | nutzt `NtripRequest` und die Profilversion; zeigt die rohe Antwort bei Fehlern | Parameter `ntripVersion` (Standard 1) |
| `Shared/AgOpenWeb.Services/Interfaces/INtripClientService.cs` | `NtripConfiguration.HttpVersion` (war ungenutzt) ersetzt durch `int NtripVersion` (Standard 1) | falls upstream `HttpVersion` zu nutzen beginnt: zusammenlegen |
| `Shared/AgOpenWeb.Models/Ntrip/NtripProfile.cs` | `int NtripVersion` (Standard 1, alte Profil-JSON ohne Feld = 1) | Feld anhängen |
| `Shared/AgOpenWeb.ViewModels/MainViewModel.Ntrip.cs` | Property `NtripVersion`, beim Verbinden durchgereicht; Profiländerung der Version löst Reconnect aus | nur NTRIP-Partial |
| `Shared/AgOpenWeb.ViewModels/MainViewModel.Commands.Ntrip.cs` | Test-Befehl übergibt die Version | eine Zeile |
| `Shared/AgOpenWeb.RemoteWiring/RemoteServerWiring.Helpers.cs` | `ntrip.save`: optionales 11. Feld `ntripVersion`; `ntrip.test`: optionales 6. Feld. Fehlt es, bleibt die gespeicherte Version (ältere Clients funktionieren weiter) | **Befehlsargument erweitert** (rückwärtskompatibel, kein neuer Befehl) |
| `Shared/AgOpenWeb.RemoteServer/Contracts.cs` | `NtripProfileDto` + `int NtripVersion = 1` (letzter Parameter) | |
| `Shared/AgOpenWeb.RemoteServer/SceneProjector.cs` | Version im Profil-DTO und im Fingerprint | |
| `Shared/AgOpenWeb.RemoteServer/WireCodec.cs` | **Wire-Format:** im NtripProfiles-Frame pro Profil ein `u8` NtripVersion nach der Feldliste | muss mit `transport.js` zusammen geändert werden; ändert upstream diesen Frame, beide Seiten in derselben Reihenfolge halten |

Web-Client (gehört zur normalen Regel, steht hier wegen des Wire-Formats):
`transport.js` liest das `u8`; `index.html`/`app.js` haben im Profil-Editor die Auswahl
„NTRIP version“ (`#nte-ver`) und hängen sie an `ntrip.save` und `ntrip.test` an; `en.json`
hat drei neue Texte.

Nachträge aus der Gesamtprüfung (gleiche Dateien, je ein Commit):
- Die letzte Position mit Fix ersetzt eine fehlende höchstens 5 Minuten
  (`MaxLastFixAgeSeconds`); danach geht keine GGA mehr raus. `GgaFix` ist eine Klasse
  (kein zerrissenes Lesen zwischen Timer und Verbindungsaufbau).
- Eine NTRIP-1-Ablehnung ohne Leerzeile („ERROR - Bad Password“ und Schließen, „ICY 401“)
  beendet den Versuch wie ein HTTP 401 (`StopOnRefusal`), statt alle 15 s neu zu verbinden;
  auch wenn das Schließen als Reset ankommt.
- Der GGA-Timer entsteht im Session-Lock vor der Anfrage (vorher konnte eine sehr schnelle
  Annahme ihn noch nicht finden; dann ging in der Sitzung keine GGA raus).
- Eine abgebrochene Reconnect-Schleife verbindet nicht mehr mit der alten Konfiguration.
- Die Logzeile zur ersten GGA nennt nur Fix-Qualität und Satelliten, nicht die Position.

Tests: `Tests/AgOpenWeb.Services.Tests/NtripVrsTests.cs` (Anfrageformat, Antworten, GGA,
Altersgrenze, NTRIP-1-Ablehnung, geschwärzte Anmeldung, simulierter VRS-Caster). Doku: Abschnitt „NTRIP Connection Format“ in `CLAUDE.md`.

### Verhalten, das sich für Nutzer ändert

- Bestehende Profile laufen mit NTRIP 1.0 („GET … HTTP/1.0“). Vorher war es eine Mischform
  (HTTP/1.1 ohne `Ntrip-Version`). Macht ein Caster damit Probleme: im Profil 2.0 wählen.
- Ohne GPS-Fix wird keine GGA gesendet. Vorher ging die Ersatzposition in Kansas raus.
- Die manuelle GGA-Position (`UseManualPosition`, in der UI derzeit nicht einstellbar)
  meldet Fix-Qualität 1 statt 4.
- Ohne Fix ersetzt die letzte Position mit Fix eine fehlende nur noch 5 Minuten lang.
- Eine NTRIP-1-Ablehnung („ERROR …“, „ICY 401“) stoppt mit „Rejected: …“ statt endlos neu
  zu verbinden. Nach Ändern des Profils wird neu verbunden.
- Die Anfrage schickt `Connection: close` statt `keep-alive`; NTRIP 1 schickt keinen `Host`
  mehr, NTRIP 2 den `Host` mit Port (außer Port 80).
- Benutzer und Passwort werden als UTF-8 kodiert (vorher ASCII): Bei Umlauten ergibt das
  eine andere Base64-Zeichenkette als vorher.
- Der Verbindungstest nutzt den User-Agent `NTRIP AgOpenWeb/1.0` (vorher `/Test`), schickt
  `Authorization` auch, wenn nur ein Passwort gesetzt ist, und nutzt die Version des Profils
  (Standard 1; vorher immer NTRIP 2).
- Scheitert bei NTRIP 1 das Senden der frühen GGA direkt nach der Anfrage, wird neu verbunden.
- Nicht auf echter Hardware und nicht gegen den echten APOS-Caster getestet; nur gegen
  einen simulierten Caster.

### Beim Rebase auf upstream

1. Konflikte in `NtripClientService.cs` von Hand lösen: upstream-Änderungen an RTCM-Framing,
   Queue und Watchdog übernehmen, die oben genannten Methoden aus dem Fork behalten.
2. Hat upstream das GGA-Problem selbst gelöst (GGA nicht mehr an `IsValid` gebunden), die
   Fork-Version von `TryBuildGga` gegen die upstream-Lösung abwägen und möglichst upstream nehmen.
3. Danach `dotnet test Tests/AgOpenWeb.Services.Tests --filter FullyQualifiedName~Ntrip`
   und `python3 Tools/i18n-extract.py --check`.

## 2. Phase 2b: Deutsch als Standard (Oktober 2026)

Keine Host-Änderung. Für Rebases wichtig, weil es upstream-Dateien außerhalb des
tablet-ui-Blocks betrifft:

| Datei | Änderung | Rebase-Hinweis |
|---|---|---|
| `wwwroot/i18n.js` | `lookup` sucht auch den normalisierten Schlüssel (ein Schlüssel mit doppelten Leerzeichen wie „Done {area}  Left …“ wurde in keiner Sprache übersetzt) | eine Zeile; Kandidat für einen upstream-PR |
| `wwwroot/i18n/de.json` | vollständig übersetzt (Fork-Begriffe, siehe `docs/Glossar-DE.md`) | upstream füllt `de.json` über Weblate: bei Konflikten die Fork-Fassung behalten und neue Schlüssel nachtragen; `Tools/i18n-extract.py --check` meldet Lücken |
| `.github/workflows/build-and-release.yml` | Schritt „Check language files are untouched“ lässt neben `en.json` auch `de.json` zu (upstream: Sprachdateien nur über Weblate); die anderen Sprachen bleiben gesperrt | ein Ausdruck in `grep -v`; bei Konflikt die Fork-Zeile behalten |
| `Tools/i18n-extract.py` | `--check` schlägt fehl, wenn `de.json` einen englischen Schlüssel nicht abdeckt (`REQUIRED = ("de",)`); veraltete Schlüssel werden nur gemeldet | kleiner Block vor `main()` |

Deutsch als Standard: Der Client schickt einmal je Gerät den vorhandenen Befehl
`app.setLanguage|de`, wenn der Host noch Englisch spricht (`aow.ui.langChosen` im localStorage;
zusätzlich ein Merker im Speicher, damit es bei gesperrtem localStorage nicht jede Sekunde
wieder umstellt). Meldungen, die der Host als fertigen Text schickt, übersetzt seit Phase 2c
`TabletHostText` teilweise (Fix-Texte, NTRIP-Status, NTRIP-Verbindungstest); Toasts aus
`ReportFailure` bleiben englisch (siehe `docs/Offene-Punkte.md`).

## 3. Phase 2c: Arbeitsbreite ohne Ersatzwert (Oktober 2026)

Keine Host-Änderung. Kleine Änderungen im upstream-Teil von `app.js` und `index.html`
(außerhalb des tablet-ui-Blocks), alle mit `fork:` kommentiert:

| Datei / Stelle | Änderung | Rebase-Hinweis |
|---|---|---|
| `app.js` `sectionsWidthM()` | **neu**, direkt vor `toolWidthM()`: Breite aus den Teilbreiten der Szene, `0` wenn es keine gibt. `toolWidthM()` selbst ist unverändert (fällt weiter auf 6 m zurück) | neue Funktion, keine Konflikte |
| `app.js` `fbDefaultOffset()` | nutzt `sectionsWidthM()`; ohne Teilbreiten `0` statt 12 m | eine Zeile |
| `app.js` `fbApplyTw()` | „N Arbeitsbreiten“ ohne Teilbreiten: Feld bleibt leer, Hinweis „Arbeitsbreite fehlt“ (`#fb-hl-twmiss`) | Funktion ersetzt (vorher eine Zeile) |
| `app.js` Vorgewende-Knöpfe (`#fb-addhl .fb-addbtn`) | ohne Abstand und ohne Arbeitsbreite wird nichts gesendet, der Hinweis erscheint; mit Abstand unverändert derselbe Befehl | eine Zeile |
| `app.js` `#fb-hl-newoff` input | blendet den Hinweis aus | eine Zeile |
| `app.js` Statuszeile Leistung (`sbPage === 1`) | ohne Teilbreiten „—“ statt einer Leistung aus 6 m | zwei Zeilen |
| `index.html` Schlag-Editor „Vorgewende hinzufügen“ | `<span id="fb-hl-twmiss">Working width missing</span>` | eine Zeile |

Nicht geändert: Hilfslinien und Kartenraster (`drawExtraGuidelinesSk`, Raster) rechnen weiter
mit `toolWidthM()`. Upstream-Issue dazu: siehe Text im PR von Phase 2c.

Die Profil-Oberfläche selbst (Karten, Assistent) liegt im tablet-ui-Block (`TabletProfiles`,
`TabletHostText` am Ende von `app.js`, CSS „Phase 2c“) und hängt sich über `lnOpen` /
`lnCloseAll` ein: `lnOpen('vehtoolhub', …)` öffnet die Karten statt der zwei Listen, die
alte Auswahl bleibt über „Klassische Ansicht“ erreichbar.

## 4. Phase 4a: Android-Name, -Symbol und Paket-ID (Oktober 2026)

Ausnahme genehmigt für App-Name, App-Symbol und Paket-ID. Signierung und Secrets unverändert.
Lenk-, Regel- und Sicherheitslogik unberührt.

| Datei | Änderung | Rebase-Hinweis |
|---|---|---|
| `Platforms/AgOpenWeb.Android/Brand.cs` | **neu**: `Brand.ProductName` | keine Konflikte möglich |
| `Platforms/AgOpenWeb.Android/MainActivity.cs` | `Label`, Starttext, Fehlertext, „Beenden?“-Titel aus `Brand.ProductName` | 4 Zeilen |
| `Platforms/AgOpenWeb.Android/BackendService.cs` | Titel der Benachrichtigung und des Kanals aus `Brand.ProductName` (Kanal-ID unverändert) | 2 Zeilen |
| `Platforms/AgOpenWeb.Android/AgOpenWeb.Android.csproj` | `ApplicationId` `at.loibl.lenksystem` (vorher `com.agopenweb.android`), `ApplicationTitle` `LM Steering Solutions` | bei Konflikt Fork-Werte behalten |
| `Platforms/AgOpenWeb.Android/Resources/drawable/icon.xml` | eigenes Symbol (Vektor) | Fork-Datei behalten |
| `Platforms/AgOpenWeb.Desktop/Brand.cs` | **neu** (Produktname, Oktober 2026, Ausnahme im Auftrag): `Brand.ProductName` = „LM Steering Solutions“ | keine Konflikte möglich |
| `Platforms/AgOpenWeb.Desktop/Launcher/LauncherEntry.cs`, `WebViewLauncher.cs`, `ConsolePage.cs`, `Program.cs` | Fenstertitel, Start- und Fehlertext, „Beenden?“-Frage, Titel der Konsolenseite, „läuft schon“-Meldung aus `Brand.ProductName`; Assembly, Namespaces, Ordner, Datenordner `Dokumente\AgOpenWeb`, Autostart-Eintrag, Port 5174 unverändert | je 1–2 Zeilen; bei Konflikt upstream nehmen und den Text wieder durch `Brand.ProductName` ersetzen |

Folgen der neuen Paket-ID: Android installiert die App neben der alten; die Daten liegen unter
`Android/data/at.loibl.lenksystem/…` statt `…/com.agopenweb.android/…` und werden nicht
übernommen. Der Java-Klassenname des Dienstes (`com.agopenweb.android.BackendService`) bleibt;
er hängt nicht an der Paket-ID.

Web-Client (gehört zur normalen Regel): Abschnitt „Phase 4a“ in `app.js` (`BRAND`,
`TabletBrand`), CSS „Phase 4a“ im tablet-ui-Block, am Ende von `index.html` zwei
`<script type="text/plain">` mit den Lizenztexten, neue Symbole `icons/brand-192.png` und
`brand-512.png`. Upstream-Teile werden nur aus dem Block heraus verändert: `renderAbout` ist
umhüllt (Info-Seite), `#about` bekommt eigenen Inhalt, das Hilfe-Panel einen Knopf
„Kurzanleitung“.

## 5. Ergänzungen aus der Gesamtprüfung (Oktober 2026)

Keine neue Host-Ausnahme außer den NTRIP-Nachträgen in §1. Für Rebases außerdem wichtig:

| Datei / Stelle | Was | Rebase-Hinweis |
|---|---|---|
| `.github/workflows/fork-prerelease.yml` | **neu** (Phase 4a): Testversionen als Pre-Release; Fußtext mit Lizenz und Quellcode-Commit; die Warnung zum Platzhalter-Produktnamen ist mit dem Namen „LM Steering Solutions“ entfallen | Fork-Datei, keine Konflikte möglich; Signaturprüfung und Secrets unverändert |
| `app.js` NTRIP-Editor (upstream-Teil) | `#nte-ver` lesen und schreiben, Version an `ntrip.save`/`ntrip.test` anhängen (siehe §1) | nicht mit `fork:` kommentiert: bei Konflikten in `openNtripEditor`/Speichern/Test nach `nte-ver` suchen |
| `index.html` NTRIP-Editor | `<select id="nte-ver">` | eine Zeile |
| `index.html` upstream-`<style>` | Regel `.fb-twmiss` (letzte Zeilen, nutzt `var(--tui-warn)` aus dem Block) | eine Regel |
| `index.html` Start | `document.title` und der Manifest-Link werden zur Laufzeit aus `BRAND` gesetzt (eigenes `data:`-Manifest) | upstream-`manifest.json` bleibt; ob die PWA-Installation mit dem `data:`-Manifest funktioniert, ist nicht geprüft |
| `Tools/ui-audit/restart-host.sh` | leert nur Ordner unter `/tmp` oder mit `.ui-audit` | Fork-Werkzeug |

Der tablet-ui-Block **umhüllt** diese upstream-Funktionen (Neuzuweisung der globalen
Funktion). Benennt upstream eine davon um oder ändert ihre Signatur, wirft die Umhüllung beim
Laden einen Fehler; nach jedem Rebase prüfen:
`lnOpen`, `lnCloseAll`, `renderAbout`, `updateLineWidths`, `drawGroundTextureSk`,
`lightbarSk`, `fmtUnit`, `unitLabel`, `fmtRate`, `updateHeadlandHud`, `renderUTurnIndicator`.
Ein schneller Test: `node --check app.js`, dann die Seite laden und auf `pageerror` achten
(die Flows unter `Tools/ui-audit` tun das).

Upstream-Knöpfe, die der Block über ihre ID anspricht (Schnellleiste, „Mehr“-Kacheln):
siehe `QPOOL` in `TabletTerminal`. Upstream entfernt `#bn-autotrack` und fügt `rn-cycle`,
`rn-cycleback`, `rn-autotrack`, `rn-isobus` hinzu (siehe `docs/Offene-Punkte.md`).

## 6. Upstream-Merge bis #357 und einmalige U-Turn-/Fahrgassen-Migration (Oktober 2026)

Upstream `develop` (bis #357, 28 PRs seit dem Fork-Punkt) ist per **Merge** übernommen, nicht per
Rebase. Konflikte gab es nur in `build-and-release.yml` (Kommentar), `en.json` (neu erzeugt) und
`de.json` (Fork-Fassung, 40 neue Texte übersetzt). In Lenk-, Regel- und Sicherheitslogik gab es
keinen Konflikt; dort gilt unverändert upstream.

Anpassungen im Block wegen upstream: Schnellleiste kennt `rn-autotrack`, `rn-cycle`,
`rn-cycleback`, `rn-isobus` (#339, #318; `#bn-autotrack` gibt es nicht mehr); „Report on
GitHub“ (#349) ist ausgeblendet; die Gerätekarte zeigt die Arbeitsbreite auch für inaktive
Geräte (#350).

**Ausnahme genehmigt: einmalige Host-Migration** wegen #330/#331 (U-Turn- und Fahrgassen-Tab
gehören jetzt zum Geräteprofil; ein Geräteprofil ohne diese Abschnitte lädt Standardwerte):

| Datei | Änderung | Rebase-Hinweis |
|---|---|---|
| `Shared/AgOpenWeb.Services/Profile/ToolUTurnTramMigration.cs` | **neu**: kopiert beim ersten Start die alten Werte aus dem Fahrzeugprofil (`youTurn`: Radius, Verlängerung, Abstand zur Grenze, Stil, Glättung; `guidance`: Fahrgassen-Durchgänge, -Anzeige, erste Spur) in jedes Geräteprofil ohne `youTurn`/`tram`. Quelle: zuletzt benutztes Fahrzeug, sonst das einzige, sonst keines (kein Raten). Fahrgassen-Breite aus den `TramConfig.json` der Felder, nur wenn alle denselben Wert haben. Vorher Kopie von `Vehicles/` und `Tools/` nach `Backups/profiles-before-uturn-tram-migration-<Zeit>/`; Merker `.fork-migrations/uturn-tram-to-tool.done`, damit es einmal läuft. Geräteprofile mit eigenen Abschnitten bleiben unberührt. | keine Konflikte möglich; kann entfallen, sobald keine alten Profile mehr im Umlauf sind |
| `Shared/AgOpenWeb.ViewModels/MainViewModel.cs` | `LoadDefaultVehicleProfile`: Aufruf direkt nach der v1-Migration, vor dem Laden der Profile; Fehler werden geloggt, dann laden die Geräte ihre Standardwerte | ein Block nach `MigrateV1ProfilesIfNeeded` |

Tests: `Tests/AgOpenWeb.Services.Tests/ToolUTurnTramMigrationTests.cs` (altes Profil:
Werte laden identisch; Sicherung; einmalig; eigene Abschnitte bleiben; kein Raten bei mehreren
Fahrzeugen; Fahrgassen-Breite nur bei Einigkeit; neues Format: nichts zu tun). Zusätzlich von
Hand: Profile mit dem Build vor dem Merge angelegt (U-Turn 6,5 m / 15,5 m / 1,25 m / Stil 1 /
Glättung 9, Fahrgassen 4 / aus / 2), dann der neue Build auf denselben Daten: identische
Werte für beide Geräte. Ohne Migration: Standardwerte (8 m / 20 m / 2 m).

Nicht übernommen wird die Startspur aus `TramConfig.json` des Feldes (Feldzustand, gehört
nicht zum Gerät).


## 7. Nur Anzeige, wegen Host-Verhalten: Drehpunkt-Abstand und Arbeitsmitte bei TBT (Oktober 2026)

Keine Host-Datei geändert. Der Web-Client passt zwei Anzeigen an das an, was der Host
tatsächlich rechnet. **Nach einem Fix upstream wieder zurücknehmen** (`app.js`, TabletProfiles
`pivotDialogExtras`, `toolDialogExtras`).

| Host-Stelle | Was der Host tut | Was die Anzeige jetzt zeigt |
|---|---|---|
| `ToolPositionService.cs:223` (`pivotOffset = TrailingHitchLength − TrailingToolToPivotLength`, mit positiver `TrailingHitchLength`) und `RemoteServerWiring.Helpers.cs` `tool.pivotSide` (behind = +, ahead = −) | Ein **positiver** Drehpunkt-Abstand legt die Arbeitslinie **vor** die Geräteachse (zum Traktor hin). Per Test geprüft: Anhängelänge 3 m, Abstand +1 m → Achse 3 m, Arbeitslinie nur 2 m hinter dem Zugpunkt. In AgOpenGPS (Anhängelänge negativ gespeichert) bedeutet + „hinter“; der Import (`ProfileJsonServiceV1.cs:256`) dreht nur die Anhängelänge, nicht den Abstand. | Gerätedialog → Drehpunkt: Der Knopf, der + sendet, heißt „Vor der Achse“, der für − „Hinter der Achse“. Eine Skizze und ein Satz zeigen, wo die Arbeitslinie liegt. Werte und Befehle unverändert. |
| `ToolPositionService.cs:113–115` | Bei TBT nimmt der Host die Zugpunkt-Länge des **Fahrzeugs**, `Tool.HitchLength` („Arbeitsmitte“) wirkt nicht. | „Arbeitsmitte“ ist bei TBT im Gerätedialog und im Assistenten ausgeblendet. |

Beim Rebase auf upstream: prüfen, ob upstream das Vorzeichen oder die Beschriftung geändert hat.
Dann die Umbeschriftung entfernen, sonst stimmt sie doppelt falsch.


## 8. Profil-Backup: Export und Import (feature/profil-backup, Oktober 2026)

Host-Ausnahme genehmigt. Umsetzung des Vorschlags `docs/Vorschlag-Profil-Backup.md`. Die Lenk-
und Steuerlogik ist nicht berührt.

### Geänderte Host-Dateien
| Datei | Änderung |
|---|---|
| `Shared/AgOpenWeb.Services/Profile/ProfileBackupService.cs` (neu) | Packen, Prüfen, Vorschau, Anwenden, automatische Sicherung, Prüfung „Lenkung aus / steht / Schlag nicht offen“ |
| `Shared/AgOpenWeb.RemoteWiring/RemoteServerWiring.Helpers.cs` | `ApplyBackupCommand`: Befehle `backup.create`, `backup.list`, `backup.preview\|<Datei>`, `backup.apply\|<Datei>\t<Indizes>`; Status als JSON |
| `Shared/AgOpenWeb.RemoteWiring/RemoteServerWiring.cs` | Befehle an `ApplyBackupCommand`; `backup.apply` ist **Tier-2** (nur das Gerät, das die Bedienung hat) |
| `Shared/AgOpenWeb.RemoteServer/RemoteServerHost.cs` | Route `GET /backups/<Datei>.zip` (nur Dateiname, nur `backup_…` und `before-import_…` aus `Backups/`) |
| `Shared/AgOpenWeb.Models/State/ApplicationState.cs` | `BackupStatus` (JSON-Text) |
| `Shared/AgOpenWeb.RemoteServer/Contracts.cs`, `SceneProjector.cs`, `WireCodec.cs`, `wwwroot/transport.js` | `AppInfoDto.BackupStatus`, hinten angehängt (append-only) |
| `Tests/AgOpenWeb.Services.Tests/ProfileBackupServiceTests.cs` (neu) | Rundlauf, Abbruch, beschädigte ZIPs, keine Geheimnisse |

### Verhalten
- **Export:** `Vehicles/*.json` und `Tools/*.json` (mit `.AutoSteer.json`), `Fields/<Schlag>/…` ohne
  `jobs/` (bearbeitete Fläche) und `NtripProfiles/*.json` **ohne Passwort** (Nachtrag; Benutzername,
  Caster, Port und Mountpoint bleiben). Dazu kommt ein `manifest.json` mit Format, Formatversion 1,
  App-Version, Datum und jeder Datei mit Größe und SHA-256. Die Datei landet unter
  `Backups/backup_<Datum>.zip`.
- **Nicht im Export:** die App-Einstellungen (AgShare-Schlüssel) und alle Passwörter.
  JSON-Eigenschaften, deren Name nach einem Geheimnis aussieht, werden zusätzlich geleert:
  - in Fahrzeug-, Geräte- und Schlagdateien password, apikey, secret, token und username;
  - in NTRIP-Profilen dasselbe ohne username.
- **NTRIP beim Import:**
  - Hat das Gerät für dieselbe Profildatei schon ein Passwort, bleibt es erhalten.
  - Fehlt es, meldet der Host das Profil (`needPassword`). Der Client zeigt dann „Passwort für
    NTRIP-Profil X neu eingeben“.
  - Die Vorschau vergleicht NTRIP-Profile ohne Passwort.
  - Nach dem Import lädt der Host die NTRIP-Profile neu.
- **Import:** nur aus `Import/`, nur ZIPs mit einem `manifest.json` dieses Formats. Die ZIP wird
  vollständig geprüft, bevor etwas geschrieben wird:
  - jede Datei mit Größe und Prüfsumme;
  - keine Datei außerhalb des Manifests;
  - keine Pfade außerhalb von Vehicles/Tools/Fields, kein `..`, kein `jobs/`;
  - höchstens 1 GB.
- **Vorschau:** Für jeden Eintrag zeigt sie „neu / überschreibt / gleich“. Bei Fahrzeug und Gerät
  nennt sie die geänderten Werte (z. B. `vehicle.wheelbase: 3.33 → 2.5`), bei einem Schlag die
  geänderten Dateien.
- **Anwenden:**
  - Vorher wird automatisch `Backups/before-import_<Datum>.zip` angelegt. Sie ist wie ein Export
    aufgebaut und lässt sich genauso wieder einspielen.
  - Danach schreibt der Host nur die ausgewählten Einträge, jede Datei über eine Temp-Datei.
  - Ist das aktive Fahrzeug oder Gerät betroffen, lädt er das Paar neu, ohne vorher zu speichern.
- **Sperren:**
  - Client: Verbindung, frische Daten, Bedienung, Lenkung aus, Stillstand.
  - Host: lehnt `backup.apply` ab, solange die Lenkung an ist, das Fahrzeug ≥ 0,5 km/h fährt oder
    ein ausgewählter Schlag offen ist.
- **Felddateien beim Überschreiben:** Dateien aus der Sicherung ersetzen die vorhandenen. Dateien,
  die nur im jetzigen Schlag liegen, bleiben liegen; die Auftragsabdeckung (`jobs/`) bleibt unberührt.

### Grenzen
- **iOS:** Den Download von `/backups/` übernimmt nur der System-Browser. iOS hält dabei die App
  und ihren Webserver an. Anders als bei `/bugreports/` gibt es kein Teilen-Menü (das wäre eine
  Änderung in `Platforms/AgOpenWeb.iOS`). Android und Desktop laden normal herunter.
- Auf einem echten Tablet ist der Ablauf noch nicht geprüft, insbesondere die USB-Kopie in `Import/`.

### Beim Rebase auf upstream
`AppInfoDto` und `transport.js` haben ein angehängtes Feld. Hängt upstream dort selbst etwas an,
muss `BackupStatus` danach weiter hinten bleiben (oder ganz ans Ende wandern).

## 11. Bedienung-1: Fenster-Vollbild im Desktop-Launcher (feature/bedienung-1, Oktober 2026)
- **Datei:** `Platforms/AgOpenWeb.Desktop/Launcher/WebViewLauncher.cs`, `OnWebMessage`: die Nachricht
  `fullscreen|1` / `fullscreen|0` ruft `_window.SetFullScreen(true/false)`. Sonst keine Änderung.
- **Client:** Der Knopf ⛶ in der Statuszeile schickt im Launcher (Photino, `window.external.sendMessage`)
  diese Nachricht statt der Fullscreen-API, die dort nur die Web-Ansicht füllt. Im Browser unverändert.
- **Beim Rebase auf upstream:** eine Abfrage am Anfang von `OnWebMessage`.

## 12. CI: iOS-Build nur noch in der Testversion (Oktober 2026)
- **Dateien:** `.github/workflows/build-and-release.yml` (Job `build-ios` entfernt, Kommentar am Ende),
  `.github/workflows/fork-prerelease.yml` (derselbe Job als `ios`, `timeout-minutes: 45`).
- **Grund:** In der PR-CI wartete `build-ios` jedes Mal 15 Minuten auf einen `macos-26`-Runner und
  wurde ohne einen einzigen Schritt abgebrochen (#19, #20). Damit war jeder PR rot.
- **Verhalten:** PRs prüfen iOS nicht mehr. Die Testversion kompiliert iOS weiter (nur Prüfung, kein
  Artefakt); die Vorabversion wartet nicht auf diesen Job, ein Abbruch dort hält Windows und APK
  nicht auf.
- **Beim Merge von upstream:** Ändert upstream `build-ios` in `build-and-release.yml`, gibt es dort einen
  Konflikt; die Änderung dann in den Job `ios` von `fork-prerelease.yml` übernehmen.

## 13. CI: Web-Tests mit Browser (feature/bedienung-2, Oktober 2026)
- **Datei:** `.github/workflows/build-and-release.yml`, Job `test`: Schritt „Run web client tests“.
  Er installiert Playwright 1.63.0 außerhalb des Repos (`$RUNNER_TEMP/pw`), dazu nur Chromiums
  Headless-Shell ohne Systempakete, zwischengespeichert in `~/.cache/ms-playwright`, und führt
  `node --test Tests/web/*.test.mjs` mit `AOW_REQUIRE_BROWSER=1` aus: fehlt der Browser, schlägt
  `long-press.test.mjs` fehl statt übersprungen zu werden.
- **Hinweis:** Auf diesem Branch gab es den Schritt noch nicht (er liegt sonst nur in
  `feature/eama-import`, dort ohne Browser). Beim Zusammenführen bleibt diese Fassung.

## 14. Host-Paket A: eindeutige Aus-Befehle (feature/host-paket, Oktober 2026)
- **Dateien:** `Shared/AgOpenWeb.ViewModels/MainViewModel.SwitchOff.cs` (neu: `AutoSteerOff()`,
  `AllSectionsOff()`), `Shared/AgOpenWeb.RemoteWiring/RemoteServerWiring.cs` (zwei `case`-Zeilen
  `autosteer.off`, `sections.alloff`). Test: `Tests/AgOpenWeb.ViewModels.Tests/SwitchOffTests.cs`.
- **Verhalten:** Nur ausschalten, nie einschalten. `AutoSteerOff` ruft den vorhandenen Lenkknopf-Befehl
  nur, wenn die Lenkung an ist (derselbe Weg wie beim Abgeben der Bedienung). `AllSectionsOff` ruft
  ebenso die vorhandenen Befehle für Handbetrieb und Automatik nur, wenn sie an sind, und für eine
  einzeln eingeschaltete Teilbreite (#316) `SetAllSections(Off)` wie bei GPS-Verlust. Ist nichts an,
  passiert nichts; Wiederholen ist harmlos. Regelung, Wende und Sicherheitsabschaltungen unverändert.
- **Bedienung:** Beide Befehle brauchen die Bedienung wie jeder andere (nicht in `ObserverIds`).
- **Client:** `TabletDemo` sendet beim Beenden beide Befehle statt nichts (vorher: Umschaltbefehle,
  dann gar keine). Andere Client-Stellen, die „aus“ meinen, gibt es nicht; die Knöpfe bleiben Umschalter.
- **Beim Merge von upstream:** neue Datei, zwei Zeilen im `switch`; ohne Konflikt zu erwarten.

## 15. Host-Paket B: Arbeitsprotokoll am Lenkrechner (feature/host-paket, Oktober 2026)
- **Dateien:** `Shared/AgOpenWeb.Services/WorkLog/WorkLogStore.cs` (neu), `RemoteServerHost.cs`
  (Routen `GET /worklog`, `POST /worklog?client=<id>`), `Profile/ProfileBackupService.cs` (Ordner
  `WorkLog` im Backup). Tests: `Tests/AgOpenWeb.Services.Tests/WorkLogStoreTests.cs`,
  `Tests/web/worklog.test.mjs` (Zusammenführen im Client).
- **Ablage:** eine Datei `WorkLog/worklog.json` im Datenordner (`AppDataRoot.Documents`), im Format
  des Clients (`aow-worklog`, Version 1, `entries`, `deleted`). Schreiben über `.tmp` und Umbenennen;
  eine unlesbare Datei wird als `worklog.json.unreadable-<Zeit>` beiseitegelegt, nicht überschrieben.
- **Zusammenführen:** nach `id`, ohne Doppel; die zuletzt geänderte Fassung gilt (`mod`, dann `end`);
  gelöschte IDs bleiben gelöscht; offene Sitzungen werden nicht gespeichert. Gleiche Regel im Client
  (`WorkLogCore.merge`).
- **Bedienung:** Schreiben nur mit der Bedienung (Client-ID wie bei `/bugreports/attach`), sonst 403.
  Lesen für alle (Beobachter sehen alles). Höchstens 8 MB je Anfrage.
- **Backup:** `WorkLog/worklog.json` wird mitgesichert; beim Einspielen zusammengeführt statt ersetzt.
  Vorschau: „+ N“ neue oder geänderte Einträge, sonst „gleich“.
- **Lenk-, Regel- und Sicherheitslogik:** nicht berührt.
- **Beim Merge von upstream:** neue Datei; im Backup-Dienst vier kleine Stellen (`Roots`, `Collect`,
  `IsAllowed`, `Group`/`Apply`/`Compare`); in `RemoteServerHost` ein Block vor `StartAsync`.

## 16. Host-Paket C: Auftragsbeginn und -ende an den Client (feature/host-paket, Oktober 2026)
- **Dateien:** `Contracts.cs` (`JobEntryDto` + `StartedMs`, `EndedMs`, angehängt mit Vorgabe 0),
  `SceneProjector.cs` (füllt beide aus `Job.StartedAt`/`EndedAt`; Fingerabdruck nimmt beide mit, damit
  das Schließen eines Auftrags die Liste neu schickt), `WireCodec.cs` und `transport.js` (je Auftrag
  zwei `f64` nach den Notizen). Test: `Tests/AgOpenWeb.RemoteServer.Tests/FieldOpsJobTimesTests.cs`.
- **Werte:** nur, was der Host hat: `StartedAt` (beim Anlegen), `EndedAt` (beim Schließen, beim
  Fortsetzen gelöscht), als Unix-Millisekunden; 0 = keiner.
- **Strecke nicht gesendet:** `Job.DistanceTraveledMeters` wird im Host nirgends berechnet (nur
  gelesen und geschrieben, laut Kommentar „beim Schließen“, aber ohne Code dafür); es wäre immer 0.
  Das Protokoll nimmt weiter die Tagesstrecke (`fieldData.tripDistanceM`) des Hosts.
- **Client:** Das Arbeitsprotokoll nimmt den Auftragsbeginn des Hosts als Sitzungsbeginn, wenn der
  Auftrag während der Sitzung neu angelegt wurde, und das Auftragsende, wenn die Sitzung mit dem
  Schließen des Auftrags endete; sonst die Tablet-Uhr. Ergäbe die Mischung ein Ende vor dem Beginn,
  gilt die Tablet-Uhr. Die Detailansicht nennt, was vom Lenkrechner kommt.
- **Beim Merge von upstream:** Der Datensatz ist nur hinten verlängert; ändert upstream die
  Auftragszeile im FieldOps-Rahmen, beide Seiten (`WireCodec`, `transport.js`) gleich nachziehen.

## 17. Host-Paket D: kleinere Punkte (feature/host-paket, Oktober 2026)
- **Einrichtungsstatus am Lenkrechner:** `PersistentAppState.FirstSetup` ("", "shown", "done") in
  `appstate.json` (`PersistentStateService.ApplySnapshot` übernimmt ihn), gesendet am Ende des
  AppInfo-Rahmens (`AppInfoDto.FirstSetup`, `WireCodec`, `transport.js`), gesetzt mit dem Befehl
  `setup.first|shown|done` (`RemoteServerWiring.cs`; „done“ wird nicht zurückgesetzt). Der Client
  liest den Host-Wert vor dem eigenen Browser-Speicher und meldet einen dort schon vorhandenen Stand
  einmal an den Host.
- **MinFixQuality an den Client:** `GpsConfigDto.MinFixQuality`, gesendet als `i32` am Ende des
  Config-Rahmens. Die Ampel prüft die Fix-Qualität jetzt wie der Host (`GpsFixQualityValidator`:
  Qualität kleiner als Minimum wird abgelehnt); ohne den Wert (älterer Host) wie bisher „RTK Fix“.
  Die Ampel wertet nach Güte (RTK Fix > RTK Float > DGPS/PPS > GPS; 0 und 6–8 kein Fix) und
  verlangt zusätzlich, dass der Host die Zahl annimmt: nie lockerer als der Host, RTK Float bei
  Vorgabe 4 nicht grün. Der Host vergleicht die NMEA-Zahl (Float 5 besteht die Vorgabe 4); das ist
  nur gemeldet, `docs/Upstream-Issues.md` Punkt 5. Test: `Tests/web/ready.test.mjs`.
- **1-KB-Grenze (Offene Punkte 7):** `WebSocketHub` sammelt die Stücke einer Nachricht bis
  `EndOfMessage` (`CommandAssembler.cs`, neu) und führt den Befehl einmal ganz aus; über 64 KB wird
  die Nachricht ganz verworfen. Test: `CommandAssemblerTests.cs`.
- **field.fromGeo:** liegt nur im eAMA-Branch (#19), nicht in diesem Stapel; die stückweise
  Übertragung bleibt dort unverändert (siehe Bericht).
- **Englische Host-Meldungen (Offene Punkte 11):** Die 21 Fehlermeldungen mit Werten im Text
  (`ReportFailure($"…")`) gehen jetzt als Schlüssel mit Platzhaltern (`{error}`, `{n}`, `{file}`,
  `{path}`) und den Werten: neue Überladung `ReportFailure(key, (name, value)…)` im ViewModel,
  `LastFailureKey` während des Ereignisses, Toast-Rahmen hinten um Schlüssel und Werte (JSON)
  verlängert. `FailureReported` bekommt weiter den englischen Satz. Der Client übersetzt den Satz,
  die Werte bleiben wie sie sind; die Schlüssel stehen in `TabletHostText` (für `en.json`).
  Tests: `KeyedFailureTests.cs`, `ToastKeyTests`; Einrichtungsstatus im Vollständigkeitstest von
  `PersistentStateServiceTests`.
- **Lenk-, Regel- und Sicherheitslogik:** nicht berührt (nur Texte der Meldungen).

## 18. CI: Windows-Installer und Freigabe „Stabil“ (feature/installer, Oktober 2026)
- **Dateien:** `.github/workflows/fork-prerelease.yml` (neuer Job `installer` auf `windows-latest`,
  Inno Setup aus dem ZIP-Paket; die Vorabversion enthält zusätzlich `*-Setup-*.exe`),
  `.github/workflows/fork-stable-release.yml` (neu: macht eine getestete Vorabversion zur
  vollständigen Release), `deploy/windows/installer.iss` (neu). Genehmigt im Auftrag; Host und
  Launcher unverändert. Einzelheiten: `docs/Installer.md`.
- **Firewall und WebView2** (Nachtrag): `installer.iss` legt bei der Installation zwei
  Firewall-Regeln nur für das Programm an (UDP 9999, 2211, 2222; TCP 5174; per `netsh`, mit
  UAC-Abfrage) und entfernt sie bei der Deinstallation; fehlt die WebView2-Laufzeit, startet es
  Microsofts Bootstrapper, den der Job `installer` herunterlädt und auf die Microsoft-Signatur
  prüft. Host und Launcher unverändert.
- **Produktname** (Nachtrag): `AppName` „LM Steering Solutions“ (Setup, Startmenü, Verknüpfung,
  „Apps“, Firewall-Regeln; Setup-Datei ohne Leerzeichen); `AppId` endgültig, unverändert; Regeln und
  Verknüpfungen der Testversionen „AgOpenWeb“ werden mit entfernt.
- **Secrets:** keine neuen, keine geänderten; nur `GITHUB_TOKEN`.

## 19. Startzeit (feature/installer, Oktober 2026; Launcher und Host nur für den Start genehmigt)
- **Messung:** `Shared/AgOpenWeb.RemoteWiring/StartupTrace.cs` (neu): Zeitstempel ab Prozessstart
  in `Program.Main`, `BackendHost`, `WebBackend.StartAsync` (nur `StartupTrace.Mark`-Zeilen) und im
  Launcher; die Seite meldet ihre Phasen (`app.js`, Block `startup:begin`) über
  `startup|{json}`. Ergebnis in `%TEMP%\agopenweb-startup.log`. Rebase: Mark-Zeilen sind
  einzeln, bei Konflikt upstream nehmen und die Zeilen neu setzen.
- **Paralleler Start:** `WebViewLauncher` startet das Backend sofort, parallel zu Fenster und
  WebView2, statt erst nach `WindowCreated`; geladen wird die Oberfläche, wenn beides fertig ist.
- **Ladebildschirm:** Produktname und Logo im Launcher-Splash (`LauncherEntry.SplashHtml`) und als
  `#tui-boot` am Anfang von `index.html`; dunkler WebView2-Hintergrund
  (`WEBVIEW2_DEFAULT_BACKGROUND_COLOR`, nur wenn nicht gesetzt).
- **Zwischenspeicher:** `RemoteServerHost` liefert Seite, Skripte, CanvasKit, Symbole und Töne mit
  ETag und `no-cache`; `SimpleWebServer` antwortet mit 304, wenn der Browser die Datei schon hat
  (`NotModifiedIfCurrent`). Veraltet kann nichts sein (Prüfung bei jedem Laden), der Browser behält
  aber den übersetzten Code. Test: `SimpleWebServerETagTests.cs`.
- **ReadyToRun:** im Fork-Workflow (`PublishReadyToRun=true` als Umgebungsvariable des Schritts);
  `deploy/windows/package.sh` unverändert.
- **Lenk-, Regel- und Sicherheitslogik:** nicht berührt.
