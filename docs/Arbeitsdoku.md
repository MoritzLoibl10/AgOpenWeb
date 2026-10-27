# Arbeitsdokumentation

## Teil A – Erhebung: was der Host heute schon liefert (Stand Oktober 2026)

| Gebraucht | Beim Client vorhanden | Quelle (Draht → `transport.js`) | Bemerkung |
|---|---|---|---|
| Schlag | Name des offenen Schlags; alle Schläge mit Grenzfläche | `FieldOps.activeField`, `FieldOps.fields[].areaHa` | |
| Auftrag | Name des offenen Auftrags; Liste aller Aufträge mit Tätigkeit (`workType`), Status, zuletzt geöffnet, Notiz | `Status.jobName`, `FieldOps.jobs[]` | Beginn/Ende des Auftrags (`Job.StartedAt`/`EndedAt`) stehen nur in `job.json` am Host |
| Bearbeitete Fläche | Fläche des offenen Auftrags laut Host, Überlappung mehrfach gezählt | `Status.workedAreaSqM` (`CoverageMapService.TotalWorkedArea`) | |
| Tatsächlich bedeckte Fläche | jede Stelle einmal gezählt | `Status.fieldData.actualAreaSqM` (`ActualAreaCovered`) | |
| Überdeckung (doppelt gefahren) | Differenz der beiden Host-Werte oben | — | Rechnung aus Host-Werten, keine Schätzung |
| Zeiten | nur die Uhr des Tablets: wann der Client einen offenen Auftrag sieht | — | Host-Zeiten (`StartedAt`, `EndedAt`) nicht übertragen |
| Strecke | gefahrene Strecke seit Öffnen des Schlags bzw. Löschen der Fläche | `Status.fieldData.tripDistanceM` | `Job.DistanceTraveledMeters` nicht übertragen |
| Arbeitsbreite | Breite aus den Teilbreiten | `Scene.toolSections` (`sectionsWidthM()`) | |
| Gerät, Fahrzeug | Name des aktiven Profils | `Profiles.activeTool`, `Profiles.activeVehicle` | |

**Über Routen erreichbare Dateien:** keine der Auftrags- oder Schlagdateien. `/backups/` liefert nur
die ZIPs des Profil-Backups, `/bugreports/` nur Diagnose-ZIPs.

### Fehlt, bräuchte eine Host-Änderung (nicht gebaut)
1. **Auftragszeiten und -strecke vom Host:** `Job.StartedAt`, `EndedAt`, `DistanceTraveledMeters`,
   `AreaWorkedHectares` in `FieldOpsDto.Jobs` mitsenden (`SceneProjector`, `WireCodec`, `transport.js`).
2. **Protokoll am Lenkrechner speichern:** z. B. `worklog.json` je Schlag neben `field.geojson`, mit
   Befehl zum Schreiben und Route zum Lesen; damit stünde es allen Geräten zur Verfügung und läge in
   der Bug-Report- und Backup-Datei.
3. **Protokoll im Profil-Backup:** Das Backup baut der Host (`backup.create`); Einträge aus dem
   Browser-Speicher kann er nicht mitnehmen.
4. **Downloads auf Android:** Die App-Ansicht (WebView) lädt im Browser erzeugte Dateien (CSV) nicht
   ohne Weiteres herunter und druckt nicht ohne Druck-Anbindung; beides wäre eine Änderung in
   `Platforms/AgOpenWeb.Android`.

## Teil B – Arbeitsprotokoll (wie aufgezeichnet wird)
- **Ein Eintrag je Arbeitssitzung:** solange dieses Tablet die Bedienung hat, aktuelle Daten
  bekommt und auf einem Schlag ein Auftrag offen ist. Wechselt Auftrag oder Schlag, geht die
  Bedienung weg oder fehlen die Daten länger als 5 Minuten, endet der Eintrag. Ein Neuladen der
  Seite innerhalb von 5 Minuten setzt denselben Eintrag fort.
- **Werte:** Beginn, Ende und Dauer nach der Uhr des Tablets (die Zeit, in der der Auftrag offen
  war). Fläche dieser Sitzung = Fläche des Auftrags laut Host am Ende minus am Beginn; geht der
  Zähler zurück (Fläche gelöscht), bleibt sie leer („—“). Dazu die Auftragswerte am Ende: Fläche
  gesamt, einfach bedeckt, Überlappung (Differenz der beiden). Strecke = Differenz der Fahrtstrecke
  laut Host. Gerät, Fahrzeug (aktive Profile) und Arbeitsbreite (aus den Teilbreiten).
- **Von Hand (Freitext, keine Vorgaben):** Tätigkeit, Mittel/Sorte, Menge, Bemerkung.

## Teil C – Übersicht
Menü → „Arbeitsprotokoll“: Filter nach Schlag, Saison (Kalenderjahr des Beginns) und Suchtext;
Summen je Schlag und Saison (Anzahl Sitzungen, Dauer, Fläche; Sitzungen ohne Fläche werden
gezählt und genannt). Antippen eines Eintrags zeigt alle Werte und die vier Freitextfelder.

## Teil D – Export
- **CSV** („CSV exportieren“): Trennzeichen „;“, Dezimalkomma, UTF-8 mit BOM, Zeilenende CRLF,
  Text mit „;“ oder Anführungszeichen in Anführungszeichen. Flächen in ha mit 2 Nachkommastellen
  und Breite in m mit 2, Strecke in m ohne Nachkommastellen, wie die App sie anzeigt. Es werden die
  gefilterten Einträge exportiert.
- **„CSV kopieren“:** derselbe Inhalt in die Zwischenablage, für Geräte ohne Download.
- **Druckseite je Schlag:** eine Seite pro Schlag mit Summen und Tabelle, über die Druckfunktion
  des Browsers (dort „Als PDF speichern“).
- Jede Ausgabe trägt den Satz, dass nicht geprüft ist, ob sie gesetzliche Aufzeichnungspflichten
  erfüllt.
- **Grenzen:** In der Android- und iOS-App-Ansicht gibt es weder Download noch Drucken (keine
  Anbindung in `Platforms/`); dort bleibt „CSV kopieren“. Im Browser am PC und im Desktop-Fenster
  funktionieren beide (im Desktop-Fenster nicht eigens geprüft).

## Teil E – Ablage
- **Wo:** im Browser-Speicher dieses Tablets (`localStorage`, Schlüssel `aow.worklog.v1`). Die
  Einträge liegen damit **nur auf diesem Tablet**; ein anderes Gerät oder ein anderer Browser sieht
  sie nicht. Löschen der Browser- bzw. App-Daten löscht sie mit. Das sagt auch die Übersicht.
- **Sichern:** „Als Datei sichern“ (JSON) und „Aus Datei laden“ (fügt hinzu, vorhandene Einträge
  bleiben, gleiche Einträge werden nicht doppelt geladen).
- **Profil-Backup:** nicht möglich ohne Host-Änderung, weil der Host die Backup-Datei baut und den
  Browser-Speicher nicht kennt (siehe Teil A, Punkt 3).
- **Dauerhafte Ablage am Lenkrechner:** nur mit Host-Änderung (Teil A, Punkt 2).
