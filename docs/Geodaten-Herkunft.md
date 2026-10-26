# Geodaten: Herkunft und Prüfsummen

## BEV-Gitter AT_GIS_GRID (2014), MGI → ETRS89
- **Datei:** `wwwroot/geo/at_bev_AT_GIS_GRID.tif`, unverändert, ausgeliefert unter
  `/geo/at_bev_AT_GIS_GRID.tif`; `GeoAT` in `wwwroot/app.js` lädt sie erst beim eAMA-Import.
- **Herkunft:** GitHub-Spiegel von PROJ-data,
  `https://raw.githubusercontent.com/OSGeo/PROJ-data/master/at_bev/at_bev_AT_GIS_GRID.tif`
  (cdn.proj.org war aus der Bauumgebung nicht erreichbar). PROJ hat das NTv2-Gitter des BEV
  in GeoTIFF umgewandelt.
- **Urheber:** BEV – Bundesamt für Eich- und Vermessungswesen.
- **Lizenz:** Creative Commons Namensnennung 4.0 (CC BY 4.0), laut `at_bev_README.txt` in PROJ-data.
- **SHA-256:** `852d58612498f7ef08541e65f25f52f2a7f35f6020fd7e8250f7fa6eaa5ac599` (217 878 Byte).
  Die App prüft die Summe beim Laden; `Tests/web/geo-at.test.mjs` prüft sie ebenfalls.
- **Transformation:** EPSG „MGI to ETRS89 (5)“, Genauigkeit laut EPSG 0,15 m.

## Rückfall außerhalb des Gitters
- EPSG „MGI to ETRS89 (1)“, 7 Parameter, Genauigkeit laut EPSG 1,5 m. Das Ergebnis trägt
  `grid: false`; die Oberfläche zeigt dann „Genauigkeit ca. 1,5 m“.
- Das Gitter enthält außerhalb Österreichs 0/0 statt „keine Daten“. PROJ rechnet mit diesen Nullen
  (am Rand bis etwa 110 m daneben). `GeoAT` wertet jede Zelle mit einer solchen Ecke als außerhalb.

## Prüfung
- `node --test Tests/web/*.test.mjs` gegen pyproj (PROJ 9.8) mit derselben Datei; Referenzpunkte
  erzeugt `Tools/geo-at-refpoints.py`.
