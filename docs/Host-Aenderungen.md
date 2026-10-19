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
| `Platforms/AgOpenWeb.Android/AgOpenWeb.Android.csproj` | `ApplicationId` `at.loibl.lenksystem` (vorher `com.agopenweb.android`), `ApplicationTitle` `[PRODUKTNAME]` | bei Konflikt Fork-Werte behalten |
| `Platforms/AgOpenWeb.Android/Resources/drawable/icon.xml` | eigenes Symbol (Vektor) | Fork-Datei behalten |

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
| `.github/workflows/fork-prerelease.yml` | **neu** (Phase 4a): Testversionen als Pre-Release; Fußtext mit Lizenz und Quellcode-Commit; Warnung, solange der Produktname `[PRODUKTNAME]` ist | Fork-Datei, keine Konflikte möglich; Signaturprüfung und Secrets unverändert |
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

