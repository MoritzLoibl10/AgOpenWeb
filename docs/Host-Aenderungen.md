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
| `Shared/AgOpenWeb.Services/NtripResponse.cs` | `Preview()` (erste Zeilen der Antwort); NTRIP 2 „200 OK“ + `Content-Type: gnss/sourcetable` = Mountpoint unbekannt | kleine Ergänzungen, leicht nachzuziehen |
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

Tests: `Tests/AgOpenWeb.Services.Tests/NtripVrsTests.cs` (Anfrageformat, Antworten, GGA,
simulierter VRS-Caster). Doku: Abschnitt „NTRIP Connection Format“ in `CLAUDE.md`.

### Verhalten, das sich für Nutzer ändert

- Bestehende Profile laufen mit NTRIP 1.0 („GET … HTTP/1.0“). Vorher war es eine Mischform
  (HTTP/1.1 ohne `Ntrip-Version`). Macht ein Caster damit Probleme: im Profil 2.0 wählen.
- Ohne GPS-Fix wird keine GGA gesendet. Vorher ging die Ersatzposition in Kansas raus.
- Die manuelle GGA-Position (`UseManualPosition`, in der UI derzeit nicht einstellbar)
  meldet Fix-Qualität 1 statt 4.
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
`app.setLanguage|de`, wenn der Host noch Englisch spricht (`aow.ui.langChosen` im localStorage).
Meldungen, die der Host als fertigen Text schickt (z. B. „RTK Fixed“, NTRIP-Status), bleiben
englisch.

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
