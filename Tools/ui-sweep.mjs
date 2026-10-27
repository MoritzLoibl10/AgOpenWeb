// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// Surface sweep of the web client (fork): opens every panel, tab, dialog, fly-out and the
// fork's sheets at a given size and language, in day and night mode, and lists what looks wrong:
// text cut off or running out of its box, controls overlapping, English left in a German UI,
// touch targets under 44 px and text with low contrast (WCAG ratio < 4.5, < 3 for large text).
// Needs a running host (default http://localhost:5174) and Playwright.
//
//   node Tools/ui-sweep.mjs [--url http://localhost:5174] [--size 1024x600] [--lang de] [--out sweep.json]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://localhost:5174/'), [W, H] = arg('size', '1024x600').split('x').map(Number);
const lang = arg('lang', 'de'), out = arg('out', 'ui-sweep.json');
const { chromium } = createRequire(import.meta.url)('playwright');
const root = new URL('..', import.meta.url);
const en = JSON.parse(readFileSync(new URL('Shared/AgOpenWeb.RemoteServer/wwwroot/i18n/en.json', root), 'utf8'));
const tl = lang === 'en' ? {} : JSON.parse(readFileSync(new URL(`Shared/AgOpenWeb.RemoteServer/wwwroot/i18n/${lang}.json`, root), 'utf8'));
// Keys whose translation differs from the English: shown as is, they are English left over.
const untranslated = Object.keys(en).filter(k => tl[k] && tl[k] !== k);

// Every surface as [name, script that opens it, root selector].
const SURFACES = () => {
  const s = [['main screen', 'lnCloseAll(); closeDialog();', 'body']];
  for (const p of LN_NAV_PANELS) {
    const open = `closeDialog(); lnCloseAll(); document.getElementById('${p}').classList.add('open');`;
    s.push([p, open, '#' + p]);
    document.querySelectorAll(`#${p} .cfg-tab`).forEach((b, i) => s.push([`${p} / tab ${i + 1}`,
      open + `document.querySelectorAll('#${p} .cfg-tab')[${i}].dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));`, '#' + p]));
  }
  for (const c of document.querySelectorAll('#dialoghost .dlg-card[id]')) s.push([c.id, `lnCloseAll(); openDialog('${c.id}');`, '#' + c.id]);
  s.push(['steer wizard', 'lnCloseAll(); closeDialog(); openSteerWizard();', '#wizard-overlay']);
  for (const f of document.querySelectorAll('.bn-flyout[id]'))
    s.push([f.id, `lnCloseAll(); closeDialog(); document.getElementById('${f.id}').classList.add('open');`, '#' + f.id]);
  // Fork sheets and menus
  const fire = sel => `document.querySelector('${sel}').dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true}));`;
  const reset = `lnCloseAll(); closeDialog(); document.querySelectorAll('.tui-sheet.open, .tp-scrim.open').forEach(e => e.classList.remove('open'));`;
  s.push(['menu', reset + fire('#tui-menu-btn'), '#tui-menu']);
  s.push(['ready list', reset + `document.getElementById('tui-ready').hidden = false; TabletReady.level;`, '#tui-ready']);
  s.push(['first setup', reset + 'TabletFirstSetup.open(0);', '#tui-setup1']);
  for (let i = 1; i < 6; i++) s.push([`first setup / step ${i + 1}`, reset + `TabletFirstSetup.open(${i});`, '#tui-setup1']);
  s.push(['start work', reset + 'TabletWork.start();', '#tui-work']);
  s.push(['work log', reset + 'TabletWorkLog.open();', '#tui-worklog']);
  s.push(['acceptance record', reset + 'TabletAcceptance.open();', '#tui-accept']);
  s.push(['info', reset + 'TabletBrand.openInfo();', '#tb-sheet']);
  s.push(['help', reset + 'TabletBrand.openHelp();', '#tb-sheet']);
  s.push(['bench checklist', reset + 'TabletBench.open();', 'body']);
  s.push(['profile backup', reset + 'TabletBackup.open();', 'body']);
  s.push(['legal notice', reset + 'TabletLegal.show();', 'body']);
  return s;
};

// The checks, run in the page on one surface root.
const CHECK = ([sel, untranslated]) => {
  const rootEl = document.querySelector(sel) || document.body;
  const skip = new Set(untranslated);
  const vis = e => { for (let x = e; x; x = x.parentElement) { const cs = getComputedStyle(x);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; }
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const name = e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.classList[0] ? '.' + e.classList[0] : '')) + (e.textContent.trim() ? ' "' + e.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) + '"' : '');
  const out = [];
  const els = [...rootEl.querySelectorAll('*')].filter(vis);
  // Text cut off or running out of its box
  for (const e of els) {
    const own = [...e.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
    if (!own || e.closest('canvas, svg')) continue;
    const cs = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll')
      out.push({ k: 'cut', w: name(e), d: `${e.scrollWidth}>${e.clientWidth}px` });
    const r = e.getBoundingClientRect();
    if (r.right > innerWidth + 1) out.push({ k: 'offscreen', w: name(e), d: `right ${Math.round(r.right)}` });
  }
  // Controls overlapping (only controls that can be tapped)
  const ctl = els.filter(e => e.matches('button, input, select, [role="button"], .tbk-it, .tui-tile'));
  for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) {
    const a = ctl[i], b = ctl[j]; if (a.contains(b) || b.contains(a)) continue;
    const p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
    const ox = Math.min(p.right, q.right) - Math.max(p.left, q.left), oy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
    if (ox > 2 && oy > 2) {
      const top = document.elementFromPoint(Math.max(p.left, q.left) + ox / 2, Math.max(p.top, q.top) + oy / 2);
      if (top && (a.contains(top) || b.contains(top))) out.push({ k: 'overlap', w: name(a) + ' × ' + name(b), d: `${Math.round(ox)}×${Math.round(oy)}px` });
    }
  }
  // English left over: a text that is an English key with a different translation
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim(), e = n.parentElement;
    if (!t || !e || !vis(e) || e.closest('[translate="no"] input, script, style, textarea')) continue;
    if (skip.has(t) || skip.has(t.replace(/[:…]$/, ''))) out.push({ k: 'english', w: name(e), d: t.slice(0, 60) });
  }
  // Touch targets under 44 px
  for (const e of ctl) { const r = e.getBoundingClientRect();
    if ((r.width < 44 || r.height < 44) && !e.matches('input[type="range"], input[type="text"], input[type="number"], input:not([type])'))
      out.push({ k: 'small', w: name(e), d: `${Math.round(r.width)}×${Math.round(r.height)}px` }); }
  // Contrast
  const rgb = s => { const m = s.match(/[\d.]+/g); return m ? m.map(Number) : [0, 0, 0, 1]; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const bgOf = e => { for (let x = e; x; x = x.parentElement) { const cs = getComputedStyle(x);
      if (cs.backgroundImage !== 'none' && !cs.backgroundImage.startsWith('linear')) return null;
      const c = rgb(cs.backgroundColor); if ((c[3] ?? 1) > 0.9) return c; }
    return rgb(getComputedStyle(document.body).backgroundColor); };
  for (const e of els) {
    if (![...e.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim())) continue;
    const cs = getComputedStyle(e), fg = rgb(cs.color), bg = bgOf(e);
    if (!bg || (fg[3] ?? 1) < 0.5) continue;
    const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
    if (ratio < (large ? 3 : 4.5)) out.push({ k: 'contrast', w: name(e), d: ratio.toFixed(2) });
  }
  return out;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(url);
await page.waitForFunction(() => typeof iHoldControl !== 'undefined' && iHoldControl === true && config && appInfo, null, { timeout: 60000 });
await page.evaluate(l => transport.send('app.setLanguage|' + l), lang);
await page.waitForFunction(l => I18n.language === l, lang);
await page.waitForTimeout(1500);
const report = [];
for (const day of [true, false]) {
  await page.evaluate(d => { if (!!(config.display && config.display.isDayMode) !== d) transport.send('display.toggleTheme'); }, day);
  await page.waitForFunction(d => !!(config.display && config.display.isDayMode) === d, day, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  for (const [name, js, sel] of await page.evaluate(SURFACES)) {
    try { await page.evaluate(js); } catch (e) { report.push({ mode: day ? 'day' : 'night', surface: name, k: 'error', w: '', d: String(e).slice(0, 80) }); continue; }
    await page.waitForTimeout(250);
    for (const r of await page.evaluate(CHECK, [sel, untranslated])) report.push({ mode: day ? 'day' : 'night', surface: name, ...r });
  }
}
await page.evaluate(() => { lnCloseAll(); closeDialog(); });
await browser.close();
writeFileSync(out, JSON.stringify(report, null, 1));
const by = {}; for (const r of report) by[r.k] = (by[r.k] || 0) + 1;
console.log(JSON.stringify(by));
