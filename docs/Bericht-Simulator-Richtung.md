# Bericht: Simulator fährt verkehrt herum, Lenkung pendelt

Befund vom ersten Test auf dem Windows-Tablet (moritz.13). SIM an, zuerst rückwärts gewählt: Die
Anzeige zeigt negative km/h, das Fahrzeug fährt aber vorwärts. Dann positive km/h: Es fährt
rückwärts und zeigt positive km/h. Beim Einlenken in eine Spur pendelt die Lenkung.

Geprüft auf `develop` 1b9ba20. Die beteiligten Stellen sind auf upstream `develop` d075aa2
(25.10.2026) unverändert; dort stehen sie teils einige Zeilen tiefer. Nachgestellt mit dem
Desktop-Host `--headless` und Playwright. Skripte liegen außerhalb des Repos und sind unten
beschrieben.

## Ergebnis in einem Satz

Der Fehler steckt **nicht im Simulator**. Er steckt in der Kursbestimmung mit einer Antenne
(`GpsHeadingFusionService`): Sie lernt die Fahrtrichtung aus der ersten Fahrt und nimmt dabei an,
dass diese vorwärts ist. Ist sie rückwärts, bleibt die Richtung um 180° verdreht, bis man auf das
Fahrzeug tippt. Das passiert **auch mit echtem GPS**, mit und ohne IMU. Der Simulator macht es nur
sichtbarer, und ein Teil des Pendelns kommt aus dem Simulator.

## Ursache

### 1. Die erste Richtung wird aus der ersten Fahrt gelernt, als wäre sie vorwärts

`Shared/AgOpenWeb.Services/Gps/GpsHeadingFusionService.cs`

- `TryStartHeading` (Zeile 338–365) nimmt als ersten Kurs die Richtung von der Startposition zur
  ersten Position, die mindestens `FixToFixDistance` (0,5 m) entfernt ist (Zeile 356). Gelernt wird
  das erst über 1,5 km/h (`StartSpeedKmh`, Zeile 50 und 209–211). Ob vorwärts oder rückwärts
  gefahren wird, weiß die Stelle nicht: NMEA liefert die Geschwindigkeit ohne Vorzeichen.
- **Mit IMU:** Der IMU-Versatz wird direkt auf diesen Kurs gesetzt:
  `_imuGpsOffset = Wrap(AngleDelta(imuRad, _gpsHeading))` (Zeile 360). War die erste Fahrt
  rückwärts, ist der Versatz 180°. Die Rückwärtserkennung vergleicht ab dann die Fahrtrichtung mit
  „IMU + Versatz“ (Zeile 242–247). Rückwärts liegen beide gleich, also gilt es als „vorwärts“.
  Vorwärts liegen sie 180° auseinander, also gilt es als „rückwärts“, und der Kurs wird gedreht
  (Zeile 246). Beim Rückwärtsfahren wird der Versatz mit 0,02 nachgezogen (Zeile 256). Er zieht
  aber zum gedrehten Kurs hin, also bleibt der Fehler dauerhaft.
- **Ohne IMU:** Die Rückwärtserkennung sieht nur Richtungswechsel von mehr als 90° gegenüber dem
  letzten Kurs (Zeile 262–275). Nach einem Rückwärtsstart ist schon der erste Kurs verdreht. Jede
  Vorwärtsfahrt gilt dann als „rückwärts“, und auch das bleibt dauerhaft.
- **Mit zwei Antennen** (Dual-GPS) tritt es nicht auf. Den Kurs liefert die Antennenbasis,
  rückwärts wird über die Fahrtrichtung erkannt (`DetectDualReverse`, Zeile 290–302).
- Ausweg heute: aufs Fahrzeug tippen. Das löst `heading.resetDirection` aus
  (`app.js` `vehicleTap`, Zeile 826; `RemoteServerWiring.cs` Zeile 150; `ResetDirection`,
  Zeile 328), und die Richtung wird aus der nächsten Vorwärtsfahrt neu gelernt.
- Upstream kennt das Verhalten. Der Test
  `StartedWhileBacking_ForwardTravelReadsAsReverse_UntilTheDirectionIsReset`
  (`GpsHeadingFusionServiceTests.cs`, Zeile 433) beschreibt es als „the trap“. AgOpenGPS verhält
  sich genauso („Reset Direction, drive forward“).

### 2. Warum es im Simulator immer passiert, wenn man rückwärts anfängt

`Shared/AgOpenWeb.ViewModels/MainViewModel.Simulator.cs`

- Der Simulator meldet seinen echten Kurs als IMU-Kurs (`ImuHeading = simulatedData.HeadingDegrees`,
  Zeile 116). Die Geschwindigkeit meldet er mit Vorzeichen (Zeile 98). Die Kursbestimmung wertet
  das Vorzeichen nicht aus (`speedKmh = Math.Abs(speedMs) * 3.6`, Zeile 146). Damit läuft der
  Simulator genau in Punkt 1 mit IMU.
- Nachgestellt, Werte aus `tick`:
  - rückwärts mit −0,83 m/s: Kurs 180°, keine Rückwärts-Kennung;
  - danach vorwärts mit +0,83 m/s: Kurs bleibt 180°, Kennung „RÜCKWÄRTS“.

  Das ist genau dein Befund.

### 3. Das Pendeln

`Shared/AgOpenWeb.Services/Pipeline/GpsPipelineService.cs`

- Gilt die Fahrt als „rückwärts“ und ist „Lenken rückwärts“ aus (Standard), wird die Lenkung
  pausiert (`steerPaused`, Zeile 1008–1010). Das Lenkmodul bekommt dann in PGN 254 den Status 0
  (`PgnBuilder.cs` Zeile 138), der Motor lenkt also nicht.
- **Der Simulator bekommt den Lenkwinkel der Führung trotzdem** (Zeile 1172, und in
  `MainViewModel.ApplyResults` über `SimulatorSteerAngle`). Er lenkt also, obwohl ein echter Motor
  stünde. Die Führung rechnet in dem Moment für Rückwärtsfahrt, das Fahrzeug fährt aber vorwärts.
  Jede Korrektur wirkt deshalb verkehrt herum, und es schaukelt sich auf.
- Nachgestellt: Spur mit 8° Abweichung, Lenkung ein. Erst vorwärts gestartet, fängt der Simulator
  die Spur sauber (XTE unter 0,1 m). Erst rückwärts gestartet, läuft er weg und pendelt: XTE bis
  25 m, Vorzeichenwechsel, Lenkwinkel zwischen −35° und +23°.
- Upstream #415 (7223ab8, schon in upstream `develop`, noch nicht im Fork) lässt den Simulator nur
  der Führung folgen, solange AutoSteer eingeschaltet ist
  (`simFollowsGuidance = g.HasGuidance && IsAutoSteerEngaged`). Eine pausierte Lenkung zählt dort
  weiter als „eingeschaltet“, das Pendeln bleibt also.

## Kann das mit echtem GPS passieren? Ja.

Bedingung: eine Antenne (mit oder ohne IMU), und die erste Fahrt über 1,5 km/h nach dem Start ist
rückwärts. Beispiel: aus der Halle zurücksetzen. Der Fehler bleibt bis zum Tippen aufs Fahrzeug
bestehen, auch über lange Strecken. Der Zustand gehört zur Kursbestimmung, nicht zum Simulator:
SIM aus und wieder an setzt ihn nicht zurück (aus dem Code, `Initialize` setzt nur den Simulator neu). Für Punkt 1 ist das per Test an der Kursbestimmung
gezeigt (IMU und ohne IMU), nicht auf echter Hardware.

Folgen, solange die Richtung verdreht ist:

| Fahrt in Wirklichkeit | Host meint | Folge |
|---|---|---|
| vorwärts | rückwärts | Kurs um 180° falsch, „RÜCKWÄRTS“ wird angezeigt. Automatische Teilbreiten bleiben aus (`IsReversing`, Zeile 796). Lenkung pausiert (Motor aus), außer „Lenken rückwärts“ ist eingeschaltet: **dann lenkt der Motor mit der Rückwärtsrechnung, also falsch herum.** |
| rückwärts | vorwärts | Keine Pause für Rückwärts. **Ist die Lenkung eingeschaltet, lenkt der Motor mit der Vorwärtsrechnung, während das Fahrzeug zurücksetzt: falsch herum, es schaukelt sich auf** (wie im Simulator). Automatische Teilbreiten schalten rückwärts nicht ab. |

Dass der Motor hier tatsächlich falsch lenkt, ist aus dem Code und dem Simulator abgeleitet.
**Board und Motor sind noch nicht auf echter Hardware getestet.**

Was sicher ist: Beim normalen Ablauf (vorwärts anfahren, dann rückwärts) wird richtig erkannt. Das
zeigen der Test im Flow (Fall A) und die bestehenden Upstream-Tests.

## Was im Fork geändert wurde (nur `wwwroot`)

Die Ursache liegt in der Kursbestimmung, also in der Lenklogik. Der Simulator-Anteil (Lenkwinkel
trotz Pause, Vorzeichen der Geschwindigkeit) liegt im Host. Beides ändert der Fork nach den
Regeln nicht, es geht als Issue an upstream (`docs/Upstream-Issues.md`, Punkt 4). Im Web-Client:

1. **Hinweis im Simulator, wenn die Richtung verkehrt gelernt ist.** Im Simulator sagt das
   Vorzeichen der Sim-Geschwindigkeit sicher, wie er wirklich fährt.
   - Bedingung: Simulator an, Fahrt über 0,3 m/s, kein Dual-GPS, Rückwärtserkennung an. Das
     Vorzeichen passt 3 s lang nicht zur Rückwärts-Kennung.
   - Dann erscheint eine Karte „Simulator: Fahrtrichtung verkehrt herum gelernt“. Sie sagt, dass
     die Lenkung jetzt für die falsche Richtung rechnet und nicht eingeschaltet werden soll.
   - Ein Knopf „Richtung zurücksetzen“ sendet den bestehenden Befehl `heading.resetDirection`, wie
     ein Tippen aufs Fahrzeug, und nur auf Tippen.
   - Die Karte bleibt im Stand stehen. Sie geht nach dem Zurücksetzen, mit SIM aus, oder nach 2 s
     richtiger Fahrt.
2. **„Echtes GPS aktiv – Simulator pausiert“.** Der Host lässt den Simulator nicht an, solange echte
   GPS-Daten kommen, und schaltet ihn ab, wenn sie bei laufendem Simulator beginnen
   (`MainViewModel.Simulator.cs`, Zeile 41–45 und 137–141). Bisher sprang der SIM-Knopf still
   zurück. Jetzt erscheint der Hinweis „Echtes GPS aktiv – Simulator pausiert. Zum Simulieren das
   GPS-Modul trennen und SIM wieder einschalten.“
   - Er erscheint, wenn SIM-Einschalten ohne Wirkung bleibt.
   - Er erscheint auch, wenn der Host den Simulator wegen echtem GPS abschaltet.
   - Hinweis: Der Host pausiert den Simulator nicht, er schaltet ihn aus. Wenn das GPS wieder weg
     ist, muss SIM von Hand wieder an. Das sagt der Hinweis.
3. **Hilfe-Seite „Fahrzeug zeigt in die falsche Richtung“.** Mit einer Antenne wird die Richtung
   aus der ersten Fahrt gelernt. Zuerst rückwärts dreht sie um. Lenkung nicht einschalten,
   anhalten, aufs Fahrzeug tippen, vorwärts anfahren. Mit Dual-GPS passiert das nicht. Das ist der
   einzige Schutz für echtes GPS, denn der Web-Client kann dort nicht erkennen, wie das Fahrzeug
   wirklich fährt.

## Prüfung

- `Tools/ui-audit`-Flow `simdir` (1280×800 und 1024×600, Handschuh):
  - A: vorwärts zuerst, dann rückwärts. Kein Hinweis, Rückwärts richtig erkannt.
  - B: rückwärts zuerst. Hinweis erscheint, Knopf 64 px. Zurücksetzen, vorwärts: Kurs 0°, keine
    Rückwärts-Kennung, Hinweis weg.
  - C: echtes GPS (GGA/VTG über UDP) beginnt bei laufendem SIM. SIM geht aus, Hinweis erscheint.
  - D: SIM einschalten bei echtem GPS. SIM bleibt aus, Hinweis erscheint.
- Kursbestimmung ohne IMU und mit Dual-GPS: per Wegwerf-Test an `GpsHeadingFusionService`
  geprüft, nicht eingecheckt.
