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
- **Windows-Firewall** (Häkchen „Windows-Firewall nur für dieses Programm freigeben“, vorgewählt):
  zwei eingehende Regeln, nur für `AgOpenWeb.Desktop.exe` im Programmordner, nur aus dem lokalen
  Subnetz, alle Profile:
  - `<Name> Module (UDP)`: UDP 9999 (Module, `UdpCommunicationService.ModulePort`), 2211 und 2222
    (GPS-Empfänger, `Gps1Port`/`Gps2Port`);
  - `<Name> Tablets (TCP)`: TCP 5174 (Web-Oberfläche für Tablets, `RemoteServerHost.Port`).
  Ausgehend braucht es nichts (RTCM an UDP 2233 geht hinaus). Dafür fragt Windows einmal nach
  Administratorrechten (UAC), auch bei der Installation nur für den Benutzer; der Text am Häkchen
  sagt das. Ohne Häkchen oder bei „Nein“ fragt Windows beim ersten Start selbst. Ein Update löscht
  und legt die Regeln neu an; die Deinstallation entfernt beide (wieder mit UAC-Abfrage).
  Prüfen: `netsh advfirewall firewall show rule name="AgOpenWeb Module (UDP)"` (bzw. `… Tablets (TCP)`).
- **WebView2-Laufzeit:** Der Installer prüft sie in der Registry (`pv` unter
  `EdgeUpdate\Clients\{F3017226-…}`, Maschine oder Benutzer). Fehlt sie, startet er Microsofts
  Bootstrapper (`MicrosoftEdgeWebview2Setup.exe`, lädt die Laufzeit aus dem Netz; braucht also
  Internet). Der Workflow lädt den Bootstrapper beim Bauen und prüft seine Microsoft-Signatur;
  ohne ihn gebaut, meldet das Setup nur, dass die Laufzeit fehlt.
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
- **Nicht gebaut, nur genannt (Host/Launcher):** ein Hinweis auf eine neue Version im
  Launcher-Fenster selbst (ohne die Web-Oberfläche).
- **WebView2 ohne Internet:** Der Bootstrapper braucht Internet. Für Rechner ohne Netz bräuchte
  das Setup Microsofts Offline-Paket (gut 150 MB); nicht eingebaut.
- **Erst in der CI geprüft:** Der Installer lässt sich nur unter Windows bauen; Firewall-Regeln,
  UAC-Abfrage und WebView2-Installation sind nur gebaut, nicht auf einem Windows-Rechner
  ausprobiert (Testtag, `docs/Testtag.md`).

## Bediengröße bei neuen Installationen
Ein Gerät, auf dem die App noch nie lief (keine eigenen Einträge im Browser-Speicher), startet mit
„Handschuh“ und merkt sich das. Geräte, die die App schon benutzt haben, behalten ihre Größe
(bisher immer „Normal“, wenn nichts gewählt war); eine gewählte Größe gilt immer. Automatisierte
Browser (CI-Layoutprüfung) bleiben bei „Normal“. Test: `Tests/web/scale.test.mjs`.
