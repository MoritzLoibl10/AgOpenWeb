// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// Long simulator run of the whole app (fork): starts its own host on an empty data folder, drives
// the simulator through realistic work for --minutes and writes down what goes wrong: console
// errors and warnings, page errors, AutoSteer switching off without our command (with the
// reason: control lost to the deadman, boundary, ...), displays that stop updating, toasts, memory
// of the page and the host. The "ignition off" case kills the host in the middle of a job and
// starts it again. Results as JSON (--out) and a short summary on stdout.
//
//   node Tools/sim-soak.mjs [--minutes 30] [--exe <AgOpenWeb.Desktop>] [--data <dir>] [--out soak.json]
//                          [--size 1280x800] [--lang de]
// Needs Playwright (Chromium) and a built Desktop head (default: the Debug build). Kills nothing
// but the host it started. Port 5174 must be free.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const root = fileURLToPath(new URL('..', import.meta.url));
const MINUTES = +arg('minutes', '30');
const EXE = arg('exe', join(root, 'Platforms/AgOpenWeb.Desktop/bin/Debug/net10.0/AgOpenWeb.Desktop'));
const DATA = arg('data', mkdtempSync(join(tmpdir(), 'aow-soak-')));
const OUT = arg('out', 'sim-soak.json');
const [W, H] = arg('size', '1280x800').split('x').map(Number);
const LANG = arg('lang', 'de');
const URL0 = 'http://localhost:5174/';
const { chromium } = createRequire(import.meta.url)('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(0).padStart(5) + 's';

const R = { started: new Date().toISOString(), minutes: MINUTES, data: DATA, size: `${W}x${H}`, lang: LANG,
  steps: [], console: [], pageErrors: [], steerOff: [], stale: [], toasts: [], memory: [], hostExits: [], notes: [] };
const log = (k, m) => { const line = `${ts()} ${k} ${m}`; console.log(line); };
const step = async (name, fn) => {
  const s = Date.now();
  try { const r = await fn(); R.steps.push({ at: ts(), name, ok: true, ms: Date.now() - s, info: r ?? null }); log('STEP', name + ' ok' + (r ? ' · ' + JSON.stringify(r) : '')); return r; }
  catch (e) { R.steps.push({ at: ts(), name, ok: false, ms: Date.now() - s, error: String(e && e.message || e) }); log('FAIL', name + ': ' + (e && e.message || e)); return null; }
};

// ---- host ----------------------------------------------------------------------------------
let host = null, hostOut = '';
function startHost() {
  if (!existsSync(EXE)) throw new Error('host not built: ' + EXE);
  hostOut = '';
  host = spawn(EXE, ['--headless'], { env: { ...process.env, AGOPENWEB_DATA: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
  const h = host;
  h.stdout.on('data', d => { hostOut += d; if (hostOut.length > 2e6) hostOut = hostOut.slice(-1e6); });
  h.stderr.on('data', d => { hostOut += d; });
  h.on('exit', (code, sig) => { R.hostExits.push({ at: ts(), code, sig, expected: !!h.expectedExit }); if (!h.expectedExit) log('HOST', `exited code=${code} sig=${sig}`); });
  return h;
}
async function waitHost() { for (let i = 0; i < 300; i++) { if (/web server listening|\[headless\] ready/.test(hostOut)) return; await sleep(100); } throw new Error('host did not start'); }
function hostRssMb() { try { const m = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${host.pid}/status`, 'utf8')); return m ? Math.round(+m[1] / 1024) : null; } catch (_) { return null; } }

// ---- page ----------------------------------------------------------------------------------
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, locale: LANG === 'de' ? 'de-DE' : 'en-US' });
// A person, not a test robot: legal notice, first setup and loading screen behave as on a tablet.
await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
const page = await ctx.newPage();
page.on('console', m => {
  if (m.type() !== 'error' && m.type() !== 'warning') return;
  const text = m.text();
  if (/GL Driver Message|GPU stall due to ReadPixels/.test(text)) { R.notes.push('webgl:' + text.slice(0, 80)); return; } // SwiftShader, see docs/Gesamtcheck.md
  R.console.push({ at: ts(), type: m.type(), text: text.slice(0, 300) }); log('CONSOLE', m.type() + ' ' + text.slice(0, 160));
});
page.on('pageerror', e => { R.pageErrors.push({ at: ts(), text: String(e).slice(0, 300) }); log('PAGEERR', String(e).slice(0, 160)); });

// Watcher in the page: AutoSteer on → off, control, connection, stale ticks, toasts.
const WATCH = () => {
  if (window.__soak) return;
  const S = window.__soak = { ev: [], ourOffAt: 0 };
  const P = (k, m) => S.ev.push([Date.now(), k, m]);
  const orig = window.showToast; window.showToast = function (m) { P('toast', String(m)); return orig.apply(this, arguments); };
  let as = null, ctl = null, conn = null, staleSince = 0;
  setInterval(() => {
    const now = performance.now();
    const a = !!(tick && tick.op && tick.op.autoSteer);
    if (as === true && !a) P('steerOff', JSON.stringify({ ctl: iHoldControl, conn: connState, ours: Date.now() - S.ourOffAt < 3000,
      sim: statusBar && statusBar.simEnabled, speed: statusBar && statusBar.simSpeedKph, field: !!(scene && scene.hasField), uturn: !!(tick.op && tick.op.executing) }));
    as = a;
    if (ctl !== iHoldControl) { if (ctl === true) P('controlLost', connState); ctl = iHoldControl; }
    if (conn !== connState) { P('conn', connState); conn = connState; }
    const stale = connState === 'connected' && lastTick && now - lastTick.t > 3000;
    if (stale && !staleSince) { staleSince = now; P('stale', Math.round(now - lastTick.t) + ' ms'); }
    if (!stale && staleSince) { P('staleEnd', Math.round(now - staleSince) + ' ms'); staleSince = 0; }
  }, 100);
};
async function drain() {
  let ev = [];
  try { ev = await page.evaluate(() => { const e = window.__soak ? window.__soak.ev : []; if (window.__soak) window.__soak.ev = []; return e; }); } catch (_) { return; }
  for (const [t, k, m] of ev) {
    const at = ((t - t0) / 1000).toFixed(0) + 's';
    if (k === 'toast') { R.toasts.push({ at, text: m }); log('TOAST', m); }
    else if (k === 'steerOff') { const d = JSON.parse(m); R.steerOff.push({ at, ...d }); if (!d.ours) log('STEER', 'off without our command ' + m); }
    else if (k === 'stale' || k === 'staleEnd') { R.stale.push({ at, k, m }); log('STALE', k + ' ' + m); }
    else if (k === 'controlLost') { R.steerOff.push({ at, controlLost: true, conn: m }); log('CONTROL', 'lost (' + m + ')'); }
    else if (k === 'conn') log('CONN', m);
  }
}
const send = c => page.evaluate(c => transport.send(c), c);
const ev = (fn, a) => page.evaluate(fn, a);
const ourOff = () => ev(() => { if (window.__soak) window.__soak.ourOffAt = Date.now(); });
async function waitControl(ms = 30000) { await page.waitForFunction(() => typeof iHoldControl !== 'undefined' && iHoldControl === true && connState === 'connected', null, { timeout: ms }); }
async function openPage() {
  await page.goto(URL0);
  await waitControl();
  await ev(WATCH);
}
const st = () => ev(() => ({ as: !!(tick && tick.op && tick.op.autoSteer), avail: !!(tick && tick.op && tick.op.autoSteerAvail),
  sim: statusBar && statusBar.simEnabled, kph: statusBar && statusBar.simSpeedKph, field: !!(scene && scene.hasField), job: statusBar && statusBar.jobName,
  ready: typeof TabletReady !== 'undefined' ? TabletReady.level : null, ut: !!(tick && tick.op && tick.op.youturn), sec: !!(tick && tick.op && (tick.op.sectionAuto || tick.op.sectionManual)) }));
async function speed(kph) {
  const s = await st(); let n = Math.round(((kph - (s.kph || 0)) / 0.5));
  while (n > 0) { await send('sim.speedUp'); n--; await sleep(60); }
  while (n < 0) { await send('sim.speedDown'); n++; await sleep(60); }
}
async function engage() { const s = await st(); if (!s.as && s.avail) await send('autosteer.toggle'); await sleep(500); return (await st()).as; }
async function disengage() { await ourOff(); await send('autosteer.off'); await sleep(300); }
async function sample(label) {
  const pm = await ev(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null)).catch(() => null);
  const m = { at: ts(), label, pageHeapMb: pm, hostRssMb: hostRssMb() };
  R.memory.push(m); log('MEM', JSON.stringify(m));
}
const drive = async (secs, label) => { const end = Date.now() + secs * 1000; while (Date.now() < end) { await sleep(5000); await drain(); } if (label) log('DRIVE', label); };
const deadline = t0 + MINUTES * 60000;

// ---- the run -------------------------------------------------------------------------------
startHost(); await waitHost();
await step('open page, take control', openPage);
await step('language ' + LANG, async () => { if (LANG === 'de') await send('app.setLanguage|de'); await sleep(1500); return ev(() => I18n.language); });
await step('legal notice and first setup shown', () => ev(() => ({ legal: !!document.getElementById('tui-legal') && !document.getElementById('tui-legal').hidden,
  setup: typeof TabletFirstSetup !== 'undefined' && TabletFirstSetup.isOpen })));
await step('read the notice', () => ev(() => { const b = document.querySelector('#tui-legal .tp-btn'); if (b) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); return !!b; }));
await step('first setup: every step', async () => { for (let i = 0; i < 6; i++) { await ev(i => TabletFirstSetup.open(i), i); await sleep(400); } await ev(() => document.querySelectorAll('.tui-sheet.open .x').forEach(x => x.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })))); return true; });
await step('simulator on', async () => { const s = await st(); if (!s.sim) await send('sim.toggleEnable'); await sleep(1500); return (await st()).sim; });
await step('ready light before a field', () => ev(() => TabletReady.checks().map(c => c[0] + ' ' + c[1])));
await step('field with boundary', async () => {
  await send('field.new|Soak'); await sleep(2500);
  await send('boundary.fromMapPoints|-120,-60;120,-60;120,420;-120,420'); await sleep(2500);
  return ev(() => !!(scene && scene.hasField));
});
await step('headland 20 m', async () => { await send('headland.wholeBoundary|20'); await sleep(2000); return true; });
await step('start job (Arbeit starten flow)', async () => {
  await ev(() => TabletWork.start()); await sleep(800);
  await send('field.startJob|Soak\tSpraying\tsoak run\tSoak job 1'); await sleep(2500);
  return (await st()).job;
});
await step('AB line through the field', async () => { await send('track.drawStraight'); await sleep(400); await send('track.drawPoint|0,-30'); await sleep(300); await send('track.drawPoint|0,380'); await sleep(1200); return (await st()).avail; });
await step('curve', async () => {
  await send('track.drawCurve'); await sleep(400);
  for (const p of ['30,-30', '40,60', '55,150', '45,250', '30,380']) { await send('track.drawPoint|' + p); await sleep(250); }
  await send('track.drawFinish'); await sleep(3000);
  return ev(() => (scene && scene.tracks ? scene.tracks.map(x => x.name + ':' + x.points.length) : null));
});
await step('back to the AB line', async () => { await send('track.cycle'); await sleep(800); return ev(() => tick && tick.activeTrackName); });
await step('U-turn on, sections auto', async () => { const s = await st(); if (!s.ut) await send('youturn.toggle'); await send('section.master'); await sleep(800); return await st(); });
await step('engage and drive 8 km/h', async () => { await speed(8); await sleep(1500); return engage(); });
await sample('start');

let cycle = 0, ignitionDone = false;
while (Date.now() < deadline) {
  cycle++;
  const left = () => Math.max(0, (deadline - Date.now()) / 1000);
  await step(`cycle ${cycle}: drive with U-turns`, async () => { if (!(await st()).ut) await send('youturn.toggle'); await engage(); await drive(Math.min(180, left())); return await st(); });
  if (Date.now() >= deadline) break;
  await step(`cycle ${cycle}: next pass and nudge`, async () => { await send('track.snapRight'); await sleep(500); await send('track.nudgeLeft'); await sleep(500); await send('track.resetNudge'); return true; });
  await step(`cycle ${cycle}: manual sections`, async () => {
    await send('section.manual'); await sleep(500);
    for (const i of [0, 1, 2]) { await send('section.toggle|' + i); await sleep(300); }
    await drive(20); await send('section.manual'); await sleep(300); await send('section.master'); return await st();
  });
  // Headland off turns the automatic U-turn off as well (upstream); switched on again here.
  await step(`cycle ${cycle}: headland on/off`, async () => { await send('headland.toggle'); await sleep(1500); await send('headland.toggle'); await sleep(800); if (!(await st()).ut) await send('youturn.toggle'); await sleep(500); return (await st()).ut; });
  // Changing the track while steering stops guidance ("track changed", upstream): counted as ours.
  await step(`cycle ${cycle}: curve for a while`, async () => { await ourOff(); await send('track.cycle'); await sleep(800); await engage(); await drive(Math.min(60, left())); await ourOff(); await send('track.cycle'); await sleep(800); return ev(() => tick && tick.activeTrackName); });
  await step(`cycle ${cycle}: ready light`, () => ev(() => ({ level: TabletReady.level, checks: TabletReady.checks().map(c => c[0] + ' ' + c[1]) })));
  const side = cycle % 6;
  if (side === 1) await step('work log', async () => { await ev(() => TabletWorkLog.open()); await sleep(1200); const n = await ev(() => TabletWorkLog.entries.length); await ev(() => document.querySelector('#tui-worklog .x').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))); return { entries: n }; });
  if (side === 2) await step('acceptance record', async () => {
    await ev(() => TabletAcceptance.open()); await sleep(800);
    const made = await ev(() => { const b = [...document.querySelectorAll('#tui-accept button')].find(x => /Abnahmeprotokoll|acceptance record/i.test(x.textContent)); if (b) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); return !!b; });
    await sleep(1200);
    await ev(() => document.querySelector('#tui-accept .x').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })));
    return { made, records: await ev(() => TabletWorkLog.records('acceptance').length) };
  });
  if (side === 3) await step('profile backup', async () => { await send('backup.create'); await sleep(2500); await send('backup.list'); await ev(() => TabletBackup.open()); await sleep(1200); const s = await ev(() => TabletBackup.state); await ev(() => document.querySelectorAll('.tui-sheet.open .x').forEach(x => x.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })))); return s; });
  if (side === 4) await step('update check', async () => { const r = await ev(() => TabletUpdate.check()); return r && (r.kind + (r.why ? ' ' + r.why : '')); });
  if (side === 5) await step('demo mode with a job open', async () => {
    await disengage();
    const before = await ev(() => TabletDemo.active); await ev(() => TabletDemo.start()); await sleep(2000);
    const during = await ev(() => TabletDemo.active); await ourOff(); await ev(() => TabletDemo.end('')); await sleep(1500);
    const s = await st(); if (!s.sim) await send('sim.toggleEnable'); await sleep(1000);
    return { before, during, after: await ev(() => TabletDemo.active), sim: (await st()).sim };
  });
  if (side === 0) await step('close job (work log), open a new one', async () => {
    await disengage(); await speed(0); await sleep(1500);
    await send('field.close'); await sleep(2500);
    const prompt = await ev(() => statusBar && statusBar.unsavedCoveragePrompt); if (prompt) { await send('coverage.saveJob'); await sleep(2500); }
    await send('field.openOnly|Soak'); await sleep(2500);
    await send(`field.startJob|Soak\tSpraying\tsoak run\tSoak job ${cycle + 1}`); await sleep(2500);
    await speed(8); await send('section.master'); await sleep(500);
    return { job: (await st()).job, entries: await ev(() => TabletWorkLog.entries.filter(e => !e.kind).length) };
  });
  // Ignition off once, after about two thirds: the host dies mid-job and starts again.
  if (!ignitionDone && Date.now() - t0 > MINUTES * 60000 * 0.6) {
    ignitionDone = true;
    await step('ignition off mid-job (kill -9) and restart', async () => {
      const before = await ev(() => ({ open: !!TabletWorkLog.entries.find(e => !e.kind && !e.end), n: TabletWorkLog.entries.length }));
      host.expectedExit = true; host.kill('SIGKILL'); await sleep(4000);
      startHost(); await waitHost(); await sleep(1000);
      await page.reload(); await waitControl(60000); await ev(WATCH);
      await sleep(8000);
      const after = await ev(() => ({ n: TabletWorkLog.entries.length, unsent: TabletWorkLog.unsent, hostAt: TabletWorkLog.hostAt }));
      const s = await st(); if (!s.sim) await send('sim.toggleEnable');
      await send('field.resumeLast'); await sleep(3000); await speed(8); await send('section.master');
      return { before, after, job: (await st()).job };
    });
  }
  await sample('cycle ' + cycle);
}

await drain();
await step('end: steering off, job closed', async () => { await disengage(); await speed(0); await sleep(1000); await send('field.close'); await sleep(2000); const p = await ev(() => statusBar && statusBar.unsavedCoveragePrompt); if (p) await send('coverage.saveJob'); await sleep(2000); return await st(); });
await sample('end');
R.finished = new Date().toISOString();
R.summary = {
  steps: R.steps.length, failedSteps: R.steps.filter(s => !s.ok).map(s => s.name),
  consoleErrors: R.console.filter(c => c.type === 'error').length, consoleWarnings: R.console.filter(c => c.type === 'warning').length,
  pageErrors: R.pageErrors.length,
  steerOffNotOurs: R.steerOff.filter(s => !s.controlLost && !s.ours).length, controlLost: R.steerOff.filter(s => s.controlLost).length,
  staleEvents: R.stale.filter(s => s.k === 'stale').length,
  hostUnexpectedExits: R.hostExits.filter(h => !h.expected).length,
  memory: { first: R.memory[0], last: R.memory[R.memory.length - 1] },
  webglNotes: R.notes.length,
};
writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log('SUMMARY ' + JSON.stringify(R.summary));
await browser.close();
if (host) { host.expectedExit = true; host.kill(); }
process.exit(0);
