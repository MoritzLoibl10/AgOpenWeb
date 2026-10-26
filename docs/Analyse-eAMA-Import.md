# Analyse: Schlaggrenzen aus eAMA / INVEKOS-GIS importieren

Stand Oktober 2026, **nur Analyse, nichts gebaut**. Wartet auf dein OK.

## Kurzfassung
- **eAMA liefert die eigenen Flächen als Shapefile** (ZIP mit `.shp/.shx/.dbf/.prj`). Der Weg führt
  über INVEKOS-GIS → Extras → GIS-Datenexport. Daneben gibt es XML und CSV. Man wählt
  „beantragte Feldstücke“ oder „beantragte Schläge“. **Ein KML- oder GeoJSON-Export ist in keiner
  Quelle belegt.**
- **Koordinatensystem:** Die offenen INVEKOS-Daten der AMA liegen in **EPSG:31287 (MGI / Austria
  Lambert)** vor. Für den eAMA-Shape-Export ist das wahrscheinlich, aber **nicht bestätigt**; die
  `.prj` einer echten Datei klärt es.
- **AgOpenWeb kann das heute nicht direkt.** Importiert werden KML und ISO-XML (TASKDATA), beide
  in WGS84. Es gibt weder einen Shapefile-Leser noch eine Umrechnung aus Lambert.
- **Heute möglich:** Shapefile in QGIS öffnen, je Schlag als KML in WGS84 speichern, in den Ordner
  Import legen und „Aus KML“ wählen. Eine KML mit mehreren Schlägen ergibt allerdings **einen**
  Schlag mit Löchern (siehe unten).
- **Vorschlag:** ein Host-Import „Schläge aus eAMA“:
  1. Shapefile-ZIP lesen und von Lambert nach WGS84 umrechnen.
  2. Liste mit Vorschau und Auswahl.
  3. Je Auswahl ein Schlag.

  Dazu kommt die Option, die Grenze später durch eine mit RTK gefahrene Runde zu ersetzen. Dafür
  ist eine Host-Ausnahme nötig, wie bei Teil 4.

## 1. Was eAMA liefert

| Punkt | Stand | Sicherheit |
|---|---|---|
| Zugang | eAMA mit ID Austria oder Betriebsnummer + PIN → Flächen → INVEKOS-GIS | belegt (mehrere Anleitungen) |
| Export | INVEKOS-GIS → **Extras → GIS-Datenexport** → Format → Exporttyp → „Anfordern“; nach Status „Abgeschlossen“ „Laden“ (ZIP) | belegt, Anleitungen teils von 2015–2019; Menüs können sich geändert haben |
| Formate | **Shapefile**, XML, CSV | belegt; KML/GML/GeoJSON nicht gefunden |
| Exporttypen | „beantragte Feldstücke (flächig)“, „beantragte Schläge“; für ÖDüPlanPlus 2024: „beantragte Schläge inkl. GSTK (XML)“ | belegt |
| Inhalt des Shape-ZIP | `.shp`, `.shx`, `.dbf`, `.prj` | belegt (Anleitung Dritter) |
| Koordinatensystem | Offene INVEKOS-Daten (GeoPackage): EPSG:31287 MGI / Austria Lambert | belegt für Open Data; **für den eAMA-Export an der `.prj` prüfen** |
| Attribute | Feldstücksnummer, Schlagnummer, Nutzung (Schlagnutzungsart), Fläche. Die genauen Spaltennamen sind **nicht bestätigt**; im offenen Datensatz heißen sie vermutlich z. B. `FS_KENNUNG`, `SNAR_BEZEICHNUNG`, `SL_FLAECHE_BRUTTO_HA`. Belegt ist nur `KZ_BIO_OEPUL_JN`. | **an einer echten Datei prüfen** |

**Feldstück oder Schlag?**
- Ein **Feldstück** ist eine zusammenhängende Fläche mit einer Nutzungsart (Acker, Grünland)
  eines Bewirtschafters.
- Ein **Schlag** ist der Teil eines Feldstücks mit einer Kultur. Liegen auf einem Feldstück zwei
  Kulturen, sind es zwei Schläge.
- Zum Lenken ist meist der **Schlag** richtig, weil dort eine Kultur mit einer Arbeitsbreite
  gefahren wird. Als äußere Grenze für Vorgewende und Teilbreiten ist bei einem Schlag pro
  Feldstück beides gleich.
- Eine Anleitung rät für Ackerschlagkarteien zu Feldstücken, die ÖDüPlanPlus-Anleitung 2024 zu
  Schlägen. Der Import sollte **beides** können (siehe offene Fragen).

**Offene INVEKOS-Daten (data.gv.at, INSPIRE):**
- Die AMA veröffentlicht „INVEKOS Schläge Österreich“ und „INVEKOS Feldstücke Österreich“ zweimal
  jährlich (Sommer „JJJJ-1“, Winter „JJJJ-2“) als GeoPackage in EPSG:31287, auch als WMS und
  OGC-API-Features.
- Lizenz laut einer Spiegelung: CC BY 3.0 AT; ältere Stände, das an der Quelle prüfen.
- Die Daten enthalten **keinen Betriebsbezug**, man findet die eigenen Flächen also nur über die
  Lage.
- Für den eigenen Betrieb ist daher der eAMA-Export der richtige Weg. Die offenen Daten taugen als
  Testmaterial und für den Fall „Schlag auf der Karte antippen und übernehmen“.

**Genauigkeit:**
- INVEKOS-Grenzen sind auf Orthofotos digitalisiert. Sie sind für die Förderung gemacht, nicht
  für RTK-Lenkung.
- Abweichungen im Bereich von Dezimetern bis wenigen Metern sind zu erwarten. Das ist eine
  Einschätzung, keine Messung.
- Für Vorgewende und Teilbreitenschaltung an der Grenze reicht das nicht ohne Sicherheitsabstand.
  Daher kommt in Abschnitt 3 die Option „durch RTK-Runde ersetzen“.

## 2. Was AgOpenWeb heute importieren kann

| Quelle | Weg im Programm | Koordinaten | Mehrere Flächen in einer Datei |
|---|---|---|---|
| **KML** | Schläge → „Aus KML“ (`field.fromKml`); Grenze in offenen Schlag (`boundary.importKmlFile`) | WGS84 (Länge, Breite) | **Ein** Schlag. Der Parser liest alle `<coordinates>`-Blöcke: das erste Polygon wird die Außengrenze, alle weiteren werden **Innengrenzen** (Löcher), siehe `MainViewModel.cs` ab Zeile ~4918 und Zeile ~5095–5110. Eine KML mit allen Schlägen des Betriebs ergibt also einen falschen Schlag. |
| **ISO-XML** (TASKDATA) | „Aus ISO-XML“ (`field.fromIsoXml`) | WGS84 | Je Import ein Schlag aus der gewählten Datei; Grenzen aus `PLN` (Typ 1/9 außen) |
| **AgShare** | Cloud-Download | — | je Schlag |
| **AgOpenGPS-Schlagordner** | einmaliger Import beim Öffnen | lokal + Ursprung | je Ordner |

**Nicht vorhanden:**
- Shapefile, GeoPackage und GML;
- Umrechnung aus einem projizierten System (Lambert, UTM);
- Auswahl mehrerer Flächen aus einer Datei.

**Umweg ohne Programmänderung** (könnte als Hilfeseite kommen; auf echtem Tablet nicht geprüft):
1. eAMA-Shape-ZIP in **QGIS** öffnen. QGIS liest die `.prj` und rechnet um.
2. Je Schlag ein Objekt wählen → Exportieren → „Gewählte Objekte speichern als“ → KML,
   KBS **EPSG:4326**.
3. Die KML-Dateien in den Ordner `Import` kopieren, dann je Datei Schläge → „Aus KML“.

Der Umweg ist mühsam (eine Datei pro Schlag), und die Namen muss man selbst vergeben.

## 3. Vorschlag: Import „Schläge aus eAMA“

### 3.1 Ablauf für den Nutzer
1. eAMA → INVEKOS-GIS → GIS-Datenexport → **Shapefile**, „beantragte Schläge“ (oder Feldstücke)
   → ZIP laden.
2. ZIP per USB in den Ordner `Import` kopieren, wie beim Profil-Backup.
3. Einrichtung → **„Schläge aus eAMA“**: Die App listet die ZIPs mit Shapefile.
4. Nach dem Antippen erscheint eine Liste aller Flächen mit Feldstück, Schlag, Nutzung und Fläche
   (Fläche laut Datei und laut berechneter Grenze), dazu eine kleine Kartenskizze. Filter:
   Acker / Grünland / alle, Suche nach Nummer.
5. Haken setzen → **„Als Schläge anlegen“**.
   - Name zum Beispiel „FS 12 / S 2 Winterweizen“, änderbar.
   - Gibt es den Namen schon, wird nachgefragt: überspringen oder als „… (2)“ anlegen. Es wird nie
     überschrieben.
6. Ergebnis: angelegte Schläge mit Außengrenze und Innengrenzen (Löcher aus dem Shapefile). Die
   Quelle wird vermerkt, z. B. „eAMA 2026, Schläge“.

### 3.2 Host (Ausnahme nötig, wie Teil 4)
| Teil | Inhalt |
|---|---|
| `Shared/AgOpenWeb.Services/Import/ShapefileReader.cs` (neu) | Liest `.shp` (Polygon, Typ 5; PolygonZ 15 ohne Z), `.dbf` (Attribute, Codepage aus `.cpg` bzw. LDID, sonst Windows-1252), `.prj` (WKT). Ringe: im Uhrzeigersinn = außen, gegen = Loch (Shapefile-Regel). Mehrteilige Flächen → je Außenring ein Teil. Grenzen für Größe und Anzahl. |
| `Shared/AgOpenWeb.Services/Import/MgiLambert.cs` (neu) | EPSG:31287 → WGS84. Die Projektion ist Lambert Conformal Conic 2SP auf Bessel 1841; dazu kommt die Datumsverschiebung MGI → WGS84 mit 7 Parametern (Genauigkeit etwa 1 m). Eine Gitterlösung wäre genauer, braucht aber Datendateien. Getestet wird gegen Referenzpunkte (z. B. aus QGIS/PROJ). Unbekannte `.prj` wird **abgelehnt** statt geraten. Optional kommen EPSG:31254–31256 (Gauß-Krüger) und 4326 dazu. |
| `Shared/AgOpenWeb.Services/Import/EamaImportService.cs` (neu) | Liste, Vorschau (Felder + Kennzahlen), Anlegen über den vorhandenen Weg zum Schlag-Anlegen (wie der KML-Import: Ursprung, Außengrenze, Innengrenzen). |
| Wiring / Status | Befehle `eama.list`, `eama.preview\|<Datei>`, `eama.create\|<Datei>\t<Indizes>`; der Status geht als JSON in einen App-Info-Zusatz (wie `BackupStatus`). Tier-1 (legt nur neue Schläge an). |
| Tests | Shapefile mit Loch und mehrteiliger Fläche, Umlaute in `.dbf`, Lambert-Punkte gegen Referenz, unbekannte `.prj`, kaputte Datei, Namenskonflikt. |

Den Shapefile-Leser würde ich selbst schreiben (rund 300 Zeilen). Eine Bibliothek wie
NetTopologySuite.IO.Esri und ProjNet ist auch möglich; das ist eine Abwägung zwischen
Abhängigkeit und eigenem Code. Das Format ist einfach und gut dokumentiert.

### 3.3 Grenze später durch RTK-Runde ersetzen
- Im offenen Schlag: **„Grenze mit RTK neu fahren“**. Das nutzt die vorhandene Grenzaufzeichnung
  (`BoundaryRecordingService`), nur mit RTK Fix.
- Nach der Runde vergleicht die App: Flächendifferenz und größter Abstand zwischen alter und neuer
  Grenze. Dazu kommt eine Skizze mit beiden Linien.
- **„Ersetzen“** speichert die eAMA-Grenze vorher als Sicherung (Datei neben dem Schlag) und setzt
  die gefahrene Runde als Außengrenze. Innengrenzen bleiben, mit einem Hinweis, sie ebenfalls zu
  prüfen.
- Vorgewende und Spuren hängen an der Grenze. Nach dem Ersetzen fragt die App deshalb, ob das
  Vorgewende neu gebaut werden soll.
- **Zu prüfen:** ob die vorhandene Aufzeichnung eine Außengrenze schon *ersetzen* kann oder nur
  hinzufügt. Das bestimmt, wie groß die Host-Änderung ist.

### 3.4 Hinweise in der Oberfläche
- „eAMA-Grenzen sind für die Förderung gezeichnet, nicht mit RTK gemessen. Vorgewende und
  Abschaltung an der Grenze erst nach einer RTK-Runde oder mit Abstand nutzen.“
- Schläge mit Quelle eAMA tragen einen kleinen Vermerk, bis die Grenze ersetzt ist.

### 3.5 Aufwand (grob) und Reihenfolge
| Schritt | Inhalt | Host |
|---|---|---|
| A | Hilfeseite „eAMA über QGIS nach KML“ | nein |
| B | Shapefile + Lambert + Import mit Auswahl | ja |
| C | Grenze durch RTK-Runde ersetzen | ja (Umfang hängt von 3.3 ab) |

## 4. Offene Fragen an dich
1. **Feldstücke oder Schläge** als Standard, oder beim Import wählen?
2. Hast du eine **echte eAMA-Export-ZIP**, gern mit verfremdeten Nummern? Damit kann ich
   Spaltennamen, `.prj`, Codepage und Ringrichtung bestätigen, bevor gebaut wird.
3. Eigener Shapefile-Leser oder Bibliothek (NetTopologySuite/ProjNet)?
4. Reihenfolge A → B → C, oder nur A und B?
5. Sollen auch die **offenen INVEKOS-Daten** (Schlag auf der Karte antippen) kommen? Das braucht
   Internet und den OGC-Dienst und wäre ein eigener Schritt.

## Quellen
Mehrere Quellen waren aus dieser Umgebung nicht abrufbar. Die Angaben stammen aus den Suchtreffern
und sind oben nach Sicherheit gekennzeichnet.
- [AMA – Benutzerhandbuch INVEKOS-GIS](https://www.ama.at/formulare-merkblaetter/dokumente/mehrfachantrag-flachen/handbucher-dokumente/benutzerhandbuch-invekos-gis/)
- [LK Salzburg – INVEKOS-GIS Benutzerhandbuch 1.3 (2015)](https://sbg.lko.at/media.php?filename=download%3D/2015.09.07/1441630872611658.pdf&rn=Handbuch+INVEKOS+GIS+Version_1-3.pdf)
- [LK Burgenland – Anleitung eAMA Flächendownload (2019)](https://bgld.lko.at/media.php?filename=download%3D/2019.11.07/1573134767845559.pdf&rn=eAMA+Anleitung+-+Fl%C3%A4chendownload.pdf)
- [Bodenproben OLUA – Anleitung Flächendownload eAMA (2023)](https://bodenproben-olua.at/wp-content/uploads/sites/24/2023/12/anleitung-flaechendownload-eama.pdf)
- [BWSB – Anleitung zum eAMA-Flächendaten-Import (Dezember 2024)](https://www.bwsb.at/mmedia/download/2024.12.02/1733127484148897.pdf)
- [tunen.ai – Shapefiles aus eAMA exportieren](https://www.tunen.ai/shapefiles-de.html)
- [Kurzanleitung: Felder aus eAMA exportieren (Operations Center)](https://docplayer.org/210834000-Kurzanleitung-felder-aus-eama-exportieren-und-ueber-operations-center-auf-das-display-importieren-seite-1-von-13.html)
- [INSPIRE – INVEKOS Schläge Österreich 2025-1](https://geoportal.inspire.gv.at/metadatensuche/inspire/api/records/b2bd27c3-ccd9-4e5a-98ce-28deab1266f5), [2024-1](https://geoportal.inspire.gv.at/metadatensuche/srv/api/records/bbd8ee1b-76a1-451f-88ef-84e9c7a1faaf), [Feldstücke 2022](https://geoportal.inspire.gv.at/metadatensuche/mqZcigHG/api/records/7d636728-bcf3-4f07-9f4a-3fe8ce8c8fce)
- [GitHub wessm/invekos (Lizenzangabe der Spiegelung)](https://github.com/wessm/invekos)
- Code: `MainViewModel.cs` (KML-Parser, `ImportKmlToExistingField`), `MainViewModel.Commands.Fields.cs`
  (`RemoteCreateFromKml`, `RemoteCreateFromIsoXml`), `IsoXml/IsoXmlParserHelpers.cs`.
