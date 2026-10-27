# Oberflächen-Prüfung (27.10.2026)

**Wie:** `Tools/ui-sweep.mjs` (Playwright) öffnet bei 1024×600 auf Deutsch, im Tag- und Nachtmodus,
jede Seite der linken Leiste mit allen Reitern, jeden Dialog, den Lenk-Assistenten, die Flyouts der
unteren Leiste und die Fork-Blätter (Menü, Ampel-Liste, Ersteinrichtung mit allen Schritten, Arbeit
starten, Arbeitsprotokoll, Abnahmeprotokoll, Info, Hilfe, Prüfstand-Checkliste, Sicherung, Hinweis).
Geprüft: abgeschnittener oder überlaufender Text, sich überdeckende Bedienelemente derselben Ebene,
englische Reste (Text, der ein englischer Schlüssel mit anderer deutscher Übersetzung ist),
Knöpfe unter 44 px, Kontrast nach WCAG (unter 4,5; große Schrift unter 3). Maßstab ist die
Handschuh-Größe (Menü → Darstellung); zum Vergleich auch „Normal“.
Aufruf: `node Tools/ui-sweep.mjs --size 1024x600 --lang de --scale glove` gegen einen laufenden Host.

## Behoben (wwwroot, im jeweils passenden Branch, nach oben gemergt)
| Befund | Ursache | Behebung | Branch |
|---|---|---|---|
| **Hilfe-Übersicht öffnete nicht** (Fehler im Browser) | Hilfeseiten „Vorführmodus“ und „Sofort wirkende Knöpfe“ ohne Bild | Übersicht verträgt Seiten ohne Bild; beide Seiten haben eins | bedienung-1, bedienung-2 |
| Seitenanzeige der Fahransicht lief unter den Weiter-Knopf („Seite 1 von 3“) | fester Platz | „1 / 3“, der Satz im Tooltip | bedienung-1 |
| Spur-Knöpfe im Schlag-Werkzeug abgeschnitten („Hinzufügen“, „Bearbeiten“, „Umbenennen“) | Mindestbreite 64 px | so breit wie der Text, 44 px hoch, Umbruch in zwei Reihen | bedienung-1 |
| Versatz-Kreuz (Offset) in Handschuh-Größe überlappend | Raster 48 px, Knöpfe 64 px | Raster so groß wie die Knöpfe | bedienung-1 |
| Prüfstand-Schritte 40 px hoch | Fork-CSS | 44 px | bedienung-1 |
| Leiste „Arbeit starten“: Text abgeschnitten | Text schrumpfte | schrumpft nicht mehr | bedienung-2 |

Ergebnis danach (Handschuh-Größe, Tag und Nacht): **kein** abgeschnittener Text, **keine**
Überlappung, **kein** Knopf unter 44 px.

## Offen
### Knöpfe unter 44 px in der Größe „Normal“
Rund 410 Fundstellen auf 52 Seiten (vor allem Schließen- und Zurück-Knöpfe 26×26 px, die
Statusleiste 23–38 px hoch, Kippschalter 34 px). In „Groß“ und „Handschuh“ setzt das bestehende
CSS alle auf mindestens 44 px. Vorschlag: für Kunden „Handschuh“ als Vorgabe; ob „Normal“ selbst
größer werden soll, ist eine Gestaltungsfrage (die Statusleiste würde höher).

### Englische Reste
Keine echten. Gemeldet wurde „Module“ (Statusleiste, Netzwerk): im Deutschen dasselbe Wort, und
„Default“ (Name des voreingestellten Fahrzeugprofils, Daten, keine Beschriftung).

### Kontrast unter dem WCAG-Wert (Handschuh-Größe; T = Tag, N = Nacht)
Die Prüfung kennt den Hintergrund nur aus CSS; Text über der Karte (Canvas) misst sie gegen den
Seitenhintergrund, solche Werte (z. B. `#roll-deg`, „A“/„B“ im Dialog) sind daher unsicher.
Nichts davon ist eindeutig genug zum Ändern; die meisten Stellen sind upstream-Farben.

| Verhältnis | Element | Text | Wo |
|---|---|---|---|
| 1.08 | `span.bm-plus` | + | D: boundarymenu |
| 1.11 | `#roll-deg` | 0,0 | N: bench checklist, N: legal notice, N: main screen, N: profile backup |
| 1.22 | `span` | A | N: dlg-latlonab |
| 1.22 | `span` | B | N: dlg-latlonab |
| 1.25 | `#as-modetitle` | Pure Pursuit | D: autosteercfg |
| 1.25 | `span.lblfast` | Schnell | D: autosteercfg |
| 1.55 | `#nt-default` | ★ | D: ntripprofiles |
| 1.78 | `#fb-trk-delete` | Löschen | D: fieldbuilder |
| 1.78 | `#fb-trk-deleteall` | Alle löschen | D: fieldbuilder |
| 2.37 | `#nt-del` | ✕ | D: ntripprofiles |
| 2.65 | `#sb-speed` | 0,0 | D: bench checklist, D: legal notice, D: profile backup |
| 2.83 | `span.lblslow` | Langsam | D: autosteercfg |
| 3.11 | `div.hub-colhdr` | Fahrzeug | D: vehtoolhub |
| 3.11 | `div.hub-colhdr` | Gerät | D: vehtoolhub |
| 3.11 | `span.wz-title` | Assistent Lenkung | D: steer wizard |
| 3.18 | `span.rd-i` | ✓ | D: bench checklist, D: legal notice, D: profile backup, D: ready list, |
| 3.18 | `span.fs1-i` | ✓ | D: first setup, N: first setup |
| 3.43 | `#sw-start` | Start | D: smartwas, N: smartwas |
| 3.55 | `div.s` | Einrichtungs-Assistent | D: steer wizard |
| 3.91 | `span.rd-i` | ✗ | N: bench checklist, N: legal notice, N: main screen, N: profile backup |
| 3.91 | `span.fs1-i` | ✗ | N: first setup |
| 4.19 | `span.bp-statlbl` | Punkte: | D: boundaryplayer |
| 4.19 | `span.bp-statlbl` | Fläche: | D: boundaryplayer |
| 4.19 | `span.nio-x` | .x | D: networkio |
| 4.19 | `div.sw-info` | Mit eingeschalteter Lenkung über 2 | D: smartwas |
| 4.19 | `#fj-empty` | Links einen Schlag wählen, um eine | D: fieldsandjobs |
| 4.19 | `div.as-dirpath` | /tmp/claude-0/-home-user-AgOpenWeb | D: appsettings |
| 4.19 | `#wz-step` | Schritt 1 von 15 | D: steer wizard |
| 4.19 | `span` | Lenkwinkel:0.0° | D: steer wizard |
| 4.19 | `span` | Querneigung:0.0° | D: steer wizard |
| 4.19 | `span` | GPS:RTK Fix | D: steer wizard |
| 4.19 | `span` | Geschwindigkeit:0,0 km/h | D: steer wizard |
| 4.19 | `span` | PWM:0 | D: steer wizard |

### Nicht geprüft
Blätter, die nur mit Daten erscheinen (Abnahme-Schritte mit Messwerten, Arbeitsprotokoll mit
Einträgen, Sicherungs-Vorschau), die VT-Karten (nur mit SharpIsoTerm) und andere Bildschirmgrößen.
