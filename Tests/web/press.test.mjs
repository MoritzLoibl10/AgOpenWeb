// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// Presses made by code (wwwroot/js/tablet-*.js, between press:begin/end) against upstream's
// ghost-press filter (wwwroot/js/map-input.js, #465), both taken from the files as they are.
// The filter drops a pointerdown from a pointer that is already down; a press made by code has no
// release, so with the default pointerId 0 every second one was dropped and a menu tile acted only
// on the second tap (tablet test moritz.31, point 1). Each press made by code has its own id.
// Needs Playwright with Chromium; skipped where it isn't installed, except with AOW_REQUIRE_BROWSER=1.
// Run: node --test Tests/web/press.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { app } from './stubs.mjs';

const read = f => readFileSync(new URL('../../Shared/AgOpenWeb.RemoteServer/wwwroot/js/' + f, import.meta.url), 'utf8');
const mi = read('map-input.js');
const press = app.slice(app.indexOf('// press:begin'), app.indexOf('// press:end'));
const END = '_pointersDown.add(e.pointerId);\n}, true);';
const filter = mi.slice(mi.indexOf('const GHOST_PRESS_MS'), mi.indexOf(END) + END.length);
let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch (_) { /* not installed */ }

test('blocks are found', () => {
  assert.ok(press.includes('function tuiPress'));
  assert.ok(filter.includes('_pointersDown') && filter.endsWith(END), 'upstream ghost filter moved: update this test');
});

test('every press made by code passes the ghost-press filter', { skip: !chromium && !process.env.AOW_REQUIRE_BROWSER && 'playwright not installed' }, async () => {
  assert.ok(chromium, 'playwright not installed');
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage();
    await p.setContent('<!doctype html><body><button id="b">b</button></body>');
    await p.addScriptTag({ content: filter + '\n' + press + `
      window.hits = 0;
      document.getElementById('b').addEventListener('pointerdown', () => window.hits++);
      window.tuiPress = tuiPress;` });
    const hits = () => p.evaluate(() => window.hits);

    // As before the fix: a bare synthetic press (pointerId 0). Every second one is dropped.
    await p.evaluate(() => { for (let i = 0; i < 6; i++) document.getElementById('b').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    assert.equal(await hits(), 3, 'the filter is expected to drop every second bare press');

    await p.evaluate(() => { window.hits = 0; for (let i = 0; i < 6; i++) window.tuiPress(document.getElementById('b')); });
    assert.equal(await hits(), 6, 'each tuiPress reaches the button');

    // A real touch between presses made by code changes nothing.
    await p.evaluate(() => { window.hits = 0; });
    await p.locator('#b').click();
    await p.evaluate(() => { window.tuiPress(document.getElementById('b')); window.tuiPress(document.getElementById('b')); });
    assert.equal(await hits(), 3);
  } finally { await browser.close(); }
});
