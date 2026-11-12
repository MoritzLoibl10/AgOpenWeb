// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: eAMA import: MGI/Austria Lambert to ETRS89 (GeoAT), the Shapefile reader (EamaShape), the import sheet (TabletEama).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

// ── GeoAT (fork, eAMA import): MGI / Austria Lambert (EPSG:31287) → ETRS89 ──────────────────
// Inside the BEV grid: "MGI to ETRS89 (5)" (EPSG accuracy 0.15 m), NTv2 grid AT_GIS_GRID 2014 as
// PROJ ships it (wwwroot/geo/at_bev_AT_GIS_GRID.tif; BEV, CC BY 4.0; fetched only when an
// import needs it, SHA-256 in GeoAT.GRID_SHA256). Outside it: "MGI to ETRS89 (1)", 7-parameter Helmert, EPSG
// accuracy 1.5 m, also in the grid's zero-filled margin (see shift()); the result then carries
// grid: false and the UI must say so. Same steps as PROJ:
// inverse LCC 2SP on Bessel 1841, then hgridshift (bilinear) or Helmert with height 0.
// Tested against pyproj by Tests/web/geo-at.test.mjs (begin/end markers are read by that test).
// geo-at:begin
const GeoAT = (() => {
  const GRID_SHA256 = '852d58612498f7ef08541e65f25f52f2a7f35f6020fd7e8250f7fa6eaa5ac599';
  const D2R = Math.PI / 180;

  // Austria Lambert (LCC 2SP), on Bessel 1841 for MGI (EPSG:31287) and on GRS80 for ETRS89
  // (EPSG:3416). Easting/northing → latitude/longitude in radians on that ellipsoid.
  const A = 6377397.155, INVF = 299.1528128, E2 = (2 - 1 / INVF) / INVF;
  const LAT0 = 47.5, LON0 = 13 + 20 / 60, LAT1 = 49, LAT2 = 46, FE = 400000, FN = 400000;
  function lambertInverse(a, e2) {
    const e = Math.sqrt(e2);
    const mf = p => Math.cos(p) / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
    const tf = p => { const es = e * Math.sin(p); return Math.tan(Math.PI / 4 - p / 2) / ((1 - es) / (1 + es)) ** (e / 2); };
    const n = (Math.log(mf(LAT1 * D2R)) - Math.log(mf(LAT2 * D2R))) / (Math.log(tf(LAT1 * D2R)) - Math.log(tf(LAT2 * D2R)));
    const f = mf(LAT1 * D2R) / (n * tf(LAT1 * D2R) ** n), rho0 = a * f * tf(LAT0 * D2R) ** n;
    return (east, north) => {
      const dx = east - FE, dy = rho0 - (north - FN);
      const t = (Math.sign(n) * Math.hypot(dx, dy) / (a * f)) ** (1 / n);
      let phi = Math.PI / 2 - 2 * Math.atan(t);
      for (let i = 0; i < 15; i++) {
        const es = e * Math.sin(phi);
        const next = Math.PI / 2 - 2 * Math.atan(t * ((1 - es) / (1 + es)) ** (e / 2));
        if (Math.abs(next - phi) < 1e-14) { phi = next; break; }
        phi = next;
      }
      return [phi, Math.atan2(dx, dy) / n + LON0 * D2R];
    };
  }
  const inverseLambert = lambertInverse(A, E2);
  const GRS80_F = 1 / 298.257222101, inverseLambertEtrs = lambertInverse(6378137, GRS80_F * (2 - GRS80_F));

  // "MGI to ETRS89 (1)": position-vector Helmert, Bessel → GRS80, height 0 on Bessel.
  function helmert(phi, lam) {
    const s = Math.sin(phi), nu = A / Math.sqrt(1 - E2 * s * s);
    const x = nu * Math.cos(phi) * Math.cos(lam), y = nu * Math.cos(phi) * Math.sin(lam), z = nu * (1 - E2) * s;
    const sec = D2R / 3600, rx = 5.137 * sec, ry = 1.474 * sec, rz = 5.297 * sec, k = 1 + 2.4232e-6;
    const X = 577.326 + k * (x - rz * y + ry * z), Y = 90.129 + k * (rz * x + y - rx * z), Z = 463.919 + k * (-ry * x + rx * y + z);
    const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), p = Math.hypot(X, Y);
    let lat = Math.atan2(Z, p * (1 - e2));
    for (let i = 0; i < 10; i++) {
      const sl = Math.sin(lat), next = Math.atan2(Z + e2 * (a / Math.sqrt(1 - e2 * sl * sl)) * sl, p);
      if (Math.abs(next - lat) < 1e-14) { lat = next; break; }
      lat = next;
    }
    return [lat / D2R, Math.atan2(Y, X) / D2R];
  }

  // Minimal GeoTIFF reader for this one file: little-endian, tiled, planar, float32, Adobe
  // deflate, floating-point predictor (3), PixelIsPoint. Anything else is rejected.
  async function readGrid(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint16(0, false) !== 0x4949 || dv.getUint16(2, true) !== 42) throw new Error('grid: not a little-endian TIFF');
    const ifd = dv.getUint32(4, true), tags = {};
    const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 12: 8, 16: 8 };
    for (let i = 0, cnt = dv.getUint16(ifd, true); i < cnt; i++) {
      const o = ifd + 2 + i * 12, tag = dv.getUint16(o, true), type = dv.getUint16(o + 2, true), count = dv.getUint32(o + 4, true);
      const sz = SIZE[type]; if (!sz) continue;
      const at = sz * count > 4 ? dv.getUint32(o + 8, true) : o + 8, vals = [];
      for (let j = 0; j < count && type !== 2; j++) {
        const p = at + j * sz;
        vals.push(type === 3 ? dv.getUint16(p, true) : type === 4 ? dv.getUint32(p, true) : type === 12 ? dv.getFloat64(p, true) : type === 16 ? Number(dv.getBigUint64(p, true)) : dv.getUint8(p));
      }
      tags[tag] = vals;
    }
    const v = t => (tags[t] || [])[0];
    const w = v(256), h = v(257), tw = v(322), th = v(323), offs = tags[324], lens = tags[325];
    if (v(259) !== 8 || v(317) !== 3 || v(284) !== 2 || v(277) !== 2 || (tags[258] || []).some(b => b !== 32)
        || (tags[339] || []).some(f => f !== 3) || !offs || offs.length !== lens.length) throw new Error('grid: unsupported TIFF layout');
    const keys = tags[34735] || [];
    for (let i = 4; i < keys.length; i += 4) if (keys[i] === 1025 && keys[i + 3] !== 2) throw new Error('grid: not PixelIsPoint');
    const scale = tags[33550], tie = tags[33922];
    const across = Math.ceil(w / tw), down = Math.ceil(h / th), perPlane = across * down;
    const planes = [new Float32Array(w * h), new Float32Array(w * h)];
    for (let k = 0; k < offs.length; k++) {
      const plane = Math.floor(k / perPlane), tx = (k % perPlane) % across, ty = Math.floor((k % perPlane) / across);
      const z = new Uint8Array(await new Response(new Blob([bytes.subarray(offs[k], offs[k] + lens[k])]).stream()
        .pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
      const rowBytes = tw * 4, out = new DataView(new ArrayBuffer(rowBytes));
      for (let r = 0; r < th; r++) {
        const row = z.subarray(r * rowBytes, (r + 1) * rowBytes);
        for (let i = 1; i < rowBytes; i++) row[i] = (row[i] + row[i - 1]) & 0xff; // undo byte differencing
        for (let i = 0; i < tw; i++) for (let b = 0; b < 4; b++) out.setUint8(i * 4 + b, row[b * tw + i]); // MSB-first byte planes
        const gy = ty * th + r; if (gy >= h) break;
        for (let i = 0; i < tw; i++) { const gx = tx * tw + i; if (gx < w) planes[plane][gy * w + gx] = out.getFloat32(i * 4, false); }
      }
    }
    // Band 0 latitude offset, band 1 longitude offset (positive east), both arc-seconds.
    return { w, h, lon0: tie[3], lat0: tie[4], dlon: scale[0], dlat: scale[1], dLat: planes[0], dLon: planes[1] };
  }

  let grid = null, loading = null;
  async function sha256Hex(bytes) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fetches and decodes the grid once (bytes may be passed in instead). Resolves to true, or
  // false when it is missing, damaged or its checksum does not match; then every point uses the
  // Helmert fallback, marked grid: false. A failed load is retried on the next call.
  function load(bytes) {
    if (grid) return Promise.resolve(true);
    if (!loading) loading = (async () => {
      try {
        if (!bytes) {
          const res = await fetch('/geo/at_bev_AT_GIS_GRID.tif');
          if (!res.ok) throw new Error('grid: HTTP ' + res.status);
          bytes = await res.arrayBuffer();
        }
        const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        if (await sha256Hex(buf) !== GRID_SHA256) throw new Error('grid: checksum mismatch');
        grid = await readGrid(buf);
        return true;
      } catch (e) { console.warn('GeoAT:', e.message); loading = null; return false; }
    })();
    return loading;
  }

  // Bilinear grid shift at an MGI position (degrees), or null outside the grid.
  function shift(latDeg, lonDeg) {
    if (!grid) return null;
    const fx = (lonDeg - grid.lon0) / grid.dlon, fy = (grid.lat0 - latDeg) / grid.dlat;
    if (!(fx >= 0 && fy >= 0 && fx <= grid.w - 1 && fy <= grid.h - 1)) return null;
    const x = Math.min(Math.floor(fx), grid.w - 2), y = Math.min(Math.floor(fy), grid.h - 2), u = fx - x, t = fy - y;
    const at = (b, i, j) => b[(y + j) * grid.w + x + i];
    // Outside Austria the grid holds 0/0 instead of no-data (the real shift is about 110 m
    // everywhere). PROJ interpolates those zeros; a cell with such a corner counts as outside.
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) if (at(grid.dLat, i, j) === 0 && at(grid.dLon, i, j) === 0) return null;
    const bil = b => (1 - u) * (1 - t) * at(b, 0, 0) + u * (1 - t) * at(b, 1, 0) + (1 - u) * t * at(b, 0, 1) + u * t * at(b, 1, 1);
    const sLat = bil(grid.dLat), sLon = bil(grid.dLon);
    return Number.isFinite(sLat) && Number.isFinite(sLon) ? [sLat / 3600, sLon / 3600] : null;
  }

  // EPSG:31287 easting/northing (m) → ETRS89 { lat, lon } in degrees. approx: true (grid: false)
  // means the 1.5 m Helmert fallback was used (outside the grid, or grid not loaded).
  function toEtrs89(e, n) {
    const [phi, lam] = inverseLambert(e, n);
    const s = shift(phi / D2R, lam / D2R);
    if (s) return { lat: phi / D2R + s[0], lon: lam / D2R + s[1], grid: true, approx: false };
    const [lat, lon] = helmert(phi, lam);
    return { lat, lon, grid: false, approx: true };
  }
  // EPSG:3416 (ETRS89 / Austria Lambert): projection only, no datum change.
  function etrsLambertToEtrs89(e, n) {
    const [phi, lam] = inverseLambertEtrs(e, n);
    return { lat: phi / D2R, lon: lam / D2R, grid: false, approx: false };
  }

  return { load, toEtrs89, etrsLambertToEtrs89, GRID_SHA256 };
})();
// geo-at:end

// ── EamaShape (fork, eAMA import): ZIP + Shapefile + .prj, all in the client ──────────────
// ZIP: methods stored (0) and deflate (8), no encryption, no ZIP64. Shapefile: Polygon (5),
// PolygonZ (15), PolygonM (25); Z/M are ignored. Rings per the Shapefile rule: clockwise = outer,
// counter-clockwise = hole, each hole goes to the smallest outer ring that contains it. .dbf text
// in the .cpg codepage, else from the language driver byte, else Windows-1252. Numbers keep the
// text as written (`raw`) and are not rounded. The .prj WKT is parsed: MGI / Austria Lambert
// and ETRS89 / Austria Lambert are accepted, everything else is refused with a reason.
// Tested by Tests/web/eama-shape.test.mjs (begin/end markers are read by that test).
// eama-shape:begin
const EamaShape = (() => {
  const LIMIT = 200 * 1024 * 1024; // uncompressed bytes per file

  // --- ZIP --------------------------------------------------------------------------------------
  async function inflateRaw(data) {
    return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  }
  // → [{ name, method, size, read() }]; throws Error('zip:<code>').
  function readZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('zip:notzip');
    const count = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
    if (count === 0xffff || cdOff === 0xffffffff) throw new Error('zip:zip64');
    const out = [];
    for (let i = 0, p = cdOff; i < count; i++) {
      if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip:damaged');
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const nb = bytes.subarray(p + 46, p + 46 + nlen);
      const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'windows-1252').decode(nb);
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      out.push({ name, method, size, async read() {
        if (flags & 1) throw new Error('zip:encrypted');
        if (method !== 0 && method !== 8) throw new Error('zip:method');
        if (size > LIMIT) throw new Error('zip:toolarge');
        if (local + 30 > bytes.length || dv.getUint32(local, true) !== 0x04034b50) throw new Error('zip:damaged');
        const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
        const data = bytes.subarray(start, start + csize);
        if (data.length !== csize) throw new Error('zip:damaged');
        let r;
        try { r = method === 0 ? data : await inflateRaw(data); } catch (_) { throw new Error('zip:damaged'); }
        if (r.length !== size) throw new Error('zip:damaged');
        return r;
      } });
    }
    return out;
  }

  // --- .prj (WKT 1 and WKT 2) -----------------------------------------------------------------
  function parseWkt(text) {
    let i = 0;
    const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
    function node() {
      ws(); const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i)); if (!m) throw new Error('wkt');
      i += m[0].length; ws();
      const open = text[i]; if (open !== '[' && open !== '(') throw new Error('wkt');
      const close = open === '[' ? ']' : ')', args = []; i++;
      for (;;) {
        ws();
        if (text[i] === '"') { let s = ''; i++; for (;;) { if (i >= text.length) throw new Error('wkt'); if (text[i] === '"') { if (text[i + 1] === '"') { s += '"'; i += 2; continue; } i++; break; } s += text[i++]; } args.push(s); }
        else if (/[-+0-9.]/.test(text[i])) { const n = /^[-+]?[0-9.]+(?:[eE][-+]?\d+)?/.exec(text.slice(i))[0]; i += n.length; args.push(Number(n)); }
        else if (/^[A-Za-z_][A-Za-z0-9_]*\s*[\],)]/.test(text.slice(i))) { const w = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i))[0]; i += w.length; args.push({ enum: w }); } // WKT 2: north, Cartesian
        else args.push(node());
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === close) { i++; break; }
        throw new Error('wkt');
      }
      return { key: m[0].toUpperCase(), args };
    }
    const root = node(); ws();
    if (i !== text.length) throw new Error('wkt');
    return root;
  }
  const kids = (n, ...keys) => n.args.filter(a => typeof a === 'object' && keys.includes(a.key));
  const kid = (n, ...keys) => kids(n, ...keys)[0];
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const PARAM = {
    falseeasting: 'fe', eastingatfalseorigin: 'fe', falsenorthing: 'fn', northingatfalseorigin: 'fn',
    centralmeridian: 'lon0', longitudeoforigin: 'lon0', longitudeoffalseorigin: 'lon0',
    standardparallel1: 'lat1', latitudeof1ststandardparallel: 'lat1',
    standardparallel2: 'lat2', latitudeof2ndstandardparallel: 'lat2',
    latitudeoforigin: 'lat0', latitudeoffalseorigin: 'lat0', scalefactor: 'k',
  };
  const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;
  // → { ok: true, datum: 'MGI'|'ETRS89', name } or { ok: false, err: 'prjunreadable'|'prjunsupported', name, why }
  function parsePrj(text) {
    let root;
    try { root = parseWkt(String(text).replace(/^﻿/, '').trim()); } catch (_) { return { ok: false, err: 'prjunreadable', name: '', why: 'WKT' }; }
    const name = typeof root.args[0] === 'string' ? root.args[0] : '';
    const no = why => ({ ok: false, err: 'prjunsupported', name, why });
    if (!['PROJCS', 'PROJCRS', 'PROJECTEDCRS'].includes(root.key)) return no('not projected');
    const geo = kid(root, 'GEOGCS', 'BASEGEOGCRS', 'BASEGEODCRS', 'GEOGCRS', 'GEODCRS');
    const datum = geo && kid(geo, 'DATUM', 'GEODETICDATUM', 'TRF', 'ENSEMBLE', 'DATUMENSEMBLE');
    const ell = datum && kid(datum, 'SPHEROID', 'ELLIPSOID');
    if (!geo || !datum || !ell) return no('no datum');
    const dname = norm(datum.args[0]), a = ell.args[1], invf = ell.args[2];
    const pm = kid(geo, 'PRIMEM', 'PRIMEMERIDIAN');
    if (pm && !near(pm.args[1], 0, 1e-12)) return no('prime meridian');
    let d = '';
    if (near(a, 6377397.155, 1e-3) && near(invf, 299.1528128, 1e-6) && /mgi|militargeographische/.test(dname) && !/1901|balkan/.test(dname)) d = 'MGI';
    else if (near(a, 6378137, 1e-3) && near(invf, 298.257222101, 1e-6) && /etrs|europeanterrestrial/.test(dname)) d = 'ETRS89';
    if (!d) return no('datum ' + datum.args[0]);
    const method = kid(root, 'PROJECTION') || kid(kid(root, 'CONVERSION') || { args: [] }, 'METHOD');
    const mname = method ? norm(method.args[0]) : '';
    if (!/lambert(conformalconic|conicconformal)/.test(mname) || /1sp/.test(mname)) return no('projection ' + (method ? method.args[0] : '?'));
    const p = {};
    for (const n of [...kids(root, 'PARAMETER'), ...kids(kid(root, 'CONVERSION') || { args: [] }, 'PARAMETER')]) {
      const k = PARAM[norm(n.args[0])]; if (!k) return no('parameter ' + n.args[0]);
      const au = kid(n, 'ANGLEUNIT'); // WKT 2 may give each angle its own unit
      if (au && k !== 'fe' && k !== 'fn' && k !== 'k' && !near(au.args[1], Math.PI / 180, 1e-15)) return no('angle unit ' + au.args[0]);
      const lu = kid(n, 'LENGTHUNIT');
      if (lu && !near(lu.args[1], 1, 1e-12)) return no('unit ' + lu.args[0]);
      p[k] = n.args[1];
    }
    const pars = [p.lat1, p.lat2].sort((x, y) => x - y);
    if (!(near(p.fe, 400000, 1e-3) && near(p.fn, 400000, 1e-3) && near(p.lon0, 13 + 20 / 60, 1e-7) && near(p.lat0, 47.5, 1e-7)
        && near(pars[0], 46, 1e-7) && near(pars[1], 49, 1e-7) && (p.k === undefined || near(p.k, 1, 1e-12)))) return no('parameters');
    const unit = kid(root, 'UNIT', 'LENGTHUNIT') || kid(kid(root, 'CS') || { args: [] }, 'UNIT', 'LENGTHUNIT')
      || (kids(root, 'AXIS').map(x => kid(x, 'LENGTHUNIT', 'UNIT')).find(Boolean));
    if (!unit || !near(unit.args[1], 1, 1e-12)) return no('unit');
    return { ok: true, datum: d, name };
  }

  // --- .shp ----------------------------------------------------------------------------------------
  const ringArea2 = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[i][0] - r[j][0]) * (r[i][1] + r[j][1]); return s; }; // > 0 clockwise
  function inRing(pt, r) {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++)
      if ((r[i][1] > pt[1]) !== (r[j][1] > pt[1]) && pt[0] < (r[j][0] - r[i][0]) * (pt[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
    return c;
  }
  // → [{ parts: [{ outer: [[x, y]…], holes: [[[x, y]…]…] }] } | null], index = record order
  function parseShp(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 100 || dv.getInt32(0, false) !== 9994) throw new Error('shp:damaged');
    const type = dv.getInt32(32, true);
    if (![0, 5, 15, 25].includes(type)) throw new Error('shp:type');
    const end = Math.min(bytes.length, dv.getInt32(24, false) * 2), out = [];
    for (let p = 100; p + 8 <= end;) {
      const len = dv.getInt32(p + 4, false) * 2, r = p + 8; p = r + len;
      if (p > end || len < 4) throw new Error('shp:damaged');
      const st = dv.getInt32(r, true);
      if (st === 0) { out.push(null); continue; }
      if (![5, 15, 25].includes(st)) throw new Error('shp:type');
      const np = dv.getInt32(r + 36, true), npt = dv.getInt32(r + 40, true), pts = r + 44 + np * 4;
      if (np < 1 || npt < 0 || pts + npt * 16 > p) throw new Error('shp:damaged');
      const rings = [];
      for (let k = 0; k < np; k++) {
        const a = dv.getInt32(r + 44 + k * 4, true), b = k + 1 < np ? dv.getInt32(r + 48 + k * 4, true) : npt;
        if (a < 0 || b > npt || b - a < 4) { if (b - a >= 0 && b - a < 4) continue; throw new Error('shp:damaged'); }
        const ring = [];
        for (let q = a; q < b; q++) ring.push([dv.getFloat64(pts + q * 16, true), dv.getFloat64(pts + q * 16 + 8, true)]);
        const f = ring[0], l = ring[ring.length - 1];
        if (f[0] === l[0] && f[1] === l[1]) ring.pop();
        rings.push(ring);
      }
      const outers = rings.filter(x => ringArea2(x) > 0).map(o => ({ outer: o, holes: [], area: ringArea2(o) }));
      for (const h of rings.filter(x => ringArea2(x) <= 0)) {
        const host = outers.filter(o => inRing(h[0], o.outer)).sort((x, y) => x.area - y.area)[0];
        if (host) host.holes.push(h); else outers.push({ outer: h.slice().reverse(), holes: [], area: -ringArea2(h) }); // stray hole: kept as its own part
      }
      out.push({ parts: outers.map(o => ({ outer: o.outer, holes: o.holes })) });
    }
    return out;
  }

  // --- .dbf ----------------------------------------------------------------------------------------
  const LDID = { 0x01: 'ibm437', 0x02: 'ibm850', 0x03: 'windows-1252', 0x57: 'windows-1252', 0x58: 'windows-1252', 0x64: 'ibm852', 0xc8: 'windows-1250' };
  function encodingOf(cpg, ldid) {
    const c = norm(cpg || '');
    const fromCpg = { utf8: 'utf-8', 65001: 'utf-8', 1252: 'windows-1252', ansi1252: 'windows-1252', cp1252: 'windows-1252', windows1252: 'windows-1252',
      88591: 'iso-8859-1', iso88591: 'iso-8859-1', 1250: 'windows-1250', windows1250: 'windows-1250', 28591: 'iso-8859-1', 885915: 'iso-8859-15', iso885915: 'iso-8859-15' }[c];
    const want = fromCpg || LDID[ldid] || 'windows-1252';
    try { new TextDecoder(want); return want; } catch (_) { return 'windows-1252'; }
  }
  // → { encoding, fields: [{ name, type, len, dec }], rows: [{ <name>: { raw, value } }] }
  function parseDbf(bytes, cpg) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 33) throw new Error('dbf:damaged');
    const n = dv.getUint32(4, true), hlen = dv.getUint16(8, true), rlen = dv.getUint16(10, true);
    const encoding = encodingOf(cpg, bytes[29]), dec = new TextDecoder(encoding);
    const fields = [];
    for (let p = 32, off = 1; p + 32 <= hlen && bytes[p] !== 0x0d; p += 32) {
      const nb = bytes.subarray(p, p + 11), z = nb.indexOf(0);
      const f = { name: dec.decode(z >= 0 ? nb.subarray(0, z) : nb).trim(), type: String.fromCharCode(bytes[p + 11]), len: bytes[p + 16], dec: bytes[p + 17], off };
      off += f.len; fields.push(f);
    }
    if (hlen + n * rlen > bytes.length) throw new Error('dbf:damaged');
    const rows = [];
    for (let i = 0; i < n; i++) {
      const r = hlen + i * rlen, row = {};
      for (const f of fields) {
        const raw = dec.decode(bytes.subarray(r + f.off, r + f.off + f.len)).trim();
        const num = (f.type === 'N' || f.type === 'F') && raw !== '' && !/^\*+$/.test(raw) ? Number(raw) : null;
        row[f.name] = { raw, value: num !== null && Number.isFinite(num) ? num : (f.type === 'N' || f.type === 'F' ? null : raw) };
      }
      rows.push(row);
    }
    return { encoding, fields: fields.map(({ off, ...f }) => f), rows };
  }

  // --- Whole ZIP -----------------------------------------------------------------------------------
  // → { layers: [{ name, prj, encoding, fields, rows, shapes }] } or throws Error('<area>:<code>').
  // A layer without .prj, or with an unsupported one, comes back with prj.ok false and no shapes.
  async function load(bytes) {
    const entries = readZip(bytes);
    const byBase = new Map();
    for (const e of entries) {
      const m = /^(.*)\.(shp|dbf|prj|cpg)$/i.exec(e.name); if (!m || /(^|\/)__MACOSX\//.test(e.name)) continue;
      const k = m[1]; if (!byBase.has(k)) byBase.set(k, {});
      byBase.get(k)[m[2].toLowerCase()] = e;
    }
    const layers = [];
    for (const [base, f] of byBase) {
      if (!f.shp) continue;
      const name = base.split('/').pop();
      if (!f.dbf) throw new Error('dbf:missing');
      const prj = f.prj ? parsePrj(new TextDecoder('utf-8').decode(await f.prj.read())) : { ok: false, err: 'noprj', name: '', why: '' };
      const dbf = parseDbf(await f.dbf.read(), f.cpg ? new TextDecoder('utf-8').decode(await f.cpg.read()).trim() : '');
      const shapes = prj.ok ? parseShp(await f.shp.read()) : [];
      if (prj.ok && shapes.length !== dbf.rows.length) throw new Error('shp:count');
      layers.push({ name, prj, encoding: dbf.encoding, fields: dbf.fields, rows: dbf.rows, shapes });
    }
    if (!layers.length) throw new Error('zip:noshp');
    return { layers };
  }

  // --- Records -------------------------------------------------------------------------------------
  // Columns: provisional guesses until a real eAMA export confirms the names.
  function columns(fields) {
    const find = re => (fields.find(f => re.test(f.name)) || {}).name;
    return {
      fs: find(/^(FS_?(NR|NUMMER|KENNUNG)|FELDSTUECK|FS)$/i) || find(/^FS/i),
      sl: find(/^(SL_?(NR|NUMMER)|SCHLAG_?NR|SCHLAG|SL)$/i),
      use: find(/SNAR|NUTZ|KULTUR|BEZ/i),
      area: find(/FL(AECHE)?.*HA|_HA$|^HA$/i),
    };
  }
  const val = (row, c) => (c && row[c] && row[c].raw) || '';
  const clean = s => s.replace(/[\\/:*?"<>|\t\r\n]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
  // The name a record gets: field and plot number and use, as in the file; else layer + number.
  function recordName(row, c, kind, layerName, i) {
    const bits = kind === 'sl'
      ? [val(row, c.fs) && 'FS ' + val(row, c.fs), val(row, c.sl) && 'S ' + val(row, c.sl)].filter(Boolean).join(' · ') // "/" can't be in a folder name
      : (val(row, c.fs) && 'FS ' + val(row, c.fs));
    return clean([bits, val(row, c.use)].filter(Boolean).join(' ')) || clean(layerName + ' ' + (i + 1));
  }
  // Indices of the records without geometry: a null shape, or no ring with at least 3 points.
  const withoutGeometry = l => (l.shapes || []).flatMap((sh, i) => !sh || !sh.parts.length ? [i] : []);

  return { load, readZip, parsePrj, parseShp, parseDbf, columns, val, clean, recordName, withoutGeometry };
})();
// eama-shape:end

// ── TabletEama (fork): "Fields from eAMA" ─────────────────────────────────────────────────────
// Reads an eAMA Shapefile ZIP picked on this device (EamaShape), converts with GeoAT. All in the
// browser; the host gets the finished rings (field.fromGeo) and creates each field like From KML.
// Also the help for the QGIS → KML route.
const TabletEama = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const STILL_MPS = 0.15;
  const ERR = {
    'zip:notzip': tr('The file is not a readable ZIP file.'),
    'zip:zip64': tr('This ZIP file uses a format the app cannot read (ZIP64, encryption or an unusual compression).'),
    'zip:encrypted': tr('This ZIP file uses a format the app cannot read (ZIP64, encryption or an unusual compression).'),
    'zip:method': tr('This ZIP file uses a format the app cannot read (ZIP64, encryption or an unusual compression).'),
    'zip:damaged': tr('The ZIP file is damaged.'),
    'zip:toolarge': tr('The file is too large.'),
    'zip:noshp': tr('The ZIP file contains no Shapefile (.shp).'),
    'dbf:missing': tr('The Shapefile has no attribute table (.dbf).'),
    'shp:type': tr('The Shapefile contains no areas (polygons).'),
  };
  const DAMAGED = tr('The Shapefile is damaged ({f}).');
  const PRJ = {
    noprj: tr('No coordinate system (.prj) in the ZIP file. Without it nothing is imported.'),
    prjunreadable: tr('The coordinate system (.prj) cannot be read. Nothing is imported.'),
    prjunsupported: tr('Coordinate system not supported: {f}. Supported are MGI / Austria Lambert and ETRS89 / Austria Lambert. Nothing is imported.'),
  };
  const ACCURACY = tr('eAMA boundaries are drawn on aerial photos for the subsidy application, not measured with RTK. Before using automatic U-turns or section control at the boundary, drive the boundary with RTK.');
  const APPROX = tr('Accuracy about 1.5 m');
  const RES = { ok: tr('created'), skip: tr('skipped, name exists'), fail: tr('failed') };
  let st = { busy: false, file: '', err: '', layers: null, grid: null };
  let kind = 'sl', items = [], empty = [], conflict = 'skip', run = null, help = false;

  const { columns, val, clean, recordName } = EamaShape;
  const area2 = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return s / 2; };

  function buildItems() {
    items = []; empty = [];
    for (const l of st.layers || []) {
      if (!l.prj.ok) continue;
      const c = columns(l.fields);
      // Records without geometry are not imported; the summary names them (record number as in
      // the file, and the name the record would have had).
      for (const i of EamaShape.withoutGeometry(l)) empty.push({ layer: l.name, rec: i + 1, name: recordName(l.rows[i] || {}, c, kind, l.name, i) });
      l.shapes.forEach((sh, i) => {
        if (!sh) return;
        const row = l.rows[i];
        sh.parts.forEach((part, j) => {
          let name = recordName(row, c, kind, l.name, i);
          if (sh.parts.length > 1) name += ' ' + T(tr('part')) + ' ' + (j + 1);
          // Shapefile rings: outer clockwise, holes counter-clockwise. The field takes them the
          // KML way round (outer counter-clockwise), so only the order of the points is reversed.
          const conv = r => r.slice().reverse().map(([x, y]) => l.prj.datum === 'MGI' ? GeoAT.toEtrs89(x, y) : GeoAT.etrsLambertToEtrs89(x, y));
          const rings = [conv(part.outer), ...part.holes.map(conv)];
          items.push({
            name, sel: true, rec: i, part: j, parts: sh.parts.length, src: part,
            use: val(row, c.use), fileArea: val(row, c.area), areaM2: area2(part.outer) - part.holes.reduce((s, h) => s + Math.abs(area2(h)), 0),
            rings, approx: rings.some(r => r.some(p => p.approx)), holes: part.holes.length,
          });
        });
      });
    }
  }

  function lockReason() {
    if (connState !== 'connected') return tr('No connection to the guidance computer.');
    if (!lastTick || performance.now() - lastTick.t > 2000) return tr('No current data from the guidance computer.');
    if (!iHoldControl) return tr('Only the device that has control can import.');
    if (tick && tick.op && tick.op.autoSteer) return tr('Steering is on. Switch steering off to import.');
    if (Math.abs(lastTick.speed || 0) > STILL_MPS) return tr('The vehicle is moving. Stop to import.');
    return '';
  }
  const existing = () => new Set(((fieldOps && fieldOps.fields) || []).map(f => String(f.name || f).toLowerCase()));

  // Final names: never overwrite. A name that exists (or repeats in this import) is skipped,
  // or gets " (2)", " (3)" … when that was chosen.
  function plan() {
    const taken = existing(), out = [];
    for (const it of items) {
      if (!it.sel) continue;
      let name = it.name, k = 2;
      if (taken.has(name.toLowerCase())) {
        if (conflict === 'skip') { out.push({ it, name, skip: true }); continue; }
        while (taken.has((name + ' (' + k + ')').toLowerCase())) k++;
        name = name + ' (' + k + ')';
      }
      taken.add(name.toLowerCase()); out.push({ it, name, skip: false });
    }
    return out;
  }

  // Sends one field as ≤ 900-byte commands (the host reads 1 KB frames), then waits until the
  // host has created and opened it.
  async function sendField(name, rings) {
    const enc = new TextEncoder();
    transport.send('field.fromGeo|begin');
    rings.forEach((r, k) => {
      let buf = [];
      const flush = () => { if (buf.length) transport.send('field.fromGeo|ring\t' + k + '\t' + buf.join(';')); buf = []; };
      for (const p of r) {
        const s = p.lat + ',' + p.lon;
        if (enc.encode('field.fromGeo|ring\t' + k + '\t' + buf.concat(s).join(';')).length > 900) flush();
        buf.push(s);
      }
      flush();
    });
    transport.send('field.fromGeo|create\t' + name);
    return waitActive(name);
  }
  async function waitActive(name) {
    const t0 = performance.now();
    while (performance.now() - t0 < 20000) {
      await new Promise(r => setTimeout(r, 250));
      if (fieldOps && (fieldOps.activeField || '') === name && (!name || existing().has(name.toLowerCase()))) return true;
    }
    return false;
  }
  async function create() {
    const todo = plan(), before = (fieldOps && fieldOps.activeField) || '';
    run = { busy: true, i: 0, n: todo.length, res: [], aborted: false, back: '' }; render();
    for (const p of todo) {
      if (p.skip) { run.res.push({ name: p.name, r: 'skip' }); continue; }
      const why = lockReason();
      if (why) { run.res.push({ name: p.name, r: 'fail', why }); run.aborted = true; break; }
      run.i++; render();
      const ok = await sendField(p.name, p.it.rings);
      run.res.push({ name: p.name, r: ok ? 'ok' : 'fail', approx: p.it.approx });
      if (!ok) { run.aborted = true; break; } // the host did not confirm: stop rather than pile up commands
    }
    // Leave the field the operator had open (or none) as it was before the import.
    if (run.res.some(x => x.r === 'ok') && connState === 'connected') {
      transport.send(before ? 'field.openOnly|' + before : 'field.close');
      run.back = (await waitActive(before)) ? '' : (before || '-');
    }
    run.busy = false; render();
  }

  // --- Sheet --------------------------------------------------------------------------------
  const sheet = el('div', 'tui-sheet tb-sheet tbk-sheet');
  sheet.id = 'tui-eama'; sheet.setAttribute('translate', 'no');
  sheet.innerHTML = '<div class="tui-sh-hdr"><span class="t"></span><button class="x">✕</button></div><div class="tui-sh-body"></div>';
  const scrim = el('div', 'tp-scrim');
  const input = el('input'); input.type = 'file'; input.accept = '.zip,application/zip'; input.style.display = 'none';
  document.body.append(scrim, sheet, input);
  for (const n of [sheet, scrim]) n.addEventListener('pointerdown', e => e.stopPropagation());
  const shT = sheet.querySelector('.t'), shB = sheet.querySelector('.tui-sh-body');
  const close = () => { if (run && run.busy) return; sheet.classList.remove('open'); scrim.classList.remove('open'); };
  onTap(sheet.querySelector('.x'), close); onTap(scrim, close);
  const isOpen = () => sheet.classList.contains('open');
  function open() {
    if (typeof lnCloseAll === 'function') lnCloseAll();
    sheet.classList.add('open'); scrim.classList.add('open');
    render();
  }

  input.addEventListener('change', async () => {
    const f = input.files && input.files[0]; input.value = '';
    if (!f) return;
    st = { busy: true, file: f.name, err: '', layers: null, grid: null }; items = []; run = null; render();
    try {
      const { layers } = await EamaShape.load(new Uint8Array(await f.arrayBuffer()));
      const grid = layers.some(l => l.prj.ok && l.prj.datum === 'MGI') ? await GeoAT.load() : null;
      st = { busy: false, file: f.name, err: '', layers, grid };
      buildItems();
    } catch (e) {
      const code = String(e && e.message || e);
      st = { busy: false, file: f.name, err: T(ERR[code] || DAMAGED).replace('{f}', code), layers: null, grid: null };
    }
    render();
  });

  function sketch(src) {
    const all = src.outer.concat(...src.holes);
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const x0 = Math.min(...xs), y1 = Math.max(...ys), sc = 44 / Math.max(Math.max(...xs) - x0, y1 - Math.min(...ys), 1e-9);
    const d = [src.outer, ...src.holes].map(r => 'M' + r.map(p => ((p[0] - x0) * sc + 2).toFixed(1) + ' ' + ((y1 - p[1]) * sc + 2).toFixed(1)).join('L') + 'Z').join('');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 48 48'); svg.setAttribute('width', '48'); svg.setAttribute('height', '48');
    svg.innerHTML = '<path fill-rule="evenodd" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.5"/>';
    svg.firstChild.setAttribute('d', d);
    return svg;
  }

  function render() {
    if (!isOpen()) return;
    shT.textContent = T(tr('Fields from eAMA'));
    const top = shB.scrollTop;
    shB.innerHTML = '';
    const box = el('div', 'tb-box');
    box.appendChild(el('div', '', T(tr('Import the boundaries of your fields from an eAMA Shapefile export (ZIP), straight from this device, e.g. from Downloads.'))));
    box.appendChild(el('div', 'tp-note warn', T(ACCURACY)));
    const row = el('div', 'tb-row');
    const pick = el('button', 'tp-btn pri big', T(tr('Choose ZIP file')));
    pick.disabled = st.busy || !!(run && run.busy);
    onTap(pick, () => input.click());
    row.appendChild(pick);
    if (st.busy) row.appendChild(el('span', 'tp-note', T(tr('Reading the file…'))));
    box.appendChild(row);
    if (st.file) { const fn = el('div', 'tp-note'); fn.textContent = st.file; box.appendChild(fn); }
    if (st.err) box.appendChild(el('div', 'tp-note bad', st.err));
    for (const l of st.layers || []) {
      const lb = el('div', 'tp-note');
      if (!l.prj.ok) { lb.className = 'tp-note bad'; lb.textContent = l.name + ': ' + T(PRJ[l.prj.err]).replace('{f}', l.prj.name || '?'); box.appendChild(lb); continue; }
      lb.textContent = l.name + ' · ' + (l.prj.datum === 'MGI' ? T(st.grid ? tr('Coordinate system: MGI / Austria Lambert, converted with the BEV grid') : tr('Coordinate system: MGI / Austria Lambert')) : T(tr('Coordinate system: ETRS89 / Austria Lambert')))
        + ' · ' + tr('{n} areas', { n: l.shapes.length }) + ' · ' + T(tr('Columns')) + ': ' + l.fields.map(f => f.name).join(', ') + ' · ' + l.encoding;
      box.appendChild(lb);
      if (l.prj.datum === 'MGI' && st.grid === false) box.appendChild(el('div', 'tp-note warn', T(tr('The BEV grid could not be loaded.')) + ' ' + T(APPROX)));
    }
    if (empty.length) {
      const d = el('div', 'tp-note warn');
      d.textContent = tr('{n} records without geometry are not imported: {list}', { n: empty.length,
        list: empty.map(e => tr('no. {r}', { r: e.rec }) + (e.name ? ' (' + e.name + ')' : '')).join(', ') });
      box.appendChild(d);
    }
    shB.appendChild(box);

    if (items.length) {
      const lb = el('div', 'tb-box');
      // Feldstücke / Schläge: provisional; the real export decides which columns name a field.
      const kr = el('div', 'tb-row');
      kr.appendChild(el('span', 'tb-lbl', T(tr('The file contains'))));
      for (const [k, t] of [['sl', tr('Fields (Schläge)')], ['fs', tr('Plots (Feldstücke)')]]) {
        const b = el('button', 'tp-btn' + (kind === k ? ' pri' : ''), T(t));
        b.disabled = !!(run && run.busy);
        onTap(b, () => { kind = k; buildItems(); run = null; render(); });
        kr.appendChild(b);
      }
      lb.appendChild(kr);
      const sr = el('div', 'tb-row');
      const nSel = items.filter(i => i.sel).length;
      const all = el('button', 'tp-btn quiet', nSel === items.length ? T(tr('Select none')) : T(tr('Select all')));
      onTap(all, () => { const on = nSel !== items.length; items.forEach(i => { i.sel = on; }); render(); });
      sr.appendChild(all);
      sr.appendChild(el('span', 'tp-note', tr('{n} of {m} selected', { n: nSel, m: items.length })));
      lb.appendChild(sr);
      const taken = existing(), list = el('div', 'tbk-list');
      items.forEach(it => {
        const r = el('div', 'tbk-it' + (it.sel ? ' on' : ''));
        const ck = el('button', 'tbk-ck', it.sel ? '✓' : '');
        onTap(ck, () => { it.sel = !it.sel; render(); });
        r.appendChild(ck);
        const nm = el('span', 'tbk-nm');
        const inp = el('input', 'tp-in'); inp.value = it.name; inp.setAttribute('translate', 'no'); inp.style.cssText = 'width:100%;text-align:left;font:inherit;font-weight:700';
        inp.addEventListener('change', () => { it.name = clean(inp.value) || it.name; render(); });
        nm.appendChild(inp);
        const info = [it.use, it.fileArea && T(tr('file')) + ' ' + it.fileArea + ' ha', T(tr('boundary')) + ' ' + fmtArea(it.areaM2)];
        if (it.holes) info.push(tr('Inner boundaries: {n}', { n: it.holes }));
        if (it.parts > 1) info.push(tr('area in {n} parts: each part becomes a field', { n: it.parts }));
        nm.appendChild(el('small', '', info.filter(Boolean).join(' · ')));
        if (taken.has(it.name.toLowerCase())) nm.appendChild(el('small', 'tbk-ch', T(tr('A field with this name exists.'))));
        if (it.approx) nm.appendChild(el('small', 'tbk-ch', T(APPROX)));
        r.appendChild(nm);
        r.appendChild(sketch(it.src));
        list.appendChild(r);
      });
      lb.appendChild(list);
      if (items.some(it => it.sel && taken.has(it.name.toLowerCase()))) {
        const cr = el('div', 'tb-row');
        cr.appendChild(el('span', 'tp-note', T(tr('Name exists:'))));
        for (const [k, t] of [['skip', tr('skip')], ['suffix', tr('create as "… (2)"')]]) {
          const b = el('button', 'tp-btn' + (conflict === k ? ' pri' : ''), T(t));
          onTap(b, () => { conflict = k; render(); });
          cr.appendChild(b);
        }
        lb.appendChild(cr);
        lb.appendChild(el('div', 'tp-note', T(tr('Existing fields are never overwritten.'))));
      }
      const why = lockReason();
      const gr = el('div', 'tb-row');
      const go = el('button', 'tp-btn pri big', T(tr('Create as fields')));
      go.disabled = !nSel || !!why || !!(run && run.busy);
      onTap(go, create);
      gr.appendChild(go);
      if (why) gr.appendChild(el('span', 'tp-note warn', T(why)));
      lb.appendChild(gr);
      lb.appendChild(el('div', 'tp-note', T(tr('Each new field is opened once while it is created; afterwards the field open before (or none) is open again.'))));
      if (run) {
        if (run.busy) lb.appendChild(el('div', 'tp-note', tr('Creating field {i} of {n}…', { i: run.i, n: run.n })));
        if (run.aborted) {
          const done = run.res.filter(x => x.r === 'ok').map(x => x.name);
          lb.appendChild(el('div', 'tp-note bad', done.length ? tr('Stopped. Already created: {f}', { f: done.join(', ') }) : T(tr('Stopped. No field was created.'))));
        }
        if (run.back) lb.appendChild(el('div', 'tp-note warn', run.back === '-' ? T(tr('Could not close the last created field.')) : tr('Could not open {f} again.', { f: run.back })));
        for (const x of run.res) {
          const d = el('div', 'tp-note' + (x.r === 'fail' ? ' bad' : ''));
          d.textContent = x.name + ': ' + T(RES[x.r]) + (x.why ? ' – ' + T(x.why) : '') + (x.r === 'ok' && x.approx ? ' · ' + T(APPROX) : '');
          lb.appendChild(d);
        }
      }
      shB.appendChild(lb);
    }

    // Help: the export in eAMA, and the route without this import (QGIS → KML → "From KML")
    const hb = el('div', 'tb-box');
    const ht = el('button', 'tp-btn quiet', (help ? '▾ ' : '▸ ') + T(tr('Help: export from eAMA, or the route via QGIS')));
    onTap(ht, () => { help = !help; render(); });
    hb.appendChild(ht);
    if (help) {
      const ol = el('ol', 'tp-note');
      for (const s of [
        tr('In eAMA: Flächen → INVEKOS-GIS → Extras → GIS-Datenexport. Format "Shapefile", export type "beantragte Schläge" (or "Feldstücke"), then "Anfordern"; when the status says "Abgeschlossen", "Laden" saves the ZIP. The menus may have changed since.'),
        tr('Here: "Choose ZIP file" and pick that ZIP.'),
        tr('Without this import: open the ZIP in QGIS, select one field, Export → Save selected features as → KML with CRS EPSG:4326. Copy the KML into the Import folder and use Fields → From KML. One file per field; a KML with several fields becomes one field with holes.'),
      ]) ol.appendChild(el('li', '', T(s)));
      hb.appendChild(ol);
    }
    hb.appendChild(el('div', 'tp-note', T(tr('Coordinate conversion with the grid AT_GIS_GRID of the BEV (Bundesamt für Eich- und Vermessungswesen), licence CC BY 4.0.'))));
    shB.appendChild(hb);
    shB.scrollTop = top;
  }
  // Lock state and field list change without a tap here; re-render only then, and not while typing.
  setInterval(() => {
    if (!isOpen() || document.activeElement?.closest?.('#tui-eama')) return;
    const key = JSON.stringify([lockReason(), ((fieldOps && fieldOps.fields) || []).map(f => f.name), tuiLang()]);
    if (key !== render.key) { render.key = key; render(); }
  }, 1000);

  // --- Menu tile (setup) --------------------------------------------------------------------
  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>';
  setInterval(() => {
    const m = document.getElementById('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const s = m.querySelector('.tui-tiles.tui-s'); if (!s || m.querySelector('[data-tile="eama"]')) return;
    const t = el('button', 'tui-tile setup'); t.dataset.tile = 'eama'; t.innerHTML = IC + '<span></span>';
    t.querySelector('span').textContent = T(tr('Fields from eAMA'));
    onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) tuiPress(x); open(); });
    s.appendChild(t);
  }, 300);
  return { open };
})();
