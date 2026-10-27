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

// --- Edge cases (feature/abnahme, Teil 3): built here, no fixture files needed ----------------
// A .shp of polygon records; a record is null (shape type 0) or a list of rings [[x, y], …].
function shp(records, type = 5) {
  const recs = records.map(r => {
    if (r === null) { const b = new DataView(new ArrayBuffer(4)); b.setInt32(0, 0, true); return b; }
    const npt = r.reduce((s, x) => s + x.length, 0), b = new DataView(new ArrayBuffer(44 + r.length * 4 + npt * 16));
    b.setInt32(0, type, true); b.setInt32(36, r.length, true); b.setInt32(40, npt, true);
    let k = 0; r.forEach((ring, i) => { b.setInt32(44 + i * 4, k, true); k += ring.length; });
    let q = 44 + r.length * 4; for (const ring of r) for (const [x, y] of ring) { b.setFloat64(q, x, true); b.setFloat64(q + 8, y, true); q += 16; }
    return b;
  });
  const len = 100 + recs.reduce((s, b) => s + 8 + b.byteLength, 0), out = new Uint8Array(len), dv = new DataView(out.buffer);
  dv.setInt32(0, 9994, false); dv.setInt32(24, len / 2, false); dv.setInt32(28, 1000, true); dv.setInt32(32, type, true);
  let p = 100;
  recs.forEach((b, i) => { dv.setInt32(p, i + 1, false); dv.setInt32(p + 4, b.byteLength / 2, false); out.set(new Uint8Array(b.buffer), p + 8); p += 8 + b.byteLength; });
  return out;
}
const square = (x, y, s = 100) => [[x, y], [x, y + s], [x + s, y + s], [x + s, y], [x, y]]; // clockwise: an outer ring

test('empty geometry: a null record stays null, a polygon of only degenerate rings has no parts', () => {
  const s = EamaShape.parseShp(shp([null, [[[0, 0], [1, 1], [0, 0]]], [square(0, 0)]]));
  assert.equal(s.length, 3);
  assert.equal(s[0], null);
  assert.deepEqual(s[1].parts, []);
  assert.equal(s[2].parts.length, 1);
});

test('.shp: truncated, wrong file, wrong shape type', () => {
  const good = shp([[square(0, 0)]]);
  assert.throws(() => EamaShape.parseShp(good.subarray(0, 50)), /shp:damaged/);
  assert.throws(() => EamaShape.parseShp(new Uint8Array(120)), /shp:damaged/);
  assert.throws(() => EamaShape.parseShp(shp([[square(0, 0)]], 1)), /shp:type/, 'points');
  const bad = shp([[square(0, 0)]]); new DataView(bad.buffer).setInt32(100 + 8 + 36, 50, true); // 50 parts claimed
  assert.throws(() => EamaShape.parseShp(bad), /shp:damaged/);
});

// A ZIP of stored (uncompressed) files; the reader does not check CRCs, so they are left 0.
function zip(files) {
  const enc = new TextEncoder(), parts = [], cd = [];
  let off = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = enc.encode(name), loc = new Uint8Array(30 + n.length), lv = new DataView(loc.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, n.length, true); loc.set(n, 30);
    const c = new Uint8Array(46 + n.length), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(8, 0x800, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, n.length, true); cv.setUint32(42, off, true); c.set(n, 46);
    parts.push(loc, data); cd.push(c); off += loc.length + data.length;
  }
  const cdLen = cd.reduce((s, c) => s + c.length, 0), e = new Uint8Array(22), ev = new DataView(e.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, cd.length, true); ev.setUint16(10, cd.length, true); ev.setUint32(12, cdLen, true); ev.setUint32(16, off, true);
  const all = [...parts, ...cd, e], out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
  let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}
// A .dbf with one numeric field and n rows.
function dbf(n) {
  const hl = 32 + 32 + 1, rl = 1 + 4, b = new Uint8Array(hl + n * rl + 1), dv = new DataView(b.buffer);
  b[0] = 3; dv.setUint32(4, n, true); dv.setUint16(8, hl, true); dv.setUint16(10, rl, true); b[29] = 0x57;
  b.set(new TextEncoder().encode('FS_NR'), 32); b[32 + 11] = 'N'.charCodeAt(0); b[32 + 16] = 4; b[64] = 0x0d;
  for (let i = 0; i < n; i++) b.set(new TextEncoder().encode(' ' + String(i + 1).padStart(4)), hl + i * rl);
  b[hl + n * rl] = 0x1a;
  return b;
}
const prjMgi = new Uint8Array(fx('mgi-esri.prj'));

test('built ZIP with an empty record: read, the empty one has no shape', async () => {
  const { layers } = await EamaShape.load(zip({ 'a.shp': shp([null, [square(639000, 524000)]]), 'a.dbf': dbf(2), 'a.prj': prjMgi }));
  assert.equal(layers[0].shapes.length, 2);
  assert.equal(layers[0].shapes[0], null);
  assert.equal(layers[0].shapes[1].parts.length, 1);
});

test('wrong .prj in the ZIP: the layer is refused and its shapes are not read', async () => {
  for (const [p, err] of [[fx('wgs84.prj'), 'prjunsupported'], [new TextEncoder().encode(''), 'prjunreadable'], [new TextEncoder().encode('kein WKT'), 'prjunreadable']]) {
    const { layers } = await EamaShape.load(zip({ 'a.shp': new Uint8Array([1, 2, 3]), 'a.dbf': dbf(1), 'a.prj': new Uint8Array(p) }));
    assert.equal(layers[0].prj.ok, false); assert.equal(layers[0].prj.err, err);
    assert.deepEqual(layers[0].shapes, [], 'the broken .shp is not even read');
  }
});

test('broken ZIP: empty, cut short, without .shp, without .dbf, counts that differ', async () => {
  const ok = zip({ 'a.shp': shp([[square(0, 0)]]), 'a.dbf': dbf(1), 'a.prj': prjMgi });
  await assert.rejects(EamaShape.load(new Uint8Array(0)), /zip:notzip/);
  await assert.rejects(EamaShape.load(ok.subarray(0, ok.length - 30)), /zip:(notzip|damaged)/);
  const cut = ok.slice(); new DataView(cut.buffer).setUint32(cut.length - 6, 5, true); // central directory points into the data
  await assert.rejects(EamaShape.load(cut), /zip:damaged/);
  await assert.rejects(EamaShape.load(zip({ 'a.dbf': dbf(1), 'a.prj': prjMgi })), /zip:noshp/);
  await assert.rejects(EamaShape.load(zip({ 'a.shp': shp([[square(0, 0)]]), 'a.prj': prjMgi })), /dbf:missing/);
  await assert.rejects(EamaShape.load(zip({ 'a.shp': shp([[square(0, 0)]]), 'a.dbf': dbf(2), 'a.prj': prjMgi })), /shp:count/);
});

test('records without geometry: found with their number and their name as in the file', async () => {
  const { layers } = await EamaShape.load(zip({ 'a.shp': shp([[square(639000, 524000)], null, [[[0, 0], [1, 1], [0, 0]]]]), 'a.dbf': dbf(3), 'a.prj': prjMgi }));
  const l = layers[0];
  assert.deepEqual(EamaShape.withoutGeometry(l), [1, 2]);
  const c = EamaShape.columns(l.fields);
  assert.equal(c.fs, 'FS_NR');
  assert.deepEqual(EamaShape.withoutGeometry(l).map(i => [i + 1, EamaShape.recordName(l.rows[i], c, 'sl', l.name, i)]), [[2, 'FS 2'], [3, 'FS 3']]);
  assert.equal(EamaShape.recordName({}, {}, 'sl', 'schlaege', 4), 'schlaege 5', 'no columns: layer and number');
});
