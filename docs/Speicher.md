# Speicher von Host und Seite im Dauerlauf (12.11.2026)

Anlass: Im 30-Minuten-Lauf vom 11.11. stieg der Host-Speicher (RSS) von 265 auf 524 MB. Frage:
Pendelt er sich ein (z. B. Abdeckungsraster des Schlags), oder wächst er weiter (Leck)?

## Antwort

**Kein Leck.** Der Speicher pendelt sich ein. Über 3 Stunden 5 Minuten mit einem einzigen Host-Prozess
blieben gleich:

- die lebenden Objekte des Hosts (Heap-Dumps),
- der langlebige Teil des .NET-Heaps (Gen2),
- der JS-Heap der Seite.

Der RSS schwankt in einem Sägezahn zwischen 317 und 636 MB. Am Ende lag er bei 468 MB. Das
Maximum lag bei Minute 155. Danach fiel er auf 420 MB, sobald die Speicherbereinigung den Large
Object Heap (LOH) aufräumte.

Belege:

| Messgröße | Minute 15 | Minute 60 | Minute 120 | Minute 180 |
|---|---:|---:|---:|---:|
| Lebende Objekte im Heap-Dump (Summe der Typen, MB) | 43,5 | 43,5 | 42,2 | 42,2 |
| davon Abdeckungs-Anzeigeraster des Schlags (`ushort[]` in `CoverageMapService`, MB) | 39,5 | 39,5 | 39,5 | 39,5 |
| Kopfzeile „GC Heap bytes“ des Dumps (MB, inkl. nicht zugeordneter Bereiche) | 60,9 | 64,2 | 69,4 | 78,5 |

- Der Heap-Dump-Vergleich (`dotnet-gcdump report`, Typ für Typ, Minute 15 gegen Minute 120)
  zeigt keinen Typ, der wächst. Die größte Zunahme sind 22 KB Laufzeit-Metadaten.
- Der Gen2-Heap nach der letzten Bereinigung (Laufzeitzähler) bleibt zwischen 2,4 und 8,3 MB.
  Am Ende sind es 6,0 MB. Er steigt nicht stetig.
- Hinweis zur Kopfzeile: .NET 10 schreibt den Dump verlustbehaftet; dotnet-gcdump warnt
  „may be incomplete“. Die Kopfzeile zählt mehr als die aufgelisteten Objekte. Ihr Anstieg um
  17 MB ist der einzige Wert, der in die Richtung eines Lecks zeigt. Weder die Typliste noch
  Gen2 bestätigen ihn. Bei einem längeren Lauf (z. B. 8 h) darauf achten.

Woher der Sägezahn kommt:

- Der Host fordert während der Fahrt rund 70–330 MB pro Minute an kurzlebigen Objekten an.
  Rund drei Viertel davon (176 von 238 MB/min, Mitschnitt vom 13.11.) stammen nicht aus dem
  Szenenaufbau, wie hier zuerst vermutet. Sie stammen aus `SceneProjector.SceneFingerprint`: Die
  Prüfsumme der Szene kopiert mit 10 Hz alle Fahrgassen-Linien in neue `Vec2Dto`-Listen, nur um
  sie zu zählen. Upstream-Issue-Entwurf 10 in `docs/Upstream-Issues.md`.
- Der LOH (Objekte ab 85 KB) wächst innerhalb eines Auftrags in Sprüngen von 55 auf bis zu
  314 MB. Er fällt erst, wenn die Laufzeit eine Gen2-Bereinigung macht; die nimmt sie bei reichlich
  freiem Speicher (Prüfrechner: 16 GB) selten vor. Welche Stelle die großen Blöcke anlegt, zeigte
  der 2-Minuten-Mitschnitt nicht (in dem Fenster kein LOH-Sprung). Da nichts davon lebend
  bleibt, ist das Speicherverhalten, kein Leck.
- Sockel ohne verwaltete Objekte: .NET-Laufzeit, Webserver, SkiaSharp, rund 120–190 MB (RSS minus „GC belegt“).

Die Seite (Chromium, `performance.memory.usedJSHeapSize`) liegt im ganzen Lauf zwischen 11 und
42 MB. Am Ende sind es 15 MB, ohne Trend. Der Fork-Code hält also nichts fest, und im Fork gibt es
nichts zu beheben.

Upstream: Es gibt kein Leck. Die unnötigen Kopien der Fahrgassen-Linien in der Prüfsumme sind
Issue-Entwurf 10 (13.11.2026).
- Die GC-Pausen des Hosts sind kurz: höchstens 10,5 ms in 5 Minuten, höchstens 38 ms pro Minute
  über 3 Stunden.
- Eine Verbindung zu den Tick-Lücken aus Issue 6 (0,8–1,2 s, im Browser) ist damit nicht belegt.
- Gemessen nur auf dem Prüfrechner, nicht auf einem Tablet.

## Wie gemessen

- `node Tools/sim-soak.mjs --minutes 185 --sample-every 300 --no-ignition --exe <Release-Build>` auf
  develop b629f17e, mit sim-soak d6748b5f.
  - `--sample-every 300` misst Host-RSS und Seiten-Heap alle 5 Minuten.
  - `--no-ignition` lässt den Host nicht neu starten, damit eine Kurve von einem Prozess
    entsteht. Der 30-Minuten-Lauf vom 11.11. startete den Host in der Mitte neu: 524 MB sind ein
    Wert aus dem Sägezahn, kein Endwert.
- Daneben lief `dotnet-counters collect --counters System.Runtime` jede Minute: Working Set, GC
  belegt, Heap je Generation.
- Heap-Dumps (`dotnet-gcdump collect`) bei Minute 15, 60, 120 und 180. Jeder Dump erzwingt eine
  volle Bereinigung; deshalb fallen die Werte kurz danach.
- Lauf:
  - 296 Schritte, 0 fehlgeschlagen, 0 Seitenfehler, 0 Konsolenfehler.
  - Bedienung nie verloren, keine stehende Anzeige, längste Tick-Lücke 1,0 s.
  - Lenkung 7-mal aus „outside boundary“: upstream-Sicherheit, die Simulation fährt über die
    Grenze hinaus.
- Prüfrechner: 4 Kerne, 16 GB. Auf einem Tablet mit weniger Speicher bereinigt .NET früher; dort
  ist ein niedrigerer Sägezahn zu erwarten. Das ist nicht gemessen.

## Kurve (alle 5 Minuten)

RSS und JS-Heap aus sim-soak. „GC belegt“, LOH und Gen2 aus `dotnet-counters`, Wert der nächsten
Minute. Der Auftrag wechselt alle 6 Zyklen (schließen, neu öffnen).

| Minute | Host RSS (MB) | Seite JS-Heap (MB) | GC belegt (MB) | LOH (MB) | Gen2 (MB) | Auftrag |
|---:|---:|---:|---:|---:|---:|---|
| 1 | 257 | 13 | 190 | 55 | 2.4 | Soak job 1 |
| 5 | 354 | 17 | 197 | 55 | 4.6 | Soak job 1 |
| 10 | 317 | 17 | 190 | 55 | 4.6 | Soak job 1 |
| 15 | 321 | 19 | 193 | 57 | 5.2 | Soak job 1 |
| 20 | 355 | 31 | 238 | 98 | 5.9 | Soak job 1 |
| 25 | 384 | 31 | 275 | 135 | 5.9 | Soak job 1 |
| 30 | 471 | 25 | 325 | 137 | 5.9 | Soak job 7 |
| 35 | 472 | 20 | 325 | 137 | 5.9 | Soak job 7 |
| 40 | 474 | 28 | 327 | 137 | 6.6 | Soak job 7 |
| 45 | 475 | 17 | 329 | 137 | 7.8 | Soak job 7 |
| 50 | 474 | 22 | 238 | 77 | 5.5 | Soak job 7 |
| 55 | 409 | 32 | 288 | 101 | 5.5 | Soak job 7 |
| 60 | 448 | 27 | 240 | 74 | 5.8 | Soak job 13 |
| 65 | 446 | 26 | 241 | 74 | 5.6 | Soak job 13 |
| 70 | 447 | 25 | 242 | 74 | 6.2 | Soak job 13 |
| 75 | 474 | 14 | 279 | 109 | 7.5 | Soak job 13 |
| 80 | 400 | 28 | 247 | 105 | 5.9 | Soak job 13 |
| 85 | 480 | 30 | 352 | 210 | 5.9 | Soak job 19 |
| 90 | 481 | 22 | 354 | 210 | 7.2 | Soak job 19 |
| 95 | 482 | 42 | 354 | 210 | 8.0 | Soak job 19 |
| 100 | 489 | 25 | 362 | 216 | 8.3 | Soak job 19 |
| 105 | 519 | 23 | 407 | 259 | 8.3 | Soak job 19 |
| 110 | 562 | 24 | 374 | 137 | 8.2 | Soak job 19 |
| 115 | 584 | 15 | 459 | 223 | 8.2 | Soak job 25 |
| 120 | 584 | 11 | 459 | 223 | 8.2 | Soak job 25 |
| 125 | 534 | 14 | 358 | 69 | 6.1 | Soak job 25 |
| 130 | 563 | 15 | 402 | 111 | 6.8 | Soak job 25 |
| 135 | 607 | 25 | 463 | 171 | 7.8 | Soak job 25 |
| 140 | 630 | 24 | 454 | 188 | 7.7 | Soak job 31 |
| 145 | 630 | 36 | 454 | 188 | 7.7 | Soak job 31 |
| 150 | 630 | 34 | 454 | 188 | 7.7 | Soak job 31 |
| 155 | 636 | 37 | 454 | 188 | 7.7 | Soak job 31 |
| 160 | 420 | 15 | 268 | 95 | 6.3 | Soak job 31 |
| 165 | 440 | 16 | 297 | 149 | 6.9 | Soak job 31 |
| 170 | 565 | 33 | 462 | 314 | 7.6 | Soak job 37 |
| 175 | 513 | 17 | 345 | 110 | 7.6 | Soak job 37 |
| 180 | 513 | 29 | 345 | 110 | 7.6 | Soak job 37 |
| 185 | 468 | 15 | 344 | 110 | 6.0 | – |
