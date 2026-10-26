// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// EamaShape (wwwroot/app.js): ZIP, Shapefile and .prj. Run with `node --test Tests/web/*.test.mjs`.
// Fixtures are synthetic, made by Tools/eama-test-shapefile.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../Shared/AgOpenWeb.RemoteServer/wwwroot/app.js', import.meta.url), 'utf8');
const block = app.slice(app.indexOf('// eama-shape:begin'), app.indexOf('// eama-shape:end'));
const EamaShape = new Function(block + '\nreturn EamaShape;')();
const fx = name => readFileSync(new URL('fixtures/' + name, import.meta.url));
const bytes = name => new Uint8Array(fx(name));

for (const [file, enc] of [['mgi-deflate-1252.zip', 'windows-1252'], ['mgi-stored-utf8.zip', 'utf-8']]) {
  test(`reads ${file}`, async () => {
    const { layers } = await EamaShape.load(bytes(file));
    assert.equal(layers.length, 1);
    const l = layers[0];
    assert.equal(l.name, 'schlaege');
    assert.deepEqual(l.prj, { ok: true, datum: 'MGI', name: 'MGI_Austria_Lambert' });
    assert.equal(l.encoding, enc);
    assert.deepEqual(l.fields.map(f => f.name), ['FS_NR', 'SL_NR', 'SNAR_BEZ', 'FL_HA']);
    assert.deepEqual(l.rows.map(r => r.SNAR_BEZ.value), ['Winterweizen', 'Ölkürbis', 'Weißklee, Grünbrache']);
    assert.equal(l.rows[0].FL_HA.raw, '1.9200'); // as written, not rounded
    assert.equal(l.rows[0].FL_HA.value, 1.92);
    assert.equal(l.rows[1].FS_NR.value, 12);

    assert.equal(l.shapes.length, 3);
    const [a, b, c] = l.shapes;
    assert.equal(a.parts.length, 1); assert.equal(a.parts[0].holes.length, 1);
    assert.equal(a.parts[0].outer.length, 4); // closing point dropped
    const hx = a.parts[0].holes[0].map(p => p[0]);
    assert.deepEqual([Math.min(...hx), Math.max(...hx)], [639050, 639090]);
    assert.equal(b.parts.length, 2); assert.ok(b.parts.every(p => p.holes.length === 0));
    assert.equal(c.parts.length, 1);
    const xs = a.parts[0].outer.map(p => p[0]), ys = a.parts[0].outer.map(p => p[1]);
    assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [639000, 639200, 524000, 524100]);
  });
}

test('ZIP without .prj: layer refused, no shapes', async () => {
  const { layers } = await EamaShape.load(bytes('noprj.zip'));
  assert.equal(layers[0].prj.ok, false); assert.equal(layers[0].prj.err, 'noprj');
  assert.equal(layers[0].shapes.length, 0);
});

test('not a ZIP / damaged ZIP', async () => {
  await assert.rejects(EamaShape.load(new Uint8Array([1, 2, 3, 4])), /zip:notzip/);
  const z = bytes('mgi-deflate-1252.zip'); z[40] ^= 0xff; z[60] ^= 0xff; // inside the first file's data
  await assert.rejects(EamaShape.load(z), /zip:damaged/);
});

const prj = name => EamaShape.parsePrj(fx(name + '.prj').toString('utf8'));
for (const [name, datum] of [['mgi-esri', 'MGI'], ['mgi-gdal', 'MGI'], ['mgi-wkt2', 'MGI'], ['etrs-esri', 'ETRS89'], ['etrs-wkt2', 'ETRS89']])
  test(`.prj accepted: ${name}`, () => { const r = prj(name); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.datum, datum); });
for (const name of ['wgs84', 'utm33n', 'mgi-gk-east', 'mgi-ferro-lambert'])
  test(`.prj refused: ${name}`, () => { const r = prj(name); assert.equal(r.ok, false); assert.equal(r.err, 'prjunsupported'); });
test('.prj unreadable', () => assert.equal(EamaShape.parsePrj('PROJCS["x",').err, 'prjunreadable'));
