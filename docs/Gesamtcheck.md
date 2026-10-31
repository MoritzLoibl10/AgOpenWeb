# Gesamtcheck mit Simulator (30.–31.10.2026, feature/installer)

Langer Lauf der ganzen App im Simulator per Playwright: `Tools/sim-soak.mjs` (startet einen eigenen
Host auf leerem Datenordner, fährt echte Abläufe, schreibt mit). Wieder ausführen:

```
dotnet build Platforms/AgOpenWeb.Desktop/AgOpenWeb.Desktop.csproj
node Tools/sim-soak.mjs --minutes 30 --out sim-soak.json      # Port 5174 muss frei sein
```

Umgebung: Linux-VM, Chromium headless mit SwiftShader (Software-WebGL), 1280×800, Deutsch, Host
Debug-Build. Kein echtes Tablet, keine echte GPU, kein Kit. **Board und Motor nicht getestet.**

## 1. Simulator-Fehler vom Tablet (Lenkung geht aus, danach „nichts geht mehr“)

**Ursache (nachgestellt):** Die Lenkung schaltet sich ab, sobald das Fahrzeug die Feldgrenze
verlässt (`GpsPipelineService`, Schritt 5 „outside boundary“). Im Simulator ohne Wende fährt das
Fahrzeug nach einigen Sekunden über die Grenze. Danach schaltet jedes erneute Einschalten außerhalb
der Grenze die Lenkung im nächsten GPS-Zyklus wieder aus, so schnell, dass die Anzeige „ein“ nie
erscheint. **Im Fork zeigt die Oberfläche dafür keinen Grund:** der Grund landet nur in
`StatusMessage`, die der Web-Client nicht anzeigt. Für den Bediener sieht es aus wie „geht aus, geht
nicht mehr an“, und die Ampel zeigt nur das Übliche im Simulator (IMU gelb „nicht gehört“, GPS
„Simulator: keine echte Position“).

| | Fork (Stand upstream #441) | upstream `develop` ca44833e |
|---|---|---|
| Fahrzeug fährt über die Grenze | Lenkung aus, **kein Hinweis** | Lenkung aus, Toast „AutoSteer disengaged - outside boundary“ |
| Einschalten außerhalb (2×) | sofort wieder aus, **kein Hinweis** | sofort wieder aus, jedes Mal derselbe Toast |

Beleg (beide Stände gleich gebaut und bedient: `field.new`, `boundary.fromMapPoints` 100 × 60 m,
AB-Linie, 10 km/h, `autosteer.toggle`, nach dem Aus zweimal `autosteer.toggle`): Fork bei N = 40,2 m aus,
upstream bei N = 40,5 m aus mit Toast. Upstream hat die Anzeige mit PR #442 („Show on screen why the
app turned AutoSteer off“, Commit 6af3401a, `MainViewModel.ApplyResults.cs`: `ReportFailure` statt
`StatusMessage`) nach unserem Abzweig nachgerüstet. **Nicht geändert** (Host, upstream-Lenklogik):
Abhilfe ist der nächste Upstream-Abgleich (enthält #442); bis dahin im Simulator U-Turn einschalten
oder innerhalb der Grenze bleiben.

**Zweite, seltene Ursache (upstream, Issue-Entwurf Nr. 6 in `docs/Upstream-Issues.md`):** Mit
Teilbreiten hält das Zeichnen der Abdeckung den Browser bei jedem Update ~0,8–1,2 s auf. Der
Totmann (1,5 s ohne `control.presence`) nimmt dann die Bedienung weg und schaltet die Lenkung aus;
die Seite holt sich die Bedienung gleich wieder. Nachgestellt in Fork **und** upstream (je einmal
in mehreren Läufen; auf schwächerer Grafik häufiger zu erwarten).

**Unser Code schaltet die Lenkung hier nicht ab:** `autosteer.off` schickt nur das Beenden des
Vorführmodus (im Fehlerfall nicht aktiv); Ampel, „Arbeit starten“, Arbeits- und Abnahmeprotokoll
schicken keine Lenkbefehle (geprüft: alle `transport.send` der Fork-Module).

## 2. Langer Lauf

| | Lauf 1 | Lauf 2 (Skript verbessert) |
|---|---|---|
| Dauer | 32 min | 31 min |
| Schritte / fehlgeschlagen | 66 / 0 | 60 / 0 |
| Seitenfehler (`pageerror`) | 0 | 0 |
| Konsolenfehler | 4 (3× Verbindung weg beim Zündung-aus, 1× GitHub 403 Rate-Limit) | 5 (4× Zündung-aus, 1× Verbindungsabbruch beim Neustart) |
| Konsolenwarnungen (ohne SwiftShader) | 0 | 0 |
| Lenkung aus ohne eigenen Befehl | 5 (davon 4 „Guidance stopped: track changed“ beim Spurwechsel, 1 Grenze) | 1 (Grenze, ohne Hinweis, siehe 1.) |
| Bedienung verloren (Totmann) | 0 | 0 |
| Anzeige hängt (> 3 s keine Ticks) | 0 | 0 |
| Host unerwartet beendet | 0 | 0 |
| Speicher Seite (JS-Heap) | 8–22 MB, einmal 184 MB (danach wieder 14) | 8–20 MB |
| Speicher Host (RSS) | 213 → 340–417 MB, nach Neustart 195 → 415 MB | 211 → 338–372 MB, nach Neustart 162 → 372 MB |

Abläufe im Lauf: Hinweis beim ersten Start, Ersteinrichtung (alle 6 Schritte), Simulator, Ampel,
Schlag mit Grenze, Vorgewende 20 m, „Arbeit starten“, Auftrag, AB-Linie und gezeichnete Kurve,
U-Turn, Teilbreiten automatisch und von Hand (3 Teilbreiten einzeln), nächste Spur und Versatz,
Vorgewende aus/ein, Arbeitsprotokoll, Abnahmeprotokoll (neues Protokoll), Profil-Backup,
Update-Prüfung, Vorführmodus mit offenem Auftrag, Auftrag schließen und neuen beginnen,
Zündung aus mitten im Auftrag (Host `kill -9`, Neustart, Seite neu, Auftrag fortsetzen).

## 3. Befunde

| Befund | Wer | Was getan |
|---|---|---|
| Grenz-Abschaltung ohne Hinweis (Ursache des Tablet-Fehlers) | upstream, dort mit #442 behoben | belegt; Upstream-Abgleich empfohlen (Host-Änderung, nicht ohne Freigabe) |
| Abdeckung zeichnen hält den Browser ~1 s auf, Totmann | upstream | Issue-Entwurf Nr. 6 |
| Spurwechsel während des Lenkens stoppt die Führung („track changed“) | upstream, gewollt | keiner |
| Vorgewende aus schaltet die automatische Wende aus, beim Einschalten nicht wieder an | upstream | Skript schaltet sie wieder ein; in der Bedienung beachten |
| Profil-Backup: „Liste“ leer nach „Erstellen“ | gewollt (Liste = Dateien zum Einspielen in `Import`, erstellte liegen in `Backups`) | keiner |
| Update-Prüfung: GitHub 403 (Rate-Limit ohne Anmeldung, 60/h) | Umgebung | App meldet „Keine Antwort von GitHub (HTTP 403)“ wie vorgesehen |
| Zündung aus: Arbeitsprotokoll hat danach dieselbe Zahl Einträge, `unsent` = false, Host-Stand aktuell | — | in Ordnung |
| Host-Speicher wächst nach dem Anlegen der Abdeckung auf ~340–420 MB und bleibt dort | upstream (Abdeckungsraster 0,1 m) | beobachtet, kein Wachstum danach |
| Software-WebGL meldet „GPU stall due to ReadPixels“ | Umgebung/upstream (siehe Issue Nr. 6) | gefiltert, gezählt |

Eindeutige Fehler in unserem Code: **keine gefunden.**

## 4. eAMA-Import mit Testdaten

Der Import liegt im Branch `feature/eama-import` (nicht in `feature/installer`), daher eigener Lauf
mit dessen Debug-Build und den Testdaten aus `Tools/eama-test-shapefile.py` (drei erfundene Parzellen
bei Mistelbach, MGI/Lambert, eine mit Loch, eine in zwei Teilen, Umlaute):
`mgi-deflate-1252.zip` und `mgi-stored-utf8.zip` → je 4 Schläge angelegt („FS 13 · S 1 Weißklee,
Grünbrache“, „FS 12 · S 1 Winterweizen“, „FS 12 · S 2 Ölkürbis Teil 1/2“), keine Konsolenfehler,
keine Ausnahme im Host-Log.

## 5. Nicht geprüft
Echtes Tablet (GPU, WebView2/Android-WebView), Kit, Board, Motor, echtes GPS, NTRIP. Die Zeiten der
Abdeckungs-Hänger gelten für Software-WebGL; auf dem Tablet selbst messen (Testtag).
