// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// AcceptCore (wwwroot/app.js, acceptance:begin/end): the measurements of the acceptance record.
// Runs count only host ticks where the host steers on the line; the statistics; the fitter's
// limits (none means not checked); the steering-off detection; the CSV.
// Run: node --test Tests/web/acceptance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../Shared/AgOpenWeb.RemoteServer/wwwroot/app.js', import.meta.url), 'utf8');
const fill = (k, p) => p ? k.replace(/\{(\w+)\}/g, (m, n) => (n in p ? String(p[n]) : m)) : k;
const A = new Function('tr', 'I18n', app.slice(app.indexOf('// acceptance:begin'), app.indexOf('// acceptance:end')) + '\nreturn AcceptCore;')(fill, { text: k => k });

const tk = (ms, xte, o = {}) => ({ hostMs: ms, crossTrackError: xte, roll: 2, guidanceActive: true, ...o,
  op: { autoSteer: true, moduleNotSteering: false, executing: false, ...o.op } });

test('a run counts only host ticks where the host steers on the line, each once', () => {
  let r = {};
  r = A.sample(r, tk(1, 0.02), false);
  r = A.sample(r, tk(1, 0.02), false);                                        // same tick again
  r = A.sample(r, tk(2, 0.5, { op: { autoSteer: false } }), false);           // not engaged
  r = A.sample(r, tk(3, 0.5, { op: { autoSteer: true, moduleNotSteering: true } }), false);
  r = A.sample(r, tk(4, 0.5, { guidanceActive: false }), false);
  r = A.sample(r, tk(5, 0.5, { op: { autoSteer: true, executing: true } }), false); // in a U-turn: not for straight runs
  r = A.sample(r, tk(6, -0.04), false);
  assert.deepEqual(r.xte, [0.02, -0.04]);
  assert.equal(r.turned, undefined);
  let u = A.sample({}, tk(7, 0.3, { op: { autoSteer: true, executing: true } }), true);
  assert.equal(u.turned, true);
  assert.deepEqual(u.xte, [0.3], 'the U-turn step counts the turn itself');
});

test('statistics: signed mean, maximum of the amount, spread', () => {
  const st = A.stats([0.02, -0.04, 0.02, 0.04]);
  assert.equal(st.n, 4);
  assert.ok(Math.abs(st.mean - 0.01) < 1e-12);
  assert.equal(st.max, 0.04);
  assert.ok(Math.abs(st.sd - Math.sqrt((0.0001 + 0.0025 + 0.0001 + 0.0009) / 4)) < 1e-12);
  assert.equal(A.stats([]), null);
});

test('limits: only the ones the fitter entered are checked; none, no verdict', () => {
  const st = A.stats([0.02, -0.04]);
  assert.equal(A.within(st, {}), null);
  assert.equal(A.within(st, { max: null }), null);
  assert.equal(A.within(st, { max: 0.05 }), true);
  assert.equal(A.within(st, { max: 0.03 }), false);
  assert.equal(A.within(st, { mean: 0.02, sd: 0.02 }), false, 'sd 3 cm > 2 cm');
  assert.equal(A.within(null, { max: 1 }), null);
});

test('steering off: armed while steering, seen when it stops', () => {
  let r = A.off({}, tk(1, 0, { op: { autoSteer: false } }), 100);
  assert.equal(r.armed, undefined, 'not armed before steering is on');
  r = A.off(r, tk(2, 0), 200);
  assert.equal(r.armed, 200);
  r = A.off(r, tk(3, 0), 300);
  assert.equal(r.seenAt, undefined);
  r = A.off(r, tk(4, 0, { op: { autoSteer: false } }), 1700);
  assert.equal(r.seenAt, 1700); assert.equal(r.how, 'off');
  assert.equal(A.off(r, tk(5, 0), 1800), r, 'kept once seen');
  const m = A.off(A.off({}, tk(1, 0), 0), tk(2, 0, { op: { autoSteer: true, moduleNotSteering: true } }), 500);
  assert.equal(m.how, 'module');
});

test('CSV: kit data, one row per step, result, measured, limits, note; values in cm with a comma', () => {
  const rec = { start: new Date(2026, 9, 27, 9, 0).getTime(),
    kit: { customer: 'Huber', tractor: 'Steyr 6125', vehicleProfile: 'Steyr', antennaHeight: 3.1, antennaPivot: 0.5, antennaOffset: 0, wheelbase: 2.6, dual: false, dualHeadingOffset: null },
    steps: { rtk: { res: 'pass', seconds: 42 }, straight: { res: 'pass', xte: [0.02, -0.04], lim: { max: 0.05 }, note: 'gut; trocken' }, offWheel: { res: 'skip' } } };
  const rows = A.csv(rec, { kit: ['k'], steps: ['s'] }).replace(/^﻿/, '').split('\r\n');
  assert.equal(rows[1], 'Huber;Steyr 6125;Steyr;27.10.2026;3.1;0.5;0;2.6;single;');
  assert.equal(rows[4], 'Time to RTK Fix;passed;42 s;;');
  assert.equal(rows[5], 'Straight run with steering;passed;cross-track: mean -1,0 cm, maximum 4,0 cm, spread 3,0 cm (2 values);maximum ≤ 5,0 cm;"gut; trocken"');
  assert.match(rows[9], /^Steering off: overriding at the wheel;skipped;;;$/);
  assert.equal(rows.length, 4 + 7 + 1);
});
