# Windows-Installer und Update-Kanäle (feature/installer)

## Installer
- **Datei:** `LM-Steering-Solutions-Setup-<Version>.exe` in jeder Testversion (Workflow „Fork Test Pre-Release“,
  Job `installer`, Inno Setup 6 auf einem Windows-Runner aus dem bisherigen ZIP-Paket). Skript:
  `deploy/windows/installer.iss`. Dazu in Testversionen `LM-Steering-Solutions-portable-<Version>.zip`
  (ohne Installation: entpacken, `AgOpenWeb.Desktop.exe` starten). Eine stabile Freigabe enthält für
  Windows nur das Setup: „Fork Stable Release“ entfernt die ZIP beim Freigeben (die APK bleibt).
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
  Subnetz, für alle Profile (`profile=any` = Domäne, Privat und Öffentlich; das Netz zum Modul ist
  meist „nicht identifiziert“ und damit öffentlich):
  - `<Name> Module (UDP)`: UDP 9999 (Module, `UdpCommunicationService.ModulePort`), 2211 und 2222
    (GPS-Empfänger, `Gps1Port`/`Gps2Port`);
  - `<Name> Tablets (TCP)`: TCP 5174 (Web-Oberfläche für Tablets, `RemoteServerHost.Port`).
  Ausgehend braucht es nichts (RTCM an UDP 2233 geht hinaus). Dafür fragt Windows einmal nach
  Administratorrechten (UAC), auch bei der Installation nur für den Benutzer; der Text am Häkchen
  sagt das, und direkt vor der Abfrage sagt es ein eigener Hinweis noch einmal („Gleich fragt
  Windows nach Adminrechten, um die Firewall für die Module freizugeben.“). Danach prüft das Setup,
  ob beide Regeln da sind. Wenn nicht (abgelehnt oder Fehler): Meldung sofort und noch einmal auf der
  letzten Seite des Setups, mit dem Weg zum Nachholen: **Startmenü → LM Steering Solutions →
  „Firewall freigeben“** (`Firewall-freigeben.cmd` im Programmordner, fragt selbst nach
  Adminrechten) oder das Setup noch einmal ausführen. Das Ergebnis steht in
  `firewall-status.txt` im Programmordner (`ok`, `failed`, `skipped`); beim App-Start prüft der
  Launcher die Regeln per `netsh` und zeigt, solange eine fehlt, denselben Hinweis in der App
  (schließbar, beim nächsten Start wieder). Ohne Häkchen (`skipped`) und in der portablen ZIP gibt es
  keinen Hinweis; Windows fragt dann beim ersten Start selbst. Ein Update löscht und legt die Regeln
  neu an; die Deinstallation entfernt beide (wieder mit UAC-Abfrage).
  Prüfen: `netsh advfirewall firewall show rule name="LM Steering Solutions Module (UDP)"` (bzw.
  `… Tablets (TCP)`) → „Profile: Domäne,Privat,Öffentlich“. Regeln der Testversionen bis moritz.26
  (`AgOpenWeb Module (UDP)`, `AgOpenWeb Tablets (TCP)`) löschen Update und Deinstallation mit.
- **Autostart** (Häkchen „Beim Windows-Start automatisch starten“, vorgewählt): Eintrag unter
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` („LM Steering Solutions“), nur für den
  Benutzer, der installiert; die App startet dann gleich im Vollbild (`--autostart`). Die
  Deinstallation entfernt den Eintrag, ein Update ohne Häkchen auch. Startet die App ein zweites
  Mal (Doppelklick, während sie läuft), kommt das laufende Fenster nach vorne; eine zweite Instanz
  gibt es weiterhin nicht (upstream #377: Sperre pro Rechner, jetzt mit Nachricht an das laufende
  Fenster über eine Named Pipe).
- **WebView2-Laufzeit:** Der Installer prüft sie in der Registry (`pv` unter
  `EdgeUpdate\Clients\{F3017226-…}`, Maschine oder Benutzer). Fehlt sie, startet er Microsofts
  Bootstrapper (`MicrosoftEdgeWebview2Setup.exe`, lädt die Laufzeit aus dem Netz; braucht also
  Internet). Der Workflow lädt den Bootstrapper beim Bauen und prüft seine Microsoft-Signatur;
  ohne ihn gebaut, meldet das Setup nur, dass die Laufzeit fehlt.
- **Name:** „LM Steering Solutions“ (Setup, Startmenü, Desktop-Verknüpfung, Eintrag unter „Apps“,
  Firewall-Regeln). Das Programm darin heißt weiter `AgOpenWeb.Desktop.exe`; Datenordner
  `Dokumente\AgOpenWeb` und Port 5174 bleiben. Ein Update einer Testversion „AgOpenWeb“ bleibt in
  deren Programmordner, ersetzt Startmenü-Ordner und Verknüpfung durch die neuen.
- **AppId endgültig:** `{6C0E8A52-5D7B-4C1E-9A2F-3B8D41E7C905}` (seit der ersten Testversion, mit dem
  Produktnamen festgeschrieben). Nie ändern, auch nicht bei einem neuen Namen, sonst erkennt Windows
  Updates nicht mehr und installiert daneben.

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
