#!/usr/bin/env node
// UI-Audit: fährt ein festes Szenario im Simulator ab, macht von jeder Hauptansicht einen
// Screenshot und misst Tippflächen, Schriftgrößen und Kontrast.
//
//   node capture.js --out ./out/vorher
//   node capture.js --out ./out/handschuh --ls aow.ui.scale=glove --ls aow.ui.sun=1
//
// Erwartet einen frisch gestarteten Host (restart-host.sh): das Szenario legt ein Feld an,
// schaltet Teilbreiten und AutoSteer im Simulator ein. Ist ein AutoSteer- oder Maschinenmodul
// im Netz zu sehen, bricht das Skript ab, bevor es etwas einschaltet.
'use strict';

const fs = require('fs');
const path = require('path');
const L = require('./lib');

function parseArgs(argv) {
  const a = { url: 'http://localhost:5174/', out: 'out', ls: {}, viewport: { width: 1280, height: 800 } };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--url') { a.url = v; i++; }
    else if (k === '--out') { a.out = v; i++; }
    else if (k === '--ls') { const j = v.indexOf('='); a.ls[v.slice(0, j)] = v.slice(j + 1); i++; }
    else if (k === '--viewport') { const [w, h] = v.split('x').map(Number); a.viewport = { width: w, height: h }; i++; }
    else if (k === '-h' || k === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 10).join('\n')); process.exit(0); }
    else throw new Error('Unbekannte Option: ' + k);
  }
  return a;
}

const GLARE_CSS = 'html{filter:contrast(0.45) brightness(1.45) saturate(0.6)}';

(async () => {
  const args = parseArgs(process.argv);
  const shotDir = path.join(args.out, 'screens');
  fs.mkdirSync(shotDir, { recursive: true });
  const browser = await L.launch();
  const views = {};

  const record = async (page, name, { wait = 700, guideline = null } = {}) => {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: path.join(shotDir, name + '.png') });
    const m = await L.measure(page);
    const contrast = await L.contrast(page);
    const v = { sum: L.summarize(m), controls: m.controls, contrast, contrastByRegion: L.contrastByRegion(contrast) };
    if (guideline) v.guideline = await L.guidelineContrast(page, guideline);
    views[name] = v;
    console.log(name.padEnd(28), `n=${v.sum.n} <48=${v.sum.lt48} >=64=${v.sum.ge64} text<14=${v.sum.textLt14}/${v.sum.textNodes}`
      + (v.guideline ? ` leitlinie=${v.guideline.cr}:1` : ''));
  };
  const glareShot = async (page, name) => {
    const tag = await page.addStyleTag({ content: GLARE_CSS });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shotDir, name + '.png') });
    await tag.evaluate(el => el.remove());
  };

  const { page: p } = await L.openPage(browser, { url: args.url, viewport: args.viewport, localStorage: args.ls });
  const send = c => p.evaluate(c => transport.send(c), c);
  // Offenes Panel oder offenen Dialog über seinen sichtbaren Schließen-Knopf schließen
  // (echter Klick, weil die Knöpfe auf pointerdown hören).
  const close = async () => {
    const found = await p.evaluate(() => {
      const c = [...document.querySelectorAll('#dialoghost.open [id$="-close"], #dialoghost.open .dlg-cancel, .ln-panel.open .ln-closex, .ln-panel.open .ln-x, #as-close')]
        .filter(b => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden');
      if (!c.length) return false;
      c[c.length - 1].setAttribute('data-uiaudit-close', '1');
      return true;
    });
    if (found) {
      await p.click('[data-uiaudit-close="1"]', { timeout: 3000 }).catch(async () => {
        // Verdeckt (z. B. von einer Meldung): Ereignisse direkt am Knopf auslösen.
        const blocker = await p.evaluate(() => {
          const el = document.querySelector('[data-uiaudit-close="1"]');
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
          el.click();
          return top ? (top.id || top.className || top.tagName) : '?';
        });
        console.log('  (Schließen-Knopf verdeckt von', blocker + '; direkt ausgelöst)');
      });
      await p.evaluate(() => document.querySelectorAll('[data-uiaudit-close]').forEach(e => e.removeAttribute('data-uiaudit-close')));
    }
    await p.waitForTimeout(400);
  };
  // Teilbreiten-Automatik, AutoSteer und U-Turn einschalten, falls sie aus sind (Zustand aus
  // dem Tick, nicht blind umschalten: ein zweiter Klick würde wieder ausschalten).
  const ensureOn = async () => {
    for (const [key, id] of [['sectionAuto', 'rn-auto'], ['autoSteer', 'rn-steer'], ['youturn', 'rn-youturn']]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await p.evaluate(k => !!(tick && tick.op && tick.op[k]), key)) break;
        await p.click('#' + id);
        await p.waitForTimeout(1000);
      }
    }
    const op = await p.evaluate(() => tick.op);
    if (!op.sectionAuto || !op.autoSteer || !op.youturn) console.log('  Hinweis: nicht alles an:', JSON.stringify(op));
  };
  const simBarOpen = () => p.evaluate(() => getComputedStyle(document.getElementById('simbar')).display !== 'none');

  // --- ohne Feld ---------------------------------------------------------------------------
  await record(p, '01-start-no-field');
  for (const id of ['filemenu', 'screenalerts', 'tools', 'vehicle', 'autosteer', 'fieldops', 'fieldtools', 'network']) {
    await p.click('#ln-' + id);
    await record(p, '02-left-' + id);
    await close();
  }
  await p.click('#sb-modbtn'); await record(p, '03-status-modules'); await p.click('#sb-modbtn'); await close();
  await p.click('#sb-fixbtn'); await record(p, '03-status-gps'); await p.click('#sb-fixbtn'); await close();

  // --- Sicherheitsprüfung: keine echten Module ----------------------------------------------
  const hw = await p.evaluate(() => statusBar && (statusBar.autoSteerOk || statusBar.autoSteerIp || statusBar.machineOk || statusBar.machineIp));
  if (hw) {
    console.error('ABBRUCH: Ein AutoSteer- oder Maschinenmodul ist im Netz sichtbar. Das Szenario schaltet Lenkung und Teilbreiten ein; nur ohne angeschlossene Module laufen lassen.');
    await browser.close();
    process.exit(2);
  }

  // --- Feld im Simulator ---------------------------------------------------------------------
  await send('config.set|tool.numSections:8'); await p.waitForTimeout(400);
  await send('field.new|Demo-Schlag'); await p.waitForTimeout(2500);
  await send('boundary.fromMapPoints|-120,-60;120,-60;120,400;-120,400'); await p.waitForTimeout(2500);
  await send('headland.wholeBoundary|18'); await p.waitForTimeout(2000);
  // Ohne Auftrag (Job) zeichnet der Host keine Bearbeitung auf und die Teilbreiten bleiben aus.
  await send('field.startJob|Demo-Schlag\tAudit\t\tAudit'); await p.waitForTimeout(2000);
  if (!(await simBarOpen())) await p.click('#sim-launch');
  for (let i = 0; i < 16; i++) await send('sim.speedUp'); // 8 km/h
  await p.waitForTimeout(3000);
  await send('track.aPlus'); await p.waitForTimeout(1000); // A+ braucht eine Position ≠ 0/0
  await ensureOn();
  await record(p, '06-driving-sections-steer', { wait: 5000 });

  await p.click('#bn-abmenu'); await record(p, '07-bottom-ab-flyout'); await p.click('#bn-abmenu'); await close();
  await p.click('#bn-flags'); await record(p, '07-bottom-flags-flyout'); await p.click('#bn-flags'); await close();
  await p.click('#bn-abmenu'); await p.waitForTimeout(300); await p.click('#bn-tracks'); await record(p, '08-tracks-dialog'); await close();
  await p.click('#ln-fieldops'); await p.waitForTimeout(300); await p.click('#fo-fields'); await record(p, '09-fields-dialog'); await close();
  await p.click('#ln-autosteer'); await p.waitForTimeout(300); await p.click('#as-expand'); await record(p, '10-autosteer-expanded'); await close();
  await p.click('#ln-vehicle'); await p.waitForTimeout(300); await p.click('#vth-vehconfig'); await record(p, '11-vehicle-config'); await close();

  // --- Fahrbild, Heading-Up, ohne Simulator-Leiste -------------------------------------------
  if (await simBarOpen()) await p.click('#sim-close');
  await ensureOn();
  await p.evaluate(() => { cameraMode = 1; }); // Heading-Up: Fahrzeug mittig, Leitlinie senkrecht
  const vp = args.viewport;
  const gl = { y: Math.round(vp.height * 0.3), x0: Math.round(vp.width / 2 - 60), x1: Math.round(vp.width / 2 + 60) };
  await record(p, '13-day-driving-clean', { wait: 3000, guideline: gl });
  await glareShot(p, '14-day-glare-simulated');
  await send('display.toggleTheme');
  await record(p, '15-night-driving', { wait: 1500, guideline: gl });
  await glareShot(p, '15b-night-glare-simulated');
  await send('display.toggleTheme'); await p.waitForTimeout(500);

  // --- zweites Gerät als Observer, 7"-Tablet -------------------------------------------------
  {
    const { ctx, page } = await L.openPage(browser, { url: args.url, viewport: vp, localStorage: args.ls, waitForControl: false });
    await page.waitForTimeout(2500);
    await page.evaluate(() => { cameraMode = 1; });
    await record(page, '16-follower-readonly', { wait: 1500 });
    await ctx.close();
  }
  {
    const { ctx, page } = await L.openPage(browser, { url: args.url, viewport: { width: 1024, height: 600 }, localStorage: args.ls, waitForControl: false });
    await page.waitForTimeout(2500);
    await page.evaluate(() => { cameraMode = 1; });
    await record(page, '17-7inch-1024x600', { wait: 1500 });
    await page.click('#ln-autosteer');
    await record(page, '17b-7inch-autosteer-panel');
    await ctx.close();
  }

  // --- Assistent (Vollbild, deshalb zuletzt) -------------------------------------------------
  await p.click('#ln-tools'); await p.waitForTimeout(300); await p.click('#tl-wizard');
  await record(p, '18-steer-wizard', { wait: 1200 });

  const meta = { date: new Date().toISOString(), url: args.url, viewport: vp, localStorage: args.ls };
  fs.writeFileSync(path.join(args.out, 'metrics.json'), JSON.stringify({ meta, views }, null, 1));
  console.log('\nGeschrieben:', path.join(args.out, 'metrics.json'));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
