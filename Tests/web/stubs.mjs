// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// Shared stubs for the web tests that run a block of wwwroot/app.js in node (vm): a DOM node that
// remembers classes and children, a block cutter and a context with timers to run by hand.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const app = readFileSync(new URL('../../Shared/AgOpenWeb.RemoteServer/wwwroot/app.js', import.meta.url), 'utf8');
export const cut = (begin, end) => app.slice(app.indexOf(begin), app.indexOf(end));
export const fill = (k, p) => p ? k.replace(/\{(\w+)\}/g, (m, n) => (n in p ? String(p[n]) : m)) : k;

export function node(tag = 'div') {
  const cls = new Set();
  const n = {
    tagName: tag.toUpperCase(), hidden: false, dataset: {}, style: {}, children: [], textContent: '', title: '', innerHTML: '', value: '',
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle: (c, on) => (on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c) },
    append(...c) { this.children.push(...c); }, appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.push(c); return c; }, remove() {}, contains: () => false,
    addEventListener() {}, setAttribute() {}, toggleAttribute() {}, dispatchEvent() {},
  };
  n.querySelector = () => n._q || (n._q = node());
  return n;
}

// Runs `code` with the globals in `g` (merged over a connected, controlling default); returns
// the context and a function that runs every interval once.
export function run(code, g = {}) {
  const timers = [], sent = [], store = new Map();
  const ctx = {
    I18n: { text: k => k, language: 'en' }, tr: fill,
    document: { createElement: node, body: node(), getElementById: () => null, documentElement: node(), activeElement: null },
    window: { addEventListener() {}, removeEventListener() {} }, navigator: { webdriver: false },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    performance: { now: () => 1000 }, setInterval: fn => timers.push(fn), clearInterval() {}, setTimeout() {},
    PointerEvent: class {}, showToast() {}, lnCloseAll() {},
    transport: { send: c => sent.push(c) },
    connState: 'connected', lastTick: { t: 900 }, iHoldControl: true, myClientId: 'c1',
    ...g,
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { ctx, sent, store, tick: () => timers.slice().forEach(f => f()) };
}
