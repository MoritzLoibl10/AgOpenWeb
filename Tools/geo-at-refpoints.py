#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Reference points for Tests/web/geo-at.test.mjs: EPSG:31287 -> ETRS89 with PROJ (pyproj),
pinned to the operations GeoAT (app.js) implements:
  inside the BEV grid  "MGI to ETRS89 (5)", hgridshift at_bev_AT_GIS_GRID.tif (2014)
  outside it           "MGI to ETRS89 (1)", 7-parameter Helmert
The grid holds 0/0 outside Austria; PROJ interpolates those zeros (up to ~110 m off), GeoAT treats a
cell with such a corner as outside. Those points expect the Helmert result. Needs tifffile+imagecodecs.
Usage: geo-at-refpoints.py <dir with at_bev_AT_GIS_GRID.tif [and ..._2021_09_28.tif]> > geo-at-refpoints.json
With the 2021 grid present it also prints (stderr) how far 2014 and 2021 differ."""
import json, math, os, sys
import tifffile
from pyproj import Transformer, Geod

grid_dir = sys.argv[1]
LCC = "+proj=lcc +lat_0=47.5 +lon_0=13.3333333333333 +lat_1=49 +lat_2=46 +x_0=400000 +y_0=400000 +ellps=bessel"
HELMERT = ("+step +proj=push +v_3 +step +proj=cart +ellps=bessel +step +proj=helmert +x=577.326 +y=90.129 "
           "+z=463.919 +rx=5.137 +ry=1.474 +rz=5.297 +s=2.4232 +convention=position_vector "
           "+step +inv +proj=cart +ellps=GRS80 +step +proj=pop +v_3")
def grid_op(name):
    return Transformer.from_pipeline(f"+proj=pipeline +step +inv {LCC} +step +proj=hgridshift "
                                     f"+grids={os.path.join(grid_dir, name)} +step +proj=unitconvert +xy_in=rad +xy_out=deg")
g14 = grid_op("at_bev_AT_GIS_GRID.tif")
helm = Transformer.from_pipeline(f"+proj=pipeline +step +inv {LCC} {HELMERT} +step +proj=unitconvert +xy_in=rad +xy_out=deg")
to_lcc = Transformer.from_pipeline(f"+proj=pipeline +step +proj=unitconvert +xy_in=deg +xy_out=rad +step {LCC}")

with tifffile.TiffFile(os.path.join(grid_dir, "at_bev_AT_GIS_GRID.tif")) as t:
    page = t.pages[0]
    band = page.asarray()
    LON0, LAT0 = page.tags["ModelTiepointTag"].value[3:5]
    DLON, DLAT = page.tags["ModelPixelScaleTag"].value[:2]
zero = (band[0] == 0) & (band[1] == 0)
to_mgi = Transformer.from_pipeline(f"+proj=pipeline +step +inv {LCC} +step +proj=unitconvert +xy_in=rad +xy_out=deg")

def in_valid_cell(e, n):
    lon, lat = to_mgi.transform(e, n)
    fx, fy = (lon - LON0) / DLON, (LAT0 - lat) / DLAT
    h, w = zero.shape
    if not (0 <= fx <= w - 1 and 0 <= fy <= h - 1):
        return False
    x, y = min(int(fx), w - 2), min(int(fy), h - 2)
    return not zero[y:y + 2, x:x + 2].any()

def frange(a, b, s):
    n = int(round((b - a) / s))
    return [a + i * s for i in range(n + 1)]

regions = {
    # EPSG area of use of Austria Lambert, 0.1 degree lattice
    "austria": [(la, lo) for la in frange(46.4, 49.0, 0.1) for lo in frange(9.5, 17.2, 0.1)],
    # Weinviertel incl. the March (east) and Thaya (north) border strips, 0.025 degree lattice
    "weinviertel": [(la, lo) for la in frange(48.20, 48.85, 0.025) for lo in frange(15.60, 17.10, 0.025)],
    # Well outside the grid: must use the Helmert fallback
    "outside": [(50.0, 12.0), (45.8, 14.0), (47.0, 8.5), (48.0, 18.0), (49.5, 16.5)],
}
out = {}
for region, pts in regions.items():
    rows = []
    for la, lo in pts:
        e, n = to_lcc.transform(lo, la)  # point positions only; expected values come below
        e, n = round(e, 3), round(n, 3)
        x, y = g14.transform(e, n)
        grid = math.isfinite(x) and math.isfinite(y) and abs(x) < 1e6 and in_valid_cell(e, n)
        if not grid:
            x, y = helm.transform(e, n)
        rows.append([e, n, round(y, 10), round(x, 10), 1 if grid else 0])
    out[region] = rows
json.dump(out, sys.stdout, separators=(",", ":"))

p21 = os.path.join(grid_dir, "at_bev_AT_GIS_GRID_2021_09_28.tif")
if os.path.exists(p21):
    g21, geod = grid_op(os.path.basename(p21)), Geod(ellps="GRS80")
    with tifffile.TiffFile(p21) as t:
        pg = t.pages[0]; b21 = pg.asarray()
        L0, B0 = pg.tags["ModelTiepointTag"].value[3:5]; SX, SY = pg.tags["ModelPixelScaleTag"].value[:2]
    z21 = (b21[0] == 0) & (b21[1] == 0)
    def in_valid_cell21(e, n):  # same rule on the 2021 grid
        lon, lat = to_mgi.transform(e, n)
        x, y = int((lon - L0) / SX), int((B0 - lat) / SY)
        return 0 <= x < z21.shape[1] - 1 and 0 <= y < z21.shape[0] - 1 and not z21[y:y + 2, x:x + 2].any()
    for region in ("austria", "weinviertel"):
        d = []
        for e, n, la, lo, grid in out[region]:
            x, y = g21.transform(e, n)
            if grid and math.isfinite(x) and abs(x) < 1e6 and in_valid_cell21(e, n):
                d.append(geod.inv(lo, la, x, y)[2])
        d.sort()
        print(f"2014 vs 2021 {region}: n={len(d)} median={d[len(d)//2]:.3f} m p95={d[int(len(d)*.95)]:.3f} m max={d[-1]:.3f} m", file=sys.stderr)
