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
