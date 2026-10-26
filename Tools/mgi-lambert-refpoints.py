#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Reference points for MgiAustriaLambertTests: EPSG:31287 -> EPSG:4326 with PROJ, pinned to
"MGI to WGS 84 (3)" (EPSG:1618), the operation MgiAustriaLambert implements. Needs pyproj."""
from pyproj.transformer import TransformerGroup

PLACES = [  # name, approx. WGS84 lat, lon
    ("Bregenz", 47.503, 9.747), ("Feldkirch", 47.238, 9.598), ("Landeck", 47.140, 10.566),
    ("Innsbruck", 47.269, 11.404), ("Lienz", 46.830, 12.769), ("Salzburg", 47.800, 13.045),
    ("Villach", 46.610, 13.855), ("Klagenfurt", 46.624, 14.308), ("Linz", 48.306, 14.286),
    ("Freistadt", 48.511, 14.505), ("Gmuend", 48.769, 14.983), ("Graz", 47.071, 15.439),
    ("Bad Radkersburg", 46.688, 15.988), ("St. Poelten", 48.204, 15.623), ("Wien", 48.208, 16.373),
    ("Eisenstadt", 47.846, 16.527), ("Oberwart", 47.288, 16.203), ("Hollabrunn", 48.563, 16.079),
    ("Laa an der Thaya", 48.719, 16.386), ("Mistelbach", 48.570, 16.573), ("Poysdorf", 48.668, 16.630),
    ("Hohenau an der March", 48.604, 16.904), ("Gaenserndorf", 48.339, 16.721), ("Retz", 48.757, 15.948),
]

grp = TransformerGroup("EPSG:31287", "EPSG:4326", always_xy=True)
inv = next(t for t in grp.transformers if "MGI to WGS 84 (3)" in t.description)
grp_f = TransformerGroup("EPSG:4326", "EPSG:31287", always_xy=True)
fwd = next(t for t in grp_f.transformers if "MGI to WGS 84 (3)" in t.description)

for name, lat, lon in PLACES:
    e, n = fwd.transform(lon, lat)
    e, n = round(e, 3), round(n, 3)
    lo, la = inv.transform(e, n)
    print(f'        new("{name}", {e:.3f}, {n:.3f}, {la:.9f}, {lo:.9f}),')
