// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// renderAbDotLabels (wwwroot/js/tracks.js, upstream; fork guard, upstream issue draft 9): it runs
// in every frame, also before CanvasKit is up. With an active line and no perspM yet it threw
// (pw/w2s on null) outside skFrame's try, and the frame loop stopped for good: map and status bar
// frozen after a reload. Now: no matrix, no letters, no error. The whole app: Tools/reload-check.mjs.
// Run: node --test Tests/web/ab-labels.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../../Shared/AgOpenWeb.RemoteServer/wwwroot/js/tracks.js', import.meta.url), 'utf8');
const start = src.indexOf('function renderAbDotLabels()');
const fn = src.slice(start, src.indexOf('\n}\n', start) + 3);

function load(perspM) {
  const spans = [];
  const el = { children: spans, appendChild(c) { spans.push(c); return c; } };
  const ctx = {
    abDotLabelsEl: el, drawPts: [], perspM, mapL: 0, ACTIVE_A_COLOR: '#a', ACTIVE_B_COLOR: '#b',
    activeAbPoints: () => [{ e: 0, n: 0 }, { e: 0, n: 100 }],
    document: { createElement: () => ({ style: {}, textContent: '' }) },
    abLetter: i => 'AB'[i], abLabelColor: () => '#c',
    pw: () => ctx.perspM[12] + 2, w2s: () => [ctx.perspM[0], ctx.perspM[1]],
  };
  vm.createContext(ctx);
  vm.runInContext(fn + '\nthis.render = renderAbDotLabels;', ctx);
  return { ctx, spans };
}

test('no matrix yet (CanvasKit loading), an active line: no error, no letters', () => {
  const t = load(null);
  assert.doesNotThrow(() => t.ctx.render());
  t.ctx.render();
  for (const s of t.spans) assert.equal(s.style.display, 'none');
});

test('with the matrix: the A and B letters as before', () => {
  const M = new Array(16).fill(0); M[0] = 100; M[1] = 50;
  const t = load(M);
  t.ctx.abDotLabelsEl.children.push({ style: {}, textContent: '' }, { style: {}, textContent: '' });
  t.ctx.render();
  assert.deepEqual(t.spans.map(s => [s.textContent, s.style.display]), [['A', 'block'], ['B', 'block']]);
});
