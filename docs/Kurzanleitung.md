# LM Steering Solutions – Kurzanleitung

Für das Lenksystem-Kit mit Tablet. Die App ist eine **Lenkhilfe**: Du bleibst am Lenkrad und für
Fahrzeug, Gerät und Umgebung verantwortlich. Nicht auf öffentlichen Straßen verwenden. Lenkung
ausschalten, sobald Personen im Fahrbereich sind.

## 1. Einschalten
1. Kit mit Strom versorgen (Lenkmodul, GPS-Empfänger).
2. App auf dem Tablet starten. Beim ersten Start erscheint der Hinweis „Bitte vor der Nutzung
   lesen“; mit „Gelesen und verstanden“ geht es weiter.
3. Oben in der Statuszeile: links **Menü**, die Fix-Anzeige (z. B. „RTK Fix“), die **Ampel** und
   der Lenkungsstatus.

## 2. Ersteinrichtung
Sie öffnet sich von selbst, solange noch kein Fahrzeugprofil angelegt ist; sonst über
**Menü → Ersteinrichtung**. Jeder Schritt lässt sich überspringen.
1. **Sprache** wählen.
2. **Fahrzeugprofil:** über „Fahrzeug & Gerät“ das Profil des Traktors wählen oder mit dem
   Assistenten anlegen. Maße nachmessen; die App füllt nichts vor.
3. **Gerät und Arbeitsbreite:** Profil des Geräts; die Arbeitsbreite ergibt sich aus den Teilbreiten.
4. **NTRIP:** unter „Netzwerk & GPS“ das Profil deines Korrekturdienstes (Caster, Port, Mountpoint,
   Benutzer, Passwort, z. B. APOS) eintragen.
5. **Kit prüfen:** Die Liste zeigt live, ob GPS, Lenkmodul und IMU gehört werden.
6. **Richtungsfalle** lesen (siehe Abschnitt 5).

**Zwei Antennen (Dual-GPS):** unter **Einrichtung → Fahrzeug & Gerät → Fahrzeug → Reiter „GPS“**
„Dual-GPS“ einschalten. „Kursversatz (°)“ bleibt 0, wenn der Empfänger den Versatz der Antennen
selbst verrechnet (z. B. `HEADING OFFSET` beim UM982); sonst trägt ihn der Monteur ein.
„Dual-Fix automatisch“ mit „Schaltgeschwindigkeit“ ist wahlweise. Kommt der Dual-Kurs an, ist die
Richtung in der Ampel grün und die Richtungskarte entfällt (außer bei „Dual-Fix automatisch“);
fehlt er, zeigt die App „kein Dual-Kurs“.

## 3. Arbeit starten
**Menü → Arbeit starten** führt in vier Schritten durch:
1. **Schlag** öffnen oder anlegen („Schläge/Aufträge“).
2. **Spur** wählen oder anlegen („Spuren“ oder „Schnelle AB-Linie“, z. B. „A+“ durch deine Position).
3. **Richtung** bestätigen („Ja“ oder „Nein – Richtung neu lernen“).
4. **Ampel** grün. Erst dann führt „Zur Fahransicht“ weiter.

Die Lenkung schaltest du danach **selbst** mit dem Knopf **„Lenken“** ein (rechte Leiste).

## 4. Die Ampel „Bereit zum Lenken“
Antippen zeigt die Liste. Sie ist nur eine Anzeige und schaltet nichts.
- **Grün:** RTK Fix, Lenkmodul verbunden, IMU gehört, Linie gewählt, Richtung bestätigt.
- **Gelb:** erst prüfen – kein IMU-Signal, Simulator statt echtem GPS, oder die Richtung ist seit
  dem Start nicht bestätigt.
- **Rot:** es fehlt etwas, das die Lenkung braucht – keine Verbindung oder Daten, kein RTK Fix,
  Lenkmodul nicht gehört oder keine Linie.

## 5. Die Richtungsfalle (eine Antenne)
Mit einer Antenne lernt das System aus der **ersten Fahrt nach dem Start**, in welche Richtung das
Fahrzeug zeigt. Fährst du zuerst **rückwärts** (z. B. aus der Halle), lernt es die Richtung
verkehrt herum, und die Lenkung arbeitet dann für die falsche Richtung.
- Nach jedem Start **zuerst vorwärts fahren** oder die Richtung auf der Karte
  „Zeigt das Fahrzeug in Fahrtrichtung?“ bestätigen.
- Zeigt der Pfeil falsch: „Nein – Richtung neu lernen“ tippen (oder auf das Fahrzeug tippen), dann
  vorwärts über 1,5 km/h fahren.
- Bis zur Bestätigung bleibt die Ampel gelb.

## 6. Lenkung ausschalten
- Knopf **„Lenken“** noch einmal antippen. Er wirkt sofort beim Antippen.
- Je nach Einrichtung schaltet auch Drehen am Lenkrad oder ein Schalter am Kit die Lenkung aus.
- Zeigt die Statuszeile rot **„Lenkt nicht“**, ist die Lenkung an, aber der Motor lenkt nicht:
  selbst lenken und das Lenkmodul prüfen.

## 7. Arbeitsprotokoll sichern
**Menü → Arbeitsprotokoll** zeigt je Arbeitssitzung Datum, Zeit, Fläche (vom Lenkrechner), Gerät
und Arbeitsbreite. Antippen: Tätigkeit, Mittel/Sorte, Menge, Bemerkung eintragen.
- Die Einträge liegen auf dem Tablet und **am Lenkrechner**: Das Tablet mit der Bedienung gleicht
  alle 30 s und nach jeder Änderung ab; andere Geräte sehen dieselben Einträge. Ist der Lenkrechner
  nicht erreichbar, bleiben sie auf dem Tablet und werden später nachgeliefert, auch eine Sitzung,
  die bei „Zündung aus“ offen war. Sie sind im Profil-Backup enthalten. Eine zusätzliche Kopie:
  - **„Als Datei sichern“** (am Tablet ggf. kein Download möglich) oder
  - **„CSV kopieren“** und in eine Tabelle oder E-Mail einfügen.
- Am PC-Browser: „CSV exportieren“ und „Druckseite je Schlag“ (als PDF speichern).
- Ob das Protokoll gesetzliche Aufzeichnungspflichten erfüllt, ist nicht geprüft.

## 8. Update
**Einrichtung → Info → Aktualisierungen → „Nach Aktualisierungen suchen“** (braucht Internet). Die
App zeigt die neueste veröffentlichte Version mit Link. Installiert wird nichts automatisch: die
neue Version selbst herunterladen und installieren. Auf Wunsch „Beim Start prüfen“ einschalten.

---
LM Steering Solutions basiert auf AgOpenWeb und AgOpenGPS. Lizenz: Apache License 2.0. Fremdkomponenten
und Namensnennungen: Einrichtung → Info →
Drittkomponenten. Kurze Erklärungen zu Knöpfen: Knopf lange drücken.
