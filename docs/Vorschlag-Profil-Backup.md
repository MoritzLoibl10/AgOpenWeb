# Vorschlag: Profil-Backup (Export und Import) – braucht eine Host-Änderung

Stand: nur Vorschlag, nicht gebaut. Wird ein eigener PR. Ziel: Fahrzeug-, Geräte- und
Schlagprofile als **eine Datei** sichern und wiederherstellen, z. B. beim Tablet-Tausch beim
Kunden.

## Warum es ohne Host-Änderung nicht geht
- Der Web-Client kennt nur die Werte des **aktiven** Fahrzeugs/Geräts (Config-Frame) und die
  Kurztexte der anderen (Profil-Frame). Profil- und Schlagdateien kann er nicht lesen.
- Die App-Hüllen (Android/iOS) können aus der Seite heraus **keine Datei speichern**; Downloads
  gehen nur über den System-Browser und nur für Dateien, die der Host ausliefert (wie
  `/bugreports/`). Sie können auch **keine Datei auswählen** (kein Datei-Dialog im WebView).
- Es gibt keinen Befehl, der Profil- oder Schlagdateien schreibt.

Bis dahin: USB-Kopie des Datenordners (in der Hilfe beschrieben, nicht auf echtem Tablet geprüft).

## Vorschlag

### 1. Export (Host)
- Neue Route `GET /backup/<name>.zip`, gebaut wie `/bugreports/` (nur Dateiname, kein Pfad, nur
  vom Host erzeugte Dateien).
- Neuer Befehl `backup.create` (Tier-1): packt `Vehicles/`, `Tools/`, `Fields/` (mit Spuren,
  Grenzen, Vorgewende, Hintergrundbild; optional ohne `jobs/`-Abdeckung) in
  `Documents/AgOpenWeb/Backups/backup_<Datum>.zip`, dazu `manifest.json` (App-Version, Paket-ID,
  Datum, Liste der Dateien mit SHA-256).
- **NTRIP-Profile:** standardmäßig **ohne** Passwort und Benutzer (Felder leer); mit einer
  ausdrücklichen Option „mit Zugangsdaten“ und Warnung im Client.
- Status über `appInfo` (wie `bugReportStatus`), der Client bietet „Herunterladen“ (System-
  Browser → Downloads).

### 2. Import (Host)
- Quelle: der vorhandene Import-Ordner `Documents/AgOpenWeb/Import` (wie KML/ISO-XML). Der
  Kunde kopiert die ZIP per USB dorthin.
- `backup.list`: ZIPs im Import-Ordner (neuer kleiner Frame oder Teil von `appInfo`).
- `backup.preview|<Datei>`: prüft `manifest.json` und die Prüfsummen und liefert je Profil und
  Schlag den Zustand **neu / überschreibt / gleich**, für Überschreiben mit den wichtigsten
  Unterschieden (z. B. Radstand alt → neu).
- `backup.apply|<Datei>\t<Auswahl>`: legt **vorher automatisch** ein Backup des jetzigen Stands
  an, schreibt dann nur die ausgewählten Einträge und lädt das aktive Paar neu.
- Sicherheit:
  - Client: Import nur im Stand (< 0,5 km/h), bei Lenkung AUS, mit Verbindung, nach der Vorschau
    und einer Bestätigung.
  - Host: lehnt `backup.apply` ab, solange AutoSteer an ist oder sich das Fahrzeug bewegt
    (zusätzliche Prüfung, kein Eingriff in die Lenklogik).
  - Kein Import älterer oder fremder Formate (nur ZIPs mit `manifest.json` dieses Formats).

### 3. Client (wwwroot)
- Einrichtung → „Sichern und Wiederherstellen“: Export-Knopf mit Hinweis (enthält Schläge und
  Positionen; NTRIP-Zugangsdaten nur auf Wunsch), Liste der ZIPs im Import-Ordner, Vorschau als
  Tabelle, Auswahl, Bestätigung, Ergebnis.
- Gleiche Sperre wie bei den Profilen (Phase 2c).

### Betroffene Host-Dateien (geschätzt)
| Datei | Änderung |
|---|---|
| `Shared/AgOpenWeb.RemoteServer/RemoteServerHost.cs` | Route `/backup/` |
| `Shared/AgOpenWeb.RemoteWiring/RemoteServerWiring.Helpers.cs` | Befehle `backup.create`, `backup.list`, `backup.preview`, `backup.apply` |
| `Shared/AgOpenWeb.Services/` (neu: `ProfileBackupService.cs`) | Packen, Prüfen, Vorschau, Anwenden, Auto-Backup |
| `Shared/AgOpenWeb.RemoteServer/Contracts.cs`, `WireCodec.cs`, `wwwroot/transport.js` | Frame für Liste und Vorschau |
| `Tests/AgOpenWeb.Services.Tests/` | Tests: Rundreise Export → Import, Prüfsummen, keine Passwörter, Sperre |

Offene Fragen: Abdeckung (`jobs/`) mitsichern? NTRIP-Zugangsdaten überhaupt erlauben?
Verschlüsselung der ZIP?
