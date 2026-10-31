# Startzeit der Desktop-App (feature/installer)

## Messen
Jeder Start schreibt `%TEMP%\agopenweb-startup.log` (Windows: Ausführen → `%TEMP%`), Zeiten in ms
ab Prozessstart, in Klammern der Abstand zur vorigen Zeile:

| Zeile | Phase |
|---|---|
| `Main` | .NET-Laufzeit geladen, Programm beginnt |
| `launcher: creating window` / `launcher: window created` | Fenster und WebView2 entstehen |
| `host: …`, `backend: …` | Backend: DI, Einstellungen, Zustand, MainViewModel, Webserver |
| `launcher: backend ready for the window`, `launcher: web UI requested` | Fenster lädt die Oberfläche |
| `page: HTML received` … `page: first map frame` | Seite: HTML, `app.js`, CanvasKit, erste Daten, erstes Kartenbild |
| `page: loading screen off` | Ladebildschirm weg |

Ein Gitter (BEV, eAMA-Import) wird in diesem Stand beim Start nicht geladen (der eAMA-Import liegt
in einem eigenen Branch). Andere Dateien beim Start: Einstellungen, Zustand (zusammen etwa 70 ms,
siehe unten), die Symbole der Oberfläche (etwa 150 kleine Dateien).

## Geändert
1. **Backend parallel zum Fenster:** startet sofort, nicht erst, wenn das Fenster und WebView2
   bereit sind. Unter Windows überlappen sich beide; gespart wird die kürzere der beiden Zeiten.
2. **ReadyToRun:** die eigenen Assemblys sind vorkompiliert, die JIT-Zeit beim Start entfällt.
3. **Zwischenspeicher mit ETag:** Seite, `app.js`, CanvasKit (7 MB WebAssembly), Symbole und Töne
   werden bei unverändertem Stand nicht neu übertragen; der Browser nutzt den beim letzten Start
   übersetzten Code. Ein Update wird trotzdem sofort geladen (Prüfung bei jedem Laden).
4. **Ladebildschirm sofort:** „LM Steering Solutions“ mit Logo im Launcher und als erstes Element
   der Seite, bis die Karte ihr erstes Bild hat (höchstens 15 s); WebView2 malt vorher dunkel statt
   weiß.

## Ergebnis (Messung in der Entwicklungsumgebung)
Linux-VM, Chromium statt WebView2, Backend als eigener Prozess, gleicher Datenordner, Median aus 6
Starts nach einem ersten Start (Zeiten ab Prozessstart, ms). WebView2 und das Fenster lassen sich
dort nicht messen; das liefert das Protokoll auf dem Tablet.

| Phase | vorher | nachher |
|---|---:|---:|
| Backend: DI-Container | 209 | 145 |
| Backend: Webserver bereit | 423 | 314 |
| Seite: HTML erhalten | 552 | 434 |
| Seite: `app.js` läuft | 787 | 620 |
| Seite: CanvasKit bereit | 1200 | 999 |
| Seite: erste Daten vom Host | 1280 | 1062 |
| Seite: erstes Kartenbild | 1488 | 1260 |

Vorher = ohne ReadyToRun und ohne ETag; der parallele Start ist darin nicht enthalten (kein Fenster).
Werte auf einem Windows-Tablet: `%TEMP%\agopenweb-startup.log` vor und nach dem Update vergleichen
(Testtag).
