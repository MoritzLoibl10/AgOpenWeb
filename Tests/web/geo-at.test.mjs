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
const GeoAT = new Function(block + '\nreturn GeoAT;')();
const html = readFileSync(new URL('index.html', root), 'utf8');
const b64 = html.match(/<script type="text\/plain" id="geo-at-gis-grid">([\s\S]*?)<\/script>/)[1];
const ref = JSON.parse(readFileSync(new URL('geo-at-refpoints.json', import.meta.url), 'utf8'));

const metres = (la1, lo1, la2, lo2) => {
  const dN = (la1 - la2) * 111320, dE = (lo1 - lo2) * 111320 * Math.cos(la1 * Math.PI / 180);
  return Math.hypot(dN, dE);
};

test('embedded grid is the PROJ-data file (SHA-256)', () => {
  const sha = createHash('sha256').update(Buffer.from(b64.replace(/\s+/g, ''), 'base64')).digest('hex');
  assert.equal(sha, GeoAT.GRID_SHA256);
});

test('fallback without grid is marked', () => {
  const [e, n] = ref.austria.find(r => r[4] === 1);
  assert.equal(GeoAT.toEtrs89(e, n).grid, false); // not loaded yet
});

test('matches pyproj: grid inside, Helmert outside; < 0.1 m', async () => {
  assert.equal(await GeoAT.load(b64), true);
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
