// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// The dictionary arrives late (review 10.11.2026, measure 3): a German page whose i18n/de.json
// comes some seconds after the page, as on a slow tablet. Before it arrives the app opens a field,
// makes a line (the direction card shows), starts "Start work" and shows the notice at first
// start; once it is there, no English text may be left anywhere on the page (texts and titles
// whose English key has a different German translation). Needs a running host and Playwright.
// Exit code 1 when English is left.
//
//   node Tools/i18n-late-check.mjs [--url http://localhost:5174] [--delay 8000] [--out i18n-late.json]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://localhost:5174/'), delay = +arg('delay', '8000'), out = arg('out', 'i18n-late.json');
const { chromium } = createRequire(import.meta.url)('playwright');
const root = new URL('..', import.meta.url);
const en = JSON.parse(readFileSync(new URL('Shared/AgOpenWeb.RemoteServer/wwwroot/i18n/en.json', root), 'utf8'));
const de = JSON.parse(readFileSync(new URL('Shared/AgOpenWeb.RemoteServer/wwwroot/i18n/de.json', root), 'utf8'));
const germanTexts = new Set(Object.values(de));
// English keys with a different German text; a key that is itself German elsewhere ("Module") is no finding.
const keys = Object.keys(en).filter(k => de[k] && de[k] !== k && /[a-z]{3}/.test(k) && !germanTexts.has(k));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'de-DE', hasTouch: true });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false })); // the notice at first start too
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.route('**/i18n/*.json', async r => { await sleep(delay); await r.continue(); });
await page.goto(url);
await page.waitForFunction(() => typeof iHoldControl !== 'undefined' && iHoldControl === true && tick && appInfo, null, { timeout: 90000 });
await page.evaluate(() => transport.send('app.setLanguage|de'));
await page.evaluate(() => transport.send('field.new|I18nLate'));
await sleep(1500);
await page.evaluate(() => { transport.send('track.drawStraight'); setTimeout(() => transport.send('track.drawPoint|0,-30'), 300); setTimeout(() => transport.send('track.drawPoint|0,300'), 600); });
await sleep(1200);
await page.evaluate(() => TabletWork.start());
const early = await page.evaluate(() => I18n.text('Steering') === 'Steering');
await page.waitForFunction(() => I18n.text('Steering') !== 'Steering', null, { timeout: delay + 60000 });
await sleep(2500);
const found = await page.evaluate(keys => {
  const K = new Set(keys), res = [];
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim(), e = n.parentElement;
    if (!t || !e || !vis(e) || e.closest('script, style, textarea')) continue;
    if (K.has(t) || K.has(t.replace(/[:…]$/, ''))) res.push(((e.closest('[id]') || {}).id || '?') + ': ' + t);
  }
  for (const e of document.querySelectorAll('[title]')) if (vis(e) && K.has(e.title)) res.push((e.id || e.className) + ' (title): ' + e.title);
  return res;
}, keys);
await page.evaluate(() => { transport.send('field.close'); });
await browser.close();
writeFileSync(out, JSON.stringify({ delay, drawnBeforeDictionary: early, english: found, pageErrors: errors }, null, 1));
console.log(`dictionary ${delay} ms late (page drawn before it: ${early}); English left: ${found.length}` + (errors.length ? `; page errors: ${errors.length}` : ''));
for (const f of found) console.log('  ' + f);
process.exit(found.length || errors.length || !early ? 1 : 0);
