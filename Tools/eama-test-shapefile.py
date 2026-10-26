#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Synthetic test data for Tests/web/eama-shape.test.mjs (made up, no real field data):
three parcels near Mistelbach in EPSG:31287 (one with a hole, one in two parts, one with an
umlaut in its crop name) as Shapefile ZIPs, plus .prj texts of several systems from pyproj.
Needs pyshp and pyproj. Usage: eama-test-shapefile.py <output dir>"""
import io, os, sys, zipfile
import shapefile
from pyproj import CRS

out = sys.argv[1]
E0, N0 = 639000.0, 524000.0
sq = lambda x, y, w, h: [(x, y), (x, y + h), (x + w, y + h), (x + w, y), (x, y)]  # clockwise

def build(encoding):
    shp, shx, dbf = io.BytesIO(), io.BytesIO(), io.BytesIO()
    w = shapefile.Writer(shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POLYGON, encoding=encoding)
    w.field("FS_NR", "N", 10, 0); w.field("SL_NR", "N", 5, 0)
    w.field("SNAR_BEZ", "C", 40); w.field("FL_HA", "N", 12, 4)
    w.poly([sq(E0, N0, 200, 100), list(reversed(sq(E0 + 50, N0 + 30, 40, 20)))])  # hole
    w.record(12, 1, "Winterweizen", 1.9200)
    w.poly([sq(E0 + 300, N0, 100, 100), sq(E0 + 450, N0, 50, 100)])  # two parts
    w.record(12, 2, "Ölkürbis", 1.5)
    w.poly([sq(E0, N0 + 200, 150, 80)])
    w.record(13, 1, "Weißklee, Grünbrache", 1.2)
    w.close()
    return shp.getvalue(), dbf.getvalue()

def write_zip(name, method, encoding, cpg, prj):
    shp, dbf = build(encoding)
    with zipfile.ZipFile(os.path.join(out, name), "w", compression=method) as z:
        def add(n, data):
            i = zipfile.ZipInfo(n, date_time=(2026, 1, 1, 0, 0, 0)); i.compress_type = method
            z.writestr(i, data)
        add("export/schlaege.shp", shp); add("export/schlaege.dbf", dbf)
        if prj is not None: add("export/schlaege.prj", prj)
        if cpg is not None: add("export/schlaege.cpg", cpg)

mgi_esri = CRS("EPSG:31287").to_wkt("WKT1_ESRI")
write_zip("mgi-deflate-1252.zip", zipfile.ZIP_DEFLATED, "cp1252", "1252", mgi_esri)
write_zip("mgi-stored-utf8.zip", zipfile.ZIP_STORED, "utf-8", "UTF-8", mgi_esri)
write_zip("noprj.zip", zipfile.ZIP_DEFLATED, "cp1252", None, None)

prj = {
    "mgi-esri": mgi_esri,
    "mgi-gdal": CRS("EPSG:31287").to_wkt("WKT1_GDAL"),
    "mgi-wkt2": CRS("EPSG:31287").to_wkt("WKT2_2019"),
    "etrs-esri": CRS("EPSG:3416").to_wkt("WKT1_ESRI"),
    "etrs-wkt2": CRS("EPSG:3416").to_wkt("WKT2_2019"),
    "wgs84": CRS("EPSG:4326").to_wkt("WKT1_ESRI"),
    "utm33n": CRS("EPSG:32633").to_wkt("WKT1_ESRI"),
    "mgi-gk-east": CRS("EPSG:31256").to_wkt("WKT1_ESRI"),
    "mgi-ferro-lambert": CRS("EPSG:31287").to_wkt("WKT1_ESRI").replace('PRIMEM["Greenwich",0.0]', 'PRIMEM["Ferro",-17.6666666666667]'),
}
for k, v in prj.items():
    with open(os.path.join(out, k + ".prj"), "w", encoding="utf-8") as f:
        f.write(v)
