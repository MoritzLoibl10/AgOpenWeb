// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// Reload with an open field and an active line while CanvasKit is slow (its .wasm held back, as
// on a weak tablet): the frame loop must keep running and the page must not throw (upstream issue
// draft 9: renderAbDotLabels threw before CanvasKit was up and stopped the frame loop, map and
// status bar frozen). Makes a field and a line itself if none is active. Needs a running host and
// Playwright. Exit code 1 on a page error or a stopped frame loop.
//
//   node Tools/reload-check.mjs [--url http://localhost:5174] [--loads 3] [--wasm-delay 3000]
import { createRequire } from 'node:module';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://localhost:5174/'), loads = +arg('loads', '3'), delay = +arg('wasm-delay', '3000');
const { chromium } = createRequire(import.meta.url)('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ready = p => p.waitForFunction(() => typeof iHoldControl !== 'undefined' && tick, null, { timeout: 90000 });

// A field and an active line (only if there is none).
{
  const p = await (await browser.newContext()).newPage();
  await p.goto(url); await ready(p);
  await p.waitForFunction(() => iHoldControl === true, null, { timeout: 30000 });
  await sleep(1500);
  if (!(await p.evaluate(() => (activeAbPoints() || []).length))) {
    const send = c => p.evaluate(c => transport.send(c), c);
    await send('field.new|ReloadCheck'); await sleep(2500);
    await send('boundary.fromMapPoints|-150,-80;150,-80;150,900;-150,900'); await sleep(2000);
    await send('track.drawStraight'); await sleep(400); await send('track.drawPoint|0,-30'); await sleep(300); await send('track.drawPoint|0,850'); await sleep(2000);
  }
  await p.evaluate(() => transport.send('autosteer.off'));
  await p.context().close();
}
let bad = 0;
for (let i = 1; i <= loads; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.route('**/vendor/canvaskit.wasm', async r => { await sleep(delay); await r.continue(); });
  await p.goto(url); await ready(p);
  await sleep(delay + 4000);
  const a = await p.evaluate(() => _frameLast);
  await sleep(1500);
  const s = await p.evaluate(() => ({ f: _frameLast, ck: !!CK, line: (activeAbPoints() || []).length }));
  const runs = s.f !== a;
  if (!runs || errs.length) bad++;
  console.log(`load ${i}: frame loop ${runs ? 'runs' : 'STOPPED'}, CanvasKit ${s.ck}, line points ${s.line}, page errors ${errs.length}${errs[0] ? ' (' + errs[0].slice(0, 80) + ')' : ''}`);
  await ctx.close();
}
await browser.close();
console.log(`${loads - bad}/${loads} reloads with a slow CanvasKit: frame loop running, no page error`);
process.exit(bad ? 1 : 0);
