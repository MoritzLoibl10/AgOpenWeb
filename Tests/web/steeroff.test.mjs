// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// TabletSteerOff (wwwroot/js/tablet-*.js, steeroff:begin/end) in a real browser: while steering is
// on and something covers the Steer button, an off button lies over it, above every layer; one
// tap sends only autosteer.off and reaches nothing underneath (neither the press nor the click
// that follows a touch). Uncovered, hidden (the Steer button is upstream's own). The whole app,
// every layer: Tools/steer-off-check.mjs. Needs Playwright with Chromium; skipped where it isn't
// installed, except with AOW_REQUIRE_BROWSER=1 (CI).
// Run: node --test Tests/web/steeroff.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { app, forkCss } from './stubs.mjs';

const html = forkCss; // the off button's rules live in css/tablet.css
const block = app.slice(app.indexOf('// steeroff:begin'), app.indexOf('// steeroff:end'));
const css = html.slice(html.indexOf('#tui-steeroff {'), html.indexOf('#tui-steeroff.done')) + '#tui-steeroff.done { background: #4b5563; }';
let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch (_) { /* not installed */ }

const PAGE = `<!doctype html><html><head><style>${css}
  #rightnav { position: fixed; right: 0; top: 200px; z-index: 1; }
  #rn-steer { width: 96px; height: 84px; }
  #sheet { position: fixed; inset: 60px 10px 10px 10px; z-index: 35; background: #eee; display: none; }
  #sheet.open { display: block; }
  #tile { position: absolute; inset: 0; }
</style></head><body>
<div id="rightnav"><button id="rn-steer">Steer</button></div>
<div id="sheet"><button id="tile">tile</button></div>
<script>
  const I18n = { text: k => k }; const tr = k => k;
  var connState = 'connected', iHoldControl = true, tick = { op: { autoSteer: true } };
  window.sent = []; window.tileHits = 0;
  const transport = { send: c => { window.sent.push(c); if (c === 'autosteer.off') tick.op.autoSteer = false; } };
  for (const t of ['pointerdown', 'click']) document.getElementById('tile').addEventListener(t, () => window.tileHits++);
  document.getElementById('rn-steer').addEventListener('pointerdown', () => window.sent.push('autosteer.toggle'));
  window.set = (k, v) => { if (k === 'as') tick.op.autoSteer = v; if (k === 'ctl') iHoldControl = v; if (k === 'conn') connState = v; };
</script></body></html>`;

test('blocks are found', () => {
  assert.ok(block.includes('const TabletSteerOff'));
  assert.ok(css.includes('z-index: 2147483647'), 'above the loading screen (2147483000)');
});

test('steering on: one tap where the Steer button is switches off, whatever covers it', { skip: !chromium && !process.env.AOW_REQUIRE_BROWSER && 'playwright not installed' }, async () => {
  assert.ok(chromium, 'playwright not installed');
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, hasTouch: true });
    const p = await ctx.newPage();
    await p.setContent(PAGE);
    await p.addScriptTag({ content: block + '\nwindow.SO = TabletSteerOff;' });
    const cdp = await ctx.newCDPSession(p);
    const steer = await p.evaluate(() => { const r = document.getElementById('rn-steer').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const tap = async () => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [steer] }); await p.waitForTimeout(60); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(150); };
    const shown = () => p.evaluate(() => { window.SO.update(); return window.SO.shown; });

    // Uncovered: the Steer button is upstream's own.
    assert.equal(await shown(), false);

    // Covered by a sheet: the off button lies exactly over the Steer button.
    await p.evaluate(() => document.getElementById('sheet').classList.add('open'));
    assert.equal(await shown(), true);
    const r = await p.evaluate(() => [document.getElementById('tui-steeroff').getBoundingClientRect(), document.getElementById('rn-steer').getBoundingClientRect()].map(b => [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]));
    assert.deepEqual(r[0], r[1]);

    // One finger tap: only the off, nothing reaches the sheet (no press, no click).
    await tap();
    assert.deepEqual(await p.evaluate(() => window.sent), ['autosteer.off']);
    assert.equal(await p.evaluate(() => window.tileHits), 0);
    assert.equal(await p.evaluate(() => document.getElementById('tui-steeroff').classList.contains('done')), true, 'stays as a dead zone');
    // A second tap in the dead zone does nothing at all.
    await tap();
    assert.deepEqual(await p.evaluate(() => window.sent), ['autosteer.off']);
    assert.equal(await p.evaluate(() => window.tileHits), 0);
    await p.waitForTimeout(1000);
    assert.equal(await shown(), false, 'steering off: gone');

    // Observers and a lost connection: not shown (the host would drop the command).
    await p.evaluate(() => { window.set('as', true); window.set('ctl', false); });
    assert.equal(await shown(), false);
    await p.evaluate(() => { window.set('ctl', true); window.set('conn', 'disconnected'); });
    assert.equal(await shown(), false);
    await p.evaluate(() => window.set('conn', 'connected'));

    // A layer above everything else (a loading screen) and a Steer button that is not laid out.
    await p.evaluate(() => { document.getElementById('sheet').classList.remove('open'); const b = document.createElement('div');
      b.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000'; b.id = 'boot'; document.body.appendChild(b); });
    assert.equal(await shown(), true);
    await p.evaluate(() => { document.getElementById('boot').remove(); document.getElementById('rightnav').style.display = 'none'; });
    assert.equal(await shown(), true, 'no Steer button on screen: at its last place');
    const at = await p.evaluate(() => { const b = document.getElementById('tui-steeroff').getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top)]; });
    assert.deepEqual(at, r[1].slice(0, 2));
  } finally { await browser.close(); }
});
