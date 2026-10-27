# Abnahmeprotokoll (feature/abnahme)

Geführte Übergabe eines eingebauten Kits an den Kunden: **Menü → Einrichtung → Abnahmeprotokoll**.
Nur Web-Client (`wwwroot/app.js`, `AcceptCore` und `TabletAcceptance`); keine Host-Änderung.
Board und Motor sind nicht getestet.

## Schritte

| Schritt | Was die App misst | Woher |
|---|---|---|
| Kit-Daten | Kunde, Traktor (Eingabe), Datum (Tablet-Uhr), Fahrzeugprofil, Antennenhöhe, Antenne–Drehpunkt, Antennenversatz, Radstand, Zwei Antennen ja/nein, Dual-Kursversatz | Config-Rahmen des Hosts, wie eingestellt; „Aktuelle Einstellungen übernehmen“ liest neu |
| Zeit bis RTK Fix | Sekunden vom Tippen auf „Start“ bis Fix-Qualität 4 | `statusBar.fixQuality`; Zeit von der Tablet-Uhr |
| Gerade Strecke | Querabweichung: Mittel (mit Vorzeichen), Maximum (Betrag), Streuung (Standardabweichung), Anzahl | `tick.crossTrackError`, nur Ticks, in denen der Host lenkt (eingeschaltet, Führung aktiv, Modul nicht „Lenkt nicht“, nicht in einer Wende), jeder Host-Tick einmal (`hostMs`) |
| Hangfahrt | wie oben, dazu Querneigung Mittel und Maximum | `tick.roll` |
| Wende | Querabweichung über die Wende hinweg; ob eine Wende gefahren wurde | `tick.op.executing` |
| Lenkung aus: Knopf | Lenkung war an, dann aus; Zeit seit dem Scharfschalten | `tick.op.autoSteer`, `moduleNotSteering` |
| Lenkung aus: Lenkrad übersteuern | dasselbe | dasselbe |
| Richtungsprüfung / Dual-Kurs | Einzelantenne: auf der Karte bestätigt; zwei Antennen: Dual-Kurs kommt an | `TabletSteerConfirm.confirmed`, `statusBar.dualHeadingMissing`, `config.gps.isDualGps` |

Pro Schritt: bestanden, nicht bestanden oder übersprungen, mit Bemerkung. Grenzwerte (Mittel als
Betrag, Maximum, Streuung, in cm) trägt der Monteur ein; leer = nicht geprüft. Die App vergleicht
nur mit eingetragenen Grenzwerten und zeigt „Innerhalb/Außerhalb deiner Grenzwerte“; das Ergebnis
setzt der Monteur selbst.

## Export und Ablage
- **Drucken / PDF:** eine Seite mit Kit-Daten, Schritten, Unterschriftsfeldern (Browser-Druck, dort
  als PDF speichern; die Android-App-Ansicht druckt nicht, siehe `docs/Arbeitsdoku.md`).
- **CSV:** `;`, Dezimalkomma, UTF-8 mit BOM.
- **Ablage:** wie das Arbeitsprotokoll, im selben Speicher (`localStorage` und `WorkLog/worklog.json`
  am Lenkrechner, Abgleich über `/worklog`), als Einträge mit `kind: "acceptance"`; die Übersicht
  des Arbeitsprotokolls zeigt sie nicht. Damit sind sie auch im Profil-Backup.

## Was fehlt (nicht gebaut, bräuchte den Host)
- **Grund für „Lenkung aus“:** Der Host meldet nur, dass die Lenkung aus ist bzw. das Modul nicht
  lenkt (eine Meldung „kickout, switch or button“); Knopf, Lenkradübersteuerung und Schalter sind
  nicht unterscheidbar. Der Monteur entscheidet.
- **Zeit bis RTK Fix ab Einschalten:** Der Host sendet keinen Startzeitpunkt des Empfängers und
  keine Zeit seit dem ersten Fix; gemessen wird ab „Start“ auf dem Tablet.
- **Querabweichung des Geräts:** nur die des Traktors (`crossTrackError`).
- **Lenkwinkelsensor und IMU-Kalibrierung:** keine Kennwerte für ein Protokoll (nur Live-Werte in den
  Diagrammen); als Bemerkung eintragen.
- **Wende:** kein Ereignis „Wende abgeschlossen“ und keine Bewertung der Wendebahn; nur `executing`.
