# UI-Audit

Skripte, mit denen die Screenshots und Messwerte in
[docs/UI-UX-Analyse.md](../../docs/UI-UX-Analyse.md) entstanden sind. Sie starten den Host
headless, fahren im Simulator ein festes Szenario ab, machen von jeder Hauptansicht einen
Screenshot und messen:

- **Tippflächen:** Breite × Höhe jedes sichtbaren Bedienelements, das am Mittelpunkt oben liegt
  (`button`, `input`, `select`, `a[href]`, Teilbreiten-Knöpfe).
- **Schriftgrößen:** berechnete `font-size` jedes sichtbaren Textknotens.
- **Kontrast:** WCAG-Verhältnis jedes DOM-Textes gegen die nächste deckende Hintergrundfarbe,
  zugeordnet zu Bereichen (Statusleiste, Teilbreiten, Panels, …). Texte direkt über der Karte
  haben keinen deckenden Hintergrund und fehlen deshalb.
- **Leitlinie:** Kontrast der Leitlinie zur Karte, aus dem Screenshot. Jede Spalte um die
  Bildmitte wird über 24 Zeilen bei 42 % der Bildhöhe gemittelt (zwischen den Anzeigen oben und dem
  Fahrzeug); Hintergrund ist der Median, Leitlinie die Spalte, die
  sich am stärksten abhebt. Gemessen in der Heading-Up-Ansicht, in der die Linie senkrecht steht.
- **Fahrwerte:** Schriftgröße der Werte, die man beim Fahren abliest (Statusleiste,
  Querabweichung, Lichtbalken-Text, HUDs, Teilbreiten, Beschriftung der Schnellzugriffe, Module;
  Liste `DRIVE_READOUTS` in `lib.js`). Pro Ansicht die kleinste Größe und alle Einträge.
- **Überlappungen:** feste Elemente über der Karte (Leisten, Anzeigen, Module, Kamera-Pad, …;
  Liste `LAYOUT_BOXES` in `lib.js`), die sich in beiden Richtungen um mehr als 4 px schneiden.

> **Nur ohne angeschlossene Module laufen lassen.** Das Szenario schaltet im Simulator
> Teilbreiten-Automatik und AutoSteer ein, und der Host schickt seine Lenk- und
> Maschinenkonfiguration an jedes Modul im Netz. `capture.js` bricht ab, wenn es ein
> AutoSteer- oder Maschinenmodul sieht; trotzdem auf einem Rechner ohne AiO-Board im Netz
> messen.

## Voraussetzungen

- .NET 10 SDK (der Host wird bei Bedarf gebaut)
- Node.js ≥ 18 und Playwright 1.56: `cd Tools/ui-audit && npm install && npx playwright install chromium`
  (wo Playwright global installiert ist, reicht `NODE_PATH=$(npm root -g)`)
- Linux (für `restart-host.sh`; auf anderen Systemen den Host selbst starten, siehe unten)

## Ablauf

```bash
# 1. Host mit leerem Datenordner (neu) starten. Der Ordner wird geleert!
Tools/ui-audit/restart-host.sh /tmp/agopenweb-ui-audit

# 2. Messen. Ergebnis: out/vorher/screens/*.png und out/vorher/metrics.json
cd Tools/ui-audit
node capture.js --out out/vorher

# Weitere Läufe brauchen jeweils einen frisch gestarteten Host, weil das Szenario ein Feld
# anlegt und der Host den Zustand behält.
../../Tools/ui-audit/restart-host.sh
node capture.js --out out/nachher

# 3. Vergleichstabelle (Markdown)
node compare.js out/vorher/metrics.json:Vorher out/nachher/metrics.json:Nachher
```

Der Web-Client ist in den Host eingebettet: nach Änderungen in `wwwroot` den Desktop-Host neu
bauen (`dotnet build Platforms/AgOpenWeb.Desktop/AgOpenWeb.Desktop.csproj`), sonst misst man den
alten Stand. Mit `AGOPENWEB_REPO=<Checkout> restart-host.sh` läuft der Host aus einem anderen
Checkout, etwa einem Feature-Branch, während die Skripte von hier kommen.

Ohne `restart-host.sh`: `AGOPENWEB_DATA=<leerer Ordner> dotnet run --project
Platforms/AgOpenWeb.Desktop/AgOpenWeb.Desktop.csproj -- --headless` und einen älteren Host vorher
beenden, sonst misst man den alten Build auf `:5174`.

## Optionen von `capture.js`

| Option | Bedeutung |
|---|---|
| `--url URL` | Adresse des Hosts, Standard `http://localhost:5174/` |
| `--out DIR` | Ausgabeordner, Standard `out` |
| `--viewport BxH` | Fenstergröße, Standard `1280x800`; Ansicht 17 nutzt immer `1024x600` |
| `--ls key=value` | Eintrag im `localStorage` vor dem Laden setzen (mehrfach möglich), z. B. für Client-Einstellungen wie die UI-Skalierung |
| `CHROMIUM_PATH` (Umgebung) | anderes Chromium statt dem von Playwright |

## Szenario

1. Ohne Feld: Startbild, die acht Panels der linken Leiste, Modul- und GPS-Popup.
2. Feld „Demo-Schlag“ (240 m × 460 m) mit 18 m Vorgewende, 8 Teilbreiten, Auftrag „Audit“,
   A+-Linie bei 8 km/h; Teilbreiten-Automatik, AutoSteer und U-Turn an (nach Zustand im Tick,
   nicht blind umgeschaltet).
3. Fahrbild mit Simulator-Leiste, AB- und Flaggen-Flyout, Tracks-Dialog, Fields and Jobs,
   AutoSteer-Konfiguration, Fahrzeug-Konfiguration.
4. Simulator zurück an den Start und bearbeitete Fläche des Testfelds gelöscht (immer dieselbe
   Stelle, 400 m freie Leitlinie voraus), dann
   Fahrbild Heading-Up ohne Simulator-Leiste, Tag und Nacht, jeweils auch mit simulierter
   Blendung (CSS-Filter `contrast(0.45) brightness(1.45) saturate(0.6)`; nur ein grober Ersatz
   für echtes Sonnenlicht).
5. Querabweichung mit festem Wert: +0,23 m (rechts der Linie, „nach links lenken“) und
   −0,41 m (links, „nach rechts lenken“), Tag und Nacht. Der Simulator lenkt einen Versatz
   innerhalb eines Bildes aus; deshalb setzt ein Testhaken in `lib.js` (`window.__auditXte`)
   den Wert in jedem Tick, nur im Browser des Audits.
6. Nur im Terminal-Layout (Phase 2): Seite 2 per Wischgeste auf der Modulspalte, Seite 3 ohne
   Karte (Tag und Nacht), Menü, Editor für Arbeitsseiten und Schnellzugriff, Einrichtungsmodus.
7. Zweiter Client als Observer, ein 7"-Tablet (1024×600) mit und ohne AutoSteer-Panel (im
   Terminal-Layout zusätzlich Seite ohne Karte, Querabweichung und Menü), zuletzt
   der AutoSteer-Assistent (Start und Schritt mit dem Motortreiber; es wird nichts gespeichert).
   Die AutoSteer-Konfiguration wird zusätzlich auf dem Hardware-Reiter fotografiert.

Im Terminal-Layout ist die linke Leiste im Fahrmodus ausgeblendet. Das Skript öffnet die Panels
dann über die Kachel im Menü (Einrichtungs-Kacheln schalten in den Einrichtungsmodus) und kehrt
danach in den Fahrmodus zurück. Mit `--ls aow.ui.layout=classic` läuft es im klassischen Layout.

Die Namen der Ansichten (`01-start-no-field`, `13-day-driving-clean`, …) sind fest, damit
`compare.js` Läufe vergleichen kann.

## Grenzen

- Headless Chromium mit Software-WebGL (SwiftShader); Bildrate und Kantenglättung weichen von
  einem echten Tablet ab.
- Die physische Größe hängt vom Gerät ab: auf einem 10,1"-Tablet mit 1280×800 CSS-px ist 1 px
  ≈ 0,17 mm.
- Sind Bing-Kacheln nicht erreichbar, zeigt die Karte nur die Standard-Bodentextur.
