// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// TabletReady (wwwroot/app.js, between ready:begin/end): the ready light in every state. The fix
// quality is judged by goodness, never looser than the host's gate (GpsFixQualityValidator:
// number < MinFixQuality is refused); dual antenna and the demo mode included.
// Run: node --test Tests/web/ready.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cut, run, node } from './stubs.mjs';

const block = cut('// ready:begin', '// ready:end');

// The light in a given situation: everything ready unless o says otherwise (objects merge).
function load(o = {}) {
  const made = [];
  const base = {
    statusBar: { gpsOk: true, gpsSentence: 'GGA', fixQuality: 4, fixText: 'RTK Fixed', autoSteerOk: true, imuOk: true },
    tick: { op: { autoSteerAvail: true } }, scene: { hasField: true },
    config: { gps: { isDualGps: false, minFixQuality: 4 } },
    TabletSteerConfirm: { confirmed: true }, TabletDemo: { active: false },
  };
  for (const [k, v] of Object.entries(o)) base[k] = v && typeof v === 'object' && base[k] && typeof base[k] === 'object' ? { ...base[k], ...v } : v;
  const t = run(block + '\nthis.TabletReady = TabletReady;', {
    ...base, document: { createElement: () => { const n = node(); made.push(n); return n; }, body: node(), getElementById: () => null },
  });
  const R = t.ctx.TabletReady;
  return { R, pill: made[0], tick: t.tick, row: k => R.checks().find(c => c[1] === k), level: () => R.level };
}

test('fix quality by goodness: RTK Float is not green when the minimum is RTK Fix', () => {
  const { R } = load();
  assert.equal(R.fixOk(4, 4), true);
  assert.equal(R.fixOk(5, 4), false, 'RTK Float (5) below RTK Fix (4)');
  assert.equal(R.fixOk(2, 4), false);
  assert.equal(R.fixOk(5, 5), true);
  assert.equal(R.fixOk(4, 5), false, 'the host refuses 4 < 5: never looser than the host');
  assert.equal(R.fixOk(2, 2), true);
  assert.equal(R.fixOk(4, 2), true);
  assert.equal(R.fixOk(5, 2), true);
  assert.equal(R.fixOk(1, 2), false);
  assert.equal(R.fixOk(6, 1), false, 'estimated (dead reckoning) is no fix');
  assert.equal(R.fixOk(8, 4), false, 'simulated is no fix');
  assert.equal(R.fixOk(0, 0), false);
  assert.equal(R.fixOk(4, null), true, 'older host: RTK Fix');
  assert.equal(R.fixOk(5, null), false);
});

test('never looser than the host: green only where the host accepts the number too', () => {
  const { R } = load();
  for (let min = 0; min <= 8; min++)
    for (let q = 0; q <= 8; q++)
      if (R.fixOk(q, min)) assert.ok(q >= min, `q ${q} green with minimum ${min}`);
});

test('all set: green', () => {
  const t = load();
  assert.equal(t.level(), 2);
  assert.deepEqual(Array.from(t.R.checks(), c => c[0]), [2, 2, 2, 2, 2]);
});

test('connection: none, or no current data → red with one row', () => {
  for (const o of [{ connState: 'connecting' }, { lastTick: { t: -5000 } }, { lastTick: null }]) {
    const t = load(o);
    assert.equal(t.level(), 0);
    assert.equal(t.R.checks().length, 1);
    assert.equal(t.R.checks()[0][1], 'Connection');
  }
});

test('GPS: simulator yellow, no data red, fix below the minimum red', () => {
  assert.equal(load({ statusBar: { gpsSentence: 'SIM' } }).row('GPS')[0], 1);
  assert.equal(load({ statusBar: { gpsLost: true } }).row('GPS')[0], 0);
  assert.equal(load({ statusBar: { gpsOk: false } }).row('GPS')[0], 0);
  assert.equal(load({ statusBar: { fixQuality: 5, fixText: 'RTK Float' } }).row('GPS')[0], 0);
  assert.equal(load({ statusBar: { fixQuality: 5 }, config: { gps: { minFixQuality: 5 } } }).row('GPS')[0], 2);
  assert.equal(load({ statusBar: { fixQuality: 5 }, config: { gps: { minFixQuality: null } } }).row('GPS')[0], 0, 'older host: RTK Fix');
});

test('steer module, IMU, line', () => {
  assert.equal(load({ statusBar: { autoSteerOk: false } }).level(), 0);
  const noImu = load({ statusBar: { imuOk: false } });
  assert.equal(noImu.row('IMU')[0], 1); assert.equal(noImu.level(), 1);
  assert.equal(load({ statusBar: { imuOk: false, systemData: { imuHeading: 87.5 } } }).row('IMU')[0], 2, 'AiO: IMU heading in PGN 253');
  assert.equal(load({ statusBar: { imuOk: false, systemData: { imuHeading: NaN } } }).row('IMU')[0], 1);
  assert.equal(load({ tick: { op: { autoSteerAvail: false } } }).row('Line')[0], 0);
  assert.equal(load({ scene: { hasField: false } }).row('Line')[0], 0);
});

test('direction: one antenna needs the confirmation; dual antenna needs its heading', () => {
  const single = load({ TabletSteerConfirm: { confirmed: false } });
  assert.equal(single.row('Direction')[0], 1); assert.equal(single.level(), 1);
  const dual = load({ TabletSteerConfirm: { confirmed: false }, config: { gps: { isDualGps: true, minFixQuality: 4 } } });
  assert.deepEqual(Array.from(dual.row('Direction')), [2, 'Direction', 'dual antenna']);
  const missing = load({ TabletSteerConfirm: { confirmed: false }, config: { gps: { isDualGps: true, minFixQuality: 4 } }, statusBar: { dualHeadingMissing: true } });
  assert.equal(missing.row('Direction')[0], 1, 'dual heading missing: not green');
});

test('demo mode: the pill says Demo whatever the checks are', () => {
  const t = load({ TabletDemo: { active: true }, statusBar: { gpsSentence: 'SIM', autoSteerOk: false } });
  t.tick();
  assert.equal(t.pill.dataset.lv, 'demo');
  assert.equal(t.pill.querySelector('.rd-t').textContent, 'Demo');
  const n = load({ statusBar: { autoSteerOk: false } }); n.tick();
  assert.equal(n.pill.dataset.lv, '0');
  assert.equal(n.pill.querySelector('.rd-t').textContent, 'Not ready');
});
