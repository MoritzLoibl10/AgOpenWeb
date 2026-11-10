# Phase 4a: Kit-Vorbereitung (ohne Lenkwerte) – Analyse

Stand: umgesetzt bis auf das Profil-Backup (siehe Abschnitt 5 und [Vorschlag-Profil-Backup.md](Vorschlag-Profil-Backup.md)). Regeln wie bisher (nur wwwroot, keine neuen Host-Befehle,
Lenk-/Regel-/Sicherheitslogik unberührt, Secrets/Signierung nicht anfassen). Nicht in dieser
Phase: Standardwerte für AiO/Keya, Regelparameter, Kit-Einrichtungsassistent.

Wichtige Rahmenbedingung für alle Punkte: Der eingebaute Webserver liefert nur fest
eingetragene Dateien aus (`index.html`, `app.js`, `transport.js`, `i18n.js`, `i18n/*.json`,
`icons/*` als PNG/GIF, `sounds/*.wav`, `manifest.webmanifest`). Neue Inhalte müssen also in
`app.js`/`index.html` oder als PNG unter `icons/` liegen. Die App-Hüllen (Android, iOS) können
selbst keine Datei speichern (Downloads gehen über den System-Browser, nur für Dateien, die der
Host ausliefert) und keine Datei auswählen (kein Datei-Dialog im WebView).

## 1. Branding

### Wo der Name heute steht
| Stelle | Datei | wwwroot? |
|---|---|---|
| Fenstertitel „AgOpenWeb Remote“ | `index.html` `<title>` | ja |
| Info-Seite „AgOpenWeb“, „Based on AgOpenGPS by Brian Tee“, „Apache License 2.0“ | `index.html` `#about` | ja |
| Hilfe-Links (GitHub, Forum, Updates → upstream-Repo) | `index.html` `#help` | ja |
| PWA-Name und -Symbol | `manifest.webmanifest`, `icons/appicon-*.png` | ja (eigene Datei) |
| Android: App-Name, App-Symbol | `MainActivity.cs` (`Label`, `Icon`), `.csproj` (`ApplicationTitle`), `Resources/drawable/icon` | **nein** |
| Android: Paket-ID `com.agopenweb.android` | `.csproj` | nein, und bleibt (neue ID = neue App, Daten weg) |
| iOS / Windows: App-Name, Symbol | jeweilige Plattform-Projekte | nein |
| Farbige Symbole der linken Leiste und der Einrichtungsdialoge | upstream-Bilder `icons/*.png` | ja, aber viele; bleiben vorerst |

### Vorschlag Umsetzung
- **Eine Stelle:** `const BRAND = { name: 'LM Steering Solutions', claim, farbwelt, quelle: 'https://github.com/MoritzLoibl10/AgOpenWeb', … }`
  am Anfang eines neuen tablet-ui-Abschnitts in `app.js`. Daraus: Titel, Info-Seite, Logo,
  Farben, Hilfe-Links.
  - Das PWA-Manifest ist eine eigene Datei. Vorschlag: zur Laufzeit aus `BRAND` erzeugen
    (`<link rel="manifest">` auf eine erzeugte Adresse), sonst wäre es eine zweite Stelle.
- **Umschaltbar:** Einrichtung → Info: „Darstellung: LM Steering Solutions / AgOpenWeb“, pro Gerät
  gemerkt. Aus = heutiges Aussehen.
- **Android/iOS-App-Name und -Symbol** liegen außerhalb von wwwroot. Sie brauchen deine
  Freigabe als Ausnahme (nur `Label`, `ApplicationTitle`, Symboldateien; Paket-ID und Signierung
  bleiben).
- **Farbwelt:** nur die Akzentfarben (`--tui-acc*`, Auswahlfarbe `--sel`), je Nacht, Tag und
  Sonne. Warnfarben (Bernstein), Stopp (Ziegelrot), Lenkrichtung links/rechts und alle
  Kartenfarben bleiben, weil sie eine Bedeutung haben.

### Drei Farbwelten (Mockups `images/kit-phase4a/mockup-farbwelt-*.jpg`)
Kontrast (WCAG) gemessen, Ziel ≥ 4,5:1:

| Farbwelt | Nacht | Tag | Sonne | Text auf Panel Nacht / Tag | Schrift auf Akzent Nacht / Tag |
|---|---|---|---|---|---|
| A Petrol (heutige Fork-Farbe) | #22b5ad | #0b6d69 | #003f3d | 6,5 / 5,7 | 6,7 / 6,2 |
| B Pflaume | #c995e0 | #6b2d87 | #4a1660 | 7,0 / 8,3 | 7,9 / 8,9 |
| C Indigo | #93a2ff | #3b47b3 | #26308a | 7,0 / 7,1 | 7,8 / 7,7 |

Abstand zu Herstellerfarben (Farbton grob, keine offiziellen Werte): Grün-Gelb (John Deere),
Grün (Fendt, Krone, Deutz), Lindgrün (Claas), Rot (Case IH, Massey Ferguson, Valtra),
Königsblau + Gelb (New Holland), Orange (Kubota).
- A Petrol: blaugrün, klar weg von Gelbgrün und Grün; am nächsten an Grün-Marken.
- B Pflaume: kein großer Landtechnik-Hersteller nutzt Violett; am deutlichsten eigen.
- C Indigo: violettstichiges Blau; am nächsten an New Holland (Blau), aber ohne Gelb.

Empfehlung: **B Pflaume** (am eigenständigsten, beste Kontraste); A, wenn der heutige Eindruck
bleiben soll.

### Logo / App-Symbol
Eigene Zeichnung: Spuren, die zum Horizont zusammenlaufen, eine Leitlinie und ein Punkt für die
eigene Position; Akzentfarbe als Fläche, weißes Zeichen. Keine Traktor- oder Herstellerform.

### Lizenz
- Damals uneinheitlich: `LICENSE.md` war der Apache-2.0-Text, README und Dateiköpfe nannten eine
  andere Lizenz. Inzwischen geklärt: Upstream hat sich auf die Apache License 2.0 festgelegt
  (#360, #363), und der Fork folgt (siehe `docs/Offene-Punkte.md`, Punkt 6).
- Geplant für Einrichtung → Info: Produktname, Version und Git-Stand, „Basiert auf AgOpenWeb und
  AgOpenGPS (Brian Tee und Mitwirkende)“, Lizenzname, vollständiger Lizenztext in der App
  (offline), Link zum Quellcode des Forks (github.com/MoritzLoibl10/AgOpenWeb) und zum
  upstream-Projekt. Keine fremden Marken im Produktnamen.

## 2. Kurzanleitung – geht ohne Host-Änderung
- Seiten unter Menü → Hilfe, gerendert aus `app.js` (offline, mit der App ausgeliefert).
- Themen: Fahrzeug/Gerät wählen, Spur anlegen, Lenkung ein/aus, Vorgewende, NTRIP/RTK-Status
  verstehen, was tun bei rotem Band.
- Bilder: eigene Strichzeichnungen als eingebettetes SVG (klein, Tag/Nacht-tauglich); wo nötig
  kleine Bildschirmfotos als PNG unter `icons/` (jedes macht die APK etwas größer).
- Die heutigen Hilfe-Links zeigen auf das upstream-Repo; sie würden auf den Fork zeigen
  (upstream bleibt als „Basiert auf“ genannt).

## 3. Diagnose-Export – geht ohne Host-Änderung, mit Grenzen
- Ein Knopf „Diagnose für Support“ unter Einrichtung nutzt den vorhandenen Befehl
  `app.bugReport`. Der Client schreibt eine Zusammenfassung in die Beschreibung; der Host
  legt sie als `user_notes.txt` ins ZIP. Herunterladen wie heute über den System-Browser.
- Zusammenfassung vom Client: Version und Git-Stand, aktives Fahrzeug/Gerät mit Werten,
  NTRIP-Status samt Caster-Antwort (so weit sie im Status steht), Fix-Qualität, Satelliten,
  Korrekturalter, die letzten Logzeilen.
- Was der Host ohnehin ins ZIP legt: Systeminfo, Einstellungen (Passwörter, API-Schlüssel,
  NTRIP-Benutzername geschwärzt), aktive Fahrzeug-/Gerätewerte (feste Liste, ohne Passwort),
  Laufzeitzustand, das komplette Log, RTCM-Bericht, 5 Minuten GPS-Daten, den offenen Schlag
  samt Bearbeitung.
- **Passwörter:** Der Client bekommt die NTRIP-Passwörter für den Profil-Editor; die
  Zusammenfassung nimmt sie nie auf und prüft zusätzlich, dass kein Passwort-Text darin
  vorkommt. Im Host-ZIP sind laut Code keine NTRIP-Profile und keine Passwörter (nicht auf
  echten Daten getestet).
- **Grenzen ohne Host-Änderung:** Das ZIP enthält immer den offenen Schlag und GPS-Positionen
  (Datenschutz beim Kunden erwähnen); die volle Caster-Antwort gibt es nur, solange sie im
  Status oder Log steht.
- Vorschlag Host (optional, nicht gebaut): Option „ohne Schlagdaten“; letzte Caster-Antwort immer
  im RTCM-Bericht.

## 4. Backup der Profile – geht nicht ohne Host-Änderung

Der Vorschlag steht ausführlich in [Vorschlag-Profil-Backup.md](Vorschlag-Profil-Backup.md).
Warum nicht:
- Der Client kennt nur die Werte des **aktiven** Profils und die Kurztexte der anderen; Profil-
  und Schlagdateien kann er nicht lesen.
- Er kann in der App keine Datei speichern (nur vom Host ausgelieferte Dateien landen über den
  System-Browser in Downloads) und keine auswählen (kein Datei-Dialog in den Hüllen).
- Es gibt keinen Befehl, der Profile oder Schläge schreibt (nur Laden, Kopieren, Umbenennen,
  Löschen, `config.set`).

Ohne Code möglich: Ordner per USB kopieren. Auf Android liegen die Daten unter
`Android/data/com.agopenweb.android/files/AgOpenWeb/` (`Vehicles`, `Tools`, `Fields`,
NTRIP-Profile, Einstellungen). Das könnte die Hilfe beschreiben (auf einem echten Tablet
noch nicht geprüft; neuere Android-Versionen schränken Dateimanager ein, am PC über USB geht es
meist).

Vorschlag Host-Änderung (nur Vorschlag, nicht gebaut):
1. Export: Route `GET /backup/<name>.zip` wie `/bugreports/`, packt `Vehicles`, `Tools`,
   `Fields` (NTRIP-Profile nur ohne Passwörter, oder gar nicht).
2. Import aus dem vorhandenen Import-Ordner (`Documents/AgOpenWeb/Import`, wie KML/ISO-XML):
   `backup.list`, `backup.preview|<Datei>` (neuer Frame: je Profil/Schlag „neu“,
   „überschreibt“, „gleich“), `backup.apply|<Datei>`. Vorher legt der Host automatisch ein
   Backup des jetzigen Stands an. Der Client erlaubt den Import nur im Stand, bei Lenkung AUS,
   mit Vorschau; der Host prüft das zusätzlich.

## 5. Entscheidungen und Umsetzung

| Punkt | Entscheidung | Umsetzung |
|---|---|---|
| Farbwelt | B Pflaume | Akzentfarben aus `BRAND` (`app.js`, Abschnitt „Phase 4a“), als `<style id="tb-style">` für `html[data-tb]` |
| Name | „LM Steering Solutions“ (vorher Platzhalter) | `BRAND.name`; Titel, Info-Seite, PWA-Manifest daraus |
| Lizenz | Info-Seite nennt die Lizenz und liefert den Text mit | heute: Apache 2.0, Text aus `LICENSE.md` als `<script type="text/plain">` in `index.html`, offline lesbar unter Einrichtung → Info (bis zur Klärung bei upstream waren es zwei Texte) |
| App-Name, App-Symbol, Paket-ID (Android) | Ausnahme genehmigt, Paket-ID `at.loibl.lenksystem` | `Brand.cs`, `MainActivity.cs`, `BackendService.cs`, `.csproj`, `Resources/drawable/icon.xml`; Signierung und Secrets unverändert |
| PWA-Manifest | aus `BRAND` erzeugen | `<link rel="manifest">` zeigt bei eingeschalteter Darstellung auf ein erzeugtes Manifest (data:-Adresse), Symbole `icons/brand-192.png` / `brand-512.png` |
| Kurzanleitung | bauen | Menü → Hilfe (Kachel „Hilfe“), 7 Themen mit eigenen Zeichnungen; USB-Backup als „nicht auf echtem Tablet geprüft“ markiert |
| Diagnose | bauen, mit Hinweis + Bestätigung | Menü → Einrichtung → „Diagnose für Support“; Hinweis auf Schlag und GPS-Positionen, Knopf „Verstanden, Datei erstellen“ |
| Profil-Backup | noch nicht bauen | Vorschlag in `Vorschlag-Profil-Backup.md` |

### Name ändern
- Web-App: `BRAND.name` in `Shared/AgOpenWeb.RemoteServer/wwwroot/app.js` (einzige Stelle für die
  Oberfläche, Titel und Manifest).
- Android: `Brand.ProductName` in `Platforms/AgOpenWeb.Android/Brand.cs` und `ApplicationTitle` in
  `Platforms/AgOpenWeb.Android/AgOpenWeb.Android.csproj` (MSBuild kann die C#-Konstante nicht lesen).

### Neue Paket-ID: was das für Nutzer heißt
- Die App mit `at.loibl.lenksystem` ist für Android eine neue App. Sie wird **neben** der alten
  (`com.agopenweb.android`) installiert und startet ohne Profile und Schläge.
- Die Daten der alten App liegen unter `Android/data/com.agopenweb.android/files/AgOpenWeb/`. Beim
  Deinstallieren der alten App löscht Android diesen Ordner. Also vorher sichern (USB-Kopie,
  siehe Hilfe) und in `Android/data/at.loibl.lenksystem/files/AgOpenWeb/` zurückkopieren.
- Nicht auf einem echten Tablet geprüft.

### Was die Diagnose enthält
Getestet mit einem NTRIP-Profil mit Benutzer und Passwort: weder Passwort noch Benutzername stehen
im ZIP (`system_info.txt`, `appsettings.json` geschwärzt, `configuration.json`, `runtime_state.json`,
`logs.txt`, `gps_data_log.csv`, `active_profile_name.txt`, `user_notes.txt` mit der Zusammenfassung;
mit offenem Schlag zusätzlich `field/…`, mit NTRIP `ntrip_rtcm.txt`).
