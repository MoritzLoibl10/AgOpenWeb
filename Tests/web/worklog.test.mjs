// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// WorkLogCore (wwwroot/app.js, worklog:begin/end): sessions from what the client sees, the
// session's share of the host's counters, sums, and the CSV for Excel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../Shared/AgOpenWeb.RemoteServer/wwwroot/app.js', import.meta.url), 'utf8');
const C = new Function(app.slice(app.indexOf('// worklog:begin'), app.indexOf('// worklog:end')) + '\nreturn WorkLogCore;')();

const T0 = new Date(2026, 9, 27, 8, 0).getTime(), MIN = 60000;
const snap = (o = {}) => ({ live: true, control: true, field: 'Breitenacker', job: 'Mähen', workType: 'Mähen', worked: 0, actual: 0, trip: 0,
  tool: 'Mähwerk 3 m', vehicle: 'Steyr', widthM: 3, ...o });
// The recorder ticks every 2 s; between two given snapshots the earlier one repeats each minute.
const run = steps => {
  let st = { entries: [], open: null };
  steps.forEach(([s, t], i) => {
    st = C.step(st, s, t);
    const next = steps[i + 1];
    if (next && s.job && next[0].job === s.job && next[0].field === s.field && next[0].control !== false && next[0].live !== false)
      for (let u = t + MIN; u < next[1]; u += MIN) st = C.step(st, s, u);
  });
  return st;
};

test('a session starts, follows the host counters and closes when the job closes', () => {
  const st = run([[snap(), T0], [snap({ worked: 5000, actual: 4800, trip: 900 }), T0 + 30 * MIN], [snap({ job: '' }), T0 + 31 * MIN]]);
  assert.equal(st.open, null); assert.equal(st.entries.length, 1);
  const e = st.entries[0];
  assert.equal(e.start, T0); assert.equal(e.end, T0 + 30 * MIN); // last moment the job was seen
  assert.equal(C.sessionArea(e), 5000); assert.equal(C.overlap(e), 200); assert.equal(C.delta(e.tripStart, e.tripEnd), 900);
});

test('another job or field, no control, no data or a long gap start a new entry', () => {
  for (const [label, next, t] of [['job', snap({ job: 'Wenden' }), T0 + MIN], ['field', snap({ field: 'Hausacker' }), T0 + MIN],
    ['control', snap({ control: false }), T0 + MIN], ['data', snap({ live: false }), T0 + MIN], ['gap', snap(), T0 + C.GAP_MS + MIN]]) {
    const st = [[snap(), T0], [next, t]].reduce((a, [x, u]) => C.step(a, x, u), { entries: [], open: null }); // no ticks in between
    assert.equal(st.entries.length, 1, label);
  }
  const short = [[snap(), T0], [snap(), T0 + C.GAP_MS - MIN]].reduce((a, [x, u]) => C.step(a, x, u), { entries: [], open: null }); // a reload in between continues
  assert.equal(short.entries.length, 0); assert.ok(short.open);
});

test('a counter that went down gives no session area (nothing made up)', () => {
  const st = run([[snap({ worked: 8000 }), T0], [snap({ worked: 1000 }), T0 + MIN], [snap({ job: '' }), T0 + 2 * MIN]]);
  assert.equal(C.sessionArea(st.entries[0]), null);
  const s = C.sums(st.entries)[0]; assert.equal(s.areaMissing, 1); assert.equal(s.areaSqM, 0);
});

test('sums per field and season', () => {
  const a = run([[snap({ worked: 0 }), T0], [snap({ worked: 10000 }), T0 + 60 * MIN], [snap({ job: '' }), T0 + 61 * MIN]]).entries;
  const b = run([[snap({ worked: 10000 }), T0 + 24 * 60 * MIN], [snap({ worked: 15000 }), T0 + 24 * 60 * MIN + 30 * MIN], [snap({ job: '' }), T0 + 25 * 60 * MIN]]).entries;
  const [s] = C.sums(a.concat(b));
  assert.deepEqual([s.field, s.season, s.count, s.ms, s.areaSqM], ['Breitenacker', 2026, 2, 90 * MIN, 15000]);
});

test('CSV: BOM, ";" and decimal comma, quoted text, CRLF', () => {
  const st = run([[snap({ worked: 0, trip: 10 }), T0], [snap({ worked: 12345, actual: 12000, trip: 1510.4, widthM: 2.95 }), T0 + 75 * MIN], [snap({ job: '' }), T0 + 76 * MIN]]);
  st.entries[0].note = 'nass; "Senke"';
  const out = C.csv(st.entries, ['A', 'B']);
  assert.ok(out.startsWith('﻿A;B\r\n'));
  const row = out.slice(1).split('\r\n')[1].split(';');
  assert.deepEqual(row.slice(0, 15), ['Breitenacker', 'Mähen', 'Mähen', '27.10.2026', '08:00', '09:15', '1:15', '1,23', '1,23', '1,20', '0,03', '1500', 'Mähwerk 3 m', '2,95', 'Steyr']);
  assert.ok(out.includes('"nass; ""Senke"""'));
  assert.ok(out.endsWith('\r\n'));
});

// Host-paket B: the tablet's copy and the guidance computer's merge by id (WorkLogStore.Merge).
const E = (id, start, o = {}) => ({ id, field: 'Breitenacker', job: 'Mähen', start, end: start + MIN, ...o });
test('merge: no duplicates, the later change wins, deleted stays deleted, open stays local', () => {
  const tablet = { entries: [E('a', T0), E('b', T0 + MIN, { note: 'alt', mod: 1 })], deleted: ['x'] };
  const host = { entries: [E('a', T0), E('b', T0 + MIN, { note: 'neu', mod: 2 }), E('c', T0 + 2 * MIN), E('x', T0 + 3 * MIN), E('o', T0 + 4 * MIN, { open: true })], deleted: [] };
  const m = C.merge(tablet, host);
  assert.deepEqual(m.entries.map(e => e.id), ['a', 'b', 'c']);
  assert.equal(m.entries[1].note, 'neu');
  assert.deepEqual(m.deleted, ['x']);
  assert.deepEqual(C.merge(m, m).entries.map(e => e.id), ['a', 'b', 'c'], 'merging again changes nothing');
  assert.deepEqual(C.merge(host, tablet).entries.map(e => [e.id, e.note]), m.entries.map(e => [e.id, e.note]), 'same result either way round');
});

// Host-paket C: the host's job start and end stand in for this tablet's clock where they mark the session.
test('host times: a new job gives the start, closing it the end; otherwise the tablet clock', () => {
  const H0 = T0 - 7 * MIN, H1 = T0 + 25 * MIN; // the host's clock is 7 min behind this tablet's
  let st = run([[snap({ jobNew: true, jobStart: H0 }), T0], [snap(), T0 + 30 * MIN], [snap({ job: '' }), T0 + 31 * MIN]]);
  let e = st.entries[0];
  assert.equal(e.hostStart, H0); assert.equal(e.byJob, true);
  e = C.ended(e, { endedMs: H1, status: 1 });
  assert.equal(C.t0(e), H0); assert.equal(C.t1(e), H1);
  assert.equal(C.csv([e], ['h']).split('\r\n')[1].split(';')[6], '0:32'); // duration from the host: 32 min
  assert.equal(C.ended(e, { endedMs: H1 + MIN }).hostEnd, H1, 'set once');

  // A resumed job (not new) or a session that ended by a lost link: tablet clock.
  st = run([[snap({ jobNew: false, jobStart: H0 }), T0], [snap({ live: false }), T0 + 30 * MIN]]);
  e = st.entries[0];
  assert.equal(e.hostStart, null); assert.equal(e.byJob, false);
  assert.equal(C.ended(e, { endedMs: H1 }).hostEnd, null);
  assert.equal(C.t0(e), T0);

  // Host times that would make the session end before it starts are not used.
  e = { start: T0, end: T0 + MIN, hostStart: null, hostEnd: T0 - 60 * MIN };
  assert.equal(C.t1(e), T0 + MIN);
});
