// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: UI scale, labelled drive buttons, sun theme (TabletUi, Phase 1).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

// ===== Tablet UI (Phase 1) ====================================================
// Cab-tablet additions, kept in this one section (CSS: <style id="tablet-ui"> in index.html)
// so the fork rebases cleanly. Per-device settings in localStorage:
//   aow.ui.scale = normal | large | glove   — touch-target size
//   aow.ui.sun   = 1                        — sun theme (high contrast; day theme only)
// Display only: no new commands, nothing sent to the host changes. The upstream render
// functions wrapped below keep their behaviour; the wrappers only recolour/restyle the map
// in the sun theme and shift the canvas light bar under a taller status bar.
let tuiBarDy = null; // canvas light bar offset, set by the Phase 2 layout (null = Phase 1 offset)
// scale-default:begin
// First start on a device: the glove size, for gloved hands in the cab. A device that used the
// app before (it has its own keys in the browser storage) keeps the size it had, normal; a stored
// choice always wins. Automated browsers (the CI layout checks) keep normal and store nothing.
function tuiInitialScale(stored, keys, automated) {
  if (stored !== null && stored !== undefined) return { scale: stored, store: false };
  if (automated) return { scale: 'normal', store: false };
  const used = keys.some(k => typeof k === 'string' && (k.startsWith('aow.') || k.startsWith('agopenweb.')));
  return { scale: used ? 'normal' : 'glove', store: true };
}
// scale-default:end
const TabletUi = (() => {
  const SCALES = ['normal', 'large', 'glove'];
  const DY = { normal: 0, large: 10, glove: 18 }; // = --tui-dy in index.html
  const lsGet = (k, d) => { try { const v = window.localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch (_) { /* private / blocked */ } };
  const first = tuiInitialScale(lsGet('aow.ui.scale', null),
    (() => { try { return Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i)); } catch (_) { return []; } })(),
    !!navigator.webdriver);
  if (first.store) lsSet('aow.ui.scale', first.scale);
  let scale = SCALES.includes(first.scale) ? first.scale : 'normal';
  let sun = lsGet('aow.ui.sun', '0') === '1';
  const root = document.documentElement;

  function apply() {
    root.setAttribute('data-tui-scale', scale);
    if (sun) root.setAttribute('data-tui-sun', ''); else root.removeAttribute('data-tui-sun');
    syncSettingsUi();
  }

  // --- Settings rows in Screen & Alerts (own classes: the panel's .sa-tgl handlers send config.set)
  const sa = document.getElementById('screenalerts');
  const box = document.createElement('div');
  box.innerHTML =
    '<div class="cfg-label">' + tr('Touch & Contrast (this device)') + '</div>' +
    '<div class="tui-seg">' +
    '<button class="tui-opt" data-tui-scale="normal">' + tr('Normal') + '</button>' +
    '<button class="tui-opt" data-tui-scale="large">' + tr('Large') + '</button>' +
    '<button class="tui-opt" data-tui-scale="glove">' + tr('Glove') + '</button>' +
    '<button class="tui-opt" data-tui-sun="1">' + tr('Sun') + '</button>' +
    '</div>' +
    '<div class="tui-hint">' + tr('Glove: every button at least 64 px. Sun: black on white for bright daylight; works with the day theme.') + '</div>';
  if (sa) sa.insertBefore(box, sa.querySelector('.cfg-label'));
  for (const b of box.querySelectorAll('.tui-opt')) {
    b.addEventListener('pointerdown', e => {
      e.stopPropagation();
      if (b.dataset.tuiScale) { scale = b.dataset.tuiScale; lsSet('aow.ui.scale', scale); }
      else { sun = !sun; lsSet('aow.ui.sun', sun ? '1' : '0'); }
      apply();
    });
  }
  function syncSettingsUi() {
    for (const b of box.querySelectorAll('.tui-opt[data-tui-scale], .tui-opt[data-tui-sun]'))
      b.classList.toggle('active', b.dataset.tuiScale ? b.dataset.tuiScale === scale : sun);
  }

  // --- Right nav: name + state under each icon -------------------------------------
  const RN_LABELS = [
    ['rn-contour', tr('Contour')], ['rn-contourlock', tr('Lock')], ['rn-manual', tr('Manual')],
    ['rn-auto', tr('Auto')], ['rn-youturn', tr('U-Turn')], ['rn-steer', tr('Steer')],
    ['rn-autotrack', tr('Auto track')], ['rn-cycle', tr('Next track')], ['rn-cycleback', tr('Previous track')], ['rn-isobus', 'ISOBUS'],
  ];
  const rnState = {};
  for (const [id, label] of RN_LABELS) {
    const b = document.getElementById(id);
    if (!b) continue;
    const l = document.createElement('span'); l.className = 'tui-rn-lbl'; l.textContent = label;
    const s = document.createElement('span'); s.className = 'tui-rn-st';
    b.append(l, s);
    rnState[id] = { b, s, last: null };
  }
  function rnSet(id, on, text) {
    const r = rnState[id];
    if (!r || r.last === text) return;
    r.last = text; r.s.textContent = text; r.b.classList.toggle('tui-on', on);
  }
  function renderRightNavLabels() {
    const op = tick && tick.op;
    if (!op || !scene || !scene.hasField) return;
    const onOff = v => (v ? tr('On') : tr('Off'));
    rnSet('rn-contour', !!op.contour, onOff(op.contour));
    rnSet('rn-contourlock', !!scene.contourLocked, onOff(scene.contourLocked));
    rnSet('rn-manual', !!op.sectionManual, onOff(op.sectionManual));
    rnSet('rn-auto', !!op.sectionAuto, onOff(op.sectionAuto));
    rnSet('rn-youturn', !!op.youturn, onOff(op.youturn));
    const at = !!(tick.tools && tick.tools.autoTrack);
    rnSet('rn-autotrack', at, onOff(at));
    const iso = statusBar && statusBar.isobus;
    if (iso) rnSet('rn-isobus', !!iso.sectionControl, !iso.sections ? '—' : onOff(iso.sectionControl));
    rnSet('rn-steer', !!op.autoSteer && !op.moduleNotSteering,
      !op.autoSteerAvail ? tr('No line') : !op.autoSteer ? tr('Off') : op.moduleNotSteering ? tr('Not steering') : tr('On'));
  }

  // --- Section buttons carry their state code, so the sun theme can recolour them ---
  function tagSections() {
    const secs = tick && tick.sections;
    if (!secs || !sectionBar.classList.contains('open')) return;
    for (const b of sectionBar.querySelectorAll('button[data-idx], button[data-zone]')) {
      const st = String(secs[+(b.dataset.idx !== undefined ? b.dataset.idx : b.dataset.last)] | 0);
      if (b.dataset.st !== st) b.dataset.st = st;
    }
  }

  // --- Lower-right cluster (roll gauge + camera pad) never under the right nav or bottom stack
  // Positions are worked out from the unshifted layout every time, so moving the cluster
  // never feeds back into the decision.
  const lr = document.getElementById('lowerright');
  const rnRoot = document.getElementById('rightnav');
  const stack = document.getElementById('bottomstack');
  let lrKey = '';
  function placeLowerRight() {
    if (!lr) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const lrW = lr.offsetWidth, lrH = lr.offsetHeight;
    let right = 14, bottom = 72;
    const rn = rnRoot && getComputedStyle(rnRoot).display !== 'none' ? rnRoot.getBoundingClientRect() : null;
    if (rn && rn.height > 0 && rn.bottom + 8 > vh - bottom - lrH) right = vw - rn.left + 36; // the roll gauge sticks out 32 px to the right
    const bn = stack ? stack.getBoundingClientRect() : null; // sim bar + sections + bottom nav
    if (bn && bn.width > 0 && bn.height > 0) {
      const x1 = vw - right - lrW, x2 = vw - right;
      if (x1 < bn.right && x2 > bn.left && vh - bottom > bn.top - 8) bottom = vh - bn.top + 8;
    }
    const key = right + ',' + bottom;
    if (key === lrKey) return;
    lrKey = key;
    lr.style.setProperty('--tui-lr-right', right + 'px');
    lr.style.setProperty('--tui-lr-bottom', bottom + 'px');
  }

  // --- Keya hint next to the motor driver choice (AutoSteer panel + wizard) ----------
  const KEYA_HTML = '<b translate="no">Keya (CAN)</b>: ' + tr('The AiO board drives a Keya motor over CAN and detects it by itself; the IBT2 / Cytron choice does not change that. For a kickout when the wheel is turned by hand, turn on Current Turn.');
  function addKeyaHints() {
    const sel = document.querySelector('select[data-key="autosteer.motorDriver"]');
    const card = sel && sel.closest('.as-card');
    if (card && !card.querySelector('.tui-keya')) {
      const d = document.createElement('div'); d.className = 'tui-keya'; d.innerHTML = KEYA_HTML; card.appendChild(d);
    }
    for (const b of document.querySelectorAll('[data-activekey="autosteer.motorDriver"]')) {
      const row = b.closest('.wz-row');
      if (row && !(row.nextElementSibling && row.nextElementSibling.classList.contains('tui-keya'))) {
        const d = document.createElement('div'); d.className = 'tui-keya'; d.innerHTML = KEYA_HTML;
        row.after(d);
      }
    }
  }

  // --- Map in the sun theme: light plain ground, dark wide lines ---------------------
  const SUN_LINES = {
    guidance: 'rgb(130,0,85)', boundary: 'rgb(160,20,10)', boundaryInner: 'rgb(120,90,0)',
    headland: 'rgb(150,95,0)', track: 'rgb(110,80,0)', reference: 'rgb(80,30,150)',
    next: 'rgb(0,95,110)', uturn: 'rgb(0,110,40)', extraGuide: 'rgba(0,100,30,0.75)',
  };
  const SUN_WIDE = ['guidance', 'next', 'uturn', 'reference', 'headland', 'boundary', 'boundaryInner', 'track'];
  const SUN_GROUND = '#f3f3ef';
  const dayClear = MAP_CLEAR.day;
  let paintsFor = null, paintsSun = null, origColors = null;
  const sunActive = () => sun && mapIsDay;
  function applySunPaints() {
    if (typeof SKP === 'undefined' || !SKP) return;
    const s = sunActive();
    if (paintsFor === SKP && paintsSun === s) return;
    if (paintsFor !== SKP) { // paints (re)built: remember upstream colours
      origColors = {};
      for (const k of Object.keys(SUN_LINES)) if (SKP[k]) origColors[k] = SKP[k].getColor();
    }
    for (const k of Object.keys(SUN_LINES)) if (SKP[k]) SKP[k].setColor(s ? ckColor(SUN_LINES[k]) : origColors[k]);
    MAP_CLEAR.day = s ? SUN_GROUND : dayClear;
    paintsFor = SKP; paintsSun = s;
  }
  updateLineWidths = (orig => function () {
    orig();
    if (!sunActive()) return;
    for (const k of SUN_WIDE) if (SKP[k]) SKP[k].setStrokeWidth(Math.max(SKP[k].getStrokeWidth() * 2, 4));
  })(updateLineWidths);
  drawGroundTextureSk = (orig => function (canvas) { if (!sunActive()) orig(canvas); })(drawGroundTextureSk);
  // The canvas light bar sits at a fixed y under the status bar; follow its new height.
  lightbarSk = (orig => function (canvas) {
    if (root.hasAttribute('data-tui-nomap')) return; // work page without the map
    const dy = tuiBarDy !== null ? tuiBarDy : DY[scale] || 0;
    if (!dy) { orig(canvas); return; }
    canvas.save(); canvas.translate(0, dy); orig(canvas); canvas.restore();
  })(lightbarSk);

  function frame() {
    renderRightNavLabels();
    tagSections();
    applySunPaints();
    requestAnimationFrame(frame);
  }
  apply();
  frame();
  addKeyaHints();
  placeLowerRight();
  setInterval(() => { placeLowerRight(); addKeyaHints(); }, 400);
  window.addEventListener('resize', placeLowerRight);
  return { get scale() { return scale; }, get sun() { return sun; } };
})();
