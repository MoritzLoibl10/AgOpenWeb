# Menü-Aufteilung: Alltag, Einstellungen, Service (Review 10.11.2026, Maßnahme 7)

Ziel: Das Menü zeigt beim Öffnen nur, was der Fahrer im Alltag braucht, in großen Kacheln. Alles
andere bleibt erreichbar, aber eine Ebene tiefer: Einstellungen für den Kunden, „Service“ für Monteur
und Support. **Nichts wird entfernt, nur umsortiert**; jede Kachel tut dasselbe wie vorher (gleicher
`data-tile`-Schlüssel, gleiche Aktion, Einrichtungsmodus wie bisher). Neu ist nur die Kachel
„Spuren“ (öffnet den vorhandenen Spur-Manager, `openTracksManager`), weil sie im Alltag gebraucht
wird und bisher nur über die untere Leiste ging.

## Vorher (Stand develop 6705540f)

| Abschnitt | Kacheln |
|---|---|
| Profile oben | Fahrzeug-Karte, Geräte-Karte |
| Im Feld | Arbeit starten, Schläge/Aufträge, Feldwerkzeuge, Arbeitsseiten, Schnellleiste, Hilfe, Arbeitsprotokoll |
| Weitere Feldwerkzeuge | Überspringen, Wendemuster, Fahrgassen, Flächenfarbe, Geräterichtung zurücksetzen |
| Einrichtung | Ersteinrichtung, Fahrzeug & Gerät, Lenkung, Netzwerk & GPS, Werkzeuge & Assistenten, Anzeige & Warnungen, App & Dateien, Sprache, Info, Diagnose für Support, Prüfstand-Checkliste, Sichern und Wiederherstellen, Vorführmodus, Abnahmeprotokoll (#19: Schläge aus eAMA) |

26 Kacheln auf einer Seite (mit #19: 27).

## Nachher

### Ebene 1: Menü (Alltag)

| Abschnitt | Kacheln | Schlüssel |
|---|---|---|
| Profile oben | Fahrzeug-Karte, Geräte-Karte (unverändert) | – |
| Alltag (6 große Kacheln) | Arbeit starten · Schläge/Aufträge · Spuren (neu) · Arbeitsprotokoll · Hilfe · **Einstellungen →** | `work`, `ln-fieldops`, `tracks`, `worklog`, `tb-help`, `page:settings` |
| Feldwerkzeuge (kleiner) | Feldwerkzeuge, Überspringen, Wendemuster, Fahrgassen, Flächenfarbe, Geräterichtung zurücksetzen | `ln-fieldtools`, `#bn-skipcycle`, `#bn-skiptoggle`, `#bn-tram`, Flächenfarbe, Geräterichtung |
| unten, klein und ruhig | **Service →** (Monteur und Support) | `page:service` |

### Ebene 2: Einstellungen (für den Kunden)

| Kachel | Schlüssel | Bisher |
|---|---|---|
| Fahrzeug & Gerät | `ln-vehicle` | Einrichtung |
| Lenkung | `ln-autosteer` | Einrichtung |
| Netzwerk & GPS | `ln-network` | Einrichtung |
| Anzeige & Warnungen | `ln-screenalerts` | Einrichtung |
| Arbeitsseiten | `pages` | Im Feld |
| Schnellleiste | `quick` | Im Feld |
| Sprache · Language | `language` | Einrichtung |
| App & Dateien | `ln-filemenu` | Einrichtung |
| Ersteinrichtung | `setup1` | Einrichtung |
| Sichern und Wiederherstellen | `tbk` | Einrichtung |
| Schläge aus eAMA (#19) | `eama` | Einrichtung |
| Info | `tb-info` | Einrichtung |

### Ebene 2: Service (Monteur und Support)

| Kachel | Schlüssel | Bisher |
|---|---|---|
| Werkzeuge & Assistenten (Kalibrieren, Lenk-Assistent) | `ln-tools` | Einrichtung |
| Prüfstand-Checkliste | `tbn` | Einrichtung |
| Abnahmeprotokoll | `accept` | Einrichtung |
| Diagnose für Support | `tb-diag` | Einrichtung |
| Vorführmodus | `demo` | Einrichtung |

## Regeln

- Ebene 2 hat oben „← Menü“ und ihren Namen als Überschrift; das Menü öffnet immer auf Ebene 1.
- Eine Kachel, die heute in den Einrichtungsmodus schaltet, tut das weiter; „Einstellungen →“ und
  „Service →“ selbst schalten nichts um, sie blättern nur.
- Unbekannte Kacheln (neu, aus einem Modul, das hier nicht steht) landen in „Einstellungen“, damit
  nichts verloren geht.
- Langes Drücken erklärt auch die neuen Einträge („Spuren“, „Einstellungen“, „Service“).
- Prüfwerkzeuge (`ui-sweep --touch`, `steer-off-check`) blättern wie ein Finger zur richtigen Ebene.
- Kurzanleitung und Einbauanleitung nennen die neuen Wege.
