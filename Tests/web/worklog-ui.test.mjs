// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// TabletWorkLog (wwwroot/app.js, worklog-ui:begin/end) with WorkLogCore: the recorder and the
// sync with the guidance computer (/worklog). A session left open when the ignition went off is
// closed at the next start and delivered to the host as soon as this tablet holds control; the
// merge with the host's copy makes no duplicates.
// Run: node --test Tests/web/worklog-ui.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { node } from './ready.test.mjs';

const app = readFileSync(new URL('../../Shared/AgOpenWeb.RemoteServer/wwwroot/app.js', import.meta.url), 'utf8');
const cut = (a, b) => app.slice(app.indexOf(a), app.indexOf(b));
const block = cut('// worklog:begin', '// worklog:end') + cut('// worklog-ui:begin', '// worklog-ui:end');

const T0 = new Date(2026, 9, 27, 8, 0).getTime(), MIN = 60000;
const flush = () => new Promise(r => setImmediate(r));

function load({ stored, host = [], now = T0 } = {}) {
  let clock = now;
  const timers = [], posts = [], store = new Map();
  if (stored) store.set('aow.worklog.v1', JSON.stringify(stored));
  let hostDoc = { format: 'aow-worklog', version: 1, entries: host, deleted: [] };
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return clock; } }
  const ctx = {
    Date: FakeDate, Math, JSON, Set, Map, Number, String, Array, Object, Promise, Error,
    I18n: { text: k => k, language: 'en' }, tr: k => k,
    document: { createElement: node, body: node(), getElementById: () => null, documentElement: node() },
    window: { addEventListener() {} },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    performance: { now: () => 1000 },
    setInterval: (fn, ms) => timers.push([fn, ms]), setTimeout() {},
    connState: 'connected', lastTick: { t: 900 }, iHoldControl: false, myClientId: 'c1',
    statusBar: { jobName: '' }, fieldOps: { activeField: '', jobs: [] }, profiles: null, sectionsWidthM: () => 0,
    encodeURIComponent,
    fetch: async (url, opt) => {
      if (opt && opt.method === 'POST') {
        const doc = JSON.parse(opt.body); posts.push(doc);
        const ids = new Set(hostDoc.entries.map(e => e.id));
        hostDoc = { ...hostDoc, entries: hostDoc.entries.concat(doc.entries.filter(e => !ids.has(e.id) && !e.open)) };
      }
      return { ok: true, json: async () => JSON.parse(JSON.stringify(hostDoc)) };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(block + '\nthis.W = TabletWorkLog;', ctx);
  const every = ms => timers.filter(t => t[1] === ms).map(t => t[0]);
  return {
    ctx, posts, store, host: () => hostDoc,
    async tick(ms = 3000) { clock += ms; for (const f of every(2000)) f(); for (const f of every(3000)) f(); await flush(); await flush(); },
  };
}

const openSession = { id: 'w1', field: 'Acker', job: 'Mähen', workType: '', start: T0, end: T0 + 20 * MIN, seenAt: T0 + 20 * MIN,
  workedStart: 0, workedEnd: 1000, actualStart: 0, actualEnd: 1000, tripStart: 0, tripEnd: 500, tool: '', vehicle: '', widthM: 3,
  activity: '', product: '', amount: '', note: '', open: true, hostStart: null, hostEnd: null };

test('ignition off: the open session is closed at the next start and sent once control is held', async () => {
  const t = load({ stored: { entries: [], open: openSession, deleted: [] }, now: T0 + 3 * 60 * MIN });
  await t.tick();
  assert.equal(t.ctx.W.entries.length, 1);
  assert.equal(t.ctx.W.entries[0].open, false);
  assert.equal(t.ctx.W.entries[0].end, T0 + 20 * MIN, 'ends when it was last seen, not now');
  assert.equal(t.posts.length, 0, 'an observer only reads');
  assert.equal(t.ctx.W.unsent, true);
  t.ctx.iHoldControl = true;
  await t.tick();
  assert.equal(t.posts.length, 1, 'sent within one round of getting control, not after 30 s');
  assert.deepEqual(t.posts[0].entries.map(e => [e.id, e.open]), [['w1', false]]);
  assert.equal(t.ctx.W.unsent, false);
  assert.deepEqual(t.host().entries.map(e => e.id), ['w1']);
  assert.match(t.store.get('aow.worklog.v1'), /"open":null/);
});

test('merge with the host: no duplicates, entries from either side kept', async () => {
  const done = { ...openSession, open: false };
  const other = { ...openSession, id: 'w2', start: T0 + 60 * MIN, end: T0 + 80 * MIN, open: false };
  const t = load({ stored: { entries: [done], open: null, deleted: [] }, host: [done, other] });
  t.ctx.iHoldControl = true;
  await t.tick(); await t.tick();
  assert.deepEqual(Array.from(t.ctx.W.entries, e => e.id), ['w1', 'w2']);
  assert.deepEqual(t.host().entries.map(e => e.id), ['w1', 'w2']);
});

test('host away: entries stay on the tablet and are sent later', async () => {
  const t = load({ stored: { entries: [{ ...openSession, open: false }], open: null, deleted: [] } });
  t.ctx.iHoldControl = true;
  t.ctx.connState = 'connecting';
  await t.tick(); await t.tick();
  assert.equal(t.posts.length, 0);
  t.ctx.connState = 'connected';
  await t.tick();
  assert.equal(t.posts.length, 1);
  assert.deepEqual(t.host().entries.map(e => e.id), ['w1']);
});
