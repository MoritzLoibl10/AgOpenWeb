# Windows-Installer und Update-Kanäle (feature/installer)

## Installer
- **Datei:** `<Name>-Setup-<Version>.exe` in jeder Testversion (Workflow „Fork Test Pre-Release“,
  Job `installer`, Inno Setup 6 auf einem Windows-Runner aus dem bisherigen ZIP-Paket). Skript:
  `deploy/windows/installer.iss`. Das ZIP bleibt zusätzlich in der Vorabversion.
- **Wohin:** für den angemeldeten Benutzer nach `%LOCALAPPDATA%\Programs\<Name>`, ohne
  Administratorrechte; wer Administrator ist, kann im ersten Dialog „für alle Benutzer“ wählen. Der
  Ordner ist fest (keine Auswahl), weil ein Update ihn vorher leert.
- **Was:** Startmenü-Eintrag, auf Wunsch Desktop-Verknüpfung, Deinstallation über „Apps“ bzw.
  das Startmenü, Start nach der Installation. Sprache des Installers Deutsch oder Englisch.
- **Update:** Die neue Version installiert über die alte (gleiche `AppId`); läuft die App, wird sie
  vorher geschlossen. Der Programmordner wird geleert, damit keine alten Dateien bleiben.
- **Daten bleiben:** bei Update und Deinstallation. Schläge, Profile, Arbeitsprotokoll,
  Abnahmeprotokolle und Einstellungen liegen in `Dokumente\AgOpenWeb` (`AppDataRoot`), der Speicher
  der Web-Ansicht in `%LOCALAPPDATA%\Photino`; der Installer fasst beides nicht an.
- **Port:** bleibt 5174; er ist in der App fest, der Installer fragt und setzt keinen.
- **Name:** `AgOpenWeb`, solange kein Produktname feststeht; beim Bauen mit `/DAppName=…` änderbar.
  Die `AppId` nie ändern, sonst erkennt Windows Updates nicht mehr.

## Update-Kanäle
- **Stabil** (Vorgabe): nur Versionen, die ausdrücklich freigegeben wurden.
- **Test:** zusätzlich alle Testversionen (Vorabversionen wie bisher).
- **Umschalten:** Einrichtung → Info → Aktualisierungen → „Kanal“, pro Gerät (Browser-Speicher).
- **Freigeben:** Workflow **„Fork Stable Release“** mit dem Tag einer getesteten Testversion. Er
  macht aus der Vorabversion eine vollständige Release („Latest“) mit dem Vermerk „Released as
  stable on …“; gebaut wird nichts neu, die geprüften Dateien sind die stabilen.
- **Anzeige:** Die App sucht die eigene Version unter allen Releases und vergleicht mit der
  neuesten des Kanals. Eine Testversion, die neuer ist als die neueste stabile, meldet
  „Diese Testversion ist neuer als die neueste stabile Version“. Installiert wird nie automatisch.
- Test: `Tests/web/update.test.mjs` (Kanäle, Testversion auf „Stabil“).

## Offen
- **Code-Signierung:** Installer und Programm sind nicht signiert; Windows SmartScreen warnt
  („Der Computer wurde durch Windows geschützt“ → „Weitere Informationen“ → „Trotzdem ausführen“).
  Dafür braucht es ein Code-Signing-Zertifikat und ein Secret im Workflow (Secrets nicht angefasst).
- **Nicht gebaut, nur genannt (Host/Launcher):**
  - Windows-Firewall: Für Tablets im Netz fragt Windows beim ersten Start nach einer Freigabe. Eine
    Regel für Port 5174 könnte der Installer nur mit Administratorrechten anlegen.
  - WebView2-Laufzeit: Der Installer prüft sie nicht und installiert sie nicht (unter Windows 10/11
    meist vorhanden); fehlt sie, bleibt das Fenster leer. Ein Bootstrapper ließe sich ergänzen.
  - Ein Hinweis auf eine neue Version im Launcher-Fenster selbst (ohne die Web-Oberfläche).
- **Erst in der CI geprüft:** Der Installer lässt sich nur unter Windows bauen; die erste Testversion
  aus diesem Branch ist sein erster Lauf.
