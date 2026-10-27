// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// TabletReady (wwwroot/app.js, between ready:begin/end): the ready light. The fix quality is
// judged by goodness, never looser than the host's gate (GpsFixQualityValidator: number <
// MinFixQuality is refused).
// Run: node --test Tests/web/ready.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../../Shared/AgOpenWeb.RemoteServer/wwwroot/app.js', import.meta.url), 'utf8');
const block = app.slice(app.indexOf('// ready:begin'), app.indexOf('// ready:end'));

export function node() {
  const n = {
    hidden: false, dataset: {}, style: {}, children: [], textContent: '', title: '', innerHTML: '',
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    append(...c) { this.children.push(...c); }, appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    addEventListener() {}, setAttribute() {}, toggleAttribute() {},
  };
  n.querySelector = () => n._q || (n._q = node());
  return n;
}

// The light in a given situation: everything ready unless o says otherwise.
export function load(o = {}) {
  const timers = [], made = [];
  const ctx = {
    I18n: { text: k => k, language: 'en' }, tr: (k, p) => p ? k.replace(/\{(\w+)\}/g, (m, n) => (n in p ? String(p[n]) : m)) : k,
    document: { createElement: () => { const n = node(); made.push(n); return n; }, body: node(), getElementById: () => null },
    performance: { now: () => 1000 },
    setInterval: fn => timers.push(fn),
    connState: 'connected', lastTick: { t: 900 },
    statusBar: { gpsOk: true, gpsSentence: 'GGA', fixQuality: 4, fixText: 'RTK Fixed', autoSteerOk: true, imuOk: true },
    tick: { op: { autoSteerAvail: true } }, scene: { hasField: true },
    config: { gps: { isDualGps: false, minFixQuality: 4 } },
    TabletSteerConfirm: { confirmed: true },
    TabletDemo: { active: false },
  };
  for (const [k, v] of Object.entries(o)) ctx[k] = typeof v === 'object' && v && !Array.isArray(v) && ctx[k] && typeof ctx[k] === 'object' ? { ...ctx[k], ...v } : v;
  vm.createContext(ctx);
  vm.runInContext(block + '\nthis.TabletReady = TabletReady;', ctx);
  return { R: ctx.TabletReady, ctx, pill: made[0], render: () => timers.forEach(f => f()) };
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

test('the GPS row follows the host minimum', () => {
  const gpsRow = o => load(o).R.checks().find(c => c[1] === 'GPS');
  assert.equal(gpsRow()[0], 2);
  assert.equal(gpsRow({ statusBar: { fixQuality: 5, fixText: 'RTK Float' } })[0], 0);
  assert.equal(gpsRow({ statusBar: { fixQuality: 5, fixText: 'RTK Float' }, config: { gps: { minFixQuality: 5 } } })[0], 2);
});
