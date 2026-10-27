# LM Steering Solutions – Einbauanleitung für den Monteur

Für ein Lenkkit mit AiO v4.5 (Teensy 4.1, BNO085), Keya-Motor über CAN, Firmware AiO-v4, und
diese App. Beschrieben ist nur, was die App einstellt und anzeigt. **Board und Motor sind nicht
getestet.** Was die Hardware betrifft, steht hier als „vom Monteur zu ergänzen“.

## 1. Antenne montieren und vermessen
- Montage, Halter, Kabelweg, Masseplatte: *vom Monteur zu ergänzen*.
- Gemessen wird am stehenden Fahrzeug auf ebenem Boden, in Metern:
  - **Antenne → Hinterachse:** von der Mitte der Hinterachse bis zur Antenne, in Fahrtrichtung
    gemessen; + = Antenne vor der Achse.
  - **Antennenhöhe:** vom Boden bis zur Antenne.
  - **Antenne seitlich:** von der Fahrzeugmitte seitlich bis zur Antenne; dazu links, Mitte oder rechts
    wählen.
  - **Radstand** und **Spurweite** (Mitte Rad zu Mitte Rad).
- Die App füllt nichts vor und rechnet nichts um; leere Felder bleiben leer.

## 2. Maße eintragen
**Einrichtung → Fahrzeug & Gerät → Fahrzeug**: Profil des Traktors anlegen (Assistent) oder
bearbeiten. Die Seiten „Antenne“ und „Anhängung / Radstand / Spurweite“ zeigen je eine Skizze zum
Maß. Gerät und Teilbreiten im Geräteprofil. Danach im Abnahmeprotokoll (Schritt „Kit-Daten“) prüfen,
dass die Werte wie gemessen dastehen.

## 3. IMU (BNO085 auf der AiO)
- Die AiO schickt den IMU-Kurs im PGN 253 mit. Die Ampel zeigt dann „IMU: verbunden“; ohne IMU-Kurs
  bleibt sie gelb.
- **Querneigung:** Fahrzeug auf ebenen Boden stellen, dann **Werkzeuge & Assistenten →
  Querneigungs-Korrektur → „Querneigung nullen“** (oder im Lenk-Assistenten „Zero Roll“). Zeigt
  die Querneigung bei Neigung nach rechts in die falsche Richtung: „Querneigung umkehren“.
- **IMU-Achse** (X oder Y) unter **Einrichtung → Lenkung** nach Einbaulage des Boards.
- Den Versatz zwischen IMU-Kurs und GPS-Kurs lernt die App beim Fahren selbst. Weicht er stark ab,
  meldet sie „Der IMU-Kurs weicht um … vom GPS-Kurs ab“: Einbaulage prüfen.
- Einbaulage und Befestigung des Boards: *vom Monteur zu ergänzen*.

## 4. Lenkwinkelsensor
**Werkzeuge & Assistenten → Lenk-Assistent** führt durch die Lenkung:
- **„Lenkwinkel nullen“** (Zero WAS) bei geradeaus stehenden Rädern.
- **„Lenkwinkelsensor umkehren“**, wenn der Live-Lenkwinkel beim Einschlag nach links die falsche
  Richtung zeigt.
- **Zähler pro Grad** und **Ackermann** unter **Einrichtung → Lenkung**; zum Ermitteln hilft die
  **Smart-WAS-Kalibrierung** (Fahrzeug fährt, die App beobachtet).
- Einbau des Sensors, Gestänge, beim Keya-Motor ggf. ohne eigenen Sensor: *vom Monteur zu ergänzen*.
- Motortreiber-Auswahl und Stromsensor für den Keya: *vom Monteur zu ergänzen* (die App kennt keine
  eigene Keya-Auswahl; siehe `docs/UI-UX-Analyse.md`, Abschnitt 3.2).

## 5. Zwei Antennen (Dual-GPS)
Nur wenn zwei Antennen verbaut sind.
- **Empfänger, die die App lesen kann:** `$PAOGI` (baut die AiO), `$KSXT` (z. B. Unicore UM982,
  Bynav T1-FD) oder `GGA` mit `HPR`, `HDT` oder `THS`. Einstellungen für den UM982:
  `Docs/GPS_RECEIVERS.md`.
- **In der App:** **Einrichtung → Fahrzeug & Gerät → Fahrzeug → Reiter „GPS“**:
  - „Dual-GPS“ einschalten;
  - „Kursversatz (°)“: 0, wenn der Empfänger den Versatz selbst verrechnet (`HEADING OFFSET`), sonst
    den Winkel der Antennenlinie zur Fahrtrichtung, *vom Monteur zu ermitteln*;
  - „Rückwärtsweg“ für die Rückwärtserkennung;
  - wahlweise „Dual-Fix automatisch“ mit „Schaltgeschwindigkeit“.
- **Was die App dann schon richtig macht:** Ampel „Richtung: Doppelantenne“ grün, solange der
  Dual-Kurs ankommt; keine Richtungskarte (außer mit „Dual-Fix automatisch“); fehlt der Dual-Kurs,
  zeigen Statuszeile und Systemdaten „kein Dual-Kurs“.
- Antennenabstand, Ausrichtung der Antennenlinie, Firmware der AiO für Dual: *vom Monteur zu ergänzen*.

## 6. Abnahme
**Einrichtung → Abnahmeprotokoll** mit dem Kunden durchgehen (`docs/Abnahme.md`):
Kit-Daten, Zeit bis RTK Fix, gerade Strecke, Hangfahrt, Wende, Lenkung aus per Knopf und durch
Übersteuern am Lenkrad, Richtung bzw. Dual-Kurs. Grenzwerte trägt der Monteur selbst ein; die App
gibt keine vor. Drucken (PDF) und CSV; das Protokoll liegt auf dem Tablet und am Lenkrechner.

---
LM Steering Solutions basiert auf AgOpenWeb und AgOpenGPS. Lizenz: Apache 2.0 wie die App. Ohne Gewähr;
Prüfung am Fahrzeug durch den Monteur.
