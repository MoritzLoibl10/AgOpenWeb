// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// TabletWork (wwwroot/app.js, work:begin/end): "Start work" walks field → track → direction →
// ready light, moves on by itself when the host's state is there, never finishes on a light that
// isn't green, and never switches steering on.
// Run: node --test Tests/web/work.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cut, run } from './stubs.mjs';

const block = cut('// work:begin', '// work:end');

function load(g = {}) {
  const ctx = {
    scene: { hasField: false }, fieldOps: { activeField: '' }, tick: { op: { autoSteerAvail: false }, lineLabel: '' },
    config: { gps: { isDualGps: false } }, statusBar: {},
    TabletSteerConfirm: { confirmed: false, confirm() { this.confirmed = true; } },
    TabletReady: { level: 0 }, TabletTerminal: { mode: 'setup', setMode(m) { this.mode = m; } },
    openFieldsAndJobs() {}, openTracksManager() {}, ...g,
  };
  const t = run(block + '\nthis.W = TabletWork;', ctx);
  return { ...t, W: t.ctx.W, done: () => Array.from(t.ctx.W.steps(), s => s.done) };
}

test('the steps follow the host: field, track, direction, ready light', () => {
  const t = load();
  assert.deepEqual(t.done(), [false, false, false, false]);
  t.ctx.scene = { hasField: true }; t.ctx.fieldOps = { activeField: 'Acker' };
  assert.deepEqual(t.done(), [true, false, false, false]);
  assert.equal(t.W.steps()[0].v, 'Acker');
  t.ctx.tick = { op: { autoSteerAvail: true }, lineLabel: '3L' };
  assert.deepEqual(t.done(), [true, true, false, false]);
  t.ctx.TabletSteerConfirm.confirm();
  assert.deepEqual(t.done(), [true, true, true, false]);
  t.ctx.TabletReady = { level: 2 };
  assert.deepEqual(t.done(), [true, true, true, true]);
});

test('a track without a field does not count', () => {
  const t = load({ tick: { op: { autoSteerAvail: true } } });
  assert.equal(t.W.steps()[1].done, false);
});

test('dual antenna: the direction step is done by the dual heading, not without it', () => {
  assert.equal(load({ config: { gps: { isDualGps: true } } }).W.steps()[2].done, true);
  assert.equal(load({ config: { gps: { isDualGps: true } }, statusBar: { dualHeadingMissing: true } }).W.steps()[2].done, false);
});

test('finish: only on a green light, then the drive view; it sends no command', () => {
  const t = load({ TabletReady: { level: 1 } });
  t.W.start();
  t.W.finish();
  assert.equal(t.ctx.TabletTerminal.mode, 'setup', 'yellow: stays');
  t.ctx.TabletReady = { level: 2 };
  t.W.finish();
  assert.equal(t.ctx.TabletTerminal.mode, 'drive');
  assert.deepEqual(t.sent, [], 'never switches steering (or anything) on');
});
