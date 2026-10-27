# Testtag: Checkliste zur Testversion 26.7.0-moritz.24 (#20–#26)

Reihenfolge wie beim Abarbeiten. Je Punkt: **tun** → **soll** · PR. Abhaken: ☐. Board und Motor
sind nicht getestet; Lenkung nur mit Abstand zu Personen, auf eigenem Gelände.

## 1. Am Tisch (Tablet, Kit noch nicht angeschlossen)
☐ App installieren (APK aus der Vorabversion), starten → Hinweis „Bitte vor der Nutzung lesen“, erst „Gelesen und verstanden“ schließt ihn · #23
☐ Danach → Ersteinrichtung öffnet sich, solange kein Fahrzeugprofil existiert; jeder Schritt überspringbar · #22
☐ Ersteinrichtung: Sprache, Fahrzeug, Gerät durchgehen → nichts vorausgefüllt, leere Felder bleiben leer · #22
☐ Menü → Vorführmodus → gestreiftes Band „VORFÜHRUNG“, Simulator fährt; „Vorführung beenden“ → Band weg · #21
☐ Ampel antippen → Liste mit GPS, Lenkmodul, IMU, Linie, Richtung · #21
☐ Knopf lange drücken (z. B. Spuren, Menü-Kachel) → Erklärung, nichts geschaltet; kurz drücken → wirkt beim Loslassen · #22
☐ „Lenken“, Teilbreiten, Wende, Vorgewende kurz antippen → wirken sofort beim Aufsetzen, keine Erklärung · #22
☐ Eine Fehlermeldung auslösen (z. B. „Arbeit starten“ ohne Schlag, Spur ohne Schlag) → deutscher Text sagt, was zu tun ist · #22
☐ Einrichtung → Info → Drittkomponenten (Liste, BEV-Namensnennung), Aktualisierungen → „Nach Aktualisierungen suchen“ zeigt die neueste Version mit Link (nur mit Internet) · #23
☐ Windows-PC: Knopf ⛶ → Fenster echtes Vollbild, noch einmal → zurück · #21
☐ Windows-PC: Setup aus der Testversion ausführen → Startmenü, Desktop-Verknüpfung, App startet; Setup einer neueren Version → installiert darüber, Schläge und Arbeitsprotokoll noch da; Deinstallieren → `Dokumente\AgOpenWeb` bleibt · Installer-PR
☐ Einrichtung → Info → Aktualisierungen: Kanal „Stabil“ (Vorgabe) und „Test“ umschalten → Anzeige wechselt, gilt nur auf diesem Gerät · Installer-PR
☐ Ersteinrichtung schließen, App-Daten des Browsers löschen, neu öffnen → Ersteinrichtung kommt **nicht** wieder (Stand am Lenkrechner) · #25
☐ Einrichtung → Abnahmeprotokoll → „Neues Abnahmeprotokoll“: Kit-Daten zeigen Antennenmaße und Fahrzeugprofil wie eingestellt; Kunde/Traktor eintragen · #26
☐ NTRIP-Profil bearbeiten: Passwort steht als Maske, „Verbindung testen“ mit NTRIP 1 und 2 klappt, Passwort bleibt erhalten · #20

## 2. Am Prüfstand (Kit angeschlossen, Räder frei, niemand an den Rädern)
Schritte der Prüfstand-Checkliste (`docs/Pruefstand-Checkliste.md`) wie bisher, dazu:
☐ Vorführmodus starten, während das Kit läuft → Meldung „Ein Modul ist angeschlossen …“, startet nicht · #21
☐ Vorführmodus läuft, dann Kit einstecken → Vorführung endet mit „Vorführung beendet – Kit erkannt. Lenkung und Teilbreiten prüfen.“; Lenkung und Teilbreiten aus (Befehle autosteer.off / sections.alloff) · #21, Host-Paket
☐ Ampel → Lenkmodul „verbunden“; IMU „verbunden“ (BNO085 über PGN 253); RTK Fix grün · #21
☐ Zweites Tablet/Browser verbinden → „Nur ansehen“, kann nichts ändern (auch keine Profile) · #20
☐ Lenken ein/aus wie bisher; kein Unterschied zur Vorversion beim Lenkverhalten · #20
☐ RTK Float erzwingen (z. B. Korrekturen trennen) → Ampel GPS rot, „verlangt Fix-Qualität 4“; zurück auf RTK Fix → grün · #25
☐ Abnahme „Zeit bis RTK Fix“: Start beim Einschalten des Empfängers → stoppt selbst bei RTK Fix, Sekunden stehen da · #26
☐ Abnahme „Lenkung aus: Knopf“: Start, Lenkung ein, mit Knopf aus → „Lenkung … s nach dem Scharfschalten aus“ · #26
☐ Abnahme „Lenkung aus: Lenkrad übersteuern“: Start, Lenkung ein, am Lenkrad drehen → erkannt; Grund meldet der Host nicht, selbst bewerten · #26

## 3. Auf dem Hof
☐ App neu starten, zuerst **rückwärts** aus der Halle → Ampel bleibt gelb „Richtung … nicht bestätigt“; Karte „Zeigt das Fahrzeug in Fahrtrichtung?“ zeigt Pfeil gegen die Spur · #21
☐ „Nein – Richtung neu lernen“, vorwärts fahren → Pfeil stimmt, nach „Ja“ wird die Richtung grün · #21/#22
☐ Menü → Arbeit starten: Schlag → Spur → Richtung → Ampel; „Zur Fahransicht“ nur bei grün; Lenkung bleibt aus · #22
☐ Zwei Antennen (falls verbaut): Ampel „Richtung: Doppelantenne“ grün ohne Karte; Kabel einer Antenne ziehen → „kein Dual-Kurs“, Richtung gelb · #25

## 4. Im Feld
☐ Schlag öffnen, Auftrag starten, Linie wählen, Ampel grün, Lenkung selbst einschalten → lenkt wie vorher · #20/#22
☐ Wende am Vorgewende (falls genutzt) → wie vorher; Werte der Wende unverändert · #20
☐ Nach dem Arbeiten Auftrag schließen → Menü → Arbeitsprotokoll: Eintrag mit Datum, Zeit, Fläche (Host), Gerät, Breite · #24
☐ Eintrag antippen, Tätigkeit/Mittel/Menge/Bemerkung eintragen, speichern · #24
☐ „CSV kopieren“ → in Tabelle/E-Mail einfügen: Spalten mit „;“, Kommazahlen · #24
☐ „Als Datei sichern“ → auf dem Tablet ggf. kein Download (bekannte Grenze); am PC-Browser prüfen · #24
☐ Druckseite je Schlag am PC-Browser → eine Seite pro Schlag · #24
☐ Arbeitsprotokoll: „Auch am Lenkrechner gespeichert (zuletzt …)“; zweites Tablet sieht dieselben Einträge · #25
☐ Während eines Auftrags Zündung aus, ohne zu schließen; neu starten → Sitzung endet mit der letzten Uhrzeit und erscheint am Lenkrechner, sobald das Tablet die Bedienung hat · #25
☐ Abnahme „Gerade Strecke“ und „Hangfahrt“: Start, lenken lassen, Stopp → Mittel/Maximum/Streuung in cm; eigene Grenzwerte eintragen → „Innerhalb/Außerhalb“ · #26
☐ Abnahme „Wende“: mit Wende fahren → „Wende gefahren“; Ergebnis je Schritt setzen, Bemerkung · #26
☐ Abnahme → „Drucken / PDF“ am PC-Browser (eine Seite, Unterschriften), „CSV exportieren“ · #26

**Notieren:** was nicht passt, mit Uhrzeit; danach Diagnose-Datei (Menü → Diagnose für Support).
