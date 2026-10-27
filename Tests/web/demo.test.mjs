// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// TabletDemo (wwwroot/app.js, between demo:begin/end): ending the demo, by "End demo" or because
// a module was detected, never sends a command that toggles steering or sections. The host only
// has toggles for them, and one sent from a stale tick could switch them on.
// Run: node --test Tests/web/demo.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../../Shared/AgOpenWeb.RemoteServer/wwwroot/app.js', import.meta.url), 'utf8');
const block = app.slice(app.indexOf('// demo:begin'), app.indexOf('// demo:end'));
const TOGGLES = ['autosteer.toggle', 'section.master', 'section.manual', 'section.toggle', 'section.toggleZone'];

function node() {
  return {
    hidden: false, dataset: {}, style: {}, children: [], textContent: '',
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    append(...c) { this.children.push(...c); }, appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, setAttribute() {}, querySelector: () => null,
  };
}

function load() {
  const timers = [], sent = [], toasts = [];
  const ctx = {
    I18n: { text: k => k }, tr: k => k,
    document: { createElement: node, body: node(), documentElement: { toggleAttribute() {} }, getElementById: () => null },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setInterval: fn => timers.push(fn),
    transport: { send: c => sent.push(c) },
    showToast: (m, ms) => toasts.push([m, ms]),
    connState: 'connected', iHoldControl: true,
    statusBar: { simEnabled: false, simPanelVisible: true },
    // Steering and both section modes on: a toggle sent now would be read back as "off",
    // but from a stale tick it could switch them on.
    tick: { op: { autoSteer: true, sectionAuto: true, sectionManual: true } },
    PointerEvent: class {},
  };
  vm.createContext(ctx);
  vm.runInContext(block + '\nthis.TabletDemo = TabletDemo;', ctx);
  return { ctx, sent, toasts, tickAll: () => timers.forEach(f => f()) };
}

test('demo: "End demo" sends no steering or section toggle', () => {
  const { ctx, sent } = load();
  ctx.TabletDemo.start();
  assert.equal(ctx.TabletDemo.active, true);
  ctx.statusBar.simEnabled = true;
  sent.length = 0;
  ctx.TabletDemo.end('');
  assert.equal(ctx.TabletDemo.active, false);
  assert.deepEqual(sent.filter(c => TOGGLES.includes(c.split('|')[0])), []);
  assert.deepEqual(sent, ['sim.toggleEnable']); // only the simulator it switched on itself
});

test('demo: a detected module ends it with a warning and no toggle', () => {
  const { ctx, sent, toasts, tickAll } = load();
  ctx.TabletDemo.start();
  ctx.statusBar.simEnabled = true;
  sent.length = 0;
  ctx.statusBar.autoSteerOk = true; // steer module heard
  tickAll();
  assert.equal(ctx.TabletDemo.active, false);
  assert.deepEqual(sent.filter(c => TOGGLES.includes(c.split('|')[0])), []);
  assert.equal(toasts.at(-1)[0], 'Demo ended – kit detected. Check steering and sections.');
});

test('demo: the module has no steering or section toggle at all', () => {
  for (const c of TOGGLES) assert.ok(!block.includes(`'${c}'`), c);
});
