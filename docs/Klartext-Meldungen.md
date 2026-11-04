# Klartext-Meldungen (Bedienung-2, Teil A)

Fehler- und Warnmeldungen, die der Web-Client anzeigt (Toasts, Hinweise in Karten und Dialogen,
die festen Host-Meldungen aus `TabletHostText`). Geändert ist nur der deutsche Text in `de.json`:
was los ist und was zu tun ist. Englischer Schlüssel, Bedeutung und Auslöser sind unverändert.
Begriffe nach `docs/Glossar-DE.md` (Schlag, Schlaggrenze, Bedienung übernehmen, Lenkrechner).

Nicht übersetzt bleiben, wie bisher, Host-Meldungen mit eingesetzten Werten (Dateinamen, Zahlen,
Fehlertexte); sie kommen englisch vom Host (Offene-Punkte #11).

| Schlüssel (englisch) | Deutsch |
|---|---|
| A and B must be at least 1 m apart | A und B liegen zu nah beieinander. B mindestens 1 m von A entfernt setzen. |
| AutoSteer is off while the steer wizard is open | Lenkung ist aus, solange der Lenk-Assistent offen ist. Assistent schließen, dann wieder einschalten. |
| AutoSteer not available - no active track | Lenkung nicht möglich: keine Spur gewählt. Zuerst eine Spur wählen oder anlegen. |
| AutoSteer off: no GPS/guidance update for over 1 s | Lenkung ausgeschaltet: über 1 s keine GPS-Daten. Selbst lenken und GPS-Empfang prüfen. |
| Boundary not saved - need at least 3 points | Schlaggrenze nicht gespeichert: mindestens 3 Punkte nötig. Weiter aufzeichnen. |
| Cannot flip U-turn direction while executing | Wenderichtung lässt sich während der Wende nicht ändern. Erst die Wende zu Ende fahren. |
| Cannot save boundary - no field is open | Schlaggrenze nicht gespeichert: kein Schlag offen. Zuerst einen Schlag öffnen. |
| Cannot smooth AB lines (only 2 points) | Eine AB-Linie lässt sich nicht glätten, sie hat nur 2 Punkte. |
| Cannot start playback (need at least 5 points) | Abspielen nicht möglich: Die Aufzeichnung hat weniger als 5 Punkte. |
| Close the field before deleting it | Der Schlag ist offen. Zuerst schließen, dann löschen. |
| Close the job before deleting it | Der Auftrag ist offen. Zuerst schließen, dann löschen. |
| Guidance stopped - contour off | Führung beendet, weil die Kontur ausgeschaltet wurde. |
| Guidance stopped: track changed | Führung beendet, weil die Spur gewechselt wurde. Lenkung bei Bedarf wieder einschalten. |
| ISO-XML file contains no field (PFD) | Die ISO-XML-Datei enthält keinen Schlag (PFD). Andere Datei wählen. |
| ISO-XML file has no coordinates to import | Die ISO-XML-Datei enthält keine Koordinaten. Andere Datei wählen. |
| ISO-XML file has no usable boundary | Die ISO-XML-Datei enthält keine brauchbare Schlaggrenze. Andere Datei wählen. |
| Invalid heading | Ungültiger Kurs. Wert prüfen. |
| Invalid latitude (must be -90 to 90) | Ungültige Breite: erlaubt sind −90 bis 90. |
| Invalid longitude (must be -180 to 180) | Ungültige Länge: erlaubt sind −180 bis 180. |
| Invalid point selection | Ungültige Punktauswahl. Punkte neu wählen. |
| Load a field with a boundary first | Zuerst einen Schlag mit Schlaggrenze öffnen. |
| Module check error | Modulprüfung fehlgeschlagen. Netzwerkkabel und Strom der Module prüfen, dann erneut versuchen. |
| Need at least 2 tracks to build a boundary | Für eine Schlaggrenze aus Spuren sind mindestens 2 Spuren nötig. |
| Network error | Netzwerkfehler. Verbindung prüfen und erneut versuchen. |
| No GPS fix — Drive In needs current position | Kein GPS-Fix: „Einfahren“ braucht die aktuelle Position. Auf GPS warten. |
| No GPS position - cannot create A+ line | Keine GPS-Position: A+-Linie nicht möglich. Auf GPS warten. |
| No GPS position - cannot place flag | Keine GPS-Position: Markierung nicht möglich. Auf GPS warten. |
| No boundary available | Keine Schlaggrenze vorhanden. Zuerst eine anlegen oder importieren. |
| No boundary for headland | Für das Vorgewende fehlt die Schlaggrenze. Zuerst eine anlegen. |
| No boundary polygons found in KML | In der KML-Datei ist keine Fläche. Andere Datei wählen. |
| No clip line defined | Keine Schnittlinie gesetzt. Zuerst zwei Punkte für die Linie wählen. |
| No field open | Kein Schlag offen. Zuerst einen Schlag öffnen. |
| No field open or no KML polygons parsed | Kein Schlag offen oder die KML-Datei enthält keine Fläche. |
| No fields directory found | Kein Ordner für Schläge gefunden. Ordner unter Einstellungen prüfen. |
| No fields within 0.5 km | Kein Schlag im Umkreis von 0,5 km. Schlag aus der Liste wählen. |
| No flags to delete | Es gibt keine Markierungen zum Löschen. |
| No headland defined | Kein Vorgewende angelegt. |
| No headland to adjust - build one first | Kein Vorgewende zum Anpassen. Zuerst ein Vorgewende erstellen. |
| No headland to clip - use Build first | Kein Vorgewende zum Zuschneiden. Zuerst „Erstellen“ tippen. |
| No other fields with tracks found | Kein anderer Schlag mit Spuren gefunden. |
| No previous field to resume | Es gibt keinen letzten Schlag zum Fortsetzen. Schlag aus der Liste wählen. |
| No track selected | Keine Spur gewählt. Zuerst eine Spur wählen. |
| No track selected for U-turn | Wende nicht möglich: keine Spur gewählt. |
| No tracks found in selected field | Im gewählten Schlag gibt es keine Spuren. |
| No tracks to cycle | Keine weitere Spur zum Wechseln. |
| No tracks to delete | Es gibt keine Spuren zum Löschen. |
| No valid boundary | Keine gültige Schlaggrenze. |
| No valid boundary to create headland from | Keine gültige Schlaggrenze, aus der das Vorgewende entstehen kann. |
| No visible tracks | Keine Spur sichtbar. Spuren unter „Spuren“ einblenden. |
| Not enough points in segment | Zu wenige Punkte im Abschnitt. Größeren Abschnitt wählen. |
| Nothing to undo | Es gibt nichts rückgängig zu machen. |
| Open a field first | Zuerst einen Schlag öffnen. |
| Open a field first before importing a boundary | Zuerst einen Schlag öffnen, dann die Schlaggrenze importieren. |
| Open a field first before importing tracks | Zuerst einen Schlag öffnen, dann die Spuren importieren. |
| Open a field first before recording a boundary | Zuerst einen Schlag öffnen, dann die Schlaggrenze aufzeichnen. |
| Open a field first to add boundary | Zuerst einen Schlag öffnen, dann die Schlaggrenze hinzufügen. |
| Press Drive In again | „Einfahren“ noch einmal tippen. |
| Select 2 points on the boundary first | Zuerst 2 Punkte auf der Schlaggrenze antippen. |
| Select a boundary first | Zuerst eine Schlaggrenze wählen. |
| Select a boundary to delete | Die Schlaggrenze wählen, die gelöscht werden soll. |
| Steer module stopped steering (kickout, switch or button) | Das Lenkmodul hat die Lenkung beendet (Lenkrad bewegt, Schalter oder Taste). Selbst lenken; bei Bedarf wieder einschalten. |
| This track has no ends to adjust | Diese Spur hat keine Enden zum Anpassen. |
| Too few points to smooth (need at least 5) | Zu wenige Punkte zum Glätten: mindestens 5 nötig. |
| A module is connected: the demo only runs without modules, so nothing real is switched. | Ein Modul ist angeschlossen. Die Vorführung läuft nur ohne Kit, damit nichts Echtes geschaltet wird: Kit trennen, dann erneut starten. |
| Direction reset. Drive forward above 1.5 kph. | Richtung zurückgesetzt. Jetzt vorwärts über 1,5 km/h fahren. |
| Enter the password for NTRIP profile {n} again (Setup → Network & GPS). | Das Passwort für das NTRIP-Profil {n} fehlt. Unter Einrichtung → Netzwerk & GPS neu eingeben. |
| File not found in the Import folder. | Die Datei liegt nicht mehr im Ordner Import. Liste aktualisieren und erneut wählen. |
| GPS data lost. | GPS-Daten fehlen. GPS-Empfänger und Kabel prüfen. |
| No base position received for {n} s. | Seit {n} s keine Basisposition vom Caster. NTRIP-Verbindung prüfen. |
| No connection to the guidance computer. | Keine Verbindung zum Lenkrechner. WLAN bzw. Kabel prüfen; die Seite verbindet sich von selbst neu. |
| No current data from the guidance computer. | Keine aktuellen Daten vom Lenkrechner. Kurz warten; hilft das nicht, den Lenkrechner neu starten. |
| No data from the steering module. Check power, network cable and the module subnet (Network & GPS). | Keine Daten vom Lenkmodul. Strom, Netzwerkkabel und Modul-Subnetz prüfen (Netzwerk & GPS). |
| No modules found: please type in the subnet first (192.168.5 is only filled in as an example). | Keine Module gefunden. Zuerst das Subnetz eintippen (192.168.5 steht nur als Beispiel da). |
| No satellite observations for {n} s. | Seit {n} s keine Satellitendaten vom Caster. NTRIP-Verbindung prüfen. |
| Not a backup of this app (manifest.json missing or another format). | Das ist keine Sicherung dieser App. Andere Datei wählen. |
| Nothing selected. | Nichts ausgewählt. Mindestens einen Eintrag anhaken. |
| Only the device that has control can import. | Übernehmen geht nur auf dem Gerät, das die Bedienung hat. Dort ausführen oder die Bedienung übernehmen. |
| Only the device that has control can start the demo. | Die Vorführung startet nur auf dem Gerät, das die Bedienung hat. |
| Please enter the cutting width. | Bitte die Schnittbreite eingeben. |
| Reading or writing failed: {f} | Lesen oder Schreiben fehlgeschlagen: {f}. Speicherplatz prüfen und erneut versuchen. |
| Real GPS active – simulator paused. To simulate, disconnect the GPS module and switch SIM on again. | Echtes GPS aktiv, Simulator pausiert. Zum Simulieren das GPS-Modul trennen und SIM wieder einschalten. |
| Select a track first | Zuerst eine Spur wählen. |
| Steering is on, but the module reports it is not steering. | Lenkung ist ein, aber das Modul lenkt nicht. Selbst lenken und Lenkmodul prüfen. |
| Steering is on. Switch steering off to change profiles. | Die Lenkung ist ein. Zum Ändern der Profile erst die Lenkung ausschalten. |
| Steering is on. Switch steering off to import. | Die Lenkung ist ein. Zum Übernehmen erst die Lenkung ausschalten. |
| Take control to reset the direction | Zum Zurücksetzen der Richtung erst die Bedienung übernehmen. |
| The IMU heading differs from the GPS heading by {d}°. | Der IMU-Kurs weicht um {d}° vom GPS-Kurs ab. IMU-Ausrichtung und Kurs-Versatz prüfen. |
| The IMU heading has been exactly 0° for {s} s while driving. The module probably sends no real IMU heading. | Der IMU-Kurs steht seit {s} s beim Fahren genau auf 0°. Das Modul sendet vermutlich keinen echten IMU-Kurs: IMU-Anschluss prüfen. |
| The backup is too large. | Die Sicherung ist zu groß. |
| The field {f} is open. Close it to import it. | Der Schlag {f} ist offen. Zum Übernehmen erst den Schlag schließen. |
| The file is not a readable ZIP file. | Die Datei ist keine lesbare ZIP-Datei. Andere Datei wählen. |
| The vehicle is moving. Stop to change profiles. | Das Fahrzeug fährt. Zum Ändern der Profile anhalten. |
| The vehicle is moving. Stop to import. | Das Fahrzeug fährt. Zum Übernehmen anhalten. |
| This backup has a format version this app does not support. | Diese Sicherung stammt aus einer neueren oder anderen Version. App aktualisieren oder andere Sicherung wählen. |
| View only: another screen has control | Nur ansehen: Ein anderer Bildschirm hat die Bedienung. |
