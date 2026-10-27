// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// GeoAT (wwwroot/app.js) against PROJ: run with `node --test Tests/web/`.
// Reference points from Tools/geo-at-refpoints.py (pyproj, same grid file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../../Shared/AgOpenWeb.RemoteServer/wwwroot/', import.meta.url);
const app = readFileSync(new URL('app.js', root), 'utf8');
const block = app.slice(app.indexOf('// geo-at:begin'), app.indexOf('// geo-at:end'));
const fresh = () => new Function(block + '\nreturn GeoAT;')();
const GeoAT = fresh();
const tif = readFileSync(new URL('geo/at_bev_AT_GIS_GRID.tif', root));
const ref = JSON.parse(readFileSync(new URL('geo-at-refpoints.json', import.meta.url), 'utf8'));

const metres = (la1, lo1, la2, lo2) => {
  const dN = (la1 - la2) * 111320, dE = (lo1 - lo2) * 111320 * Math.cos(la1 * Math.PI / 180);
  return Math.hypot(dN, dE);
};

test('shipped grid is the PROJ-data file (SHA-256)', () => {
  const sha = createHash('sha256').update(tif).digest('hex');
  assert.equal(sha, GeoAT.GRID_SHA256);
});

test('fallback without grid is marked', () => {
  const [e, n] = ref.austria.find(r => r[4] === 1);
  assert.equal(GeoAT.toEtrs89(e, n).grid, false); // not loaded yet
});

test('wrong checksum: no crash, Helmert fallback marked grid: false', async () => {
  const geo = fresh();
  const bytes = new Uint8Array(tif);
  bytes[bytes.length - 1] ^= 0xff; // one flipped byte
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal(await geo.load(bytes), false);
    assert.equal(await geo.load(new Uint8Array([1, 2, 3])), false);
    assert.equal(await geo.load(), false); // no server: the fetch fails
  } finally { console.warn = warn; }
  const [e, n, lat, lon] = ref.austria.find(r => r[4] === 1);
  const r = geo.toEtrs89(e, n);
  assert.equal(r.grid, false);
  assert.ok(Number.isFinite(r.lat) && Number.isFinite(r.lon));
  assert.ok(metres(r.lat, r.lon, lat, lon) < 3, 'fallback stays near the grid result');
});

test('matches pyproj: grid inside, Helmert outside; < 0.1 m', async () => {
  assert.equal(await GeoAT.load(new Uint8Array(tif)), true);
  const groups = {
    austria: ref.austria, weinviertel: ref.weinviertel, outside: ref.outside,
    'March/Thaya strip': ref.weinviertel.filter(r => r[4] === 1 && (r[3] >= 16.8 || r[2] >= 48.65)),
  };
  for (const [name, rows] of Object.entries(groups)) {
    let max = 0, onGrid = 0;
    for (const [e, n, lat, lon, grid] of rows) {
      const r = GeoAT.toEtrs89(e, n);
      assert.equal(r.grid, grid === 1, `${name} ${e} ${n}: grid flag`);
      max = Math.max(max, metres(r.lat, r.lon, lat, lon)); onGrid += grid;
    }
    console.log(`${name}: ${rows.length} points (${onGrid} on grid), max deviation ${(max * 1000).toFixed(3)} mm`);
    assert.ok(max < 0.1, `${name}: ${max} m`);
  }
});

// EPSG:3416 → EPSG:4258 with pyproj (projection only, no datum change).
const ETRS_LAMBERT = [
  [130000, 406000, 47.4979197053, 9.7473935348],
  [470000, 490000, 48.3058624909, 14.2771973258],
  [639000, 524000, 48.5706830745, 16.5733621650],
  [663000, 528000, 48.5971727238, 16.9007726523],
  [603000, 313000, 46.6859879293, 15.9880656914],
];
test('ETRS89 / Austria Lambert matches pyproj; not marked approximate', () => {
  for (const [e, n, lat, lon] of ETRS_LAMBERT) {
    const r = GeoAT.etrsLambertToEtrs89(e, n);
    assert.ok(metres(r.lat, r.lon, lat, lon) < 0.001, `${e} ${n}`);
    assert.equal(r.approx, false);
  }
});
