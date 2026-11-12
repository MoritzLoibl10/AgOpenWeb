// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// Steering off with one tap, on every layer of the real app (review 10.11.2026, measure 1;
// TabletSteerOff in wwwroot/js/tablet-steeroff.js). Needs a running host (simulator on, any data folder)
// and Playwright. With steering on, each layer is opened (every menu tile by touch, every dialog,
// fly-out, popup, the keyboard, the notice, a stand-in for the loading screen and for a future
// layer), then one finger tap goes to the place of the Steer button. Passed when steering is off,
// the only command sent was an off, and the layers open before the tap are still the same (so
// the tap reached nothing else). Exit code 1 on any failure.
//
//   node Tools/steer-off-check.mjs [--url http://localhost:5174] [--size 1280x800] [--scale glove] [--cpu 1] [--out steer-off.json]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://localhost:5174/'), [W, H] = arg('size', '1280x800').split('x').map(Number);
const scale = arg('scale', 'glove'), cpu = +arg('cpu', '1'), out = arg('out', 'steer-off.json');
const { chromium } = createRequire(import.meta.url)('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, locale: 'de-DE' });
await ctx.addInitScript(s => { try { localStorage.setItem('aow.ui.scale', s); } catch (_) { /* ignore */ } }, scale);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => typeof iHoldControl !== 'undefined' && iHoldControl === true && config && appInfo && tick, null, { timeout: 90000 });
await page.evaluate(() => transport.send('app.setLanguage|de'));
await sleep(2000);
const ev = (fn, a) => page.evaluate(fn, a);
const send = c => ev(c => transport.send(c), c);
const op = () => ev(() => ({ as: !!(tick && tick.op && tick.op.autoSteer), avail: !!(tick && tick.op && tick.op.autoSteerAvail), sim: !!(statusBar && statusBar.simEnabled) }));

// A finger: touchStart, 60 ms, touchEnd.
async function tapAt(x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(sel) {
  const r = await ev(s => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: 'center' });
    const b = e.getBoundingClientRect(); return b.width ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null; }, sel);
  if (!r) return false;
  await tapAt(r.x, r.y); await sleep(700); return true;
}
// Where a finger switches steering off: the Steer button's middle, or the off button over it.
const steerSpot = () => ev(() => {
  const o = document.getElementById('tui-steeroff');
  const s = document.getElementById('rn-steer');
  const r = o && !o.hidden ? o.getBoundingClientRect() : s && s.getBoundingClientRect();
  return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2, over: !!(o && !o.hidden) } : null;
});
// The layers that are open (anything with an id that is shown and is no fixed part of the screen).
const layers = () => ev(() => [...document.querySelectorAll('.open[id], [id].show, #tui-legal:not([hidden]), #tui-fw:not([hidden]), #tui-ready:not([hidden]), #tui-explain:not([hidden]), #tui-dircheck:not([hidden]), #sw-test-layer, #tui-boot-test')]
  .filter(e => e.getBoundingClientRect().width > 0 && !/^(simbar|sim-launch|bottomnav|statusbar|tui-steeroff|toast)$/.test(e.id))
  .map(e => e.id).sort().join(','));
function reset() {
  return ev(() => {
    try { wzClose(true); lnCloseAll(); closeDialog(); } catch (_) { /* older page */ }
    document.querySelectorAll('.tui-sheet.open, .tp-scrim.open, .bn-flyout.open, #tui-scrim.open').forEach(e => e.classList.remove('open'));
    for (const id of ['tui-legal', 'tui-fw', 'tui-ready', 'tui-explain']) { const e = document.getElementById(id); if (e) e.hidden = true; }
    for (const id of ['sw-test-layer', 'tui-boot-test']) { const e = document.getElementById(id); if (e) e.remove(); }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (typeof TabletTerminal !== 'undefined' && TabletTerminal.mode !== 'drive') TabletTerminal.setMode('drive');
  });
}

// --- A field, a line, the simulator, steering on --------------------------------------------
let s = await op();
if (!s.sim) { await send('sim.toggleEnable'); await sleep(1500); }
await send('field.new|SteerOffCheck'); await sleep(2500);
await send('boundary.fromMapPoints|-150,-80;150,-80;150,900;-150,900'); await sleep(2000);
await send('track.drawStraight'); await sleep(400); await send('track.drawPoint|0,-30'); await sleep(300); await send('track.drawPoint|0,850'); await sleep(1500);
await send('sim.speedUp'); await sleep(500);
await reset(); await sleep(500);
async function engage() {
  for (let i = 0; i < 6; i++) {
    if ((await op()).as) return true;
    await send('autosteer.toggle'); await sleep(1200);
  }
  return (await op()).as;
}
if (!(await engage())) { console.error('could not switch steering on (no line?)'); await browser.close(); process.exit(2); }

// --- The layers -------------------------------------------------------------------------------
await tapSel('#tui-menu-btn'); await sleep(600);
const tiles = await ev(() => [...document.querySelectorAll('#tui-menu [data-tile]')].map(e => e.dataset.tile).filter(t => !t.startsWith('#') && t !== 'demo'));
// A tile on a deeper menu page (docs/Menue-Aufteilung.md): its page's entry first, as a finger does.
async function toTilePage(t) {
  // a module adds its tile a moment after the menu opens; wait until it sits on its page
  await page.waitForFunction(t => { const e = document.querySelector('#tui-menu [data-tile="' + t + '"]'); return !!e && !!e.closest('.tui-mpage'); }, t, { timeout: 5000 }).catch(() => {});
  const pg = await ev(t => { const e = document.querySelector('#tui-menu [data-tile="' + t + '"]'); const d = e && e.closest('.tui-mpage');
    return d && d.hidden ? d.dataset.mpage : ''; }, t);
  if (pg) await tapSel(`#tui-menu [data-tile="page:${pg}"]`);
}
const dialogs = await ev(() => [...document.querySelectorAll('#dialoghost .dlg-card[id]')].map(e => e.id));
const flyouts = await ev(() => [...document.querySelectorAll('.bn-flyout[id]')].map(e => e.id));
await reset();
const L = [];
L.push(['menu', async () => tapSel('#tui-menu-btn')]);
for (const t of tiles) L.push(['menu tile ' + t, async () => { await tapSel('#tui-menu-btn'); await toTilePage(t); return tapSel(`#tui-menu [data-tile="${t}"]`); }]);
for (const d of dialogs) L.push(['dialog ' + d, async () => ev(d => { openDialog(d); return true; }, d)]);
for (const f of flyouts) L.push(['fly-out ' + f, async () => ev(f => { document.getElementById(f).classList.add('open'); return true; }, f)]);
L.push(['ready list', async () => tapSel('#tui-sb-ready')]);
L.push(['explanation (long press)', async () => ev(() => { TabletExplain.show(document.getElementById('tui-sb-steer'), tr('Steering status: on, off, no line, or a fault such as "Not steering".')); return true; })]);
L.push(['notice at first start', async () => ev(() => { TabletLegal.show(); return true; })]);
L.push(['firewall warning', async () => ev(() => { TabletFirewall.show(); return true; })]);
L.push(['keyboard (settings field)', async () => {
  await ev(() => { TabletTerminal.setMode('setup'); document.getElementById('vehiclecfg').classList.add('open'); });
  await sleep(400);
  return ev(() => { const i = [...document.querySelectorAll('#vehiclecfg input')].find(x => x.getBoundingClientRect().width > 0); if (!i) return false; i.focus(); return true; });
}]);
L.push(['loading screen (stand-in)', async () => ev(() => { const b = document.createElement('div'); b.id = 'tui-boot-test';
  b.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#0b1020'; document.body.appendChild(b); return true; })]);
L.push(['a future layer (z-index 999999)', async () => ev(() => { const b = document.createElement('div'); b.id = 'sw-test-layer';
  b.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.3)'; b.addEventListener('pointerdown', () => { window.__layerHit = true; }); document.body.appendChild(b); return true; })]);

const results = [];
for (const [name, open] of L) {
  await reset(); await sleep(300);
  if (!(await engage())) { results.push({ name, ok: false, why: 'steering would not switch on again' }); continue; }
  const opened = await open(); await sleep(600);
  const before = await layers();
  const spot = await steerSpot();
  if (!opened || !spot) { results.push({ name, ok: false, why: opened ? 'no Steer place' : 'layer did not open' }); continue; }
  await ev(() => { window.__sent = []; window.__layerHit = false; if (!transport.__swWrapped) { const o = transport.send.bind(transport); transport.send = c => { (window.__sent || []).push(c); return o(c); }; transport.__swWrapped = true; } });
  await tapAt(spot.x, spot.y);
  await sleep(1300);
  // A hint that closes on any touch (the long-press explanation) may close; nothing may open.
  const after = (await layers()), hint = l => l.split(',').filter(x => x && x !== 'tui-explain').join(',');
  const st = await op();
  const sent = (await ev(() => window.__sent.slice())).filter(c => c !== 'control.presence' && c !== 'diag.ping'); // the heartbeat
  const hit = await ev(() => !!window.__layerHit);
  const offOnly = sent.length > 0 && sent.every(c => c === 'autosteer.off' || c === 'autosteer.toggle') && sent.length <= 1;
  const ok = !st.as && offOnly && hint(after) === hint(before) && !hit;
  results.push({ name, ok, over: spot.over, sent: sent.join(' '), before, after, as: st.as,
    why: ok ? '' : [st.as ? 'steering still on' : '', offOnly ? '' : 'sent: ' + (sent.join(' ') || 'nothing'), hint(after) !== hint(before) ? 'layers changed' : '', hit ? 'the layer got the tap' : ''].filter(Boolean).join('; ') });
}
await reset();
await send('autosteer.off');
await browser.close();
writeFileSync(out, JSON.stringify({ size: `${W}x${H}`, scale, cpu, results, pageErrors: errors }, null, 1));
const bad = results.filter(r => !r.ok);
for (const r of results) console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name.padEnd(36) + (r.over ? ' [off button]' : ' [Steer button]') + (r.ok ? '' : ' — ' + r.why));
console.log(`${results.length - bad.length}/${results.length} layers: one tap switched steering off` + (errors.length ? `; page errors: ${errors.length}` : ''));
process.exit(bad.length || errors.length ? 1 : 0);
