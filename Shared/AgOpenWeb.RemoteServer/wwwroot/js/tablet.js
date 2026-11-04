// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork: the cab-tablet UI and the fork's other modules (formerly the end of app.js). Loaded
// last, after frame.js, so everything upstream defines is there; the blocks marked
// `// name:begin` / `// name:end` are what Tests/web cut out and test.

// fork: a press made by code (a menu tile pressing the original button, the long-press replay).
// Upstream's ghost-press filter (js/map-input.js, #465) drops a pointerdown from a pointer that is
// already down. Presses made by code have no release, so with the default pointerId 0 every
// second one was dropped: a tile acted only on the second tap. Each press gets its own pointerId.
// press:begin
let tuiPressId = 1000000;
function tuiPressInit(init) { return { bubbles: true, cancelable: true, ...(init || {}), pointerId: ++tuiPressId }; }
function tuiPress(node, init) {
  if (!node) return false;
  return node.dispatchEvent(new PointerEvent('pointerdown', tuiPressInit(init)));
}
// press:end
// A setup sheet (bench checklist, backup) opened from the menu: in the terminal layout the
// terminal goes to setup mode first, as the setup tiles of TabletUi do.
function tuiEnterSetup() {
  if (typeof TabletTerminal !== 'undefined' && TabletTerminal.layout === 'terminal' && TabletTerminal.mode !== 'setup') TabletTerminal.setMode('setup');
}
// Upstream's panel hotkeys (F field menu, V vehicle) press with pointerId 0 as well, so every
// second key press did nothing (upstream too: docs/Upstream-Issues.md Nr. 7). Same press here.
if (typeof HOTKEY_UI !== 'undefined') {
  HOTKEY_UI.FieldMenu = () => tuiPress(document.getElementById('ln-fieldops'));
  HOTKEY_UI.VehicleSettings = () => tuiPress(document.getElementById('ln-vehicle'));
}

// ===== Tablet UI (Phase 1) ====================================================
// Cab-tablet additions, kept in this one section (CSS: <style id="tablet-ui"> in index.html)
// so the fork rebases cleanly. Per-device settings in localStorage:
//   aow.ui.scale = normal | large | glove   — touch-target size
//   aow.ui.sun   = 1                        — sun theme (high contrast; day theme only)
// Display only: no new commands, nothing sent to the host changes. The upstream render
// functions wrapped below keep their behaviour; the wrappers only recolour/restyle the map
// in the sun theme and shift the canvas light bar under a taller status bar.
let tuiBarDy = null; // canvas light bar offset, set by the Phase 2 layout (null = Phase 1 offset)
const TabletUi = (() => {
  const SCALES = ['normal', 'large', 'glove'];
  const DY = { normal: 0, large: 10, glove: 18 }; // = --tui-dy in index.html
  const lsGet = (k, d) => { try { const v = window.localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch (_) { /* private / blocked */ } };
  let scale = SCALES.includes(lsGet('aow.ui.scale', 'normal')) ? lsGet('aow.ui.scale', 'normal') : 'normal';
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
// ===== Tablet UI (Phase 2): terminal layout =====================================
// html[data-tui-layout="terminal"] (default) or "classic" (Screen & Alerts), per device:
//   aow.ui.layout = terminal | classic
//   aow.ui.pages  = [["map","xte","speed","steer"], …]   work pages (modules per page)
//   aow.ui.page   = index of the shown page
//   aow.ui.quick  = ["contour","manual",…]               quick bar slots (steer is always last)
// Drive mode shows the work page; the menu (tile grid) opens field panels directly and
// setup panels in setup mode (html[data-tui-mode="setup"], left nav back, striped band).
// Display only: the menu tiles, quick bar slots and setup mode open the existing panels and
// press the existing buttons (same handlers, same commands); nothing new goes to the host.
const TabletTerminal = (() => {
  const root = document.documentElement;
  const lsGet = (k, d) => { try { const v = window.localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch (_) { /* private / blocked */ } };
  const lsJson = (k, d) => { try { const v = JSON.parse(lsGet(k, 'null')); return v == null ? d : v; } catch (_) { return d; } };
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); fn(e); });

  // --- Own icons (24×24, stroke) -----------------------------------------------------
  const svg = (body, extra = '') => '<svg viewBox="0 0 24 24" aria-hidden="true" ' + extra + '>' + body + '</svg>';
  const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const IC = {
    menu: svg('<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>', 'fill="currentColor"'),
    drive: svg('<path d="M8 21 L10.5 3 M16 21 L13.5 3"/><path d="M12 7v2M12 12v2M12 17v2"/>', STROKE),
    field: svg('<path d="M3 18 L6 7 L15 5 L21 14 L13 20 Z"/><path d="M11 15V8l4 1.5-4 1.5"/>', STROKE),
    fieldtools: svg('<path d="M4 20 L4 6 L18 20 Z"/><path d="M8 16h2M4 10h2M4 14h2"/><path d="M15 4l5 5-2 2-5-5z"/>', STROKE),
    pages: svg('<rect x="7" y="3" width="13" height="15" rx="2"/><path d="M4 7v12a2 2 0 0 0 2 2h10"/><path d="M10 8h7M10 12h7"/>', STROKE),
    quick: svg('<rect x="15" y="2.5" width="6" height="19" rx="2"/><circle cx="18" cy="7" r="1"/><circle cx="18" cy="12" r="1"/><circle cx="18" cy="17" r="1"/><path d="M3 12h8M8 8.5 11.5 12 8 15.5"/>', STROKE),
    vehicle: svg('<circle cx="7.5" cy="16" r="4.5"/><circle cx="18" cy="17.5" r="3"/><path d="M5 11.5V5h6l2 6.5h6l1 3"/><path d="M12 16h3"/>', STROKE),
    steer: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M3.5 10.5 9.6 11.2M14.4 11.2l6.1-.7M12 14.5V21"/>', STROKE),
    network: svg('<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M12 7.5v5M12 12.5 6.6 16.2M12 12.5l5.4 3.7"/>', STROKE),
    tools: svg('<path d="M14.5 6.5a4 4 0 0 1 5-5l-2.6 2.6.4 2.6 2.6.4 2.6-2.6a4 4 0 0 1-5 5L8 21a2.1 2.1 0 0 1-3-3z"/>', STROKE),
    display: svg('<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><circle cx="12" cy="10.5" r="2.5"/><path d="M12 5.8v1M12 14.2v1M7.3 10.5h1M15.7 10.5h1"/>', STROKE),
    file: svg('<path d="M6 2.5h8l5 5V21.5H6z"/><path d="M14 2.5v5h5M9 13h7M9 17h7"/>', STROKE),
    speed: svg('<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/><path d="M6.5 11.5l1 .8M12 8.5V10M17.5 11.5l-1 .8"/>', STROKE),
    sections: svg('<path d="M3 9h18M3 9v8M7.5 9v8M12 9v8M16.5 9v8M21 9v8"/><path d="M3 6h18"/>', STROKE),
    xte: svg('<path d="M12 3v18"/><path d="M5 12h5M7.5 9.5 10 12l-2.5 2.5"/>', STROKE),
    map: svg('<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>', STROKE),
    language: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>', STROKE),
    left: svg('<path d="M15.5 4 6.5 12l9 8z"/>', 'fill="currentColor"'),
    right: svg('<path d="M8.5 4l9 8-9 8z"/>', 'fill="currentColor"'),
    width: svg('<path d="M3 7v10M21 7v10"/><path d="M6.5 12h11M9 9l-3 3 3 3M15 9l3 3-3 3"/>', STROKE),
    arrowL: '<svg viewBox="0 0 30 24" aria-hidden="true"><path d="M1 12 13 1v6.5h16v9H13V23z"/></svg>',
    arrowR: '<svg viewBox="0 0 30 24" aria-hidden="true"><path d="M29 12 17 1v6.5H1v9h16V23z"/></svg>',
  };

  // --- State ---------------------------------------------------------------------------
  // Steering shows once, in the status bar (plus the Steer button on the right): the module
  // column carries the working width instead (Phase 2b). Stored pages with 'steer' get 'width'.
  const MODS = ['map', 'xte', 'speed', 'width', 'sections'];
  const MOD_NAME = { map: tr('Map'), xte: tr('Cross-track'), speed: tr('Speed'), width: tr('Working width'), sections: tr('Sections') };
  const DEFAULT_PAGES = [['map', 'xte', 'speed', 'width'], ['map', 'xte', 'sections', 'speed'], ['xte', 'speed', 'width', 'sections']];
  const MAX_PAGES = 5;
  // A page without the map keeps the cross-track module: its card is where the headland and
  // U-turn distances go when the map's HUDs are hidden.
  const withXte = p => p.includes('map') || p.includes('xte') ? p : MODS.filter(x => x === 'xte' || p.includes(x));
  const cleanPages = v => {
    if (!Array.isArray(v)) return null;
    const out = v.filter(Array.isArray).slice(0, MAX_PAGES)
      .map(p => MODS.filter(m => p.includes(m) || (m === 'width' && p.includes('steer')))).filter(p => p.length).map(withXte);
    return out.length ? out : null;
  };
  let layout = lsGet('aow.ui.layout', 'terminal') === 'classic' ? 'classic' : 'terminal';
  let mode = 'drive'; // not stored: a restart always comes up in drive mode
  let pages = cleanPages(lsJson('aow.ui.pages', null)) || DEFAULT_PAGES.map(p => p.slice());
  let pageIdx = Math.min(Math.max(parseInt(lsGet('aow.ui.page', '0'), 10) || 0, 0), pages.length - 1);
  const savePages = () => { lsSet('aow.ui.pages', JSON.stringify(pages)); lsSet('aow.ui.page', String(pageIdx)); };
  const page = () => pages[pageIdx] || pages[0];
  const terminal = () => layout === 'terminal';
  const noMap = () => terminal() && mode === 'drive' && !page().includes('map');

  // --- Status bar: menu / setup band, steering, clock ----------------------------------
  const sb = $('statusbar');
  const menuBtn = el('button', '', IC.menu + '<span></span>'); menuBtn.id = 'tui-menu-btn';
  const modeBand = el('div', '', ''); modeBand.id = 'tui-sb-mode';
  const steerChip = el('div', '', IC.steer + '<span class="st-t"><span class="st-k"></span><span class="st-v"></span></span>'); steerChip.id = 'tui-sb-steer';
  steerChip.querySelector('.st-k').textContent = tr('Steering');
  const clockSb = el('div', '', '--:--'); clockSb.id = 'tui-sb-clock'; clockSb.setAttribute('translate', 'no');
  if (sb) {
    sb.insertBefore(modeBand, sb.firstChild);
    sb.insertBefore(menuBtn, sb.firstChild);
    const fs = $('sb-fs');
    sb.insertBefore(steerChip, fs);
    sb.insertBefore(clockSb, fs);
  }
  onTap(menuBtn, () => { if (mode === 'setup') setMode('drive'); else if (menuSheet.classList.contains('open')) closeSheets(); else openMenu(); });
  function syncMenuBtn() {
    const drive = mode === 'setup';
    menuBtn.innerHTML = (drive ? IC.drive : IC.menu) + '<span>' + esc(drive ? tr('Drive') : tr('Menu')) + '</span>';
    menuBtn.title = drive ? tr('Back to drive mode') : tr('Menu');
    modeBand.textContent = tr('Setup');
  }
  function tickClock() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const t = p(d.getHours()) + ':' + p(d.getMinutes());
    if (clockSb.textContent !== t) clockSb.textContent = t;
  }

  // Live data: the socket is up and a tick came in the last 2 s. Otherwise the steer chip
  // says so and the readouts show "—", instead of freezing on the last values (the host's
  // deadman may already have released steering and sections).
  function tuiLive() { return connState === 'connected' && !!lastTick && performance.now() - lastTick.t < 2000; }
  function steerState() {
    if (connState !== 'connected') return ['fault', tr('Disconnected')];
    if (!tuiLive()) return ['fault', tr('No data')];
    const op = tick && tick.op;
    if (!op || !scene || !scene.hasField || !op.autoSteerAvail) return ['none', tr('No line')];
    if (op.autoSteer && op.moduleNotSteering) return ['fault', tr('Not steering')];
    if (op.autoSteer) return ['on', tr('On')];
    return ['off', tr('Off')];
  }

  // --- U3: cross-track readout -----------------------------------------------------------
  const xteBox = el('div', '', '<div class="x-side x-l">' + IC.arrowL + '<span class="x-let"><span>L</span></span></div>' +
    '<div class="x-mid"><div><span class="x-val">0</span><span class="x-unit"></span></div><div class="x-cap"></div></div>' +
    '<div class="x-side x-r"><span class="x-let"><span>R</span></span>' + IC.arrowR + '</div>');
  xteBox.id = 'tui-xte'; xteBox.setAttribute('translate', 'no');
  document.body.appendChild(xteBox);
  const X = { l: xteBox.querySelector('.x-l'), r: xteBox.querySelector('.x-r'), v: xteBox.querySelector('.x-val'),
    u: xteBox.querySelector('.x-unit'), c: xteBox.querySelector('.x-cap') };
  // Cross-track error → { val, unit, dir: -1 steer left · 0 on line · 1 steer right, cap }.
  // Sign as the light bar: + = right of the line, so the way to steer is left.
  const steerBar = () => !!(config && config.autosteer && config.autosteer.steerBarEnabled);
  function xteInfo() {
    const xte = tick.crossTrackError || 0, a = Math.abs(xte);
    let raw, unit;
    if (a >= 10) { raw = toDisplayUnit(a, 'm').toFixed(1); unit = unitLabel('m'); }
    else { raw = toDisplayUnit(a * 100, 'cm').toFixed(isMetric() ? 0 : 1); unit = unitLabel('cm'); }
    // "On line" within 5 cm, as the light bar's centre LED and #lb (upstream onLine).
    const dir = a < 0.05 ? 0 : xte > 0 ? -1 : 1;
    const val = tuiDec(raw);
    const pass = tick.op && !tick.op.contour ? tr('Pass {n}', { n: Math.abs((tick.op.passNumber | 0)) + 1 }) : '';
    // Steer-bar style: the light bar and #lb show the steer-angle error, which can point the
    // other way; the readout then only gives the distance, without a steering direction.
    if (steerBar()) {
      const w = I18n.text(tr('Cross-track'));
      return { val, unit, dir: null, cap: pass ? w + ' · ' + pass : w };
    }
    // Translated here: the caption is joined from two strings, so the page translator can't match it.
    const word = I18n.text(dir < 0 ? tr('Steer left') : dir > 0 ? tr('Steer right') : tr('On line'));
    return { val, unit, dir, cap: pass ? word + ' · ' + pass : word };
  }
  let xteLast = '';
  function renderXte() {
    const want = !!(tick && tick.guidanceActive && scene && scene.hasField && !document.body.classList.contains('maptap')
      && !noMap() && (!terminal() || page().includes('xte')));
    if (want !== xteBox.classList.contains('show')) {
      xteBox.classList.toggle('show', want);
      if (want) root.setAttribute('data-tui-xte', ''); else root.removeAttribute('data-tui-xte');
      stackNow = true; // re-stack the light bar and HUDs this frame
    }
    if (steerBar() !== root.hasAttribute('data-tui-steerbar')) {
      if (steerBar()) root.setAttribute('data-tui-steerbar', ''); else root.removeAttribute('data-tui-steerbar');
      stackNow = true;
    }
    if (!want) { xteLast = ''; return; }
    const i = tuiLive() ? xteInfo() : { val: '—', unit: '', dir: null, cap: I18n.text(tr('No data')) };
    const key = i.val + i.unit + i.dir + i.cap;
    if (key === xteLast) return;
    xteLast = key;
    X.v.textContent = i.val; X.u.textContent = i.unit; X.c.textContent = i.cap;
    X.l.classList.toggle('on', i.dir < 0); X.r.classList.toggle('on', i.dir > 0);
    xteBox.classList.toggle('online', i.dir === 0);
  }

  // Everything under the status bar stacks top-down: readout, canvas light bar, #lb text,
  // headland HUD / reverse badge. Positions as CSS variables (and the bar's offset for the
  // lightbarSk wrapper in Phase 1), so they follow the status bar and readout heights.
  let yKey = '', stackNow = true;
  function stackTop() {
    stackNow = false;
    const r = sb && sb.style.display !== 'none' ? sb.getBoundingClientRect() : null;
    let y = (r ? r.bottom : 0) + 8, xb = 0, xr = 0, xt = 0;
    if (xteBox.classList.contains('show')) {
      const xr0 = xteBox.getBoundingClientRect();
      xb = xr0.bottom + 10; y = xb - 2; xr = xr0.right + 12; xt = xr0.top;
    }
    const cfg = config && config.autosteer;
    const bar = !!(tick && tick.guidanceActive && cfg && cfg.guidanceBarOn && cfg.lightbarEnabled);
    tuiBarDy = y - 54; // lightbarSk draws at y = 54
    if (bar) y += 16 + 6;
    const lbY = y;
    if (lbEl && lbEl.style.display !== 'none' && (!root.hasAttribute('data-tui-xte') || root.hasAttribute('data-tui-steerbar'))) y += lbEl.offsetHeight + 4;
    const key = lbY + ',' + y + ',' + xb + ',' + xr;
    if (key === yKey) return;
    yKey = key;
    root.style.setProperty('--tui-xte-b', xb + 'px');
    root.style.setProperty('--tui-xte-r', xr + 'px');
    root.style.setProperty('--tui-xte-t', xt + 'px');
    root.style.setProperty('--tui-y-lb', lbY + 'px');
    root.style.setProperty('--tui-y-hud', (y + 2) + 'px');
  }

  // --- Work pages: modules ---------------------------------------------------------------
  const col = el('div'); col.id = 'tui-col';
  const dash = el('div'); dash.id = 'tui-dash';
  document.body.append(col, dash);
  function pagerHtml() {
    return '<div class="tui-pager"><button class="pg-prev" title="' + esc(tr('Previous page')) + '">' + IC.left + '</button>' +
      '<div class="pg-t"><div class="pg-n"></div><div class="pg-dots"></div></div>' +
      '<button class="pg-next" title="' + esc(tr('Next page')) + '">' + IC.right + '</button></div>';
  }
  const CARD = {
    speed: () => '<div class="tui-card" data-m="speed"><div class="c-k">' + IC.speed + esc(MOD_NAME.speed) + '</div><div class="c-v"><span class="c-n">—</span><span class="c-u"></span></div></div>',
    width: () => '<div class="tui-card" data-m="width"><div class="c-k">' + IC.width + esc(MOD_NAME.width) + '</div><div class="c-v"><span class="c-n">—</span><span class="c-u"></span></div></div>',
    sections: () => '<div class="tui-card" data-m="sections"><div class="c-k">' + IC.sections + esc(MOD_NAME.sections) + '</div><div class="c-v"><span class="c-n">—</span></div><div class="tui-secs"></div></div>',
    xte: () => '<div class="tui-card d-xte" data-m="xte"><div class="c-k">' + IC.xte + esc(MOD_NAME.xte) + '</div>' +
      '<div class="c-v"><span class="x-dir x-l">' + IC.arrowL + '<span class="x-let"><span>L</span></span></span>' +
      '<span><span class="c-n">—</span><span class="c-u"></span></span>' +
      '<span class="x-dir x-r"><span class="x-let"><span>R</span></span>' + IC.arrowR + '</span></div><div class="c-cap"></div><div class="c-extra"></div></div>',
  };
  let built = '', cards = {};
  function buildPage() {
    const p = page(), nm = noMap();
    const key = layout + mode + pageIdx + p.join() + pages.length;
    if (key === built) return;
    built = key;
    if (nm) root.setAttribute('data-tui-nomap', ''); else root.removeAttribute('data-tui-nomap');
    if (terminal() && p.includes('speed')) root.setAttribute('data-tui-speed', ''); else root.removeAttribute('data-tui-speed');
    col.innerHTML = ''; dash.innerHTML = '';
    if (!terminal()) return;
    const host = nm ? dash : col;
    const order = nm ? ['xte', 'speed', 'width', 'sections'] : ['speed', 'width', 'sections'];
    host.innerHTML = pagerHtml() + order.filter(m => p.includes(m)).map(m => CARD[m]()).join('');
    const others = order.filter(m => m !== 'xte' && p.includes(m)).length;
    dash.style.setProperty('--tui-dash-cols', String(Math.max(1, others)));
    dash.classList.toggle('solo', others === 0);
    dash.classList.toggle('noxte', !p.includes('xte'));
    cards = {};
    for (const c of host.querySelectorAll('.tui-card')) cards[c.dataset.m] = { el: c, last: '' };
    const pg = host.querySelector('.tui-pager');
    // "1 / 3" on the pager (the sentence ran under the next button at 1024×600); the sentence and
    // the cards of the page are in the tooltip.
    pg.querySelector('.pg-n').textContent = (pageIdx + 1) + ' / ' + pages.length;
    pg.querySelector('.pg-dots').innerHTML = pages.map((_, i) => '<i class="' + (i === pageIdx ? 'on' : '') + '"></i>').join('');
    pg.querySelector('.pg-t').title = tr('Page {n} of {count}', { n: pageIdx + 1, count: pages.length }) + ': ' + p.map(m => MOD_NAME[m]).join(', ');
    pg.querySelector('.pg-prev').disabled = pageIdx === 0;
    pg.querySelector('.pg-next').disabled = pageIdx >= pages.length - 1;
    onTap(pg.querySelector('.pg-prev'), () => goPage(pageIdx - 1));
    onTap(pg.querySelector('.pg-next'), () => goPage(pageIdx + 1));
    xteLast = ''; yKey = '';
  }
  function goPage(i) {
    if (i < 0 || i >= pages.length || i === pageIdx) return;
    pageIdx = i; savePages(); buildPage(); placeWorkArea();
  }
  // Swipe left/right on the module column or the dashboard turns the page. The map itself
  // keeps its pan gesture; these overlays stop the pointer before it reaches the map.
  for (const host of [col, dash]) {
    let sx = null, sy = 0;
    host.addEventListener('pointerdown', e => { e.stopPropagation(); sx = e.clientX; sy = e.clientY; });
    host.addEventListener('pointerup', e => {
      if (sx === null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) goPage(pageIdx + (dx < 0 ? 1 : -1));
    });
    host.addEventListener('pointercancel', () => { sx = null; });
  }
  function setCard(m, key, fn) {
    const c = cards[m];
    if (!c || c.last === key) return;
    c.last = key; fn(c.el);
  }
  function renderCards() {
    if (!terminal() || mode !== 'drive') return;
    const live = tuiLive();
    const spd = live ? tuiNum(toDisplayUnit(Math.abs(lastTick.speed) * 3.6, 'kmh'), 1) : '—', su = live ? unitLabel('kmh') : '';
    setCard('speed', spd + su, c => { c.querySelector('.c-n').textContent = spd; c.querySelector('.c-u').textContent = su; });
    // The configured total width, as Tool Configuration shows it ("Total width", 2 decimals).
    // Not toolWidthM(): that falls back to a made-up 6 m when the scene has no sections.
    const wm = config && config.tool ? +config.tool.totalWidth || 0 : 0;
    const wv = wm > 0 ? tuiNum(toDisplayUnit(wm, 'm'), 2) : '—', wu = wm > 0 ? unitLabel('m') : '';
    setCard('width', wv + wu, c => { c.querySelector('.c-n').textContent = wv; c.querySelector('.c-u').textContent = wu; });
    const secs = live && tick && scene && scene.hasField ? tick.sections : null;
    const sk = secs ? secs.join('') : live ? '-' : 'x';
    setCard('sections', sk, c => {
      const on = secs ? secs.filter(s => s === 1 || s === 2 || s === 3).length : 0; // 3 = turning off: still applying
      c.querySelector('.c-n').textContent = secs && secs.length ? on + ' / ' + secs.length : '—';
      c.querySelector('.tui-secs').innerHTML = secs ? secs.map(s => '<i data-st="' + (s | 0) + '"></i>').join('') : '';
      c.title = secs ? tr('{on} of {count} sections on', { on, count: secs.length }) : '';
    });
    if (cards.xte) {
      const ok = !!(live && tick && tick.guidanceActive && scene && scene.hasField);
      const i = ok ? xteInfo() : null;
      setCard('xte', i ? i.val + i.unit + i.dir + i.cap : live ? '-' : 'x', c => {
        c.querySelector('.c-n').textContent = i ? i.val : '—';
        c.querySelector('.c-u').textContent = i ? i.unit : '';
        c.querySelector('.c-cap').textContent = i ? i.cap : live ? tr('No line') : tr('No data');
        c.querySelector('.x-l').classList.toggle('on', !!i && i.dir < 0);
        c.querySelector('.x-r').classList.toggle('on', !!i && i.dir > 0);
        c.dataset.st = i ? (i.dir === 0 ? 'on' : '') : 'none';
      });
      // The map's headland-distance HUD and U-turn indicator are hidden on this page; their values go here.
      const parts = [], hd = tuiHeadlandText(), ud = tuiUTurnText();
      if (hd) parts.push(hd);
      if (ud) parts.push(ud);
      const ex = cards.xte.el.querySelector('.c-extra'), et = parts.join(' · ');
      if (ex.textContent !== et) { ex.textContent = et; cards.xte.el.classList.toggle('has-extra', !!et); }
    }
  }
  // Column / dashboard end above the bottom stack (sim bar, sections, bottom nav) and left
  // of the quick bar, whatever their size at this scale and screen.
  let waKey = '';
  function placeWorkArea() {
    const vh = window.innerHeight, vw = window.innerWidth;
    // Bottom limit: the top of every bottom-stack row that reaches across the column's / the
    // dashboard's width (the narrow SIM launcher in the middle does not cut the column short).
    const colL = 8, colR = 8 + (col.offsetWidth || 0);
    let colB = 16, dashB = 16;
    const stack = $('bottomstack');
    if (stack) {
      for (const c of stack.children) {
        if (getComputedStyle(c).display === 'none') continue;
        const r = c.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        dashB = Math.max(dashB, vh - r.top + 8);
        if (r.left < colR && r.right > colL) colB = Math.max(colB, vh - r.top + 8);
      }
    }
    const rn = $('rightnav');
    const rr = rn && getComputedStyle(rn).display !== 'none' ? rn.getBoundingClientRect() : null;
    const right = rr && rr.width > 0 ? vw - rr.left + 8 : 16;
    const key = colB + ',' + dashB + ',' + right + ',' + colR;
    if (key === waKey) return;
    waKey = key;
    root.style.setProperty('--tui-col-bottom', colB + 'px');
    root.style.setProperty('--tui-dash-bottom', dashB + 'px');
    root.style.setProperty('--tui-dash-right', right + 'px');
    root.style.setProperty('--tui-col-w', (colR - 8) + 'px');
  }

  // The bottom stack (sim bar, sections, bottom nav) is centred in the free band between the
  // left nav (when shown) and the quick bar, so it never runs under either; the bottom-nav
  // buttons share that band (Phase 1 sized them from the whole width).
  let bandKey = '';
  function placeBand() {
    const vw = window.innerWidth;
    const ln = $('leftnav'), rn = $('rightnav');
    const lr = ln && getComputedStyle(ln).display !== 'none' ? ln.getBoundingClientRect() : null;
    const rr = rn && getComputedStyle(rn).display !== 'none' ? rn.getBoundingClientRect() : null;
    const L = Math.round(lr && lr.width > 0 ? lr.right + 8 : 8);
    const R = Math.round(rr && rr.width > 0 ? rr.left - 8 : vw - 8);
    const n = document.querySelectorAll('#bottomnav .bn-bar > .bn-btn:not(.hide)' + (terminal() ? ':not(.tui-bnmove)' : '')).length || 12;
    const key = L + ',' + R + ',' + n;
    if (key === bandKey) return;
    bandKey = key;
    root.style.setProperty('--tui-stack-l', L + 'px');
    root.style.setProperty('--tui-stack-w', Math.max(R - L, 200) + 'px');
    root.style.setProperty('--tui-bn-n', String(n));
    root.setAttribute('data-tui-band', '');
  }

  // --- Quick bar (right nav): which buttons, in which order --------------------------------
  const QPOOL = [
    { id: 'contour', rn: 'rn-contour' }, { id: 'manual', rn: 'rn-manual' }, { id: 'auto', rn: 'rn-auto' },
    { id: 'youturn', rn: 'rn-youturn' },
    { id: 'headland', src: '#bn-headland', label: tr('Headland'), on: t => t.tools && t.tools.headlandOn },
    { id: 'hlsections', src: '#bn-secheadland', label: tr('Sections in headland'), on: t => t.tools && !t.tools.sectionInHeadland },
    { id: 'tram', src: '#bn-tram', label: tr('Tram lines'), on: t => t.tools && t.tools.tramMode > 0 },
    // Upstream's own track picking (#339): shown by upstream only with two or more visible tracks.
    { id: 'autotrack', rn: 'rn-autotrack' }, { id: 'cycle', rn: 'rn-cycle' }, { id: 'cycleback', rn: 'rn-cycleback' },
    { id: 'uturnL', src: '#osb-uturn [data-cmd="youturn.manualLeft"]', label: tr('U-turn left') },
    { id: 'uturnR', src: '#osb-uturn [data-cmd="youturn.manualRight"]', label: tr('U-turn right') },
    { id: 'shiftL', src: '#osb-lateral [data-cmd="track.snapLeft"]', label: tr('Shift left') },
    { id: 'shiftR', src: '#osb-lateral [data-cmd="track.snapRight"]', label: tr('Shift right') },
    // ISOBUS section control (#318): always in the bar while upstream shows it (a task
    // controller heartbeat is heard), so it is never out of reach; outside the slot budget.
    { id: 'isobus', rn: 'rn-isobus', auto: true },
    { id: 'steer', rn: 'rn-steer', fixed: true },
  ];
  const QBY = Object.fromEntries(QPOOL.map(q => [q.id, q]));
  const RN_LABEL = { contour: tr('Contour'), manual: tr('Manual'), auto: tr('Auto'), youturn: tr('U-Turn'), steer: tr('Steer'),
    autotrack: tr('Auto track'), cycle: tr('Next track'), cycleback: tr('Previous track'), isobus: 'ISOBUS' };
  const qLabel = q => q.label || RN_LABEL[q.id] || q.id;
  const DEFAULT_QUICK = ['contour', 'manual', 'auto', 'youturn'];
  const MAX_SLOTS = 6; // with steer; contour counts twice (its lock button). Keeps glove ≥ 64 px at 600 px height.
  const slotCost = ids => ids.reduce((n, id) => n + (id === 'contour' ? 2 : 1), 1);
  const cleanQuick = v => {
    if (!Array.isArray(v)) return null;
    const out = [];
    for (const id of v) if (QBY[id] && !QBY[id].fixed && !QBY[id].auto && !out.includes(id) && slotCost(out.concat(id)) <= MAX_SLOTS) out.push(id);
    return out;
  };
  let quick = cleanQuick(lsJson('aow.ui.quick', null)) || DEFAULT_QUICK.slice();
  const rnRoot = $('rightnav');
  const proxies = {};
  for (const q of QPOOL) {
    if (!q.src || !rnRoot) continue;
    const b = el('button', 'rn-btn tui-qp', '<span class="rn-ic"></span><span class="tui-rn-lbl"></span><span class="tui-rn-st"></span>');
    b.dataset.q = q.id;
    b.querySelector('.tui-rn-lbl').textContent = q.label;
    rnRoot.insertBefore(b, $('rn-readonly'));
    const p = { b, ic: b.querySelector('.rn-ic'), st: b.querySelector('.tui-rn-st'), icKey: '', last: '' };
    proxies[q.id] = p;
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      const src = document.querySelector(q.src);
      if (!src || b.classList.contains('disabled')) return;
      // Press the original button: its own handler sends its own command, with its own gates.
      tuiPress(src);
    });
  }
  function srcAvailable(q, src) {
    if (!src) return false;
    if (src.closest('#bottomnav')) return $('bottomnav').classList.contains('open') && !src.classList.contains('hide');
    const row = src.closest('.osb-row');
    return !!row && !row.hidden && !(tick && tick.op && tick.op.executing);
  }
  function renderProxies() {
    if (!terminal()) return;
    for (const id of quick) {
      const p = proxies[id];
      if (!p) continue;
      const q = QBY[id], src = document.querySelector(q.src);
      const avail = srcAvailable(q, src);
      p.b.classList.toggle('disabled', !avail);
      // Icon: the original's image (it changes with the state) or its drawn glyph.
      const img = src && src.querySelector('img'), sv = src && src.querySelector('svg');
      const icKey = img ? img.getAttribute('src') || '' : sv ? 'svg' : '';
      if (icKey !== p.icKey) {
        p.icKey = icKey;
        const n = img ? Object.assign(document.createElement('img'), { src: icKey, alt: '' }) : sv ? sv.cloneNode(true) : document.createElement('span');
        n.classList.add('rn-ic');
        p.ic.replaceWith(n); p.ic = n;
      }
      const on = q.on && tick ? !!q.on(tick) : null;
      const text = on === null ? '' : on ? tr('On') : tr('Off');
      if (text !== p.last) { p.last = text; p.st.textContent = text; p.b.classList.toggle('tui-on', !!on); }
    }
  }
  function applyQuick() {
    const t = terminal();
    let n = 0;
    for (const q of QPOOL) {
      const node = q.rn ? $(q.rn) : proxies[q.id] && proxies[q.id].b;
      if (!node) continue;
      const i = quick.indexOf(q.id);
      const shown = q.fixed || q.auto || i >= 0;
      node.classList.toggle('tui-qhide', t && !shown);
      node.style.order = t ? String(q.fixed ? 90 : q.auto ? 80 : i * 2) : '';
      if (q.id === 'contour') {
        const lock = $('rn-contourlock');
        if (lock) { lock.classList.toggle('tui-qhide', t && !shown); lock.style.order = t ? String(i * 2 + 1) : ''; }
      }
      if (shown) n++;
    }
    if (rnRoot) for (const b of rnRoot.querySelectorAll('.tui-qp')) if (!t) b.classList.add('tui-qhide');
    countSlots();
    return n;
  }
  function countSlots() {
    if (!rnRoot) return;
    const n = [...rnRoot.querySelectorAll('.rn-btn')].filter(b => getComputedStyle(b).display !== 'none').length;
    root.style.setProperty('--tui-q-n', String(Math.max(n, 1)));
  }
  const saveQuick = () => lsSet('aow.ui.quick', JSON.stringify(quick));

  // --- Menu (tile grid) and editor sheets ------------------------------------------------
  const scrim = el('div'); scrim.id = 'tui-scrim';
  document.body.appendChild(scrim);
  onTap(scrim, () => closeSheets());
  function sheet(id, title, narrow) {
    const s = el('div', 'tui-sheet' + (narrow ? ' narrow' : ''),
      '<div class="tui-sh-hdr"><span class="t"></span><button class="x" title="' + esc(tr('Close')) + '">✕</button></div><div class="tui-sh-body"></div>');
    s.id = id; s.querySelector('.t').textContent = title;
    s.addEventListener('pointerdown', e => e.stopPropagation()); // no map pan through the sheet
    onTap(s.querySelector('.x'), () => closeSheets());
    document.body.appendChild(s);
    return { s, body: s.querySelector('.tui-sh-body') };
  }
  const { s: menuSheet, body: menuBody } = sheet('tui-menu', tr('Menu'));
  const { s: pagesSheet, body: pagesBody } = sheet('tui-pages-ed', tr('Work pages'), true);
  const { s: quickSheet, body: quickBody } = sheet('tui-quick-ed', tr('Quick bar'), true);
  function closeSheets() {
    for (const s of [menuSheet, pagesSheet, quickSheet]) s.classList.remove('open');
    scrim.classList.remove('open');
  }
  function openSheet(s) {
    if (typeof lnCloseAll === 'function') lnCloseAll();
    closeSheets();
    s.classList.add('open'); scrim.classList.add('open');
  }
  const pressNav = id => { const b = $(id); if (b) tuiPress(b); };
  const TILES_FIELD = [ // [icon, label, key (data-tile), action]
    ['field', tr('Fields and Jobs'), 'ln-fieldops', () => pressNav('ln-fieldops')],
    ['fieldtools', tr('Field Tools'), 'ln-fieldtools', () => pressNav('ln-fieldtools')],
    ['pages', tr('Work pages'), 'pages', () => { renderPagesEditor(); openSheet(pagesSheet); }],
    ['quick', tr('Quick bar'), 'quick', () => { renderQuickEditor(); openSheet(quickSheet); }],
  ];
  const TILES_SETUP = [
    ['vehicle', tr('Vehicle & Tool'), 'ln-vehicle'],
    ['steer', tr('AutoSteer'), 'ln-autosteer'],
    ['network', tr('Network & GPS'), 'ln-network'],
    ['tools', tr('Tools & Wizards'), 'ln-tools'],
    ['display', tr('Screen & Alerts'), 'ln-screenalerts'],
    ['file', tr('App & Files'), 'ln-filemenu'],
    ['language', tr('Language'), 'language'],
  ];
  // Phase 2b: bottom-bar buttons used now and then live here; each tile presses the original
  // (hidden) button, so its own handler, command and control gate apply. The menu stays open,
  // so a cycling button can be tapped again; the tile shows the original's current state.
  const TILES_MORE = [ // [source selector, label, state (text) from the original]
    ['#bn-skipcycle', tr('Skip rows'), () => ($('bn-skipnum') || {}).textContent || ''],
    ['#bn-skiptoggle', tr('Skip mode'), null],
    ['#bn-tram', tr('Tram lines'), null],
    ['#bottomnav .bn-bar [data-cmd="map.cycleColor"]', tr('Coverage colour'), null],
    ['#bottomnav .bn-bar [data-cmd="tool.resetHeading"]', tr('Reset tool heading'), null],
  ];
  let moreTiles = [];
  function renderMoreTiles() {
    for (const m of moreTiles) {
      const src = document.querySelector(m.sel);
      const ok = !!src && $('bottomnav').classList.contains('open') && !src.classList.contains('hide');
      m.t.classList.toggle('disabled', !ok);
      const img = src && src.querySelector('img'), icon = img ? img.getAttribute('src') || '' : '';
      if (icon !== m.icon) { m.icon = icon; m.ic.innerHTML = icon ? '<img src="' + esc(icon) + '" alt="">' : ''; }
      const st = m.state ? m.state() : '';
      if (m.st.textContent !== st) m.st.textContent = st;
    }
  }
  function renderMenu() {
    menuBody.innerHTML =
      '<div class="tui-sh-sec">' + esc(tr('In the field')) + '</div><div class="tui-tiles tui-f"></div>' +
      '<div class="tui-sh-sec">' + esc(tr('Setup')) + '<small>' + esc(tr('opens setup mode; the left bar comes back')) + '</small></div>' +
      '<div class="tui-tiles setup-band tui-s"></div>';
    const fBox = menuBody.querySelector('.tui-f'), sBox = menuBody.querySelector('.tui-s');
    const mBox = el('div', 'tui-tiles tui-m');
    fBox.after(Object.assign(el('div', 'tui-sh-sec'), { textContent: tr('More field tools') }), mBox);
    moreTiles = TILES_MORE.map(([sel, label, state]) => {
      const t = el('button', 'tui-tile field more', '<span class="m-ic"></span><span class="m-l"></span><span class="m-st" translate="no"></span>');
      t.querySelector('.m-l').textContent = label;
      t.dataset.tile = sel;
      onTap(t, () => {
        const src = document.querySelector(sel);
        if (!src || t.classList.contains('disabled')) return;
        tuiPress(src);
        setTimeout(renderMoreTiles, 150);
      });
      mBox.appendChild(t);
      return { t, sel, state, ic: t.querySelector('.m-ic'), st: t.querySelector('.m-st'), icon: null };
    });
    renderMoreTiles();
    for (const [ic, label, key, fn] of TILES_FIELD) {
      const t = el('button', 'tui-tile field', IC[ic] + '<span></span>'); t.querySelector('span').textContent = label;
      t.dataset.tile = key;
      onTap(t, () => { closeSheets(); fn(); });
      fBox.appendChild(t);
    }
    for (const [ic, label, nav] of TILES_SETUP) {
      const t = el('button', 'tui-tile setup', IC[ic] + '<span></span>'); t.querySelector('span').textContent = label;
      t.dataset.tile = nav;
      if (nav === 'language') { // the language panel lives in the App menu; findable in any language
        const sp = t.querySelector('span'); sp.setAttribute('translate', 'no');
        sp.textContent = I18n.text('Language') === 'Language' ? 'Language' : I18n.text('Language') + ' · Language';
        onTap(t, () => { closeSheets(); setMode('setup'); if (typeof lnOpen === 'function') lnOpen('language', 'ln-filemenu', renderLanguage); });
        sBox.appendChild(t);
        continue;
      }
      onTap(t, () => { closeSheets(); setMode('setup'); pressNav(nav); });
      sBox.appendChild(t);
    }
  }
  function openMenu() { renderMenu(); openSheet(menuSheet); }

  function renderPagesEditor() {
    pagesBody.innerHTML = '<div class="tui-hint">' + esc(tr('Each page shows the chosen modules. Without the map, the page is a full-screen display. Swipe the module column to change pages. Saved on this device.')) + '</div>';
    pages.forEach((p, i) => {
      const row = el('div', 'tui-erow');
      row.appendChild(Object.assign(el('span', 'e-n'), { textContent: tr('Page {n}', { n: i + 1 }) }));
      for (const m of MODS) {
        const c = el('button', 'tui-chip' + (p.includes(m) ? ' on' : ''));
        c.textContent = MOD_NAME[m];
        const fixed = m === 'xte' && !p.includes('map'); // see withXte
        if (fixed) c.classList.add('lock');
        onTap(c, () => {
          if (fixed) return;
          const has = p.includes(m);
          if (has && p.length === 1) return; // a page keeps at least one module
          pages[i] = withXte(has ? p.filter(x => x !== m) : MODS.filter(x => x === m || p.includes(x)));
          savePages(); built = ''; buildPage(); renderPagesEditor();
        });
        row.appendChild(c);
      }
      row.appendChild(el('span', 'e-grow'));
      const up = el('button', 'tui-ibtn', '▲'), dn = el('button', 'tui-ibtn', '▼'), del = el('button', 'tui-ibtn', '✕');
      up.title = tr('Move up'); dn.title = tr('Move down'); del.title = tr('Delete page');
      up.disabled = i === 0; dn.disabled = i === pages.length - 1; del.disabled = pages.length === 1;
      const move = d => { const j = i + d; [pages[i], pages[j]] = [pages[j], pages[i]]; if (pageIdx === i) pageIdx = j; else if (pageIdx === j) pageIdx = i; savePages(); built = ''; buildPage(); renderPagesEditor(); };
      onTap(up, () => { if (!up.disabled) move(-1); });
      onTap(dn, () => { if (!dn.disabled) move(1); });
      onTap(del, () => {
        if (del.disabled) return;
        pages.splice(i, 1); pageIdx = Math.min(pageIdx, pages.length - 1); savePages(); built = ''; buildPage(); renderPagesEditor();
      });
      row.append(up, dn, del);
      pagesBody.appendChild(row);
    });
    const bar = el('div', 'tui-ebar');
    const add = el('button', '', esc(tr('Add page'))), reset = el('button', '', esc(tr('Restore defaults'))), done = el('button', 'pri', esc(tr('Done')));
    add.disabled = pages.length >= MAX_PAGES;
    onTap(add, () => { if (pages.length < MAX_PAGES) { pages.push(['map', 'xte']); savePages(); renderPagesEditor(); built = ''; buildPage(); } });
    onTap(reset, () => { pages = DEFAULT_PAGES.map(p => p.slice()); pageIdx = 0; savePages(); built = ''; buildPage(); renderPagesEditor(); });
    onTap(done, () => closeSheets());
    bar.append(add, reset, done);
    pagesBody.appendChild(bar);
  }

  function qIcon(q) {
    const src = q.rn ? $(q.rn) : document.querySelector(q.src);
    const img = src && src.querySelector('img'), sv = src && src.querySelector('svg');
    if (img && img.getAttribute('src')) return '<img src="' + esc(img.getAttribute('src')) + '" alt="">';
    if (sv) return sv.outerHTML;
    return '<span style="width:36px"></span>';
  }
  function renderQuickEditor() {
    quickBody.innerHTML = '<div class="tui-hint">' + esc(tr('Pick the buttons for the bar on the right edge and their order. Steer always stays at the bottom. Up to {n} buttons (Contour brings its lock button). Saved on this device.', { n: MAX_SLOTS })) + '</div>';
    const ordered = quick.map(id => QBY[id]).concat(QPOOL.filter(q => !q.fixed && !q.auto && !quick.includes(q.id)))
      .concat(QPOOL.filter(q => q.auto), [QBY.steer]);
    for (const q of ordered) {
      const row = el('div', 'tui-qitem', qIcon(q) + '<span class="e-grow"></span>');
      row.querySelector('.e-grow').textContent = qLabel(q);
      const i = quick.indexOf(q.id);
      if (q.fixed || q.auto) {
        row.appendChild(Object.assign(el('span', 'tui-chip lock on'), { textContent: q.fixed ? tr('Always') : tr('When connected') }));
      } else {
        const chip = el('button', 'tui-chip' + (i >= 0 ? ' on' : ''));
        chip.textContent = i >= 0 ? tr('In the bar') : tr('Add');
        const full = i < 0 && slotCost(quick.concat(q.id)) > MAX_SLOTS;
        if (full) { chip.disabled = true; chip.title = tr('The bar is full'); }
        onTap(chip, () => {
          if (i >= 0) quick.splice(i, 1);
          else if (!full) quick.push(q.id);
          saveQuick(); applyQuick(); renderQuickEditor();
        });
        row.appendChild(chip);
        const up = el('button', 'tui-ibtn', '▲'), dn = el('button', 'tui-ibtn', '▼');
        up.title = tr('Move up'); dn.title = tr('Move down');
        up.disabled = i <= 0; dn.disabled = i < 0 || i >= quick.length - 1;
        const move = d => { const j = i + d; [quick[i], quick[j]] = [quick[j], quick[i]]; saveQuick(); applyQuick(); renderQuickEditor(); };
        onTap(up, () => { if (!up.disabled) move(-1); });
        onTap(dn, () => { if (!dn.disabled) move(1); });
        row.append(up, dn);
      }
      quickBody.appendChild(row);
    }
    const bar = el('div', 'tui-ebar');
    const reset = el('button', '', esc(tr('Restore defaults'))), done = el('button', 'pri', esc(tr('Done')));
    onTap(reset, () => { quick = DEFAULT_QUICK.slice(); saveQuick(); applyQuick(); renderQuickEditor(); });
    onTap(done, () => closeSheets());
    bar.append(reset, done);
    quickBody.appendChild(bar);
  }

  // --- Modes and layout --------------------------------------------------------------------
  function setMode(m) {
    if (m === mode) return;
    mode = m;
    if (m === 'drive' && typeof lnCloseAll === 'function') lnCloseAll();
    closeSheets();
    apply();
  }
  function apply() {
    root.setAttribute('data-tui-layout', layout);
    root.setAttribute('data-tui-mode', mode);
    syncMenuBtn();
    built = ''; buildPage(); applyQuick(); syncLayoutOpts();
    waKey = ''; yKey = ''; bandKey = ''; stackNow = true;
  }
  // Layout choice next to the Phase 1 size / sun buttons in Screen & Alerts.
  const sa = $('screenalerts');
  const hint = sa && sa.querySelector('.tui-hint');
  const lay = el('div', 'tui-seg tui-seg2',
    '<button class="tui-opt" data-tui-layout="terminal"></button><button class="tui-opt" data-tui-layout="classic"></button>');
  lay.children[0].textContent = tr('Terminal layout'); lay.children[1].textContent = tr('Classic layout');
  if (hint) hint.after(lay);
  for (const b of lay.children) onTap(b, () => { layout = b.dataset.tuiLayout; lsSet('aow.ui.layout', layout); if (layout === 'classic') mode = 'drive'; apply(); });
  function syncLayoutOpts() { for (const b of lay.children) b.classList.toggle('active', b.dataset.tuiLayout === layout); }

  // --- Frame loop ----------------------------------------------------------------------------
  // Point 12: with the host gone or silent, upstream displays keep their last state (fix chip,
  // light bar, roll gauge, right nav states). Mark the page stale; CSS and the light bar wrapper
  // below hide or grey them until data flows again.
  let staleNow = null;
  lightbarSk = (orig => function (canvas) { if (staleNow) return; return orig(canvas); })(lightbarSk);
  function frame() {
    const stale = !tuiLive();
    if (stale !== staleNow) {
      staleNow = stale;
      if (stale) root.setAttribute('data-tui-stale', ''); else root.removeAttribute('data-tui-stale');
      const fb = $('sb-fixbtn'); if (fb) fb.dataset.stale = I18n.text(tr('No data'));
    }
    if (sb && statusBar) {
      const q = statusBar.gpsLost ? 0 : statusBar.fixQuality | 0;
      const fb = $('sb-fixbtn');
      if (fb && fb.dataset.q !== String(q)) fb.dataset.q = String(q);
    }
    const [st, word] = steerState();
    if (steerChip.dataset.st !== st || steerChip.dataset.w !== word) {
      steerChip.dataset.st = st; steerChip.dataset.w = word;
      steerChip.querySelector('.st-v').textContent = word;
    }
    buildPage();
    renderXte();
    if (stackNow) stackTop(); // otherwise every 300 ms (layout reads stay out of the frame loop)
    renderCards();
    renderProxies();
    if (menuSheet.classList.contains('open')) renderMoreTiles();
    requestAnimationFrame(frame);
  }
  apply();
  tickClock();
  setInterval(tickClock, 1000);
  // Roll gauge: hidden while it would sit on the cross-track readout or the module column.
  function gaugeFit() {
    const lrEl = $('lowerright'), g = $('rollgauge');
    if (!lrEl || !g) return;
    lrEl.classList.remove('tui-nogauge');
    const r = g.getBoundingClientRect();
    if (!r.width) return;
    const hit = [xteBox, col, $('uturn-indicator')].some(b => {
      if (!b || b.hidden) return false;
      if (!b.offsetParent && getComputedStyle(b).position !== 'fixed') return false;
      const o = b.getBoundingClientRect();
      return o.width > 0 && r.left < o.right && r.right > o.left && r.top < o.bottom + 6 && r.bottom > o.top;
    });
    if (hit) lrEl.classList.add('tui-nogauge');
  }
  // Module column: a card that does not fit whole above the bottom stack is hidden, not cut.
  // On-screen U-turn / shift rows that would sit under the bottom stack (open sim bar) give way.
  function fitOverlays() {
    const cb = col.getBoundingClientRect().bottom;
    for (const c of col.querySelectorAll('.tui-card')) {
      c.style.visibility = '';
      if (c.getBoundingClientRect().bottom > cb + 1) c.style.visibility = 'hidden';
    }
    const rows = document.querySelectorAll('#onscreenbtns .osb-row');
    const stackRects = [...($('bottomstack') ? $('bottomstack').children : [])]
      .filter(c => getComputedStyle(c).display !== 'none').map(c => c.getBoundingClientRect()).filter(r => r.width > 0);
    for (const row of rows) {
      row.classList.remove('tui-osb-off');
      if (row.hidden) continue;
      const r = row.getBoundingClientRect();
      if (stackRects.some(o => r.left < o.right && r.right > o.left && r.bottom > o.top - 4 && r.top < o.bottom)) row.classList.add('tui-osb-off');
    }
  }
  // Point 31: on a narrow screen (7 inch, glove) the on-screen buttons (turn / track left-right)
  // sat over the headland distance. When the two overlap sideways, the buttons move below it.
  let osbKey = '';
  function placeOsb() {
    const osb = $('onscreenbtns'), hud = $('headland-hud');
    let y = 0;
    if (osb && hud && hud.offsetWidth && getComputedStyle(hud).display !== 'none') {
      const a = osb.getBoundingClientRect(), b = hud.getBoundingClientRect();
      if (a.width && a.left < b.right && a.right > b.left) y = Math.round(b.bottom + 8);
    }
    const k = String(y);
    if (k !== osbKey) { osbKey = k; root.style.setProperty('--tui-osb-y', y + 'px'); }
  }
  setInterval(() => { stackTop(); placeBand(); placeWorkArea(); countSlots(); gaugeFit(); placeOsb(); fitOverlays(); }, 300);
  window.addEventListener('resize', () => { waKey = ''; yKey = ''; bandKey = ''; stackNow = true; placeBand(); placeWorkArea(); });
  frame();
  return { get layout() { return layout; }, get mode() { return mode; }, setMode, openMenu, goPage,
    get page() { return pageIdx; }, get pages() { return pages.map(p => p.slice()); } };
})();
// ===== Tablet UI (Phase 2b): polish and German ===================================
// Display only, like Phases 1 and 2: the labels, the moved buttons and the camera pad change
// what is shown; every press still goes to the original button and its handler.
//   aow.ui.langChosen = auto | user   — German was set once as the default / a language was picked
// Numbers and units follow the language: German gets the decimal comma, km/h and ha/h. The
// formatters below are global so the Phase 2 renderers (called during their first frame) find them.
function tuiIsDe() { return String(I18n.language || 'en').split('-')[0] === 'de'; }
// "12.5" → "12,5" in German. Not for IP addresses or versions (two dots or more).
function tuiDec(s) {
  s = String(s);
  if (!tuiIsDe() || /\d\.\d+\.\d/.test(s)) return s;
  return s.replace(/(\d)\.(\d)/g, '$1,$2');
}
function tuiNum(v, dec) { return tuiDec(Number(v).toFixed(dec)); }
// Driving distances with what they measure: to the headland line ahead (tool pivot, along the
// heading) and to the start of the armed auto U-turn.
function tuiHeadlandText() {
  const on = config && config.display && config.display.headlandDistanceVisible;
  const d = tick ? tick.headlandDist : -1;
  if (!on || d == null || d < 0 || document.body.classList.contains('maptap')) return '';
  return tr('Headland {d}', { d: isMetric() ? fmtUnit(d, 'm', 1) : fmtUnit(d, 'm', 0) });
}
function tuiUTurnText() {
  const op = tick && tick.op;
  if (!(scene && scene.hasField && op && op.youturn && op.distToTrigger > 0)) return '';
  return tr('U-turn {d}', { d: fmtUnit(op.distToTrigger, 'm', 0) });
}
const TabletPolish = (() => {
  const root = document.documentElement;
  const $ = id => document.getElementById(id);
  const lsGet = (k, d) => { try { const v = window.localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch (_) { /* private / blocked */ } };

  // --- Units and numbers in German ------------------------------------------------------
  // German: decimal comma, and number and unit stay on one line (no-break space).
  fmtUnit = (orig => function (v, u, dec) { const r = tuiDec(orig(v, u, dec)); return tuiIsDe() ? r.replace(' ', '\u00a0') : r; })(fmtUnit);
  unitLabel = (orig => function (u) { const l = orig(u); return tuiIsDe() && l === 'kph' ? 'km/h' : l; })(unitLabel);
  fmtRate = (orig => function (h) { const r = orig(h); return tuiIsDe() ? r.replace(/\/hr$/, '/h') : r; })(fmtRate);
  // Readouts the upstream code writes with toFixed(): rewritten in place (decimal comma).
  // The rotating status line also carries field / job / track names (user data): there only
  // the degrees of the AB heading are rewritten; area and rate already come from fmtUnit.
  const DEC_IDS = ['sb-speed', 'sb-unit', 'sb-hdg', 'sb-age', 'sb-rot', 'lb', 'roll-deg', 'sim-speedval', 'sim-steerval', 'bn-nudgeval'];
  function fixText(node) {
    if (!tuiIsDe()) return;
    const v = node.nodeValue;
    if (!v || !/\d\.\d|kph|\/hr/.test(v)) return;
    const out = node.parentElement && node.parentElement.closest('#sb-rot')
      ? v.replace(/(\d)\.(\d+°)/g, '$1,$2')
      : tuiDec(v).replace(/\bkph\b/g, 'km/h').replace(/ha\/hr\b/g, 'ha/h');
    if (out !== v) node.nodeValue = out;
  }
  function fixAll(elm) {
    const w = document.createTreeWalker(elm, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) fixText(n);
  }
  const decObs = new MutationObserver(recs => {
    for (const r of recs) {
      if (r.type === 'characterData') fixText(r.target);
      else for (const n of r.addedNodes) { if (n.nodeType === Node.TEXT_NODE) fixText(n); else if (n.nodeType === Node.ELEMENT_NODE) fixAll(n); }
    }
  });
  for (const id of DEC_IDS) { const e = $(id); if (e) { decObs.observe(e, { subtree: true, childList: true, characterData: true }); fixAll(e); } }

  // --- German as the default language --------------------------------------------------------
  // Once per device: if the host still speaks English and German is offered, switch to German
  // with the existing language command. Picking a language in the language panel ends that.
  // Only the device holding control does it, so an observer tablet never flips the host.
  const LANG_KEY = 'aow.ui.langChosen';
  let langDone = false; // also in memory: with storage blocked it would switch back every second
  setInterval(() => {
    if (langDone || !appInfo || !iHoldControl || lsGet(LANG_KEY, '')) return;
    const de = (appInfo.languages || []).some(l => l.code === 'de');
    if (de && (appInfo.currentLanguage || 'en') === 'en') transport.send('app.setLanguage|de');
    lsSet(LANG_KEY, 'auto'); langDone = true;
  }, 1000);
  const langList = $('lang-list');
  if (langList) langList.addEventListener('pointerdown', () => { lsSet(LANG_KEY, 'user'); langDone = true; }, true);

  // --- Distances with a label ---------------------------------------------------------------
  // The name in the label size, the value as before: "Vorgewende 319,0 m". The upstream
  // renderers write the plain value every frame; the name goes in front of it again.
  function labelled(node, key) {
    const first = node.firstElementChild;
    if (first && first.classList.contains('tui-dk')) return;
    node.innerHTML = '<span class="tui-dk">' + esc(I18n.text(key)) + '</span> ' + esc(node.textContent);
  }
  updateHeadlandHud = (orig => function () {
    orig();
    if (hlHud.style.display === 'block' && tuiHeadlandText()) labelled(hlHud, tr('Headland'));
  })(updateHeadlandHud);
  renderUTurnIndicator = (orig => function () {
    orig();
    if (UTI.root && !UTI.root.hidden && tuiUTurnText()) labelled(UTI.dist, tr('U-Turn'));
  })(renderUTurnIndicator);

  // --- Camera pad: hidden while driving; a tap on the map shows it for 5 s -------------------------
  const pad = $('campad');
  let camTimer = 0;
  function showCam() {
    root.setAttribute('data-tui-cam', '');
    clearTimeout(camTimer);
    camTimer = setTimeout(() => root.removeAttribute('data-tui-cam'), 5000);
  }
  const ck = $('ck');
  // Only touches that reach the map: overlays stop their own pointer events.
  window.addEventListener('pointerdown', e => { if (e.target === ck || e.target === document.body) showCam(); });
  if (pad) pad.addEventListener('pointerdown', showCam); // keep it up while it is used

  // --- Bottom bar: a name under every button; rarely used ones go to the menu ---------------------
  const BN_LABEL = [ // [selector in .bn-bar, label, moved to the menu]
    ['#bn-skipcycle', tr('Skip rows'), true],
    ['#bn-skiptoggle', tr('Skip mode'), true],
    ['[data-cmd="map.cycleColor"]', tr('Coverage colour'), true],
    ['[data-cmd="tool.resetHeading"]', tr('Reset tool heading'), true],
    ['#bn-flags', tr('Flags'), false],
    ['[data-cmd="track.snapLeft"]', tr('Track left'), false],
    ['[data-cmd="track.snapRight"]', tr('Track right'), false],
    ['[data-cmd="track.snapPivot"]', tr('Line to me'), false],
    ['#bn-tram', tr('Tram lines'), true],
    ['#bn-abmenu', tr('AB Line'), false],
  ];
  const bar = document.querySelector('#bottomnav .bn-bar');
  if (bar) for (const [sel, label, moved] of BN_LABEL) {
    const b = bar.querySelector(':scope > ' + sel);
    if (!b) continue;
    const l = document.createElement('span'); l.className = 'tui-bn-lbl'; l.textContent = label;
    b.appendChild(l);
    if (moved) b.classList.add('tui-bnmove');
  }

  // --- On-screen U-turn / track shift: framed buttons with a name ----------------------------------
  const OSB_LABEL = { 'youturn.manualLeft': tr('U-turn left'), 'youturn.manualRight': tr('U-turn right'),
    'track.snapLeft': tr('Track left'), 'track.snapRight': tr('Track right') };
  for (const b of document.querySelectorAll('#onscreenbtns .osb-btn')) {
    const t = OSB_LABEL[b.dataset.cmd];
    if (!t) continue;
    const l = document.createElement('span'); l.className = 'tui-osb-lbl'; l.textContent = t;
    b.appendChild(l);
  }

  // With its label the U-turn readout can be too wide for the gap between the cross-track
  // readout and the quick bar (7" screens): then it moves under the readout, right-aligned.
  function placeUTurn() {
    const u = UTI.root, rn = $('rightnav');
    if (!u || u.hidden || !rn) { root.removeAttribute('data-tui-uti-low'); return; }
    const low = root.hasAttribute('data-tui-uti-low');
    if (low) root.removeAttribute('data-tui-uti-low'); // measure in the normal place
    const r = u.getBoundingClientRect(), q = rn.getBoundingClientRect();
    const hit = q.width > 0 && r.right > q.left - 6 && r.left < q.right && r.top < q.bottom && r.bottom > q.top;
    if (hit) { root.setAttribute('data-tui-uti-low', ''); root.style.setProperty('--tui-uti-r', (innerWidth - q.left + 8) + 'px'); }
  }
  setInterval(placeUTurn, 300);

  return { showCam };
})();
// ===== Tablet UI (Phase 2c): vehicle and tool profiles ===========================
// Cards to pick the active vehicle and tool, and an assistant (step by step, a sketch per
// measurement) to make a new one or change the active one. Only existing commands:
// profile.load / new / configureVehicle / configureTool / rename / delete / save and config.set
// with the keys of the setup dialogs; values go through the same unit helpers as there
// (writeUnitInput / readUnitInput), and only the values that were changed are sent.
// The assistant sends nothing while it is open: every value stays here and goes out in one go
// on "Save", so Cancel leaves the active profile exactly as it was. Changing or editing a
// profile needs the vehicle standing and steering off. Unusual values get a yellow warning,
// never a correction.
//   aow.ui.toolIcon.<name> = cultivator | sprayer | …   — symbol picked for a tool (this device only)
const TabletProfiles = (() => {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const lsGet = (k, d) => { try { const v = window.localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { if (v == null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch (_) { /* private / blocked */ } };
  const T = k => I18n.text(k);

  // --- Symbols (own line drawings) -----------------------------------------------------------
  const svg = body => '<svg class="tp-ic" viewBox="0 0 88 58" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">' + body + '</g></svg>';
  const ICON = {
    tractor: svg('<circle cx="22" cy="40" r="14"/><circle cx="22" cy="40" r="4"/><circle cx="70" cy="45" r="9"/><path d="M36 40h25M14 26V10h22l6 16h28l6 10v6h-6"/><path d="M40 10l-4 16"/>'),
    harvester: svg('<circle cx="26" cy="44" r="10"/><circle cx="66" cy="47" r="7"/><path d="M14 36V12h30v24M44 20h22l6 16M2 48h10M8 48l6-12"/>'),
    articulated: svg('<circle cx="20" cy="42" r="11"/><circle cx="66" cy="42" r="11"/><path d="M6 31h30V12H18l-4 10H6zM50 31h32V19H50z"/><path d="M36 26h14"/><circle cx="43" cy="26" r="3"/>'),
    cultivator: svg('<path d="M6 16h76M12 16v20l-5 8M28 16v20l-5 8M44 16v20l-5 8M60 16v20l-5 8M76 16v20l-5 8"/><path d="M44 16V6"/>'),
    sprayer: svg('<rect x="30" y="8" width="28" height="20" rx="8"/><path d="M4 34h80M14 34v6M30 34v6M44 34v6M58 34v6M74 34v6"/><path d="M12 46l2-6 2 6M28 46l2-6 2 6M42 46l2-6 2 6M56 46l2-6 2 6M72 46l2-6 2 6"/>'),
    seeder: svg('<path d="M14 8h60l-8 18H22z"/><path d="M8 32h72M16 32v12M32 32v12M48 32v12M64 32v12"/><circle cx="16" cy="48" r="3"/><circle cx="32" cy="48" r="3"/><circle cx="48" cy="48" r="3"/><circle cx="64" cy="48" r="3"/>'),
    plough: svg('<path d="M4 12h76"/><path d="M16 12l8 24c3 6 11 7 16 3M40 12l8 24c3 6 11 7 16 3"/><path d="M68 12v10"/>'),
    spreader: svg('<path d="M20 6h48L56 28H32z"/><path d="M44 28v6"/><circle cx="30" cy="42" r="8"/><circle cx="58" cy="42" r="8"/><path d="M30 34v16M22 42h16M58 34v16M50 42h16"/>'),
    mower: svg('<path d="M6 36h76M10 36l8-14h52l8 14"/><circle cx="22" cy="44" r="5"/><circle cx="44" cy="44" r="5"/><circle cx="66" cy="44" r="5"/>'),
    other: svg('<rect x="8" y="20" width="72" height="16" rx="3"/><path d="M44 20V8M20 36v10M44 36v10M68 36v10"/>'),
  };
  const VEH_TYPES = [[0, 'tractor', tr('Tractor')], [1, 'harvester', tr('Harvester')], [2, 'articulated', tr('Articulated')]];
  const VEH_TYPE_BY_TEXT = { Tractor: 0, Harvester: 1, FourWD: 2 }; // the host preview's "Type:" (VehicleType enum)
  const TOOL_TYPES = [['front', 0, tr('Front Fixed'), 'ToolChkFront'], ['rear', 1, tr('Rear Fixed'), 'ToolChkRear'],
    ['tbt', 2, tr('TBT'), 'ToolChkTBT'], ['trailing', 3, tr('Trailing'), 'ToolChkTrailing']];
  const ATTACH_TEXT = [tr('Front fixed'), tr('Rear fixed'), tr('Trailing')]; // the host preview's "Attach:"
  const SYMBOLS = [['', tr('From the name')], ['cultivator', tr('Cultivator')], ['sprayer', tr('Sprayer')], ['seeder', tr('Seed drill')],
    ['plough', tr('Plough')], ['spreader', tr('Spreader')], ['mower', tr('Mower')], ['other', tr('Other')]];
  const GUESS = [['sprayer', /spritz|spray/i], ['seeder', /s[äa]e?masch|drill|seed|plant|einzelkorn|legeger/i],
    ['plough', /pflug|plough|plow/i], ['spreader', /streuer|spread|dünger/i], ['mower', /m[äa]h|mower|schwad|wender|mulch/i],
    ['cultivator', /grubber|cultivat|egge|harrow|scheibe|disc|striegel|hacke|fr[äa]se|tiller/i]];
  const iconKey = name => 'aow.ui.toolIcon.' + name;
  function toolSymbol(name, pick) {
    const s = pick != null ? pick : lsGet(iconKey(name), '');
    if (s && ICON[s]) return s;
    for (const [k, re] of GUESS) if (re.test(name)) return k;
    return 'other';
  }
  // Text the host formats ("2.50 m"): shown as it comes, only the decimal comma in German.
  const hostVal = v => (v == null || v === '' ? '—' : tuiDec(v));
  function prevMap(txt) {
    const m = {};
    for (const line of String(txt || '').split('\n')) { const i = line.indexOf(': '); if (i > 0) m[line.slice(0, i)] = line.slice(i + 2); }
    return m;
  }
  const activeName = kind => profiles ? (kind === 'vehicle' ? profiles.activeVehicle : profiles.activeTool) : '';
  // The host lists the profiles saved on disk; a fresh install's "Default" is active before it
  // is saved, so the active one is always added.
  const listOf = kind => {
    if (!profiles) return [];
    const l = kind === 'vehicle' ? profiles.vehicles : profiles.tools, a = activeName(kind);
    return a && !l.some(p => p.name === a) ? [{ name: a, preview: '' }].concat(l) : l;
  };
  const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  // Working width = sum of the sections, as the host computes it (ActualToolWidth); for the
  // active tool from the config, same format as the width card on the work pages.
  function activeWidth() {
    const wm = config && config.tool ? +config.tool.totalWidth || 0 : 0;
    return wm > 0 ? tuiNum(toDisplayUnit(wm, 'm'), 2) + ' ' + unitLabel('m') : '—';
  }

  // --- Lock: profiles change only standing, steering off, connected ---------------------------
  const STILL_MPS = 0.15; // ≈ 0.5 km/h: GPS jitter at a standstill stays below this
  function lockReason() {
    if (connState !== 'connected') return tr('No connection to the guidance computer.');
    // Stale ticks: steering and speed below would be the last known values.
    if (!lastTick || performance.now() - lastTick.t > 2000) return tr('No current data from the guidance computer.');
    // Observers: the operator may switch steering back on at any moment with these values.
    if (!iHoldControl && lastControl && lastControl.held) return tr('Another device has control. Profiles can only be changed there.');
    if (tick && tick.op && tick.op.autoSteer) return tr('Steering is on. Switch steering off to change profiles.');
    if (lastTick && Math.abs(lastTick.speed || 0) > STILL_MPS) return tr('The vehicle is moving. Stop to change profiles.');
    return '';
  }

  // --- Sheet ---------------------------------------------------------------------------------
  const scrim = el('div', 'tp-scrim');
  const sheet = el('div', 'tui-sheet tp-sheet',
    '<div class="tui-sh-hdr"><span class="t"></span><button class="x">✕</button></div><div class="tui-sh-body tp-body"></div><div class="tp-foot"></div><div class="tp-ask" hidden></div>');
  sheet.id = 'tui-prof';
  sheet.querySelector('.x').title = tr('Close');
  document.body.append(scrim, sheet);
  for (const n of [sheet, scrim]) n.addEventListener('pointerdown', e => e.stopPropagation()); // no map pan through it
  const hdrT = sheet.querySelector('.t'), body = sheet.querySelector('.tp-body'), foot = sheet.querySelector('.tp-foot'), ask = sheet.querySelector('.tp-ask');
  let view = 'pick', W = null, sel = { vehicle: '', tool: '' }, msg = '', pickKey = '';
  const isOpen = () => sheet.classList.contains('open');
  onTap(sheet.querySelector('.x'), () => tryClose());
  onTap(scrim, () => tryClose());

  function open() {
    if (lnCloseAllOrig) lnCloseAllOrig();
    view = 'pick'; W = null; msg = ''; pickKey = '';
    sel = { vehicle: activeName('vehicle'), tool: activeName('tool') };
    sheet.classList.add('open'); scrim.classList.add('open');
    render();
  }
  function close() { sheet.classList.remove('open'); scrim.classList.remove('open'); hideAsk(); view = 'pick'; W = null; }
  function tryClose() {
    if (view !== 'wiz' || !W) { close(); return; }
    const wj = wjob();
    if (wj && wj.state === 'sending') return; // wait for the result
    if (wj && (wj.state === 'done' || wj.state === 'reverted')) { close(); return; }
    confirmAsk(tr('Leave the assistant?'), wj ? tr('The saving was not confirmed. Check the values in the profile.') :
      tr('Nothing has been sent; the profile stays as it was.'), tr('Leave'), () => { close(); });
  }

  // Small question box inside the sheet (name entry, confirmations).
  function hideAsk() { ask.hidden = true; ask.innerHTML = ''; }
  function confirmAsk(title, text, okLabel, onOk, danger) {
    ask.innerHTML = '<div class="tp-ask-box"><div class="tp-ask-t"></div><div class="tp-ask-m"></div><div class="tp-ask-b"><button class="tp-btn c"></button><button class="tp-btn pri o"></button></div></div>';
    ask.querySelector('.tp-ask-t').textContent = title; ask.querySelector('.tp-ask-m').textContent = text;
    ask.querySelector('.c').textContent = tr('Cancel');
    const ok = ask.querySelector('.o'); ok.textContent = okLabel; if (danger) ok.classList.add('dan');
    onTap(ask.querySelector('.c'), hideAsk);
    onTap(ok, () => { hideAsk(); onOk(); });
    ask.hidden = false;
  }
  // Name check: not empty, no characters a file name can't hold, not taken (case-insensitive).
  function nameProblem(kind, name, except) {
    if (!name) return tr('Please enter a name.');
    if (name.length > 60) return tr('The name is too long.');
    if (/[\t\\/:*?"<>|]/.test(name)) return tr('Please do not use these characters: \\ / : * ? " < > |');
    // Point 23: names Windows can't use as a file name (the profile is saved as <name>.json).
    if (/[. ]$/.test(name)) return tr('The name must not end with a dot or a space.');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) return tr('This name is reserved on Windows. Please choose another one.');
    if (listOf(kind).some(p => sameName(p.name, name) && !(except && sameName(except, name)))) return tr('A profile with this name already exists.');
    return '';
  }
  function nameAsk(kind, title, start, except, onOk) {
    ask.innerHTML = '<div class="tp-ask-box"><div class="tp-ask-t"></div><input class="tp-name" type="text" maxlength="60" autocomplete="off" translate="no"><div class="tp-ask-e"></div><div class="tp-ask-b"><button class="tp-btn c"></button><button class="tp-btn pri o"></button></div></div>';
    ask.querySelector('.tp-ask-t').textContent = title;
    const inp = ask.querySelector('.tp-name'), err = ask.querySelector('.tp-ask-e');
    inp.value = start || '';
    ask.querySelector('.c').textContent = tr('Cancel'); ask.querySelector('.o').textContent = tr('OK');
    onTap(ask.querySelector('.c'), hideAsk);
    const go = () => { const n = inp.value.trim(), p = nameProblem(kind, n, except); if (p) { err.textContent = p; return; } hideAsk(); onOk(n); };
    onTap(ask.querySelector('.o'), go);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    ask.hidden = false;
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  }

  // --- Pick view: cards ----------------------------------------------------------------------
  // The active profile's values as the host's preview writes them (same fields, 2 decimals).
  function activePreview(kind) {
    if (!config || !config.vehicle || !config.tool) return {};
    const f = v => Number.isFinite(v) ? fmtUnit(v, 'm', 2) : '—'; // point 25: no "NaN m"
    if (kind === 'vehicle') return { Wheelbase: f(config.vehicle.wheelbase), 'Antenna height': f(config.vehicle.antennaHeight), 'Antenna pivot': f(config.vehicle.antennaPivot) };
    return { Sections: String(config.tool.numSections) };
  }
  function cardHtml(kind, p, active) {
    const m = p.preview ? prevMap(p.preview) : active ? activePreview(kind) : {};
    // Active tool: the attach type from the config (the preview writes "—" for TBT).
    if (kind === 'tool' && active && config && config.tool) { const tt = TOOL_TYPES.find(t => t[1] === config.tool.type); if (tt) m['Attach'] = tt[2]; }
    let ic, rows;
    if (kind === 'vehicle') {
      const ty = active && config && config.vehicle ? config.vehicle.type : VEH_TYPE_BY_TEXT[m.Type];
      ic = ICON[(VEH_TYPES.find(v => v[0] === ty) || VEH_TYPES[0])[1]];
      rows = [[tr('Wheelbase'), hostVal(m['Wheelbase'])], [tr('Antenna height'), hostVal(m['Antenna height'])], [tr('Antenna to rear axle'), hostVal(m['Antenna pivot'])]];
    } else {
      ic = ICON[toolSymbol(p.name)];
      rows = [];
      // Inactive: the preview's "Width", which is the sum of the sections since upstream #350.
      rows.push([tr('Working width'), active ? activeWidth() : hostVal(m['Width'])]);
      rows.push([tr('Sections'), hostVal(m['Sections'])], [tr('Attach'), m['Attach'] && m['Attach'] !== '—' ? T(m['Attach']) : '—']);
    }
    return '<span class="tp-c-top"><span class="tp-c-ic">' + ic + '</span><span class="tp-c-n" translate="no"></span>' +
      (active ? '<span class="tp-badge">● ' + esc(T(tr('Active'))) + '</span>' : '') + '</span><span class="tp-c-k">' +
      rows.map(([k, v]) => '<span>' + esc(T(k)) + '</span><b translate="no">' + esc(v) + '</b>').join('') + '</span>';
  }
  function section(kind) {
    const isV = kind === 'vehicle', act = activeName(kind), list = listOf(kind);
    if (!list.some(p => p.name === sel[kind])) sel[kind] = act;
    const s = el('div', 'tp-sec');
    s.appendChild(Object.assign(el('div', 'tui-sh-sec'), { textContent: isV ? T(tr('Vehicle')) : T(tr('Tool')) }));
    const cards = el('div', 'tp-cards');
    for (const p of list) {
      const c = el('button', 'tp-card' + (p.name === sel[kind] ? ' sel' : '') + (p.name === act ? ' on' : ''), cardHtml(kind, p, p.name === act));
      c.querySelector('.tp-c-n').textContent = p.name;
      onTap(c, () => { sel[kind] = p.name; msg = ''; render(); });
      cards.appendChild(c);
    }
    const add = el('button', 'tp-card add', '<span class="tp-plus">＋</span><span></span>');
    add.querySelector('span:last-child').textContent = isV ? T(tr('New vehicle')) : T(tr('New tool'));
    add.disabled = !!lockReason();
    onTap(add, () => startWizard(kind, 'new'));
    cards.appendChild(add);
    s.appendChild(cards);
    const lock = lockReason(), isAct = sel[kind] === act;
    const acts = el('div', 'tp-acts');
    const btn = (label, fn, on, cls) => { const b = el('button', 'tp-btn' + (cls ? ' ' + cls : '')); b.textContent = label; b.disabled = !on; onTap(b, fn); acts.appendChild(b); return b; };
    btn(T(tr('Edit')), () => startWizard(kind, 'edit'), !lock && isAct);
    btn(T(tr('Duplicate')), () => duplicate(kind), !lock && isAct);
    const onDisk = (isV ? profiles.vehicles : profiles.tools).some(p => p.name === sel[kind]); // rename needs the file
    btn(T(tr('Rename')), () => rename(kind), !lock && onDisk);
    btn(T(tr('Delete')), () => remove(kind), !lock && !!sel[kind] && !isAct, 'dan');
    btn(T(tr('All settings')), () => allSettings(kind), !lock && isAct, 'quiet');
    s.appendChild(acts);
    if (!isAct && sel[kind]) s.appendChild(Object.assign(el('div', 'tp-note'),
      { textContent: T(isV ? tr('Edit and duplicate work on the active vehicle. Load it first.') : tr('Edit and duplicate work on the active tool. Load it first.')) }));
    return s;
  }
  function renderPick() {
    hdrT.textContent = T(tr('Vehicle & Tool'));
    body.innerHTML = '';
    const lock = lockReason();
    if (!profiles) { body.textContent = T(tr('Waiting for the profiles…')); foot.innerHTML = ''; return; }
    if (lock) body.appendChild(Object.assign(el('div', 'tp-lock'), { textContent: T(lock) }));
    if (pending) {
      const pb = el('button', 'tp-pend inline', '<span class="tp-pend-t"></span><span class="tp-pend-s"></span>');
      pb.querySelector('.tp-pend-t').textContent = T(tr('Profile not completely saved – check the values'));
      pb.querySelector('.tp-pend-s').textContent = pending.kind === 'vehicle' ? tr('Vehicle "{name}"', { name: pending.name }) : tr('Tool "{name}"', { name: pending.name });
      onTap(pb, () => openRecover());
      body.appendChild(pb);
    }
    body.append(section('vehicle'), section('tool'));
    if (msg) body.appendChild(Object.assign(el('div', 'tp-msg'), { textContent: msg }));
    foot.innerHTML = '';
    const classic = el('button', 'tp-btn quiet'); classic.textContent = T(tr('Classic view'));
    classic.disabled = !!lock;
    onTap(classic, () => {
      if (pending) { openRecover(); return; } // its Load would save the half-applied values too
      close(); lnOpenOrig('vehtoolhub', 'ln-vehicle', refreshHub);
    });
    const changed = sel.vehicle !== profiles.activeVehicle || sel.tool !== profiles.activeTool;
    const load = el('button', 'tp-btn pri big');
    load.innerHTML = '✓ <span></span>';
    load.querySelector('span').textContent = changed ? tr('Load: {vehicle} + {tool}', { vehicle: sel.vehicle, tool: sel.tool }) : T(tr('Loaded'));
    load.setAttribute('translate', 'no');
    load.disabled = !!lock || !changed;
    onTap(load, () => {
      if (lockReason()) return;
      if (pending) { openRecover(); return; } // the host would save the half-applied values first
      transport.send('profile.load|' + sel.vehicle + '\t' + sel.tool); // saves the outgoing pair first (host)
      // Point 23: "Loaded" only once the host's profile list names this pair as active.
      loadWait = { vehicle: sel.vehicle, tool: sel.tool, t: Date.now() };
      msg = tr('Loading: {vehicle} + {tool} …', { vehicle: sel.vehicle, tool: sel.tool });
    });
    foot.append(classic, el('span', 'tp-grow'), load);
  }
  // While a save is unfinished, the active pair holds half-applied values only in memory.
  // Load, duplicate and rename make the host save it (profile.load / profile.new save the
  // active pair first, rename leaves the record pointing at a name that is gone), so the
  // recovery view comes first, as for the assistant.
  function duplicate(kind) {
    if (pending) { openRecover(); return; }
    const src = activeName(kind);
    nameAsk(kind, T(kind === 'vehicle' ? tr('Duplicate vehicle') : tr('Duplicate tool')), tr('{name} copy', { name: src }), null, n => {
      if (lockReason()) return;
      transport.send('profile.new|' + kind + '\t' + n); // copy of the active profile under a new name
      if (kind === 'tool') { const s = lsGet(iconKey(src), ''); if (s) lsSet(iconKey(n), s); }
      sel[kind] = n; msg = tr('Copy made: {name}', { name: n }); render();
    });
  }
  function rename(kind) {
    if (pending) { openRecover(); return; }
    const old = sel[kind];
    nameAsk(kind, T(tr('Rename')), old, old, n => {
      if (lockReason() || n === old) return;
      transport.send('profile.rename|' + kind + '\t' + old + '\t' + n);
      if (kind === 'tool') { const s = lsGet(iconKey(old), ''); if (s) { lsSet(iconKey(n), s); lsSet(iconKey(old), null); } }
      sel[kind] = n; msg = ''; render();
    });
  }
  function remove(kind) {
    const n = sel[kind];
    if (!n || n === activeName(kind)) return;
    confirmAsk(T(tr('Delete Profile')), tr('Delete the profile "{name}"? This cannot be undone.', { name: n }), T(tr('Delete')), () => {
      if (lockReason()) return;
      transport.send('profile.delete|' + kind + '\t' + n);
      if (kind === 'tool') lsSet(iconKey(n), null);
      sel[kind] = activeName(kind); msg = ''; render();
    }, true);
  }
  // The full setup dialogs (every field, each change takes effect at once as before).
  function allSettings(kind) {
    close();
    if (typeof TabletTerminal !== 'undefined' && TabletTerminal.layout === 'terminal') TabletTerminal.setMode('setup');
    if (kind === 'vehicle') lnOpenOrig('vehiclecfg', 'ln-vehicle', () => populateVehicleCfg(true));
    else lnOpenOrig('toolcfg', 'ln-vehicle', () => populateToolCfg(true));
  }

  // --- Assistant -----------------------------------------------------------------------------
  // A field: key (config.set), unit ('m' | 'cm' | ''), the step of the matching setup-dialog input,
  // label, help, sketch. Signed fields show the amount plus a side choice; the value sent is
  // -amount / 0 / +amount, as the dialog's side buttons would leave it.
  const V_FIELDS = {
    wheelbase: { key: 'vehicle.wheelbase', unit: 'm', label: tr('Wheelbase'), help: tr('Centre of the rear axle to centre of the front axle, measured at the side.'), sk: 'wheelbase', warn: [1, 6] },
    trackWidth: { key: 'vehicle.trackWidth', unit: 'm', label: tr('Track width'), help: tr('Centre of the left tyre to centre of the right tyre.'), sk: 'trackWidth' },
    hitchLength: { key: 'vehicle.hitchLength', unit: 'm', label: tr('Hitch length'), help: tr('Rear axle to the hitch point.'), sk: 'hitchLength' },
    antennaPivot: { key: 'vehicle.antennaPivot', unit: 'm', label: tr('Antenna to rear axle'), help: tr('From the middle of the rear axle to the antenna, along the vehicle.'), sk: 'antennaPivot', warnAbs: 4 },
    antennaHeight: { key: 'vehicle.antennaHeight', unit: 'm', label: tr('Antenna height'), help: tr('From the ground to the antenna.'), sk: 'antennaHeight', warn: [1, 5] },
    antennaOffset: { key: 'vehicle.antennaOffset', unit: 'm', label: tr('Antenna to the side'), help: tr('From the middle of the vehicle to the antenna, sideways.'), sk: 'antennaOffset', warnAbs: 0.5,
      sides: [['left', -1, tr('Left')], ['center', 0, tr('Center')], ['right', 1, tr('Right')]] },
  };
  const T_FIELDS = {
    hitchLength: { key: 'tool.hitchLength', unit: 'm', label: tr('Working center'), help: tr('Middle of the rear axle to the working point of the tool, along the vehicle.'), sk: 'tool:hitchLength' },
    trailingHitchLength: { key: 'tool.trailingHitchLength', unit: 'm', label: tr('Trailing hitch'), help: tr('Hitch pin of the tractor to the axle of the tool.'), sk: 'tool:trailingHitchLength' },
    tankTrailingHitchLength: { key: 'tool.tankTrailingHitchLength', unit: 'm', label: tr('Tank trailing hitch'), help: tr('Hitch pin of the tractor to the axle of the tank.'), sk: 'tool:tankTrailingHitchLength' },
    length: { key: 'tool.length', unit: 'm', label: tr('Implement length'), help: tr('Working point to the rear end of the tool.'), sk: 'tool:length' },
    offset: { key: 'tool.offset', unit: 'm', label: tr('Tool offset'), help: tr('Tool shifted sideways from the middle of the vehicle.'), img: 'ToolOffsetPositiveRight',
      sides: [['left', -1, tr('Left')], ['zero', 0, tr('Zero')], ['right', 1, tr('Right')]] },
    overlap: { key: 'tool.overlap', unit: 'm', label: tr('Overlap / gap'), help: tr('Overlap between two passes, or a gap.'), img: 'ToolOverlap',
      sides: [['gap', -1, tr('Gap')], ['zero', 0, tr('Zero')], ['overlap', 1, tr('Overlap')]] },
    defaultSectionWidth: { key: 'tool.defaultSectionWidth', unit: 'cm', label: tr('Default width'), help: tr('Width given to sections that are added.'), sk: 'sections' },
  };
  // The matching input of the setup dialogs: its step decides rounding and display (as there).
  const dlgInput = key => document.querySelector('#vehiclecfg .cfg-num[data-key="' + key + '"], #toolcfg .cfg-num[data-key="' + key + '"]');
  const stepOf = key => { const d = dlgInput(key); return d ? (d.dataset.mstep || d.getAttribute('step') || '0.01') : '0.01'; };
  const metricOf = inp => readUnitInput(inp);
  const fmtM = (v, u) => Number.isFinite(v) ? fmtUnit(v, u) : '—';

  function makeNum(key, unit, metricVal, step) {
    const inp = el('input', 'tp-in');
    inp.type = 'number'; inp.inputMode = 'decimal'; inp.setAttribute('step', step || stepOf(key));
    if (unit) inp.dataset.unit = unit;
    inp.dataset.key = key;
    applyUnitsTo(inp);
    if (Number.isFinite(metricVal)) writeUnitInput(inp, metricVal);
    inp.dataset.init = inp.value;
    inp.addEventListener('input', () => onEdit());
    inp.addEventListener('focus', () => { if (W) { W.focus = inp.dataset.sk || W.focus; drawSketch(); } });
    return inp;
  }
  // applyUnits() for one new input (the global one walks the page).
  function applyUnitsTo(inp) {
    if (inp.dataset.mstep == null) inp.dataset.mstep = inp.getAttribute('step') || '';
    const d = UNIT_DEFS[inp.dataset.unit];
    if (d && !isMetric()) inp.step = String(d.impStep);
  }
  function fieldRow(f, inp, extra) {
    const r = el('div', 'tp-fld');
    r.innerHTML = '<div class="tp-f-l"></div><div class="tp-f-h"></div><div class="tp-f-in"></div><div class="tp-f-w" hidden></div>';
    r.querySelector('.tp-f-l').textContent = T(f.label);
    r.querySelector('.tp-f-h').textContent = T(f.help || '');
    const box = r.querySelector('.tp-f-in');
    box.appendChild(inp);
    const u = el('span', 'tp-f-u'); u.textContent = f.unit ? unitLabel(f.unit) : ''; box.appendChild(u);
    if (extra) r.appendChild(extra);
    inp.dataset.sk = f.sk || f.img || '';
    r.addEventListener('pointerdown', e => { if (e.target === r || !e.target.closest('input,button,select')) inp.focus(); });
    return r;
  }
  // Signed field: amount + side.
  function signedField(f, metricVal) {
    const zeroSide = f.sides.find(s => s[1] === 0)[0];
    const side0 = !Number.isFinite(metricVal) ? zeroSide : metricVal < -0.005 ? f.sides.find(s => s[1] < 0)[0] : metricVal > 0.005 ? f.sides.find(s => s[1] > 0)[0] : zeroSide;
    const inp = makeNum(f.key, f.unit, Number.isFinite(metricVal) ? Math.abs(metricVal) : NaN);
    const seg = el('div', 'tp-seg');
    const st = { f, inp, side: side0, side0, base: metricVal };
    for (const [id, , label] of f.sides) {
      const b = el('button', 'tp-segb'); b.textContent = T(label); b.dataset.side = id;
      onTap(b, () => { st.side = id; syncSeg(); onEdit(); });
      seg.appendChild(b);
    }
    const syncSeg = () => {
      for (const b of seg.children) b.classList.toggle('on', b.dataset.side === st.side);
      const zero = f.sides.find(s => s[0] === st.side)[1] === 0;
      inp.disabled = zero;
    };
    st.syncSeg = syncSeg; syncSeg();
    st.row = fieldRow(f, inp, seg);
    st.changed = () => st.side !== st.side0 || (f.sides.find(s => s[0] === st.side)[1] !== 0 && inp.value !== inp.dataset.init);
    st.value = () => { const sg = f.sides.find(s => s[0] === st.side)[1]; if (sg === 0) return 0;
      // Magnitude untouched (only the side changed): the host's exact value, not the rounded text.
      const a = inp.value === inp.dataset.init && Number.isFinite(st.base) && Math.abs(st.base) > 0.005 ? Math.abs(st.base) : metricOf(inp); return Number.isFinite(a) ? sg * Math.abs(a) : NaN; };
    return st;
  }
  function plainField(f, metricVal) {
    const inp = makeNum(f.key, f.unit, metricVal);
    const st = { f, inp, base: metricVal, row: fieldRow(f, inp) };
    st.changed = () => inp.value !== inp.dataset.init;
    st.value = () => metricOf(inp);
    return st;
  }
  function selectField(key, label, opts, cur) {
    const s = el('select', 'tp-sel');
    opts.forEach((lab, i) => { const o = el('option'); o.value = String(i - 1); o.textContent = T(lab); s.appendChild(o); });
    s.value = String(cur);
    s.addEventListener('change', () => onEdit());
    const r = el('div', 'tp-fld');
    r.innerHTML = '<div class="tp-f-l"></div><div class="tp-f-h"></div><div class="tp-f-in"></div>';
    r.querySelector('.tp-f-l').textContent = T(label);
    r.querySelector('.tp-f-in').appendChild(s);
    return { key, sel: s, base: cur, row: r, changed: () => s.value !== String(cur), value: () => s.value, label, opts };
  }
  // Coupling type (ISO 11783 code, Vehicle/Tool.HitchType) as tiles with everyday names, the norm
  // small below. The host only writes it into the ISO-XML export (connector type, DDI 157); it
  // does not change guidance, steering or the tool position. Same value as the select had.
  function hitchTiles(key, cur) {
    const r = el('div', 'tp-fld wide');
    r.innerHTML = '<div class="tp-f-l"></div><div class="tp-f-h"></div><div class="tp-hitch"></div>';
    r.querySelector('.tp-f-l').textContent = T(tr('Coupling type'));
    r.querySelector('.tp-f-h').textContent = T(tr('Only a description (ISO-XML export); it does not change guidance or steering.'));
    const g = r.querySelector('.tp-hitch');
    const st = { key, base: cur, cur: String(cur), row: r, label: tr('Coupling type'), opts: HITCH_OPTS };
    for (const h of TUI_HITCH) {
      const b = el('button', 'tp-ht', tuiHitchPicto(h.code) + '<b></b><small></small>');
      b.dataset.code = String(h.code);
      b.querySelector('b').textContent = T(h.name);
      b.querySelector('small').textContent = HITCH_NORM[h.code + 1] || '';
      onTap(b, () => { st.cur = String(h.code); sync(); onEdit(); });
      g.appendChild(b);
    }
    const sync = () => { for (const b of g.children) b.classList.toggle('on', b.dataset.code === st.cur); };
    sync();
    st.changed = () => st.cur !== String(cur);
    st.value = () => st.cur;
    return st;
  }
  function warnFor(f, v) {
    if (!Number.isFinite(v)) return '';
    if (f.warn && (v < f.warn[0] || v > f.warn[1]))
      return tr('Unusual value (expected {min} to {max}). Please measure again; it is saved as entered.', { min: fmtUnit(f.warn[0], f.unit), max: fmtUnit(f.warn[1], f.unit) });
    if (f.warnAbs && Math.abs(v) > f.warnAbs)
      return tr('Unusual value (usually not more than {max}). Please measure again; it is saved as entered.', { max: fmtUnit(f.warnAbs, f.unit) });
    return '';
  }

  // The host's values for the profile kind (a tool also depends on the vehicle type).
  const snapOf = kind => JSON.stringify(config[kind]) + (kind === 'tool' ? '|' + (config.vehicle.type | 0) : '');
  function startWizard(kind, mode) {
    if (lockReason() || !config || !config.vehicle || !config.tool || !profiles) return;
    if (pending) { openRecover(); return; } // an unfinished save comes first
    const src = activeName(kind);
    const v = config.vehicle, t = config.tool;
    W = { kind, mode, src, name: mode === 'edit' ? src : '', step: 0, focus: '', save: null, sym: null,
      harvester: (v.type | 0) === 1, baseToolType: t.type, snap: snapOf(kind), metric: isMetric() };
    if (kind === 'vehicle') {
      W.type = { key: 'vehicle.type', base: v.type | 0, cur: v.type | 0 };
      W.f = {
        wheelbase: plainField(V_FIELDS.wheelbase, v.wheelbase),
        trackWidth: plainField(V_FIELDS.trackWidth, v.trackWidth),
        hitchLength: plainField(V_FIELDS.hitchLength, v.hitchLength),
        antennaPivot: plainField(V_FIELDS.antennaPivot, v.antennaPivot),
        antennaHeight: plainField(V_FIELDS.antennaHeight, v.antennaHeight),
        antennaOffset: signedField(V_FIELDS.antennaOffset, v.antennaOffset),
      };
      W.hitch = hitchTiles('vehicle.hitchType', v.hitchType);
      W.steps = mode === 'new' ? ['type', 'name', 'size', 'antenna', 'check'] : ['type', 'size', 'antenna', 'check'];
    } else {
      const ty = TOOL_TYPES.find(x => x[1] === t.type) || TOOL_TYPES[1];
      W.type = { key: 'tool.type', base: ty[0], cur: ty[0] };
      W.sym = lsGet(iconKey(src), '');
      W.symBase = W.sym;
      W.f = {};
      for (const k of ['hitchLength', 'trailingHitchLength', 'tankTrailingHitchLength', 'length', 'defaultSectionWidth']) W.f[k] = plainField(T_FIELDS[k], t[k]);
      W.f.offset = signedField(T_FIELDS.offset, t.offset);
      W.f.overlap = signedField(T_FIELDS.overlap, t.overlap);
      W.hitch = hitchTiles('tool.hitchType', t.hitchType);
      W.nSec = { base: t.numSections | 0 };
      W.nSec.inp = makeNum('tool.numSections', '', t.numSections | 0, '1');
      W.nSec.inp.min = '1'; W.nSec.inp.max = '64';
      W.widths = []; // { inp, init, edited }
      W.baseWidths = (t.sectionWidths || []).slice();
      W.steps = mode === 'new' ? ['type', 'name', 'sections', 'hitch', 'check'] : ['type', 'sections', 'hitch', 'check'];
      // A new tool on a harvester: the header is offered straight away (front fixed, one section).
      if (mode === 'new' && W.harvester) setHeader(true);
    }
    view = 'wiz';
    renderWizard();
  }
  // Section width boxes follow the count. Sections that exist keep their width; added ones start
  // with the default width, as the host gives them (ConfigurationStore.NumSections).
  function syncWidths() {
    const n = Math.max(1, Math.min(64, Math.round(parseFloat(W.nSec.inp.value)) || 0));
    const def = W.f.defaultSectionWidth.inp.value;
    for (let i = 0; i < Math.max(n, W.widths.length); i++) {
      if (i >= n) { if (W.widths[i]) W.widths[i].wrap.hidden = true; continue; }
      if (!W.widths[i]) {
        const exists = i < W.nSec.base;
        const inp = makeNum('tool.sectionWidth', 'cm', exists ? W.baseWidths[i] : NaN, '0.1'); // as the dialog's section boxes
        if (!exists) { inp.value = def; inp.dataset.init = def; }
        inp.dataset.sk = 'sections';
        const wrap = el('label', 'tp-sw'); wrap.innerHTML = '<span></span>'; wrap.firstChild.textContent = 'S' + (i + 1); wrap.appendChild(inp);
        const w = { inp, wrap, exists, edited: false };
        inp.addEventListener('input', () => { w.edited = true; });
        W.widths[i] = w;
        W.swBox.appendChild(wrap);
      }
      const w = W.widths[i];
      w.wrap.hidden = false;
      // Not yet typed in: an added section follows the default width.
      if (!w.exists && !w.edited) { w.inp.value = def; w.inp.dataset.init = def; }
    }
  }
  function sumWidthM() {
    const n = Math.max(1, Math.min(64, Math.round(parseFloat(W.nSec.inp.value)) || 0));
    let s = 0;
    for (let i = 0; i < n; i++) { const v = W.widths[i] ? metricOf(W.widths[i].inp) : NaN; if (!Number.isFinite(v)) return NaN; s += v; }
    return s / 100; // cm → m, as ActualToolWidth
  }

  // Sketches: own drawings for the vehicle measurements and the sections; the hitch, offset and
  // overlap pictures are the ones of the tool setup dialog (they show what each length means).
  function dim(x1, y1, x2, y2, label, lx, ly, anchor) {
    const a = Math.atan2(y2 - y1, x2 - x1), h = 12, w = 6;
    const head = (x, y, d) => { const c = Math.cos(a) * d, s = Math.sin(a) * d;
      return 'M' + x + ' ' + y + 'L' + (x - c * h - s * w) + ' ' + (y - s * h + c * w) + 'L' + (x - c * h + s * w) + ' ' + (y - s * h - c * w) + 'Z'; };
    return '<g class="sk-d"><line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/><path d="' + head(x2, y2, 1) + head(x1, y1, -1) + '"/></g>' +
      '<text class="sk-dl" x="' + lx + '" y="' + ly + '" text-anchor="' + (anchor || 'middle') + '">' + esc(T(label)) + '</text>';
  }
  const dash = (x1, y1, x2, y2) => '<line class="sk-x" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>';

  // --- Coupling types: everyday names and own pictograms (side view, tractor rear on the left) ---
  // code = ISO 11783 connector code (Vehicle/Tool.HitchType); the norm comes from HITCH_NORM.
  const TUI_HITCH = [
    { code: 5, name: tr('Clevis (jaw)') }, { code: 8, name: tr('Ball hitch K80') }, { code: 6, name: tr('Piton-fix') },
    { code: 4, name: tr('Hitch hook') }, { code: 1, name: tr('Swinging drawbar') }, { code: 3, name: tr('Three-point linkage') },
    { code: 2, name: tr('Three-point, semi-mounted') }, { code: 7, name: tr('CUNA hitch') }, { code: 10, name: tr('Drawbar eye (wagon)') },
    { code: 9, name: tr('Self-propelled (on the chassis)') }, { code: 0, name: tr('Unknown') }, { code: -1, name: tr('Not specified') },
  ];
  const HITCH_NORM = ['', '', 'ISO 6489-3', 'ISO 730', 'ISO 730', 'ISO 6489-1', 'ISO 6489-2 (40 mm)', 'ISO 6489-4', 'ISO 6489-5', 'ISO 24347', '', 'ISO 5692-2'];
  function tuiHitchPicto(code) {
    // Tractor rear: wheel, fender, body; the coupling sits right of x = 58.
    const base = '<circle cx="34" cy="46" r="20"/><circle cx="34" cy="46" r="5"/><path d="M6 22h44l8 18v10"/><path d="M14 30a22 22 0 0 1 40 6"/>';
    const c = {
      1: '<path d="M58 54h34"/><circle cx="88" cy="54" r="3"/>',
      2: '<path d="M58 52l26 6"/><path d="M84 40v22h22"/><circle cx="100" cy="62" r="6"/>',
      3: '<path d="M58 52l24 4"/><path d="M58 32l24 4"/><path d="M82 30v32h18v-32z"/>',
      4: '<path d="M58 54h26q8 0 8-8v-4"/>',
      5: '<path d="M58 44h28M58 56h28"/><path d="M80 38v24"/>',
      6: '<path d="M58 58h30"/><path d="M82 58v-14q0-4 4-4"/>',
      7: '<path d="M58 42h24M58 58h24"/><path d="M82 42q10 8 0 16"/><path d="M76 36v28"/>',
      8: '<path d="M58 56h26v-8"/><circle cx="84" cy="42" r="6"/>',
      9: '<path d="M58 30h44v24h-44z"/><path d="M66 54v8M94 54v8"/>',
      10: '<path d="M58 54h22"/><circle cx="88" cy="54" r="7"/>',
    }[code];
    const q = '<text x="84" y="56" text-anchor="middle" class="ht-q">?</text>';
    return '<svg class="tp-htp" viewBox="0 0 120 72"><line class="ht-g" x1="2" y1="67" x2="118" y2="67"/><g class="ht-b">' + base + (c || '') + '</g>' + (c ? '' : q) + '</svg>';
  }

  // --- Tool measurements: side view per tool type, each length with arrows from point to point.
  // The focused field's length is highlighted; the vehicle's hitch length (rear axle → hitch pin)
  // is shown for trailing/TBT tools, where the host adds it (ToolPositionService.Update).
  function tuiToolSketch(type, focus, veh) {
    const on = k => !focus || focus === k;
    const D = (k, x1, x2, y, label, ly) => '<g class="' + (on(k) ? 'sk-on' : 'sk-off') + '">' + dash(x1, y - 30, x1, y + 8) + dash(x2, y - 30, x2, y + 8) +
      dim(Math.min(x1, x2), y, Math.max(x1, x2), y, label, (x1 + x2) / 2, ly != null ? ly : y + 26) + '</g>';
    const tractor = (dx, flip) => '<g class="sk-b" transform="translate(' + dx + ' 0) scale(0.82)' + (flip ? '' : '') + '">' +
      '<circle cx="170" cy="262" r="68"/><circle cx="170" cy="262" r="14"/><circle cx="410" cy="284" r="46"/><circle cx="410" cy="284" r="9"/>' +
      '<path d="M100 200V70h120l26 90h164l42 54v24"/><path d="M226 70l-20 90"/></g>';
    const wheel = (x, r) => '<g class="sk-b"><circle cx="' + x + '" cy="' + (270 - r) + '" r="' + r + '"/><circle cx="' + x + '" cy="' + (270 - r) + '" r="4"/></g>';
    const mark = x => '<path class="sk-wp" d="M' + x + ' 270l-9 -16h18z"/>'; // working point on the ground
    let g = '<line class="sk-g" x1="10" y1="270" x2="890" y2="270"/>';
    const vh = veh && Number.isFinite(veh.hitchLength) ? veh.hitchLength : NaN;
    if (type === 0) { // front fixed: tractor left (rear axle x 180), tool ahead on the right
      g += tractor(40) + '<g class="sk-b"><path d="M412 238h46"/><path d="M412 214l46 6"/><rect x="470" y="150" width="150" height="90" rx="8"/></g>' + mark(560);
      g += D('hitchLength', 180, 560, 300, tr('Working center')) + D('length', 560, 620, 120, tr('Implement length'), 104);
    } else if (type === 1) { // rear fixed: tractor right (rear axle x 640), tool behind on the left
      g += tractor(500) + '<g class="sk-b"><path d="M584 236h-60"/><path d="M584 214l-60 6"/><rect x="400" y="150" width="124" height="90" rx="8"/></g>' + mark(450);
      g += D('hitchLength', 450, 640, 300, tr('Working center')) + D('length', 400, 450, 120, tr('Implement length'), 104);
    } else if (type === 3) { // trailing
      g += tractor(500) + '<g class="sk-b"><circle cx="555" cy="225" r="6"/><path d="M549 225H330"/><rect x="180" y="170" width="150" height="60" rx="8"/></g>' + wheel(300, 26);
      g += '<g class="sk-off">' + dash(555, 195, 555, 278) + dash(640, 195, 640, 278) + dim(555, 288, 640, 288, '', 0, 0) + '</g>';
      g += D('trailingHitchLength', 300, 555, 300, tr('Trailing hitch')) + D('length', 180, 300, 140, tr('Implement length'), 124);
    } else { // TBT: tank on the hitch, tool behind the tank
      g += tractor(500) + '<g class="sk-b"><circle cx="555" cy="225" r="6"/><path d="M549 225H480"/><rect x="360" y="120" width="120" height="110" rx="10"/><path d="M360 220H230"/>' +
        '<rect x="70" y="175" width="160" height="55" rx="8"/></g>' + wheel(420, 30) + wheel(170, 24);
      g += '<g class="sk-off">' + dash(555, 195, 555, 278) + dash(640, 195, 640, 278) + dim(555, 288, 640, 288, '', 0, 0) + '</g>';
      g += D('tankTrailingHitchLength', 420, 555, 300, tr('Tank trailing hitch')) + D('trailingHitchLength', 170, 420, 300, tr('Trailing hitch'))
        + D('length', 70, 170, 140, tr('Implement length'), 124);
    }
    if (type === 2 || type === 3)
      g += '<text class="sk-dl sk-small" x="598" y="328" text-anchor="start">' + esc(T(tr('Hitch length (vehicle)'))) + ' ' + esc(fmtM(vh, 'm')) + '</text>';
    return '<svg class="tp-sk tp-sk-tool" viewBox="0 0 900 340">' + g + '</svg>';
  }
  function sideView(extra) {
    return '<svg class="tp-sk" viewBox="0 0 560 380"><line class="sk-g" x1="20" y1="330" x2="540" y2="330"/>' +
      '<g class="sk-b"><circle cx="170" cy="262" r="68"/><circle cx="170" cy="262" r="14"/><circle cx="410" cy="284" r="46"/><circle cx="410" cy="284" r="9"/>' +
      '<path d="M100 200V70h120l26 90h164l42 54v24"/><path d="M226 70l-20 90"/><path d="M102 250H72"/><circle cx="66" cy="250" r="6"/></g>' +
      '<rect class="sk-a" x="194" y="50" width="40" height="14" rx="5"/>' + extra + '</svg>';
  }
  function rearView(extra) {
    return '<svg class="tp-sk" viewBox="0 0 560 380"><line class="sk-g" x1="20" y1="330" x2="540" y2="330"/>' +
      '<g class="sk-b"><rect x="104" y="196" width="72" height="134" rx="16"/><rect x="384" y="196" width="72" height="134" rx="16"/>' +
      '<path d="M176 250h208"/><rect x="204" y="70" width="152" height="170" rx="12"/></g>' +
      dash(280, 30, 280, 345) + '<rect class="sk-a" x="306" y="48" width="40" height="14" rx="5"/>' + extra + '</svg>';
  }
  function sectionsView() {
    const n = Math.max(1, Math.min(64, Math.round(parseFloat(W.nSec.inp.value)) || 1)), shown = Math.min(n, 16);
    const ws = []; for (let i = 0; i < shown; i++) { const v = W.widths[i] ? metricOf(W.widths[i].inp) : NaN; ws.push(Number.isFinite(v) && v > 0 ? v : 1); }
    const tot = ws.reduce((a, b) => a + b, 0), x0 = 40, x1 = 520;
    let x = x0, segs = '';
    ws.forEach((w, i) => { const nx = x + (x1 - x0) * w / tot; segs += '<rect class="sk-sec' + (i % 2 ? ' alt' : '') + '" x="' + x + '" y="190" width="' + (nx - x) + '" height="34"/>'; x = nx; });
    const s1 = x0 + (x1 - x0) * ws[0] / tot;
    return '<svg class="tp-sk" viewBox="0 0 560 380"><g class="sk-b"><rect x="252" y="30" width="56" height="96" rx="10"/><path d="M240 46v24M320 46v24M240 92v26M320 92v26M280 126v64"/></g>' +
      segs + (n > shown ? '<text class="sk-dl" x="280" y="182" text-anchor="middle">' + esc(tr('({n} sections)', { n })) + '</text>' : '') +
      dim(x0, 262, x1, 262, tr('Working width'), 280, 296) + dim(x0, 160, s1, 160, tr('Section'), x0, 146, 'start') + '</svg>';
  }
  function hitchImg() {
    const ty = (TOOL_TYPES.find(x => x[0] === W.type.cur) || TOOL_TYPES[1])[1];
    return '/icons/' + (['ToolHitchPageFront', 'ToolHitchPageRear', 'ToolHitchPageTBT', 'ToolHitchPageTrailing'][ty] || 'ToolHitchPageRear') + '.png';
  }
  function sketchSvg(id) {
    switch (id) {
      case 'wheelbase': return sideView(dash(170, 262, 170, 362) + dash(410, 284, 410, 362) + dim(170, 350, 410, 350, tr('Wheelbase'), 290, 374));
      case 'hitchLength': return sideView(dash(66, 250, 66, 362) + dash(170, 262, 170, 362) + dim(66, 350, 170, 350, tr('Hitch length'), 118, 374));
      case 'antennaPivot': return sideView(dash(170, 262, 170, 20) + dash(214, 50, 214, 20) + dim(170, 28, 214, 28, tr('Antenna to rear axle'), 230, 33, 'start'));
      case 'antennaHeight': return sideView(dash(234, 57, 512, 57) + dim(500, 330, 500, 57, tr('Antenna height'), 488, 120, 'end'));
      case 'trackWidth': return rearView(dash(140, 330, 140, 362) + dash(420, 330, 420, 362) + dim(140, 352, 420, 352, tr('Track width'), 280, 376));
      case 'antennaOffset': return rearView(dim(280, 22, 326, 22, tr('Antenna to the side'), 340, 27, 'start'));
      case 'sections': return sectionsView();
      case 'hitch': return '<img class="tp-skimg" src="' + hitchImg() + '" alt="">';
      default: if (id.startsWith('tool:')) return tuiToolSketch(toolTypeNo(), id.slice(5), config && config.vehicle); return '';
      case 'ToolOffsetPositiveRight': case 'ToolOverlap': return '<img class="tp-skimg" src="/icons/' + id + '.png" alt="">';
    }
  }
  function drawSketch() {
    const box = W && W.skBox;
    if (!box) return;
    const id = W.focus || W.skDefault || '';
    const k = id + '|' + (id === 'sections' ? W.nSec.inp.value + W.widths.map(w => w.inp.value).join(',') : id === 'hitch' || id.startsWith('tool:') ? W.type.cur : '') + '|' + I18n.language;
    if (box.dataset.k === k) return;
    box.dataset.k = k;
    box.innerHTML = sketchSvg(id);
  }

  const STEP_LABEL = { type: tr('Type'), attach: tr('Attach'), name: tr('Name'), size: tr('Dimensions'), antenna: tr('Antenna'),
    sections: tr('Sections'), hitch: tr('Hitch'), header: tr('Header'), check: tr('Check and save') };
  const stepTitle = s => T(STEP_LABEL[s === 'type' && W.kind === 'tool' ? 'attach' : s]);
  function renderWizard() {
    const isV = W.kind === 'vehicle';
    hdrT.textContent = W.mode === 'new' ? T(isV ? tr('New vehicle') : tr('New tool')) : tr('Edit: {name}', { name: W.src });
    hdrT.setAttribute('translate', 'no');
    body.innerHTML = '';
    const steps = el('div', 'tp-steps');
    W.steps.forEach((s, i) => {
      const b = el('button', 'tp-st' + (i < W.step ? ' done' : i === W.step ? ' cur' : ''));
      b.textContent = (i + 1) + ' ' + stepTitle(s) + (i < W.step ? ' ✓' : '');
      b.disabled = i > W.step || !!wjob();
      onTap(b, () => { W.step = i; renderWizard(); });
      steps.appendChild(b);
    });
    body.appendChild(steps);
    const s = W.steps[W.step];
    W.skBox = null; W.focus = '';
    const page = el('div', 'tp-page');
    if (s === 'type') pageType(page);
    else if (s === 'name') pageName(page);
    else if (s === 'size') pageFields(page, [W.f.wheelbase, W.f.trackWidth], [W.hitch, W.f.hitchLength], 'wheelbase');
    else if (s === 'antenna') pageFields(page, [W.f.antennaPivot, W.f.antennaHeight, W.f.antennaOffset], null, 'antennaPivot');
    else if (s === 'sections') pageSections(page);
    else if (s === 'hitch') pageHitch(page);
    else if (s === 'header') pageHeader(page);
    else pageCheck(page);
    body.appendChild(page);
    if (s === 'check') renderResult();
    renderWizFoot();
    onEdit();
  }
  function renderWizFoot() {
    foot.innerHTML = '';
    const s = W.steps[W.step], wj = wjob();
    const back = el('button', 'tp-btn'); back.textContent = '← ' + T(W.step === 0 ? tr('Cancel') : tr('Back'));
    back.disabled = !!wj;
    onTap(back, () => { if (W.step === 0) tryClose(); else { W.step--; renderWizard(); } });
    foot.append(back, el('span', 'tp-grow'));
    if (s !== 'check') {
      const next = el('button', 'tp-btn pri big'); next.textContent = T(tr('Next')) + ' →';
      next.dataset.role = 'next';
      onTap(next, () => { if (stepOk()) { W.step++; renderWizard(); } });
      foot.appendChild(next);
    } else if (wj && wj.state !== 'done' && wj.state !== 'reverted') {
      // the result box offers "send again" / "put the old values back"
    } else if (!wj) {
      const save = el('button', 'tp-btn pri big'); save.dataset.role = 'save';
      save.textContent = '✓ ' + T(tr('Save'));
      onTap(save, () => doSave());
      foot.appendChild(save);
    } else {
      const done = el('button', 'tp-btn pri big'); done.textContent = T(tr('Done'));
      onTap(done, () => { sel[W.kind] = activeName(W.kind); view = 'pick'; W = null; render(); });
      foot.appendChild(done);
    }
    syncSaveBtn();
  }
  function stepOk() {
    const s = W.steps[W.step];
    if (s === 'header') {
      const m = metricOf(W.cutW);
      if (!(Number.isFinite(m) && m > 0)) { showToast(T(tr('Please enter the cutting width.'))); W.cutW.focus(); return false; }
      const d = metricOf(W.f.hitchLength.inp);
      if (!(Number.isFinite(d) && d > 0)) { showToast(T(tr('Measure the distance from the rear axle to the cutter bar.'))); W.f.hitchLength.inp.focus(); return false; }
      applyHeader();
    }
    if (s === 'name') {
      const p = nameProblem(W.kind, W.nameInp.value.trim());
      W.nameErr.textContent = p;
      if (p) return false;
      W.name = W.nameInp.value.trim();
    }
    return true;
  }
  function pageType(page) {
    const isV = W.kind === 'vehicle';
    page.appendChild(Object.assign(el('div', 'tp-lead'), { textContent: T(isV ? tr('What kind of vehicle?') : tr('How is the tool attached?')) }));
    const g = el('div', 'tp-choice');
    if (isV) {
      for (const [val, ic, label] of VEH_TYPES) {
        const b = el('button', 'tp-ch' + (W.type.cur === val ? ' on' : ''), ICON[ic] + '<span></span>');
        b.querySelector('span').textContent = T(label);
        onTap(b, () => { W.type.cur = val; renderWizard(); });
        g.appendChild(b);
      }
    } else {
      if (W.harvester && W.mode === 'new') {
        const b = el('button', 'tp-ch img' + (W.header ? ' on' : ''), '<img src="/icons/ToolChkFront.png" alt=""><span></span>');
        b.querySelector('span').textContent = T(tr('Header (front)'));
        onTap(b, () => { setHeader(true); renderWizard(); });
        g.appendChild(b);
      }
      for (const [val, , label, img] of TOOL_TYPES) {
        if (W.harvester && val !== 'front') continue; // a harvester takes a front tool only (host, #111)
        const b = el('button', 'tp-ch img' + (W.type.cur === val && !W.header ? ' on' : ''), '<img src="/icons/' + img + '.png" alt=""><span></span>');
        b.querySelector('span').textContent = T(label);
        onTap(b, () => { setHeader(false); W.type.cur = val; renderWizard(); });
        g.appendChild(b);
      }
    }
    page.appendChild(g);
    if (isV && W.type.cur === 1 && W.type.base !== 1)
      page.appendChild(Object.assign(el('div', 'tp-note warn'), { textContent: T(tr('With a harvester the tool is always front fixed (as in the setup dialog).')) }));
    if (!isV && W.harvester) page.appendChild(Object.assign(el('div', 'tp-note'), { textContent: T(tr('The vehicle is a harvester: front fixed only.')) }));
    if (!isV) {
      page.appendChild(Object.assign(el('div', 'tp-lead'), { textContent: T(tr('Symbol on this tablet')) }));
      const sg = el('div', 'tp-syms');
      const nm = () => (W.mode === 'new' ? (W.name || '') : W.src);
      for (const [k, label] of SYMBOLS) {
        const shown = k || toolSymbol(nm(), '');
        const b = el('button', 'tp-sym' + ((W.sym || '') === k ? ' on' : ''), ICON[shown] + '<span></span>');
        b.querySelector('span').textContent = T(label);
        onTap(b, () => { W.sym = k; renderWizard(); });
        sg.appendChild(b);
      }
      page.appendChild(sg);
      page.appendChild(Object.assign(el('div', 'tp-note'), { textContent: T(tr('The symbol is only kept on this device; the profile does not change.')) }));
    }
  }
  function pageName(page) {
    page.appendChild(Object.assign(el('div', 'tp-lead'), { textContent: T(W.kind === 'vehicle' ? tr('Name of the new vehicle') : tr('Name of the new tool')) }));
    const inp = el('input', 'tp-name big'); inp.type = 'text'; inp.maxLength = 60; inp.autocomplete = 'off'; inp.setAttribute('translate', 'no');
    inp.value = W.name;
    W.nameInp = inp;
    W.nameErr = el('div', 'tp-ask-e');
    inp.addEventListener('input', () => { W.name = inp.value.trim(); W.nameTouched = true; W.nameErr.textContent = ''; });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && stepOk()) { W.step++; renderWizard(); } });
    page.append(inp, W.nameErr);
    page.appendChild(Object.assign(el('div', 'tp-note'), { textContent: tr('It starts as a copy of "{name}"; the next steps change the values that differ.', { name: W.src }) }));
    setTimeout(() => inp.focus(), 50);
  }
  function pageFields(page, main, adv, skDefault) {
    const wrap = el('div', 'tp-meas');
    const sk = el('div', 'tp-skbox'); W.skBox = sk; W.skDefault = skDefault;
    const col = el('div', 'tp-fields');
    for (const st of main) col.appendChild(st.row);
    if (adv) {
      const d = el('details', 'tp-adv');
      d.appendChild(Object.assign(el('summary'), { textContent: T(tr('Advanced (rarely needed)')) }));
      for (const st of adv) d.appendChild(st.row);
      col.appendChild(d);
    }
    wrap.append(sk, col);
    page.appendChild(wrap);
    drawSketch();
  }
  function pageSections(page) {
    const wrap = el('div', 'tp-meas');
    const sk = el('div', 'tp-skbox'); W.skBox = sk; W.skDefault = 'sections';
    const col = el('div', 'tp-fields');
    const nRow = fieldRow({ label: tr('Number of sections'), help: tr('How many sections the tool switches.'), sk: 'sections' }, W.nSec.inp);
    W.nSec.inp.removeEventListener('input', syncWidthsEv); W.nSec.inp.addEventListener('input', syncWidthsEv);
    col.appendChild(nRow);
    const box = el('div', 'tp-fld wide');
    box.innerHTML = '<div class="tp-f-l"></div><div class="tp-f-h"></div><div class="tp-sws"></div><div class="tp-same"></div><div class="tp-sum"></div><div class="tp-f-w" hidden></div>';
    box.querySelector('.tp-f-l').textContent = T(tr('Section widths')) + ' (' + unitLabel('cm') + ')';
    box.querySelector('.tp-f-h').textContent = T(tr('Width of each section (S1, S2, …).'));
    if (!W.swBox) { W.swBox = el('div', 'tp-swgrid'); W.swBox.addEventListener('input', () => { onEdit(); drawSketch(); }); }
    box.querySelector('.tp-sws').appendChild(W.swBox);
    // "All the same": copies the typed text into every box (no conversion).
    const same = box.querySelector('.tp-same');
    const sIn = el('input', 'tp-in sm'); sIn.type = 'number'; sIn.inputMode = 'decimal'; sIn.step = '0.1'; sIn.placeholder = unitLabel('cm');
    const sBtn = el('button', 'tp-btn'); sBtn.textContent = T(tr('Same width for all'));
    onTap(sBtn, () => { if (sIn.value === '') return; for (const w of W.widths) { if (!w.wrap.hidden) { w.inp.value = sIn.value; w.edited = true; } } onEdit(); drawSketch(); });
    same.append(sIn, el('span', 'tp-f-u', esc(unitLabel('cm'))), sBtn);
    W.sumEl = box.querySelector('.tp-sum');
    W.sumWarn = box.querySelector('.tp-f-w');
    col.appendChild(box);
    const d = el('details', 'tp-adv');
    d.appendChild(Object.assign(el('summary'), { textContent: T(tr('Advanced (rarely needed)')) }));
    d.appendChild(W.f.defaultSectionWidth.row);
    W.f.defaultSectionWidth.inp.removeEventListener('input', syncWidthsEv); W.f.defaultSectionWidth.inp.addEventListener('input', syncWidthsEv);
    col.appendChild(d);
    wrap.append(sk, col);
    page.appendChild(wrap);
    syncWidths();
    drawSketch();
  }
  function syncWidthsEv() { syncWidths(); drawSketch(); }
  // Header preset (harvester): front fixed, one section as wide as the cut. Asked: the cutting
  // width, and the distance rear axle → cutter bar (empty: to be measured). Same commands as the normal steps: tool.type,
  // tool.numSections, tool.sectionWidth, tool.hitchLength.
  function setHeader(on) {
    W.header = on;
    if (on) {
      W.type.cur = 'front';
      W.steps = ['type', 'header', 'name', 'check'];
      if (!W.cutW) {
        W.cutW = makeNum('tool.cutWidth', 'm', NaN, '0.01');
        W.cutW.addEventListener('input', () => applyHeader());
        // No made-up or copied value: the distance starts empty and has to be measured (an
        // empty box can't be saved). On a harvester the copied tool is always front fixed (host).
        W.f.hitchLength.inp.value = '';
      }
    } else {
      W.steps = W.mode === 'new' ? ['type', 'name', 'sections', 'hitch', 'check'] : ['type', 'sections', 'hitch', 'check'];
    }
  }
  function applyHeader() {
    if (!W.header) return;
    W.nSec.inp.value = '1';
    if (!W.swBox) W.swBox = el('div', 'tp-swgrid');
    syncWidths();
    const m = metricOf(W.cutW);
    const w = W.widths[0];
    if (w) { if (Number.isFinite(m) && m > 0) { writeUnitInput(w.inp, m * 100); w.edited = true; } else { w.inp.value = w.inp.dataset.init; w.edited = false; } }
    if (!W.nameTouched && W.mode === 'new') W.name = T(tr('Header')) + (Number.isFinite(m) && m > 0 ? ' ' + fmtUnit(m, 'm') : '');
  }
  function pageHeader(page) {
    page.appendChild(Object.assign(el('div', 'tp-lead'), { textContent: T(tr('Header of the harvester: how wide does it cut?')) }));
    const f = { label: tr('Cutting width'), unit: 'm', help: tr('Working width of the header, from one end of the cutter bar to the other.'), sk: 'tool:' };
    const wrap = el('div', 'tp-meas');
    const sk = el('div', 'tp-skbox'); W.skBox = sk; W.skDefault = 'tool:hitchLength';
    const col = el('div', 'tp-fields');
    col.appendChild(fieldRow(f, W.cutW));
    const hl = W.f.hitchLength.row; hl.querySelector('.tp-f-h').textContent = T(tr('Middle of the rear axle forwards to the cutter bar, along the vehicle.'));
    hl.querySelector('.tp-f-l').textContent = T(tr('Rear axle to cutter bar'));
    col.appendChild(hl);
    if (W.f.hitchLength.inp.value === '') col.appendChild(Object.assign(el('div', 'tp-note warn'), { textContent: T(tr('Measure the distance from the rear axle to the cutter bar.')) }));
    col.appendChild(Object.assign(el('div', 'tp-note'), { textContent: T(tr('Front fixed, one section as wide as the header. Sections, offset and the rest can be changed later in the tool settings.')) }));
    wrap.append(sk, col); page.appendChild(wrap);
    drawSketch();
    setTimeout(() => W.cutW && W.cutW.focus(), 50);
  }
  // The lengths the host uses per tool type (ToolPositionService.Update, ImplementSweptPath):
  // rigid front/rear: Tool.HitchLength = rear axle → working point; trailing: Vehicle.HitchLength
  // (rear axle → hitch pin, from the vehicle) + Tool.TrailingHitchLength (hitch pin → tool axle);
  // TBT: Vehicle.HitchLength + TankTrailingHitchLength (hitch pin → tank axle) + TrailingHitchLength
  // (tank axle → tool axle). Tool.HitchLength is not used for TBT, so it is not asked for there.
  // Length: from the working point (rigid) or the tool axle (trailing/TBT) to the rear end (front
  // tool: its front end); only the U-turn clearance from a hard boundary uses it.
  const toolTypeNo = () => (TOOL_TYPES.find(x => x[0] === W.type.cur) || TOOL_TYPES[1])[1];
  function hitchFields() {
    const ty = toolTypeNo();
    const trailing = ty === 3, tbt = ty === 2;
    const f = [];
    if (!trailing && !tbt) f.push(W.f.hitchLength);  // rigid front/rear only (the host ignores it for TBT)
    if (tbt) f.push(W.f.tankTrailingHitchLength);
    if (trailing || tbt) f.push(W.f.trailingHitchLength);
    f.push(W.f.length);
    return f;
  }
  const HITCH_HELP = {
    hitchLength: [tr('Middle of the rear axle forwards to the working point of the tool, along the vehicle.'), tr('Middle of the rear axle to the working point of the tool, along the vehicle.')],
    trailingHitchLength: { 2: tr('Axle of the tank to the axle of the tool.'), 3: tr('Hitch pin of the tractor to the axle of the tool.') },
    length: [tr('Working point forwards to the front end of the tool. Only used to keep the tool clear of a hard boundary in U-turns.'),
      tr('Working point to the rear end of the tool. Only used to keep the tool clear of a hard boundary in U-turns.'),
      tr('Axle of the tool to its rear end. Only used to keep the tool clear of a hard boundary in U-turns.'),
      tr('Axle of the tool to its rear end. Only used to keep the tool clear of a hard boundary in U-turns.')],
  };
  function setHitchHelp() {
    const ty = toolTypeNo();
    const set = (st, txt) => { const h = st.row.querySelector('.tp-f-h'); if (h && txt) h.textContent = T(txt); };
    set(W.f.hitchLength, HITCH_HELP.hitchLength[ty === 0 ? 0 : 1]);
    set(W.f.trailingHitchLength, HITCH_HELP.trailingHitchLength[ty]);
    set(W.f.length, HITCH_HELP.length[ty]);
  }
  // Trailing and TBT tools hang on the vehicle's hitch pin: show that length (from the vehicle).
  function vehHitchNote() {
    const v = config && config.vehicle;
    const r = el('div', 'tp-note');
    r.textContent = T(tr('Rear axle to the hitch pin: {len} (vehicle "{name}"; change it in the vehicle).',
      { len: fmtM(v ? v.hitchLength : NaN, 'm'), name: activeName('vehicle') }));
    return r;
  }
  function pageHitch(page) {
    const ty = toolTypeNo();
    setHitchHelp();
    pageFields(page, hitchFields(), [W.f.offset, W.f.overlap], 'tool:');
    if (ty === 2 || ty === 3) page.querySelector('.tp-fields').prepend(vehHitchNote());
    page.appendChild(W.hitch.row);
  }

  // All changes as commands, in the order the setup dialog would need them.
  function changes() {
    const out = []; // { key, send, val (metric or code), label, from, to }
    const num = (st, label) => { if (st.changed()) { const v = st.value(); out.push({ key: st.f.key, send: v, val: v, label: label || st.f.label, unit: st.f.unit, from: st.base }); } };
    if (W.kind === 'vehicle') {
      if (W.type.cur !== W.type.base) out.push({ key: 'vehicle.type', send: W.type.cur, val: W.type.cur, label: tr('Vehicle type'), from: W.type.base, kindOf: 'vtype' });
      if (W.hitch.changed()) out.push({ key: 'vehicle.hitchType', send: W.hitch.value(), val: +W.hitch.value(), label: W.hitch.label, from: W.hitch.base, kindOf: 'hitch' });
      for (const k of ['hitchLength', 'wheelbase', 'trackWidth', 'antennaPivot', 'antennaHeight', 'antennaOffset']) num(W.f[k]);
    } else {
      if (W.type.cur !== W.type.base) out.push({ key: 'tool.type', send: W.type.cur, val: W.type.cur, label: tr('Attach'), from: W.type.base, kindOf: 'ttype' });
      if (W.hitch.changed()) out.push({ key: 'tool.hitchType', send: W.hitch.value(), val: +W.hitch.value(), label: W.hitch.label, from: W.hitch.base, kindOf: 'hitch' });
      const shown = hitchFields();
      for (const k of ['hitchLength', 'trailingHitchLength', 'tankTrailingHitchLength', 'length']) if (shown.includes(W.f[k])) num(W.f[k]);
      num(W.f.offset); num(W.f.overlap); num(W.f.defaultSectionWidth);
      const n = Math.max(1, Math.min(64, Math.round(parseFloat(W.nSec.inp.value)) || 0));
      if (n !== W.nSec.base) out.push({ key: 'tool.numSections', send: n, val: n, label: tr('Number of sections'), from: W.nSec.base, kindOf: 'int' });
      for (let i = 0; i < n; i++) {
        const w = W.widths[i];
        if (!w || w.inp.value === w.inp.dataset.init) continue; // added sections: the host gives them the default width
        const v = metricOf(w.inp);
        out.push({ key: 'tool.sectionWidth', idx: i, send: i + ',' + v, val: v, label: 'S' + (i + 1), unit: 'cm', from: w.exists ? W.baseWidths[i] : NaN });
      }
    }
    return out;
  }
  function problems() {
    const p = [];
    // Units switched (a host setting, from any device): the fields still show the old units
    // but would now be read in the new ones.
    if (isMetric() !== W.metric) p.push(T(tr('The units were changed. Please cancel and start the assistant again.')));
    for (const c of changes()) if (c.kindOf == null && !Number.isFinite(c.val)) p.push(tr('{field}: please enter a number.', { field: T(c.label) }));
    if (W.kind === 'tool') {
      const n = Math.round(parseFloat(W.nSec.inp.value));
      if (!(n >= 1 && n <= 64)) p.push(T(tr('Number of sections: 1 to 64.')));
      // The host stores these as max(0, value): a negative entry would never be confirmed.
      for (const k of ['hitchLength', 'length']) if (W.f[k].value() < 0) p.push(tr('{field}: 0 or more.', { field: T(W.f[k].f.label) }));
    }
    return p;
  }
  function warnings() {
    const w = [];
    if (W.kind === 'vehicle') {
      for (const k of ['wheelbase', 'antennaPivot', 'antennaHeight', 'antennaOffset']) {
        const st = W.f[k], m = warnFor(st.f, st.value());
        if (m) w.push([st.f.label, m]);
      }
      const a = config && config.autosteer ? +config.autosteer.maxSteerAngle : NaN;
      if (Number.isFinite(a) && (a < 20 || a > 60)) w.push([tr('Max Steer Angle'), tr('Unusual value (expected {min} to {max}). Please measure again; it is saved as entered.', { min: '20°', max: '60°' })]);
    } else {
      const s = sumWidthM();
      if (Number.isFinite(s) && (s < 1 || s > 60))
        w.push([tr('Working width'), tr('Unusual value (expected {min} to {max}). Please measure again; it is saved as entered.', { min: fmtUnit(1, 'm'), max: fmtUnit(60, 'm') })]);
    }
    return w;
  }
  // Live: yellow warnings next to the fields, the section sum, the save button.
  function onEdit() {
    if (!W) return;
    const all = W.kind === 'vehicle' ? Object.values(W.f) : [];
    for (const st of all) {
      const box = st.row.querySelector('.tp-f-w'), m = warnFor(st.f, st.value());
      box.hidden = !m; box.textContent = m; st.row.classList.toggle('warn', !!m);
    }
    if (W.kind === 'tool' && W.sumEl && W.sumEl.isConnected) {
      const s = sumWidthM();
      W.sumEl.textContent = tr('Working width (sum of the sections): {w}', { w: fmtM(s, 'm') });
      const m = Number.isFinite(s) && (s < 1 || s > 60) ? warnFor({ warn: [1, 60], unit: 'm' }, s) : '';
      W.sumWarn.hidden = !m; W.sumWarn.textContent = m;
    }
    syncSaveBtn();
  }
  function syncSaveBtn() {
    const b = foot.querySelector('[data-role="save"]');
    if (!b || !W) return;
    const lock = lockReason(), sending = !!wjob();
    b.disabled = !!lock || !!sending || problems().length > 0;
    const li = body.querySelector('.tp-lockline');
    if (li) { li.hidden = !lock; li.textContent = lock ? T(lock) : ''; }
  }
  function fmtChange(c, v) {
    if (c.kindOf === 'vtype') return T((VEH_TYPES.find(x => x[0] === v) || [0, '', '—'])[2]);
    if (c.kindOf === 'ttype') return T((TOOL_TYPES.find(x => x[0] === v) || [0, 0, '—'])[2]);
    if (c.kindOf === 'hitch') { const h = TUI_HITCH.find(x => x.code === +v); return h ? T(h.name) : '—'; }
    if (c.kindOf === 'int') return String(v);
    return fmtM(v, c.unit);
  }
  // A signed value as amount + side ("0,30 m Links"), others with their unit.
  function fmtVal(f, v) {
    if (!f.sides || !Number.isFinite(v)) return fmtM(v, f.unit);
    const sg = v < -0.005 ? -1 : v > 0.005 ? 1 : 0;
    return fmtM(Math.abs(v), f.unit) + ' ' + T(f.sides.find(x => x[1] === sg)[2]);
  }
  function pageCheck(page) {
    const isV = W.kind === 'vehicle';
    const ch = changes(), warn = warnings(), prob = problems();
    const grid = el('div', 'tp-sum2');
    // What the profile will hold (changed rows marked, with the value before).
    const card = el('div', 'tp-sumc');
    card.appendChild(Object.assign(el('h4'), { textContent: W.mode === 'new' ? W.name : W.src }));
    card.querySelector('h4').setAttribute('translate', 'no');
    const row = (label, val, from, changed, warnTxt) => {
      const r = el('div', 'tp-row' + (changed ? ' ch' : '') + (warnTxt ? ' warn' : ''), '<span></span><b translate="no"></b>');
      r.firstChild.textContent = T(label); r.lastChild.textContent = val;
      if (changed && from != null) r.appendChild(Object.assign(el('small', null), { textContent: tr('before: {v}', { v: from }) }));
      card.appendChild(r);
    };
    const chOf = key => ch.find(c => c.key === key);
    if (isV) {
      const c = chOf('vehicle.type');
      row(tr('Vehicle type'), fmtChange({ kindOf: 'vtype' }, W.type.cur), c && fmtChange(c, c.from), !!c);
      for (const k of ['wheelbase', 'trackWidth', 'antennaPivot', 'antennaHeight', 'antennaOffset', 'hitchLength']) {
        const st = W.f[k], c2 = chOf(st.f.key), v = st.value();
        row(st.f.label, fmtVal(st.f, v), c2 && fmtVal(st.f, c2.from), !!c2, warnFor(st.f, v));
      }
      const a = config && config.autosteer ? config.autosteer.maxSteerAngle : null;
      row(tr('Max Steer Angle'), a == null ? '—' : a + '°', null, false, Number.isFinite(+a) && (a < 20 || a > 60) ? 'x' : '');
      card.appendChild(Object.assign(el('div', 'tp-note'), { textContent: T(tr('The max steer angle is set under AutoSteer and is not changed here.')) }));
    } else {
      const c = chOf('tool.type');
      row(tr('Attach'), fmtChange({ kindOf: 'ttype' }, W.type.cur), c && fmtChange(c, c.from), !!c);
      const n = Math.max(1, Math.min(64, Math.round(parseFloat(W.nSec.inp.value)) || 0)), cn = chOf('tool.numSections');
      row(tr('Number of sections'), String(n), cn && String(cn.from), !!cn);
      const s = sumWidthM();
      row(tr('Working width'), fmtM(s, 'm'), null, ch.some(x => x.key === 'tool.sectionWidth') || !!cn, Number.isFinite(s) && (s < 1 || s > 60) ? 'x' : '');
      for (const st of hitchFields().concat([W.f.offset, W.f.overlap])) {
        const c2 = chOf(st.f.key), v = st.value();
        row(st.f.label, fmtVal(st.f, v), c2 && fmtVal(st.f, c2.from), !!c2);
      }
      const sym = toolSymbol(W.mode === 'new' ? W.name : W.src, W.sym || '');
      const sr = el('div', 'tp-row', '<span></span><b class="tp-row-ic"></b>');
      sr.firstChild.textContent = T(tr('Symbol on this tablet')); sr.lastChild.innerHTML = ICON[sym];
      card.appendChild(sr);
    }
    grid.appendChild(card);
    // Right: what happens on Save.
    const info = el('div', 'tp-sumc');
    info.appendChild(Object.assign(el('h4'), { textContent: T(tr('On Save')) }));
    const ul = el('ul', 'tp-list');
    const li = t => ul.appendChild(Object.assign(el('li'), { textContent: t }));
    if (W.mode === 'new') {
      li(tr('A new profile "{name}" is made as a copy of "{src}" and becomes active.', { name: W.name, src: W.src }));
      li(tr('"{src}" stays unchanged.', { src: W.src }));
    }
    li(ch.length ? tr('{n} value(s) are sent and the profile is saved.', { n: ch.length }) : T(W.mode === 'new' ? tr('No values differ from the copy; the copy is saved.') : tr('Nothing was changed.')));
    if (isV && W.type.cur === 1 && W.type.base !== 1) li(T(tr('With a harvester the tool is always front fixed (as in the setup dialog).')));
    info.appendChild(ul);
    for (const [label, m] of warn) {
      const w = el('div', 'tp-note warn', '<b></b> <span></span>');
      w.firstChild.textContent = T(label) + ':'; w.lastChild.textContent = m;
      info.appendChild(w);
    }
    for (const p of prob) info.appendChild(Object.assign(el('div', 'tp-note bad'), { textContent: p }));
    info.appendChild(Object.assign(el('div', 'tp-lock tp-lockline'), { hidden: true }));
    const res = el('div', 'tp-result'); W.resEl = res;
    info.appendChild(res);
    grid.appendChild(info);
    page.appendChild(grid);
  }

  // --- Save: everything in one go, then check what the host reports back ---------------------
  // The commands leave in one burst (one JavaScript task, so the socket takes all or none) and
  // the host runs them in order. Done = the host's config and profile frames show every value
  // and the connection stayed up a moment longer (profile.save is the last command). If the
  // connection drops on the way, this says so and offers to send the same commands again
  // (they set absolute values) or, when editing, to put the old values back.
  // From sending until the host confirms, the save is kept on this device
  // (aow.ui.profilePending), so a red band in the driving view shows an unfinished save, also
  // after a reload, until "send again" or "put the old values back" has been confirmed.
  const PEND_KEY = 'aow.ui.profilePending';
  let pending = null, job = null; // job: { rec, state, t0, okAt, revert, expect, k }
  // Only a record this code could have written: a broken one would send "config.set|key:undefined".
  const recOk = r => !!r && r.v === 1 && (r.kind === 'vehicle' || r.kind === 'tool') && (r.mode === 'new' || r.mode === 'edit')
    && typeof r.name === 'string' && !!r.name && typeof r.src === 'string' && Array.isArray(r.ch)
    && r.ch.every(c => c && typeof c.key === 'string' && c.send !== undefined && c.send !== null);
  try { const r = JSON.parse(lsGet(PEND_KEY, '') || 'null'); if (recOk(r)) pending = r; } catch (_) { /* unreadable: none */ }
  if (pending) job = { rec: pending, state: 'lost', reloaded: true };
  // Point 22: read it back; if the browser keeps nothing (blocked storage), the band says so.
  let pendKept = true;
  function setPending(r) {
    pending = r;
    const v = r ? JSON.stringify(r) : null;
    lsSet(PEND_KEY, v);
    pendKept = !r || lsGet(PEND_KEY, null) === v;
    syncBand();
  }
  const wjob = () => (job && W && W.rec && job.rec === W.rec ? job : null); // this assistant's save

  function makeRec() {
    const t = W.kind === 'tool';
    return { v: 1, kind: W.kind, mode: W.mode, name: W.mode === 'new' ? W.name : W.src, src: W.src, ch: changes(),
      baseToolType: W.baseToolType, nSecBase: t ? W.nSec.base : 0, baseWidths: t ? W.baseWidths.slice(0, 64) : [], t: Date.now() };
  }
  function planCmds(rec, retry) {
    const cmds = [], isV = rec.kind === 'vehicle';
    if (rec.mode === 'new') {
      const exists = listOf(rec.kind).some(p => sameName(p.name, rec.name));
      if (!(retry && exists)) cmds.push('profile.new|' + rec.kind + '\t' + rec.name);        // copy of the active profile
      cmds.push((isV ? 'profile.configureVehicle|' : 'profile.configureTool|') + rec.name); // make the copy active
    }
    for (const c of rec.ch) cmds.push('config.set|' + c.key + ':' + c.send);
    cmds.push('profile.save');
    return cmds;
  }
  // Edit only: the values from before, exactly as the host had sent them.
  function revertList(rec) {
    const ex = [];
    for (const c of rec.ch) {
      if (c.key === 'tool.sectionWidth') { if (c.idx < rec.nSecBase) ex.push({ key: c.key, idx: c.idx, val: rec.baseWidths[c.idx] }); continue; }
      if (c.key === 'tool.numSections') { ex.push({ key: c.key, val: rec.nSecBase }); continue; }
      ex.push({ key: c.key, val: c.from });
    }
    // A harvester forces the tool to front fixed: put the tool's attach back too.
    if (rec.kind === 'vehicle' && rec.ch.some(c => c.key === 'vehicle.type')) {
      const tt = TOOL_TYPES.find(x => x[1] === rec.baseToolType); if (tt) ex.push({ key: 'tool.type', val: tt[0] });
    }
    if (rec.kind === 'tool' && rec.ch.some(c => c.key === 'tool.numSections'))
      for (let i = 0; i < rec.nSecBase; i++) if (!ex.some(e => e.idx === i)) ex.push({ key: 'tool.sectionWidth', idx: i, val: rec.baseWidths[i] });
    return ex;
  }
  function hostVal2(c) {
    if (!config) return undefined;
    if (c.key === 'tool.sectionWidth') return (config.tool.sectionWidths || [])[c.idx];
    if (c.key === 'tool.type') return (TOOL_TYPES.find(x => x[1] === config.tool.type) || [])[0];
    const [sec, f] = c.key.split('.'); return config[sec] && config[sec][f];
  }
  function valueOk(c) {
    const got = hostVal2(c);
    if (c.key === 'tool.type') return got === ((config.vehicle.type | 0) === 1 ? 'front' : c.val); // harvester: front (host, #111)
    return Number.isFinite(+got) && got !== undefined && Math.abs(+got - +c.val) <= 1e-6 * Math.max(1, Math.abs(+c.val));
  }
  function matches(rec, list) {
    if (!config || !profiles || activeName(rec.kind) !== rec.name) return false;
    return list.every(valueOk);
  }
  // The profile the commands must go to is not active: for an edit the profile itself; for a
  // new one not made yet its template, since profile.new copies whatever is active.
  const loadName = rec => rec.mode === 'edit' ? rec.name : rec.src;
  const wrongActive = rec => !!profiles && (rec.mode === 'edit' ? activeName(rec.kind) !== rec.name
    : !listOf(rec.kind).some(p => sameName(p.name, rec.name)) && activeName(rec.kind) !== rec.src);
  function startJob(rec, cmds, isRevert) {
    for (const c of cmds) transport.send(c);
    const tries = job && job.rec === rec ? (job.tries || 0) + 1 : 0; // attempts after the first, for deadEnd
    job = { rec, state: 'sending', t0: performance.now(), okAt: 0, revert: !!isRevert, expect: isRevert ? revertList(rec) : rec.ch, tries };
    setPending(rec); // stays until the host confirms
    refreshJob(true);
  }
  function canAct() { return !!job && connState === 'connected' && !lockReason() && !wrongActive(job.rec); }
  // Dead ends: cases no button here can repair. Only then is "Discard" offered, after a question
  // listing what is lost; otherwise the band stays until the save is confirmed or reverted.
  function deadEnd(j) {
    const rec = j.rec;
    if (!profiles || !config || connState !== 'connected') return '';
    const has = n => listOf(rec.kind).some(p => sameName(p.name, n));
    if (rec.mode === 'edit' && !has(rec.name))
      return tr('The profile "{name}" no longer exists on this guidance computer (deleted or renamed).', { name: rec.name });
    if (rec.mode === 'new' && !has(rec.name) && !has(rec.src))
      return tr('Neither "{name}" nor its template "{src}" exists on this guidance computer.', { name: rec.name, src: rec.src });
    // Not one value is the old or the new one: the note is not about this computer's data
    // (another guidance computer at the same address, or the profile was changed elsewhere).
    if (activeName(rec.kind) === rec.name && rec.ch.length
      && rec.ch.every(c => c.from !== undefined && !valueOk(c) && !valueOk(Object.assign({}, c, { val: c.from }))))
      return tr('None of the values on the guidance computer is the old or the new one. The note probably comes from another guidance computer, or the profile was changed elsewhere.');
    if ((j.tries || 0) >= 2 && j.state !== 'sending' && !matches(rec, rec.ch))
      return tr('The guidance computer did not take the values after two more attempts.');
    return '';
  }
  function askDiscard(rec) {
    const lines = rec.ch.map(c => '• ' + (c.label ? T(c.label) : c.key) + ': ' + (c.from !== undefined ? fmtChange(c, c.from) + ' → ' : '') + fmtChange(c, c.val));
    const text = (rec.mode === 'new' ? tr('The new profile "{name}" is not made complete. These values are not saved:', { name: rec.name })
      : tr('These values for "{name}" are not saved:', { name: rec.name })) + '\n' + (lines.length ? lines.join('\n') : '—') + '\n\n'
      + T(tr('The guidance computer keeps the values it has now. They are not saved there until a profile is loaded or saved.'));
    confirmAsk(T(tr('Discard the unfinished save?')), text, T(tr('Discard')), () => {
      setPending(null); job = null; msg = ''; close(); syncBand();
    }, true);
    const m = ask.querySelector('.tp-ask-m'); if (m) m.style.whiteSpace = 'pre-line';
  }
  function retryJob() { if (canAct()) startJob(job.rec, planCmds(job.rec, true), false); }
  function revertJob() {
    if (!canAct() || job.rec.mode !== 'edit') return;
    const ex = revertList(job.rec);
    startJob(job.rec, ex.map(e => 'config.set|' + e.key + ':' + (e.idx != null ? e.idx + ',' : '') + e.val).concat(['profile.save']), true);
  }
  // Edit, other profile active (e.g. after a reload): load the one the save was for.
  function loadTarget() {
    if (!job || connState !== 'connected' || lockReason()) return;
    const r = job.rec, n = loadName(r);
    transport.send('profile.load|' + (r.kind === 'vehicle' ? n + '\t' + profiles.activeTool : profiles.activeVehicle + '\t' + n));
  }
  function doSave() {
    if (!W || lockReason() || problems().length) return;
    if (pending && !wjob()) { openRecover(); return; } // an unfinished save comes first
    if (W.mode === 'new') {
      const p = nameProblem(W.kind, W.name);
      if (p) { W.step = W.steps.indexOf('name'); renderWizard(); W.nameErr && (W.nameErr.textContent = p); return; }
    }
    // Another device loaded or changed the profile since the assistant opened: the review page
    // no longer shows what would be saved (a new profile copies the active one as it is now).
    if (activeName(W.kind) !== W.src || snapOf(W.kind) !== W.snap) { W.err = 'stale'; renderResult(); return; }
    if (connState !== 'connected') { W.err = 'offline'; renderResult(); return; }
    W.err = '';
    const rec = makeRec();
    W.rec = rec;
    if (W.kind === 'tool') { const nm = rec.name; if ((W.sym || '') !== (W.symBase || '') || W.mode === 'new') lsSet(iconKey(nm), W.sym || null); }
    startJob(rec, planCmds(rec, false), false);
  }
  // Result lines and buttons (assistant's check page and the recovery view).
  function fillResult(r, j) {
    r.innerHTML = '';
    r.className = 'tp-result';
    if (!j) return;
    const rec = j.rec;
    const line = (t, cls) => { r.className = 'tp-result ' + (cls || ''); r.appendChild(Object.assign(el('div'), { textContent: t })); };
    const btn = (t, fn, cls) => { const b = el('button', 'tp-btn' + (cls ? ' ' + cls : '')); b.textContent = t; b.disabled = !canAct(); onTap(b, fn); r.appendChild(b); return b; };
    if (j.state === 'sending') line(T(tr('Saving…')));
    else if (j.state === 'done') line('✓ ' + T(tr('Saved. The guidance computer shows the new values.')), 'ok');
    else if (j.state === 'reverted') line('✓ ' + T(tr('The old values were sent back and saved.')), 'ok');
    else {
      line(j.reloaded ? T(tr('Saving was interrupted (connection lost or page reloaded). It is not certain that everything was saved.'))
        : j.state === 'lost' ? T(tr('The connection broke while saving. It is not certain that everything was saved.'))
        : T(tr('The guidance computer did not confirm all values.')), 'bad');
      if (connState !== 'connected') { line(T(tr('Waiting for the connection…')), 'bad'); return; }
      const dead = deadEnd(j);
      if (dead) {
        line(T(dead), 'bad');
        const b = btn(T(tr('Discard (do not save)')), () => askDiscard(rec), 'dan');
        b.disabled = false; // sends nothing, so no lock applies
        if (!canAct()) return; // nothing else would work
      }
      if (wrongActive(rec)) {
        line(rec.mode === 'edit' ? tr('"{name}" is not active. Load it first, then send again or put the old values back.', { name: rec.name })
          : tr('The new profile is made as a copy of "{name}", which is not active. Load it first, then send again.', { name: rec.src }), 'bad');
        const b = btn(tr('Load "{name}"', { name: loadName(rec) }), loadTarget); b.disabled = !!lockReason();
        return;
      }
      line(matches(rec, rec.ch) ? T(tr('The values are there now. Save again to be sure.')) : T(tr('Some values are missing.')), 'bad');
      btn(T(tr('Send again and save')), retryJob, 'pri');
      if (rec.mode === 'edit') btn(T(tr('Put the old values back')), revertJob);
      else r.appendChild(Object.assign(el('div'), { textContent: tr('"{src}" was not changed.', { src: rec.src }) }));
      const lock = lockReason(); if (lock) line(T(lock), 'bad');
    }
  }
  function renderResult() {
    const r = W && W.resEl;
    if (!r || !r.isConnected) return;
    if (W.err && !wjob()) {
      r.innerHTML = ''; r.className = 'tp-result bad';
      r.appendChild(Object.assign(el('div'), { textContent: W.err === 'offline' ? T(tr('No connection: nothing was sent.'))
        : T(tr('The active profile changed in the meantime. Nothing was sent; please start again.')) }));
      return;
    }
    fillResult(r, wjob());
  }

  // Recovery view: what was being saved, what the host shows now, and the two ways out.
  function openRecover() {
    if (!job) return;
    if (lnCloseAllOrig) lnCloseAllOrig();
    view = 'recover'; W = null; hideAsk();
    sheet.classList.add('open'); scrim.classList.add('open');
    renderRecover();
  }
  function renderRecover() {
    const j = job, rec = j && j.rec;
    hdrT.removeAttribute('translate');
    hdrT.textContent = T(tr('Profile not completely saved'));
    body.innerHTML = ''; foot.innerHTML = '';
    if (!rec) return;
    const lead = el('div', 'tp-lead');
    lead.textContent = rec.kind === 'vehicle' ? tr('Vehicle "{name}": these values were being saved.', { name: rec.name })
      : tr('Tool "{name}": these values were being saved.', { name: rec.name });
    body.appendChild(lead);
    const card = el('div', 'tp-sumc');
    const hd = el('div', 'tp-row hd', '<span></span><b></b><b></b>');
    hd.children[0].textContent = T(tr('Value')); hd.children[1].textContent = T(tr('To save')); hd.children[2].textContent = T(tr('Host now'));
    card.appendChild(hd);
    const list = j.revert || j.state === 'reverted' ? revertList(rec).map(e => Object.assign({}, rec.ch.find(c => c.key === e.key && c.idx === e.idx) || {}, e)) : rec.ch;
    for (const c of list) {
      const ok = connState === 'connected' && activeName(rec.kind) === rec.name && valueOk(c);
      const r = el('div', 'tp-row r3' + (ok ? '' : ' warn'), '<span></span><b translate="no"></b><b translate="no"></b>');
      r.children[0].textContent = c.label ? T(c.label) : c.key;
      r.children[1].textContent = fmtChange(c, c.val);
      const got = hostVal2(c);
      r.children[2].textContent = (got === undefined ? '—' : fmtChange(c, got)) + (ok ? ' ✓' : '');
      card.appendChild(r);
    }
    if (!list.length) card.appendChild(Object.assign(el('div', 'tp-note'), { textContent: T(tr('No values; only the profile itself was being saved.')) }));
    body.appendChild(card);
    const res = el('div', 'tp-result');
    body.appendChild(res);
    fillResult(res, j);
    const done = j.state === 'done' || j.state === 'reverted';
    const cl = el('button', 'tp-btn' + (done ? ' pri big' : '')); cl.textContent = T(done ? tr('Done') : tr('Close'));
    onTap(cl, () => { if (done) job = null; close(); syncBand(); });
    foot.append(el('span', 'tp-grow'), cl);
  }

  // Red band in the driving view (first in the bottom stack, so it sits above the section bar).
  const band = el('button', 'tp-pend', '<span class="tp-pend-t"></span><span class="tp-pend-s"></span>');
  band.id = 'tp-pend';
  band.hidden = true;
  { const bs = $('bottomstack'); if (bs) bs.prepend(band); else document.body.appendChild(band); }
  onTap(band, () => openRecover());
  function syncBand() {
    const show = !!pending && !(job && job.state === 'sending');
    const k = (pending ? pending.mode : '') + (pendKept ? '' : '!');
    if (band.hidden === !show && band.dataset.mode === k) return;
    band.hidden = !show;
    band.dataset.mode = k;
    band.querySelector('.tp-pend-t').textContent = T(tr('Profile not completely saved – check the values'));
    band.querySelector('.tp-pend-s').textContent = T(pending && pending.mode === 'edit' ? tr('Tap: send again or restore') : tr('Tap: send again'))
      + (pendKept ? '' : ' · ' + T(tr('This tablet cannot keep this note over a restart.')));
  }
  syncBand();
  function refreshJob(full) {
    syncBand();
    if (!isOpen()) return;
    if (view === 'recover') renderRecover();
    else if (view === 'wiz' && W && wjob()) { if (full) renderWizard(); else renderResult(); }
  }
  function watchJob() {
    const j = job;
    if (!j) return;
    if (j.state === 'sending') {
      if (connState !== 'connected') { j.state = 'lost'; refreshJob(true); return; }
      if (matches(j.rec, j.expect)) {
        if (!j.okAt) j.okAt = performance.now();
        else if (performance.now() - j.okAt > 1000) { j.state = j.revert ? 'reverted' : 'done'; j.reloaded = false; setPending(null); refreshJob(true); return; }
      } else j.okAt = 0;
      if (performance.now() - j.t0 > 8000) { j.state = 'unconfirmed'; refreshJob(true); }
    } else if (j.state === 'lost' || j.state === 'unconfirmed') {
      const k = [connState, matches(j.rec, j.rec.ch), lockReason(), profiles && activeName(j.rec.kind), JSON.stringify(config && config[j.rec.kind])].join('|');
      if (k !== j.k) { j.k = k; refreshJob(false); }
    }
  }

  // --- Refresh -------------------------------------------------------------------------------
  function render() {
    if (!isOpen()) return;
    if (view === 'pick') { hdrT.removeAttribute('translate'); renderPick(); }
    else if (view === 'recover') renderRecover();
    else if (W) renderWizard();
  }
  let loadWait = null;
  setInterval(() => {
    watchJob();
    if (loadWait && profiles) {
      if (sameName(activeName('vehicle'), loadWait.vehicle) && sameName(activeName('tool'), loadWait.tool)) {
        msg = tr('Loaded: {vehicle} + {tool}', loadWait); loadWait = null;
      } else if (Date.now() - loadWait.t > 8000) { msg = tr('Not loaded: the host did not confirm. Please check and try again.'); loadWait = null; }
    }
    if (!isOpen()) return;
    if (view === 'pick') {
      const k = JSON.stringify([profiles, sel, msg, lockReason(), config && config.tool && config.tool.totalWidth, config && config.vehicle && config.vehicle.type, I18n.language, !!pending]);
      if (k !== pickKey) { pickKey = k; renderPick(); }
    } else if (view === 'wiz') syncSaveBtn();
  }, 250);

  // --- Hooks: the Vehicle & Tool button (left bar, menu tile, hotkey) opens the cards ---------
  const lnOpenOrig = lnOpen, lnCloseAllOrig = lnCloseAll;
  lnOpen = function (id) {
    if (id === 'vehtoolhub') { if (isOpen()) close(); else open(); return; }
    if (isOpen()) close();
    return lnOpenOrig.apply(this, arguments);
  };
  lnCloseAll = function () { if (isOpen()) close(); return lnCloseAllOrig.apply(this, arguments); };

  // --- Menu: the active vehicle and tool on top of the setup tiles ----------------------------
  function nowTiles() {
    const m = $('tui-menu');
    const box = m && m.querySelector('.tui-sh-body');
    if (!box || !profiles) return;
    let band = box.querySelector('.tp-now');
    if (!band) {
      band = el('div', 'tp-now');
      for (const kind of ['vehicle', 'tool']) {
        const t = el('button', 'tui-tile tp-nowt', '<span class="tp-n-ic"></span><span class="tp-n-tx"><span class="l"></span><span class="v" translate="no"></span><span class="s" translate="no"></span></span><span class="tp-n-go"></span>');
        t.dataset.kind = kind;
        onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) tuiPress(x); open(); });
        band.appendChild(t);
      }
      box.prepend(band);
    }
    const lock = lockReason();
    for (const t of band.children) {
      const kind = t.dataset.kind, name = activeName(kind), p = listOf(kind).find(x => x.name === name) || { name, preview: '' };
      const mp = p.preview ? prevMap(p.preview) : activePreview(kind);
      const ic = kind === 'vehicle' ? ICON[(VEH_TYPES.find(v => v[0] === (config && config.vehicle ? config.vehicle.type : 0)) || VEH_TYPES[0])[1]] : ICON[toolSymbol(name)];
      const s = kind === 'vehicle' ? T(tr('Wheelbase')) + ' ' + hostVal(mp['Wheelbase'])
        : T(tr('Working width')) + ' ' + activeWidth() + ' · ' + T(tr('Sections')) + ' ' + hostVal(mp['Sections']);
      const k = [name, s, lock, ic.length].join('|');
      if (t.dataset.k === k) continue;
      t.dataset.k = k;
      t.querySelector('.tp-n-ic').innerHTML = ic;
      t.querySelector('.l').textContent = T(kind === 'vehicle' ? tr('Vehicle') : tr('Tool'));
      t.querySelector('.v').textContent = name || '—';
      t.querySelector('.s').textContent = s;
      // The lock has several reasons now (driving, steering, no data, another device has control).
      t.querySelector('.tp-n-go').textContent = lock ? T(tr('Locked')) : T(tr('Change'));
      t.title = lock ? T(lock) : '';
      t.classList.toggle('locked', !!lock);
    }
  }
  setInterval(() => { const m = $('tui-menu'); if (m && m.classList.contains('open')) nowTiles(); }, 300);

  // --- Setup dialogs (tablet-feedback-1): coupling types with everyday names, the tool lengths
  // drawn point to point, and no "Working center" for TBT (the host takes the vehicle's hitch
  // length there, ToolPositionService.Update). Values and commands stay those of the dialog.
  function relabelHitchSelect(sel) {
    if (!sel) return;
    for (const o of sel.options) {
      const h = TUI_HITCH.find(x => String(x.code) === o.value);
      const norm = HITCH_NORM[(+o.value) + 1];
      if (h) o.textContent = T(h.name) + (norm ? ' (' + norm + ')' : '');
    }
  }
  let dlgFocus = '';
  function toolDialogExtras() {
    const t = config && config.tool;
    if (!t) return;
    relabelHitchSelect(document.querySelector('#toolcfg .cfg-sel[data-key="tool.hitchType"]'));
    // TBT: the host takes the vehicle's hitch length, not Tool.HitchLength ("Working center").
    if (t.type === 2) for (const n of document.querySelectorAll('#toolcfg [data-show="rigid"]')) n.hidden = true;
    const img = document.getElementById('tc-img-hitch');
    if (!img) return;
    let box = document.getElementById('tui-tc-sk');
    if (!box) {
      box = el('div', 'tp-skbox'); box.id = 'tui-tc-sk';
      img.after(box); img.hidden = true;
      for (const k of ['hitchLength', 'trailingHitchLength', 'tankTrailingHitchLength', 'length']) {
        const inp = document.querySelector('#toolcfg .cfg-num[data-key="tool.' + k + '"]');
        if (inp) { inp.addEventListener('focus', () => { dlgFocus = k; toolDialogExtras(); }); inp.addEventListener('blur', () => { dlgFocus = ''; toolDialogExtras(); }); }
      }
    }
    const k = t.type + '|' + dlgFocus + '|' + (config.vehicle ? config.vehicle.hitchLength : '') + '|' + I18n.language;
    if (box.dataset.k !== k) { box.dataset.k = k; box.innerHTML = tuiToolSketch(t.type, dlgFocus, config.vehicle); }
  }
  // Pivot distance (Tool.TrailingToolToPivotLength) as the host uses it: the working line sits
  // at hitch − (TrailingHitchLength − value) (ToolPositionService.cs:223), so a POSITIVE value puts
  // it AHEAD of the tool axle, towards the tractor. The dialog's buttons send behind = +, ahead = −
  // (RemoteServerWiring.Helpers "tool.pivotSide"), i.e. their labels were the wrong way round. The
  // labels and the picture follow the host here; see docs/Host-Aenderungen.md (undo after a fix upstream).
  function pivotDialogExtras(t) {
    const body = document.getElementById('tcs-pivot');
    if (!body) return;
    const bB = body.querySelector('.cfg-act[data-val="behind"]'), bA = body.querySelector('.cfg-act[data-val="ahead"]');
    if (bB && bA) {
      if (!body.dataset.tuiPivot) { // order: behind | zero | ahead, by what each button really does
        body.dataset.tuiPivot = '1';
        const z0 = body.querySelector('.cfg-act[data-val="zero"]');
        bB.parentNode.insertBefore(bA, bB.parentNode.firstChild);
        if (z0) bB.parentNode.insertBefore(z0, bB);
      }
      bB.textContent = T(tr('Ahead of the axle')); bA.textContent = T(tr('Behind the axle'));
      const v = +t.trailingToolToPivotLength || 0;
      bB.classList.toggle('active', v > 0.0005); bA.classList.toggle('active', v < -0.0005);
      const z = body.querySelector('.cfg-act[data-val="zero"]'); if (z) z.classList.toggle('active', Math.abs(v) <= 0.0005);
    }
    const img = body.querySelector('img.vc-diag');
    let box = document.getElementById('tui-tc-pivot');
    if (img && !box) {
      box = el('div', 'tp-skbox'); box.id = 'tui-tc-pivot'; img.after(box); img.hidden = true;
      const note = el('div', 'tp-note'); note.id = 'tui-tc-pivot-n'; box.after(note);
      const wrap = el('div', 'tui-tc-pivot-w'); box.before(wrap); wrap.append(box, note);
    }
    if (!box) return;
    const v = +t.trailingToolToPivotLength || 0;
    const k = v.toFixed(3) + '|' + I18n.language;
    if (box.dataset.k === k) return;
    box.dataset.k = k;
    // Side view, tractor to the right: tool axle (pivot) and the working line.
    const ax = 300, wx = v > 0.0005 ? 400 : v < -0.0005 ? 200 : 300;
    let g = '<line class="sk-g" x1="20" y1="230" x2="580" y2="230"/><g class="sk-b"><rect x="150" y="110" width="300" height="70" rx="8"/><path d="M450 150h110"/><circle cx="566" cy="150" r="6"/>' +
      '<circle cx="' + ax + '" cy="204" r="26"/><circle cx="' + ax + '" cy="204" r="4"/></g>' +
      '<path class="sk-wp" d="M' + wx + ' 230l-9 -16h18z"/><text class="sk-dl sk-small" x="560" y="130" text-anchor="end">' + esc(T(tr('Tractor'))) + ' →</text>';
    if (wx !== ax) g += '<g class="sk-on">' + dash(ax, 170, ax, 262) + dash(wx, 170, wx, 262) + dim(Math.min(ax, wx), 252, Math.max(ax, wx), 252, '', 0, 0) + '</g>';
    g += '<text class="sk-dl sk-small" x="' + wx + '" y="100" text-anchor="middle">' + esc(T(tr('Working line'))) + '</text>';
    box.innerHTML = '<svg class="tp-sk" viewBox="0 0 600 280">' + g + '</svg>';
    document.getElementById('tui-tc-pivot-n').textContent = T(Math.abs(v) <= 0.0005 ? tr('Working line on the tool axle.')
      : v > 0 ? tr('Working line {d} ahead of the tool axle (towards the tractor).', { d: fmtUnit(v, 'm', 2) })
        : tr('Working line {d} behind the tool axle.', { d: fmtUnit(-v, 'm', 2) }));
  }
  populateToolCfg = (orig => function (force) { orig(force); toolDialogExtras(); if (config && config.tool) pivotDialogExtras(config.tool); })(populateToolCfg);

  // Point 15: Network IO fills empty subnet boxes with 192.168.5 (upstream). Without modules
  // found, that default would go out as the new subnet of every module after one confirm; it is
  // only sent once the operator has typed the subnet in.
  {
    const btn = document.getElementById('nio-subnet');
    const boxes = ['nio-o1', 'nio-o2', 'nio-o3'].map(id => document.getElementById(id)).filter(Boolean);
    let typed = false;
    for (const b of boxes) b.addEventListener('input', () => { typed = true; });
    // On the parent, capture phase: runs before the button's own (upstream) listener.
    if (btn) btn.parentNode.addEventListener('pointerdown', e => {
      if (!e.target.closest('#nio-subnet') || typed || (statusBar && statusBar.moduleSubnet)) return;
      e.stopImmediatePropagation(); e.preventDefault();
      showToast(T(tr('No modules found: please type in the subnet first (192.168.5 is only filled in as an example).')), 6000);
    }, true);
  }
  populateVehicleCfg = (orig => function (force) { orig(force); relabelHitchSelect(document.querySelector('#vehiclecfg .cfg-sel[data-key="vehicle.hitchType"]')); })(populateVehicleCfg);

  return { open, get view() { return view; } };
})();

// ===== Tablet UI (Phase 2c): known host texts in German ==============================
// The host sends the fix quality and the NTRIP state as fixed English texts. Known ones are
// translated for display; addresses and caster replies inside them stay as they are, and
// anything unknown stays English. Exact texts are keys (the page translates them itself);
// texts with a variable part are rewritten on the elements that show them.
const TabletHostText = (() => {
  [tr('No Fix'), tr('GPS Fix'), tr('DGPS Fix'), tr('RTK Fixed'), tr('RTK Float'), tr('Connected'), tr('Caster sent an invalid reply'),
   tr('Success: Connected to caster and mount point')];
  const FIX = /\b(No Fix|GPS Fix|DGPS Fix|RTK Fixed|RTK Float)\b/g;
  const PAT = [
    [/^Connecting to (.+)…$/s, x => tr('Connecting to {x}…', { x })],
    [/^Connected to (.+)$/s, x => tr('Connected to {x}', { x })],
    [/^Connection failed: (.+)$/s, x => tr('Connection failed: {x}', { x })],
    [/^Rejected: (.+)$/s, x => tr('Rejected: {x}', { x })],
    [/^Error: (.+)$/s, x => tr('Error: {x}', { x })],
    [/^(.+) — reconnecting…$/s, x => tr('{x} — reconnecting…', { x })],
  ];
  // Point 11: the host's fixed failure texts (MainViewModel ReportFailure → toast). Texts with a
  // value inside (file names, counts, error messages) stay English.
  const TOASTS = new Set([
    tr('A and B must be at least 1 m apart'),
    tr('AutoSteer is off while the steer wizard is open'),
    tr('AutoSteer not available - no active track'),
    tr('AutoSteer off: no GPS/guidance update for over 1 s'),
    tr('Boundary not saved - need at least 3 points'),
    tr('Cannot flip U-turn direction while executing'),
    tr('Cannot save boundary - no field is open'),
    tr('Cannot smooth AB lines (only 2 points)'),
    tr('Cannot start playback (need at least 5 points)'),
    tr('Close the field before deleting it'),
    tr('Close the job before deleting it'),
    tr('Guidance stopped - contour off'),
    tr('Guidance stopped: track changed'),
    tr('ISO-XML file contains no field (PFD)'),
    tr('ISO-XML file has no coordinates to import'),
    tr('ISO-XML file has no usable boundary'),
    tr('Invalid heading'),
    tr('Invalid latitude (must be -90 to 90)'),
    tr('Invalid longitude (must be -180 to 180)'),
    tr('Invalid point selection'),
    tr('Load a field with a boundary first'),
    tr('Module check error'),
    tr('Need at least 2 tracks to build a boundary'),
    tr('Network error'),
    tr('No GPS fix — Drive In needs current position'),
    tr('No GPS position - cannot create A+ line'),
    tr('No GPS position - cannot place flag'),
    tr('No boundary available'),
    tr('No boundary for headland'),
    tr('No boundary polygons found in KML'),
    tr('No clip line defined'),
    tr('No field open'),
    tr('No field open or no KML polygons parsed'),
    tr('No fields directory found'),
    tr('No fields within 0.5 km'),
    tr('No flags to delete'),
    tr('No headland defined'),
    tr('No headland to adjust - build one first'),
    tr('No headland to clip - use Build first'),
    tr('No other fields with tracks found'),
    tr('No previous field to resume'),
    tr('No track selected'),
    tr('No track selected for U-turn'),
    tr('No tracks found in selected field'),
    tr('No tracks to cycle'),
    tr('No tracks to delete'),
    tr('No valid boundary'),
    tr('No valid boundary to create headland from'),
    tr('No visible tracks'),
    tr('Not enough points in segment'),
    tr('Nothing to undo'),
    tr('Open a field first'),
    tr('Open a field first before importing a boundary'),
    tr('Open a field first before importing tracks'),
    tr('Open a field first before recording a boundary'),
    tr('Open a field first to add boundary'),
    tr('Press Drive In again'),
    tr('Select 2 points on the boundary first'),
    tr('Select a boundary first'),
    tr('Select a boundary to delete'),
    tr('Steer module stopped steering (kickout, switch or button)'),
    tr('This track has no ends to adjust'),
    tr('Too few points to smooth (need at least 5)')]);
  showToast = (orig => function (msg, ms) { return orig(typeof msg === 'string' && tuiIsDe() && TOASTS.has(msg) ? I18n.text(msg) : msg, ms); })(showToast);
  function de(s) {
    if (!tuiIsDe()) return s;
    for (const [re, f] of PAT) { const m = s.match(re); if (m) return f(m[1]); }
    return s.replace(FIX, k => I18n.text(k));
  }
  function fix(node) {
    const v = node.nodeValue;
    if (!v || !/[A-Za-z]{3}/.test(v)) return;
    const out = de(v);
    if (out !== v) node.nodeValue = out;
  }
  const obs = new MutationObserver(recs => {
    for (const r of recs) {
      if (r.type === 'characterData') fix(r.target);
      else for (const n of r.addedNodes) {
        if (n.nodeType === Node.TEXT_NODE) fix(n);
        else if (n.nodeType === Node.ELEMENT_NODE) { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); for (let t = w.nextNode(); t; t = w.nextNode()) fix(t); }
      }
    }
  });
  // Where the host's texts are shown: status bar, GPS popup, Network IO, System Data, NTRIP test.
  const IDS = ['sb-fix', 'sb-gps-d', 'gc-fix', 'nio-ntrip-status', 'nio-ntrip-rx', 'sd-fix', 'nte-teststatus'];
  for (const id of IDS) { const e = document.getElementById(id); if (e) obs.observe(e, { subtree: true, childList: true, characterData: true }); }
  return { de };
})();

// ===== Tablet UI (Phase 4a): product look, help, support diagnosis ====================
// BRAND is the one place for the product name, colours, logo and links of the web app (the
// Android launcher name and icon live in the Android project, see docs/Host-Aenderungen.md).
// Look only: switched per device under Setup → Info (aow.ui.brand = on | off, default on);
// off = the AgOpenWeb look. Warning, stop and steer-direction colours never change.
const BRAND = {
  name: 'LM Steering Solutions',
  claim: tr('GPS steering aid for tractor and tool'),
  // Colour world B "Pflaume": accent per theme, [colour, text on it, r,g,b]
  night: ['#c995e0', '#1d0b26', '201,149,224'],
  day: ['#6b2d87', '#ffffff', '107,45,135'],
  sun: ['#4a1660', '#ffffff', '74,22,96'],
  source: 'https://github.com/MoritzLoibl10/AgOpenWeb',
  upstream: 'https://github.com/AgOpenGPS-Official/AgOpenWeb',
  agopengps: 'https://github.com/AgOpenGPS-Official/AgOpenGPS',
};
// The logo: tracks running to the horizon, the guidance line and the own position.
function brandLogo(size, bg, fg) {
  return '<svg class="tb-logo" viewBox="0 0 96 96" width="' + size + '" height="' + size + '" aria-hidden="true"><rect x="4" y="4" width="88" height="88" rx="22" fill="' + bg + '"/>' +
    '<g fill="none" stroke="' + fg + '" stroke-width="5" stroke-linecap="round" opacity=".55"><path d="M20 76 C30 52 34 38 36 20"/><path d="M36 78 C42 54 46 38 48 20"/><path d="M64 78 C58 54 54 38 52 20"/><path d="M80 76 C70 52 66 38 64 20"/></g>' +
    '<path d="M50 18 V62" stroke="' + fg + '" stroke-width="7" stroke-linecap="round"/><circle cx="50" cy="70" r="9" fill="' + fg + '"/></svg>';
}
const TabletBrand = (() => {
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const lsGet = (k, d) => { try { const v = window.localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch (_) { /* private / blocked */ } };
  const T = k => I18n.text(k);
  const KEY = 'aow.ui.brand';
  const on = () => lsGet(KEY, 'on') !== 'off';

  // --- Look: accent colours, title, web-app manifest ---------------------------------------
  const style = el('style'); style.id = 'tb-style';
  style.textContent =
    ':root[data-tb]{--tui-acc:' + BRAND.night[0] + ';--tui-acc-ink:' + BRAND.night[1] + ';--tui-acc-soft:rgba(' + BRAND.night[2] + ',0.18);--sel:rgba(' + BRAND.night[2] + ',0.35)}' +
    ':root[data-tb][data-theme="day"]{--tui-acc:' + BRAND.day[0] + ';--tui-acc-ink:' + BRAND.day[1] + ';--tui-acc-soft:rgba(' + BRAND.day[2] + ',0.14);--sel:rgba(' + BRAND.day[2] + ',0.22)}' +
    ':root[data-tb][data-theme="day"][data-tui-sun]{--tui-acc:' + BRAND.sun[0] + ';--tui-acc-ink:' + BRAND.sun[1] + ';--tui-acc-soft:rgba(' + BRAND.sun[2] + ',0.14)}';
  document.head.appendChild(style);
  const mf = document.querySelector('link[rel="manifest"]');
  const mfOrig = mf ? mf.getAttribute('href') : null, titleOrig = document.title;
  function manifest() {
    const o = location.origin;
    return 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify({
      name: BRAND.name, short_name: BRAND.name, start_url: o + '/', scope: o + '/',
      display: 'fullscreen', display_override: ['fullscreen', 'standalone'], orientation: 'landscape',
      background_color: '#0f1115', theme_color: BRAND.day[0],
      icons: [{ src: o + '/icons/brand-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: o + '/icons/brand-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: o + '/icons/brand-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
    }));
  }
  function apply() {
    const b = on();
    if (b) root.setAttribute('data-tb', ''); else root.removeAttribute('data-tb');
    document.title = b ? BRAND.name : titleOrig;
    if (mf) mf.setAttribute('href', b ? manifest() : mfOrig);
  }
  apply();

  // --- Setup → Info: name, version, origin, licence, source --------------------------------
  const LIC = { apache: ['tui-lic-apache', 'Apache License 2.0'], // LICENSE.md, embedded in index.html
    third: ['tui-lic-third', tr('Third-party components')] }; // fork: index.html, block third-party:begin/end (English, -de German)
  const sheet = el('div', 'tui-sheet tb-sheet', '<div class="tui-sh-hdr"><span class="t"></span><button class="x">✕</button></div><div class="tui-sh-body"></div>');
  sheet.id = 'tb-sheet';
  const scrim = el('div', 'tp-scrim');
  document.body.append(scrim, sheet);
  for (const n of [sheet, scrim]) n.addEventListener('pointerdown', e => e.stopPropagation());
  const shT = sheet.querySelector('.t'), shB = sheet.querySelector('.tui-sh-body');
  const closeSheet = () => { sheet.classList.remove('open'); scrim.classList.remove('open'); };
  onTap(sheet.querySelector('.x'), closeSheet);
  onTap(scrim, closeSheet);
  function openSheet(title, fill) {
    if (typeof lnCloseAll === 'function') lnCloseAll();
    shT.textContent = title; shB.innerHTML = ''; shB.scrollTop = 0;
    fill(shB);
    sheet.classList.add('open'); scrim.classList.add('open');
  }
  function showLicense(k) {
    const [id, name] = LIC[k], src = (k === 'third' && tuiIsDe() && $(id + '-de')) || $(id); // third-party page: German headings and notes, licence texts as is
    openSheet(T(name), b => {
      const back = el('button', 'tp-btn'); back.textContent = '← Info'; onTap(back, () => openInfo());
      b.appendChild(back);
      const pre = el('pre', 'tb-lic'); pre.setAttribute('translate', 'no');
      pre.textContent = src ? src.textContent.trim() : '—';
      b.appendChild(pre);
    });
  }
  const link = (label, url) => { const a = el('button', 'tp-btn quiet tb-link'); a.innerHTML = '<span></span><small translate="no"></small>';
    a.firstChild.textContent = label; a.lastChild.textContent = url.replace(/^https:\/\//, ''); onTap(a, () => openExternal(url)); return a; };
  function renderInfo() {
    const ab = $('about');
    if (!ab) return;
    for (const e of ab.querySelectorAll('.ab-title, .ab-desc')) e.hidden = true;
    let box = ab.querySelector('.tb-info');
    if (!box) { box = el('div', 'tb-info'); ab.appendChild(box); }
    box.innerHTML = '';
    const b = on();
    const head = el('div', 'tb-head', (b ? brandLogo(84, 'var(--tui-acc)', 'var(--tui-acc-ink)') : '') + '<div><div class="tb-name" translate="no"></div><div class="tb-claim"></div></div>');
    head.querySelector('.tb-name').textContent = b ? BRAND.name : 'AgOpenWeb';
    head.querySelector('.tb-claim').textContent = T(BRAND.claim);
    box.appendChild(head);
    const ori = el('div', 'tb-box');
    // Apache 2.0 (as upstream, LICENSE.md): the licence, that this is a changed version, the
    // copyright of AgOpenWeb and of the changes, and the no-warranty clause (§4, §7).
    ori.appendChild(Object.assign(el('div'), { textContent: T(tr('Changed version (fork) of AgOpenWeb, based on AgOpenWeb; changed since October 2026. AgOpenWeb builds on AgOpenGPS (Brian Tee and contributors).')) }));
    ori.appendChild(Object.assign(el('div'), { textContent: T(tr('Licensed under the Apache License 2.0. You may use, change and pass it on; the source code is open.')) }));
    ori.appendChild(Object.assign(el('div'), { textContent: T(tr('Copyright © 2024–2026 AgOpenWeb contributors. Changes in this version: Copyright © 2026 Moritz Loibl.')) }));
    ori.appendChild(Object.assign(el('div'), { textContent: T(tr('Provided “as is”, without warranties or conditions of any kind (see the licence text).')) }));
    const lr = el('div', 'tb-row');
    const ba = el('button', 'tp-btn'); ba.textContent = T(tr('Licence text (Apache 2.0)')); onTap(ba, () => showLicense('apache'));
    const b3 = el('button', 'tp-btn'); b3.textContent = T(tr('Third-party components')); onTap(b3, () => showLicense('third'));
    lr.append(ba, b3); ori.appendChild(lr);
    box.appendChild(ori);
    const src = el('div', 'tb-box');
    src.appendChild(Object.assign(el('div', 'tb-lbl'), { textContent: T(tr('Source code of this version')) }));
    const hash = appInfo && /^[0-9a-f]{7,40}$/.test(appInfo.gitHash || '') ? appInfo.gitHash : '';
    src.appendChild(link(T(tr('This version (fork)')), hash ? BRAND.source + '/tree/' + hash : BRAND.source));
    src.appendChild(link('AgOpenWeb', BRAND.upstream));
    src.appendChild(link('AgOpenGPS', BRAND.agopengps));
    box.appendChild(src);
    try { box.appendChild(TabletUpdate.box()); } catch (_) { /* not loaded yet */ } // fork: update check
    const sw = el('div', 'tb-box');
    sw.appendChild(Object.assign(el('div', 'tb-lbl'), { textContent: T(tr('Look')) }));
    const seg = el('div', 'tp-seg');
    for (const [v, label] of [['on', BRAND.name], ['off', 'AgOpenWeb']]) {
      const s = el('button', 'tp-segb' + ((v === 'on') === b ? ' on' : '')); s.textContent = label; s.setAttribute('translate', 'no');
      onTap(s, () => { lsSet(KEY, v); apply(); renderInfo(); });
      seg.appendChild(s);
    }
    sw.appendChild(seg);
    sw.appendChild(Object.assign(el('div', 'tp-note'), { textContent: T(tr('Only the look on this device changes.')) }));
    box.appendChild(sw);
  }
  renderAbout = (orig => function () { const r = orig.apply(this, arguments); renderInfo(); return r; })(renderAbout);
  const abTitle = $('about') && $('about').querySelector('.ln-hdr-title');
  if (abTitle) abTitle.textContent = 'Info';
  function openInfo() {
    closeSheet();
    if (typeof TabletTerminal !== 'undefined' && TabletTerminal.layout === 'terminal') TabletTerminal.setMode('setup');
    lnOpen('about', 'ln-filemenu', renderAbout);
  }

  // --- Help: short illustrated pages, offline -----------------------------------------------
  const sv = body => '<svg class="tb-ill" viewBox="0 0 320 170" aria-hidden="true">' + body + '</svg>';
  const box = (x, y, w, h, txt, cls) => '<rect class="' + (cls || 'hb') + '" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="8"/>' +
    (txt ? '<text class="ht" x="' + (x + w / 2) + '" y="' + (y + h / 2 + 5) + '" text-anchor="middle">' + esc(T(txt)) + '</text>' : '');
  const ILL = {
    vehicle: () => sv(box(10, 14, 300, 28, tr('Menu'), 'hb acc') + box(10, 52, 145, 56, tr('Vehicle')) + box(165, 52, 145, 56, tr('Tool')) + box(190, 124, 120, 34, tr('Load'), 'hb acc')),
    track: () => sv('<path class="hl" d="M40 160 L160 10"/><circle class="hp" cx="70" cy="122" r="9"/><circle class="hp" cx="136" cy="40" r="9"/>' +
      '<text class="ht" x="52" y="150">A</text><text class="ht" x="148" y="34">B</text>' + box(200, 60, 110, 36, tr('AB Line'), 'hb acc')),
    steer: () => sv(box(200, 20, 110, 130, '', 'hb') + box(212, 100, 86, 40, tr('Steer'), 'hb acc') + '<path class="hl" d="M90 160 L90 10"/>' +
      '<rect class="hb acc" x="20" y="8" width="150" height="30" rx="8"/><text class="ht inv" x="95" y="28" text-anchor="middle">' + esc(T(tr('Steering ON'))) + '</text>'),
    headland: () => sv('<rect class="hb" x="20" y="10" width="280" height="150" rx="6"/><rect class="hhl" x="50" y="34" width="220" height="102" rx="4"/>' +
      '<path class="hl" d="M160 150 L160 34"/><text class="ht" x="160" y="26" text-anchor="middle">' + esc(T(tr('Headland'))) + '</text>'),
    rtk: () => sv(box(10, 20, 96, 40, 'RTK Fix', 'hb f1') + box(112, 20, 96, 40, 'RTK Float', 'hb f2') + box(214, 20, 96, 40, 'DGPS', 'hb f3') +
      '<text class="ht" x="58" y="84" text-anchor="middle">———</text><text class="ht" x="160" y="84" text-anchor="middle">- - -</text><text class="ht" x="262" y="84" text-anchor="middle">· · ·</text>' + box(10, 106, 300, 40, tr('Network & GPS'))),
    band: () => sv('<rect class="hband" x="20" y="60" width="280" height="50" rx="10"/><text class="ht inv" x="160" y="90" text-anchor="middle">' + esc(T(tr('Profile not completely saved'))) + '</text>'),
    actnow: () => sv(box(40, 50, 110, 60, tr('Steer'), 'hb acc') + box(170, 50, 110, 60, tr('Auto'), 'hb acc')),
    demo: () => sv('<rect class="hband" x="20" y="60" width="280" height="50" rx="10"/><text class="ht inv" x="160" y="90" text-anchor="middle">' + esc(T(tr('DEMO – simulator only, no real outputs'))) + '</text>'),
    board: () => sv(box(60, 30, 200, 110, 'AiO v4') + box(84, 100, 70, 26, 'v4', 'hb acc') + box(166, 100, 70, 26, 'v26', 'hb f3')),
    direction: () => sv('<path class="hl" d="M160 150 L160 20"/><path class="hl" d="M146 40 L160 20 L174 40"/>' +
      box(110, 70, 100, 60, tr('Vehicle'), 'hb acc') + box(10, 14, 92, 34, tr('REVERSE'), 'hb f2') + box(218, 14, 92, 34, tr('Tap'), 'hb')),
    usb: () => sv(box(10, 40, 110, 90, tr('Tablet')) + '<path class="hl" d="M120 85 H200"/>' + box(200, 40, 110, 90, 'PC') + '<text class="ht" x="160" y="76" text-anchor="middle">USB</text>'),
  };
  const PAGES = [
    { id: 'vehicle', t: tr('Choose vehicle and tool'), steps: [
      tr('Open the menu {menu}. At the top you see the active vehicle and tool.'),
      tr('Tap one of them: the cards show all vehicles and tools.'),
      tr('Tap a card, then "Load". This only works standing, with steering off.'),
      tr('New vehicle or tool: "New" starts the assistant. Measure each value; the sketch shows where.'),
      tr('A yellow note means an unusual value. Check it; it is saved as entered.')] },
    { id: 'track', t: tr('Create a track'), steps: [
      tr('Open a field first: Menu → Fields and Jobs.'),
      tr('Tap {abline} "AB Line" in the bottom bar, then {quickab} "Quick AB Line".'),
      tr('"A+": a straight line through your position in the direction you drive.'),
      tr('"Drive AB": drive to the start, set A; drive to the end, set B.'),
      tr('{snapleft} "Track left" / {snapright} "Track right" move the line by one working width.'),
      tr('{next} "Next track" (right) switches to the next track. It switches steering and auto U-turn off; switch steering on again yourself.')] },
    { id: 'steer', t: tr('Steering on and off'), steps: [
      tr('Steering needs a track and, as set by default, an RTK fix.'),
      tr('Before the first steering: check the heading in setup mode (card "Heading check"). Driving, GPS and IMU heading should agree.'),
      tr('After every start, drive forward first or confirm the direction on the card ("Does the vehicle face the way it drives?").'),
      tr('Tap {steer} "Steer" (bottom right). The status bar shows "Steering ON".'),
      tr('Tap "Steer" again to switch it off. Turning the steering wheel by hand can switch it off too, if this is set up.'),
      tr('"Not steering" in red: steering is on, but the motor does not steer. Steer by hand and check the steering module.'),
      tr('Stay at the wheel. Steering is an aid; you remain responsible.')] },
    { id: 'headland', t: tr('Headland'), steps: [
      tr('The headland is set up per field: Field Tools → Field Builder → Headland.'),
      tr('{headland} "Headland" in the bottom bar switches it on and off.'),
      tr('"Headland 12.0 m" is the distance to the headland line ahead. It turns red inside the headland.'),
      tr('{secheadland} "Sec. in headl." switches the sections off in the headland.')] },
    { id: 'rtk', t: tr('Understand NTRIP and RTK'), steps: [
      tr('The box at the top shows the fix: solid frame = RTK Fix (steering ready), dashed = RTK Float, dotted = DGPS/GPS.'),
      tr('"Age" is the age of the correction in seconds. Above about 5 s the correction is old.'),
      tr('Corrections come from NTRIP over the internet. The state is under Setup → Network & GPS.'),
      tr('"Rejected: …": user, password or mount point is wrong. "Connection failed": no internet or wrong address.'),
      tr('Network RTK (VRS) needs your position; it is sent automatically once the receiver has a fix.')] },
    { id: 'band', t: tr('Red band: profile not completely saved'), steps: [
      tr('The connection broke while a profile was being saved. Not all values may have arrived.'),
      tr('Tap the band. You see which values were meant to be saved and what is there now.'),
      tr('"Send again and save" sends the same values again. When editing, "Put the old values back" restores the previous ones.'),
      tr('The band only goes away when one of the two has been confirmed. Do not drive with steering until then.')] },
    { id: 'direction', t: tr('Vehicle faces the wrong way'), steps: [
      tr('With one antenna, the direction the vehicle faces is learned from its first travel above 1.5 km/h.'),
      tr('If that first travel is backwards, it is learned the wrong way round: reversing shows as forward, and forward shows "REVERSE".'),
      tr('Then the steering would be computed for the wrong direction, and the auto sections stay off driving forward. Do not engage steering.'),
      tr('Stop, tap the vehicle on the map ("Reset direction"), then drive forward above 1.5 km/h.'),
      tr('So after switching on, drive forward first if you can. With two antennas (Dual GPS) this does not happen.'),
      tr('On the test bench, Menu → Bench checklist → "Reverse start" reproduces this case on purpose.')] },
    { id: 'actnow', t: tr('Buttons that act at once'), steps: [
      tr('Steer: switches automatic steering on or off. It needs a track and, as set by default, an RTK fix. Stay at the wheel; steering is an aid.'),
      tr('Auto U-turn: switches automatic U-turns at the headland on or off.'),
      tr('Sections automatic: the sections switch on and off by themselves, by the worked area and the boundary.'),
      tr('Sections manual: switches the sections on by hand; they stay on until you switch them off.'),
      tr("ISOBUS: switches the implement's own section control on or off."),
      tr('Contour: guidance along the path you drove before, instead of along a track.'),
      tr('Contour lock: keeps the contour you follow, so the guidance does not jump to another path.'),
      tr('Next track: switches to the next track. Steering and auto U-turn are switched off; switch steering on again yourself.'),
      tr('Previous track: switches to the previous track.'),
      tr('Auto track: picks the closest track by itself.'),
      tr('Section control in the headland on or off.'),
      tr('Headland on or off. The headland distance and the hydraulic lift follow it.'),
      tr('Demo mode: the simulator with a "DEMO" band, only without the kit connected.')] },
    { id: 'demo', t: tr('Demo mode'), steps: [
      tr('Demo only without the kit connected.'),
      tr('Menu → "Demo mode" starts the simulator; a striped "DEMO" band shows it runs.'),
      tr('If a module is detected, the demo ends: then check steering and sections yourself.'),
      tr('"End demo" on the band or in the menu stops it.')] },
    { id: 'usb', t: tr('Back up profiles by USB copy'), warn: tr('Not checked on a real tablet yet.'), steps: [
      tr('Easier: Setup → Menu → "Back up and restore" makes one file and restores it from the Import folder.'),
      tr('Close the app. Connect the tablet to a PC by USB and choose "File transfer" on the tablet.'),
      tr('On the PC open: Android/data/at.loibl.lenksystem/files/AgOpenWeb/'),
      tr('Copy the folders Vehicles, Tools, Fields and NtripProfiles to the PC. NtripProfiles contains your NTRIP password.'),
      tr('To restore, copy them back to the same place while the app is closed.'),
      tr('Older versions of this app used the folder Android/data/com.agopenweb.android/ instead.'),
      tr('Windows tablet: the same folders are in Documents\\AgOpenWeb (C:\\Users\\<name>\\Documents\\AgOpenWeb; with OneDrive possibly OneDrive\\Documents\\AgOpenWeb). Close the app and copy them to a USB stick.')] },
    { id: 'board', t: tr('Steering module: firmware'), warn: tr('Board and motor are not tested on real hardware yet.'), steps: [
      tr('AiO board (v4.x, also v4.5): use the AiO v4 firmware, not v26.'),
      tr('v26 sends 0 as IMU heading in the steering data. The system then takes 0° as a real heading, and the heading lags behind every turn.'),
      tr('Check it in setup mode on the card "Heading check": a yellow warning appears when the IMU heading stays exactly 0° while driving.')] },
  ];
  // Buttons named in a step show their real symbol inline: {abline} → the image of that button
  // as it is on screen now (the bottom bar's, the right nav's), else its file.
  const HELP_ICON = {
    abline: ['#bn-abmenu img', 'TrackOn.png'], quickab: ['#bn-quickab img', 'ABTrackAPlus.png'],
    snapleft: ['#bottomnav [data-cmd="track.snapLeft"] img', 'SnapLeft.png'], snapright: ['#bottomnav [data-cmd="track.snapRight"] img', 'SnapRight.png'],
    next: ['#rn-cycle img', 'ABLineCycle.png'], steer: [null, 'AutoSteerOff.png'],
    headland: ['#bn-headland-ic', 'HeadlandOff.png'], secheadland: ['#bn-secheadland-ic', 'HeadlandSectionOn.png'],
  };
  function stepItem(text) {
    const li = el('li');
    for (const part of text.split(/(\{[a-z]+\})/)) {
      const m = /^\{([a-z]+)\}$/.exec(part);
      if (m && m[1] === 'menu') { const b = $('tui-menu-btn'); const i = el('span', 'tb-ic tb-ic-svg', b ? (b.querySelector('svg') || {}).outerHTML || '' : ''); li.appendChild(i); continue; }
      if (m && HELP_ICON[m[1]]) {
        const [q, file] = HELP_ICON[m[1]];
        const live = q ? document.querySelector(q) : null;
        const img = el('img', 'tb-ic'); img.alt = ''; img.src = live && live.getAttribute('src') ? live.src : '/icons/' + file;
        li.appendChild(img); continue;
      }
      li.appendChild(document.createTextNode(part));
    }
    return li;
  }
  function openHelp(id) {
    const pg = PAGES.find(p => p.id === id);
    if (!pg) {
      openSheet(T(tr('Help')), b => {
        b.appendChild(Object.assign(el('div', 'tp-lead'), { textContent: T(tr('Short guide')) }));
        const g = el('div', 'tb-topics');
        for (const p of PAGES) {
          const t = el('button', 'tb-topic', (ILL[p.id] ? ILL[p.id]() : '') + '<span></span>'); t.querySelector('span').textContent = T(p.t); // a page without a picture must not break the index
          onTap(t, () => openHelp(p.id));
          g.appendChild(t);
        }
        b.appendChild(g);
        b.appendChild(Object.assign(el('div', 'tp-lead'), { textContent: T(tr('Online (needs internet)')) }));
        const r = el('div', 'tb-row');
        r.append(link(T(tr('This version (fork)')), BRAND.source), link(T(tr('Original project')), BRAND.upstream));
        b.appendChild(r);
      });
      return;
    }
    openSheet(T(pg.t), b => {
      const w = el('div', 'tb-page');
      if (ILL[pg.id]) w.appendChild(el('div', 'tb-pill', ILL[pg.id]()));
      const col = el('div');
      if (pg.warn) col.appendChild(Object.assign(el('div', 'tp-note warn'), { textContent: T(pg.warn) }));
      const ol = el('ol', 'tb-steps');
      for (const s of pg.steps) ol.appendChild(stepItem(T(s)));
      col.appendChild(ol);
      w.appendChild(col);
      b.appendChild(w);
      const nav = el('div', 'tb-row');
      const back = el('button', 'tp-btn'); back.textContent = '← ' + T(tr('All topics')); onTap(back, () => openHelp());
      nav.appendChild(back);
      const i = PAGES.indexOf(pg);
      if (i < PAGES.length - 1) { const nx = el('button', 'tp-btn pri'); nx.textContent = T(PAGES[i + 1].t) + ' →'; onTap(nx, () => openHelp(PAGES[i + 1].id)); nav.appendChild(nx); }
      b.appendChild(nav);
    });
  }
  // The upstream help panel (App & Files → Help) gets the short guide on top.
  { const h = $('help'); if (h) { const b = el('button', 'fo-btn tb-helpbtn'); b.textContent = tr('Short guide'); onTap(b, () => openHelp()); h.querySelector('.ln-hdr').after(b); } }

  // --- Diagnosis for support: the bug report with a summary from this device ----------------
  // Uses the existing bug report (app.bugReport): the host zips settings (secrets blanked),
  // profile values, logs, RTCM report, GPS log, the open field. The summary below goes in as the
  // description. NTRIP passwords and user names never go in; they are blanked if they appear.
  function summary() {
    const s = statusBar || {}, v = config && config.vehicle, t = config && config.tool;
    const L = [];
    L.push('DIAGNOSIS ' + new Date().toISOString());
    L.push('Product: ' + BRAND.name + ' (look ' + (on() ? 'on' : 'off') + ')');
    L.push('Version: ' + (appInfo ? appInfo.version + ' ' + appInfo.gitHash : '?'));
    L.push('Client: ' + navigator.userAgent + ' ' + innerWidth + 'x' + innerHeight + ' lang ' + I18n.language);
    L.push('Connection: ' + connState + ', control ' + (iHoldControl ? 'this device' : 'other / none'));
    L.push('');
    L.push('Active vehicle: ' + (profiles ? profiles.activeVehicle : '?'));
    if (v) L.push('  type ' + v.type + ', wheelbase ' + v.wheelbase + ' m, track ' + v.trackWidth + ' m, antenna pivot ' + v.antennaPivot +
      ' m, height ' + v.antennaHeight + ' m, offset ' + v.antennaOffset + ' m, hitch ' + v.hitchLength + ' m');
    if (config && config.autosteer) L.push('  max steer angle ' + config.autosteer.maxSteerAngle + ' deg');
    L.push('Active tool: ' + (profiles ? profiles.activeTool : '?'));
    if (t) L.push('  type ' + t.type + ', sections ' + t.numSections + ', widths cm ' + (t.sectionWidths || []).slice(0, t.numSections).join('/') +
      ', total ' + t.totalWidth + ' m, offset ' + t.offset + ' m, overlap ' + t.overlap + ' m, hitch ' + t.hitchLength + ' m');
    L.push('');
    L.push('GPS: fix ' + s.fixQuality + ' (' + (s.fixText || '?') + '), sats ' + s.sats + ', hdop ' + s.hdop + ', correction age ' + s.age + ' s' + (s.gpsLost ? ', DATA LOST' : ''));
    L.push('NTRIP: ' + (s.ntripEnabled ? 'on' : 'off') + ', connected ' + !!s.ntripConnected + ', bytes ' + s.ntripBytes + ', to ' + (s.ntripDestination || '?'));
    L.push('  status: ' + (s.ntripStatus || ''));
    L.push('Modules: gps ' + !!s.gpsOk + ', imu ' + !!s.imuOk + ', steer ' + !!s.autoSteerOk + ', machine ' + !!s.machineOk);
    // The bench checklist result, if one was ticked on this device (TabletBench).
    if (typeof TabletBench !== 'undefined') L.push(...TabletBench.lines());
    // The host's log and RTCM report are in the file as logs.txt and ntrip_rtcm.txt.
    let out = L.join('\n');
    // Never a password or NTRIP user name, even if it appears in a log line.
    const secrets = [];
    const np = ntripProfiles && ntripProfiles.profiles;
    if (np) for (const k of Object.keys(np)) for (const f of ['password', 'username']) { const x = np[k] && np[k][f]; if (x && x.length >= 3) secrets.push(x); }
    for (const x of secrets.sort((a, b) => b.length - a.length)) out = out.split(x).join('***');
    // The host reads a command in 1 KB pieces and runs each piece on its own: the summary has
    // to fit in one, with the command prefix (code points, so no character is cut in half).
    const enc = new TextEncoder(), max = 1000 - enc.encode('app.bugReport|diagnose\t').length;
    if (enc.encode(out).length > max) {
      let cp = Array.from(out);
      while (enc.encode(cp.join('') + ' …').length > max) cp = cp.slice(0, -16);
      out = cp.join('') + ' …';
    }
    return out;
  }
  let diagSent = false;
  function openDiag() {
    diagSent = false;
    openSheet(T(tr('Diagnosis for support')), fillDiag);
  }
  function fillDiag(b) {
    b.innerHTML = '';
    if (!diagSent) {
      b.appendChild(Object.assign(el('div', 'tp-lead'), { textContent: T(tr('A file for support with the state of this system.')) }));
      const ul = el('ul', 'tp-list');
      for (const x of [tr('Version, active vehicle and tool with their values'), tr('NTRIP state with the last caster reply, GPS fix quality, satellites, correction age'),
        tr('The last log lines, the settings and the NTRIP correction report')]) ul.appendChild(Object.assign(el('li'), { textContent: T(x) }));
      b.appendChild(ul);
      b.appendChild(Object.assign(el('div', 'tp-note warn'), { textContent: T(tr('The file also contains the open field (boundary, tracks, worked area) and the GPS positions of the last 5 minutes. Only pass it on to someone you trust.')) }));
      b.appendChild(Object.assign(el('div', 'tp-note'), { textContent: T(tr('Passwords and the NTRIP user name are not included.')) }));
      const r = el('div', 'tb-row');
      const go = el('button', 'tp-btn pri big'); go.textContent = T(tr('Understood, create the file'));
      go.disabled = connState !== 'connected';
      onTap(go, () => {
        if (connState !== 'connected') return;
        transport.send('app.bugReport|' + 'diagnose' + '\t' + summary().replace(/\t/g, ' '));
        diagSent = true; fillDiag(b);
      });
      const cancel = el('button', 'tp-btn'); cancel.textContent = T(tr('Cancel')); onTap(cancel, closeSheet);
      r.append(cancel, go);
      b.appendChild(r);
      return;
    }
    const st = appInfo ? appInfo.bugReportStatus || '' : '';
    const m = /(bugreport_[^\/\\]+\.zip)$/.exec(st);
    b.appendChild(Object.assign(el('div', 'tp-lead'), { textContent: m ? T(tr('The file is ready.')) : /^Error/.test(st) ? st : T(tr('Creating the file…')) }));
    if (m) {
      const dl = el('button', 'tp-btn pri big'); dl.textContent = T(tr('Download'));
      onTap(dl, () => openExternal(location.origin + '/bugreports/' + encodeURIComponent(m[1])));
      b.appendChild(dl);
      b.appendChild(Object.assign(el('div', 'tp-note'), { textContent: T(tr('The download opens in the browser and lands in Downloads on this device.')) }));
      const fn = el('div', 'tp-note'); fn.setAttribute('translate', 'no'); fn.textContent = m[1]; b.appendChild(fn);
    }
  }
  let diagKey = '';
  setInterval(() => {
    if (!sheet.classList.contains('open') || !diagSent) return;
    const k = appInfo ? appInfo.bugReportStatus : '';
    if (k !== diagKey) { diagKey = k; fillDiag(shB); }
  }, 400);

  // --- Menu tiles: Help (in the field), Info and Diagnosis (setup) --------------------------
  const ICS = {
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><circle cx="12" cy="17.5" r=".6" fill="currentColor"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".6" fill="currentColor"/></svg>',
    diag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  };
  function menuTiles() {
    const m = $('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const f = m.querySelector('.tui-tiles.tui-f'), s = m.querySelector('.tui-tiles.tui-s');
    const add = (box, key, cls, label, fn) => {
      if (!box || box.querySelector('[data-tile="' + key + '"]')) return;
      const t = el('button', 'tui-tile ' + cls, ICS[key.slice(3)] + '<span></span>'); t.dataset.tile = key;
      t.querySelector('span').textContent = T(label);
      onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) tuiPress(x); fn(); });
      box.appendChild(t);
    };
    add(f, 'tb-help', 'field', tr('Help'), () => openHelp());
    add(s, 'tb-info', 'setup', 'Info', () => openInfo());
    add(s, 'tb-diag', 'setup', tr('Diagnosis for support'), () => openDiag());
  }
  setInterval(menuTiles, 300);

  return { get on() { return on(); }, apply, openHelp, openInfo, openDiag, summary };
})();

// ===== Heading check (test bench): GPS heading beside the IMU heading, setup mode only ========
// Display only: reads what the host already sends (tick: GPS fix-to-fix heading and the IMU
// heading with the fusion's learned offset; status: the IMU heading as it came in, NaN when
// there is none) and sends nothing. Since upstream #357 the host also takes the IMU heading
// from PGN 253 / 211; a firmware that sends 0 there instead of 9999 ("no IMU") feeds 0°
// into the heading fusion (docs/Offene-Punkte.md, point 32). The warnings show that on the
// bench. The steering itself is not changed by any of this.
const TabletHeadingCheck = (() => {
  const MOVING_MPS = 0.5;      // ≈ 1.8 km/h: below this the fix-to-fix heading isn't meaningful
  const ZERO_SECONDS = 5;      // raw IMU heading exactly 0 for this long while moving
  const DEV_DEG = 20, DEV_SECONDS = 1;
  const T = k => I18n.text(k);
  const box = document.createElement('div');
  box.id = 'tui-hdgchk'; box.setAttribute('translate', 'no'); box.hidden = true;
  box.innerHTML = '<div class="hc-t"></div><div class="hc-g"></div><div class="hc-w"></div>';
  document.body.appendChild(box);
  const [title, grid, warn] = box.children;
  let zeroSince = 0, devSince = 0, last = '';
  const fin = v => typeof v === 'number' && Number.isFinite(v);
  const norm = d => ((d % 360) + 360) % 360;
  const diff = (a, b) => { const d = norm(a - b); return d > 180 ? 360 - d : d; };
  const deg = v => fin(v) ? tuiNum(norm(v), 1) + '°' : '—';
  function render() {
    const show = typeof TabletTerminal !== 'undefined' && TabletTerminal.mode === 'setup';
    if (box.hidden === show) box.hidden = !show;
    if (!show) { zeroSince = devSince = 0; last = ''; return; }
    const now = performance.now();
    const live = connState === 'connected' && !!lastTick && now - lastTick.t < 2000;
    const moving = live && Math.abs(lastTick.speed || 0) > MOVING_MPS;
    const gps = tick ? tick.chartGpsHeading : NaN, corr = tick ? tick.chartImuHeading : NaN;
    const sd = statusBar && statusBar.systemData, raw = sd ? sd.imuHeading : NaN;
    const dev = fin(gps) && fin(corr) ? diff(corr, gps) : NaN;
    zeroSince = moving && fin(raw) && Math.abs(raw) < 0.05 ? (zeroSince || now) : 0;
    devSince = moving && fin(dev) && dev > DEV_DEG ? (devSince || now) : 0;
    const w = [];
    if (zeroSince && now - zeroSince >= ZERO_SECONDS * 1000)
      w.push(tr('The IMU heading has been exactly 0° for {s} s while driving. The module probably sends no real IMU heading.', { s: Math.round((now - zeroSince) / 1000) }));
    if (devSince && now - devSince >= DEV_SECONDS * 1000)
      w.push(tr('The IMU heading differs from the GPS heading by {d}°.', { d: tuiNum(dev, 0) }));
    const rows = [
      [T(tr('GPS Heading')), live ? deg(gps) : '—'],
      [T(tr('IMU heading (as received)')), !live ? '—' : fin(raw) ? deg(raw) : T(tr('None'))],
      [T(tr('IMU heading (with offset)')), live ? deg(corr) : '—'],
      [T(tr('Difference')), live && fin(dev) ? tuiNum(dev, 1) + '°' : '—'],
    ];
    const key = rows.map(r => r.join('=')).join('|') + '|' + w.join('|') + moving;
    if (key === last) return;
    last = key;
    title.textContent = T(tr('Heading check')) + (live && !moving ? ' · ' + T(tr('standing')) : '');
    grid.innerHTML = '';
    for (const [k, v] of rows) {
      grid.appendChild(Object.assign(document.createElement('span'), { textContent: k }));
      grid.appendChild(Object.assign(document.createElement('b'), { textContent: v }));
    }
    warn.innerHTML = '';
    for (const t of w) warn.appendChild(Object.assign(document.createElement('div'), { textContent: '⚠ ' + t }));
    box.classList.toggle('warn', w.length > 0);
    state = { rows, warnings: w, moving };
  }
  let state = { rows: [], warnings: [], moving: false };
  setInterval(render, 250);
  // The bench checklist shows the same rows (TabletBench, step "Heading").
  return { render, get state() { return state; } };
})();

// ===== Simulator direction (fix/simulator-richtung) ===========================================
// The heading stage learns which way the vehicle faces from its first travel above 1.5 km/h
// (GpsHeadingFusionService.TryStartHeading). Backing first, it learns it the wrong way round:
// backing then shows as driving forward, forward as reversing, and the steering the guidance
// computes is for the wrong direction. In the simulator the speed's sign says which way it
// really goes, so the mix-up can be told for sure; this shows it and offers the existing
// "Reset direction" (the same command as a tap on the vehicle). Display only: nothing is sent
// unless the operator taps the button. With real GPS the client can't tell; see the help.
// Also: real GPS present → the host keeps the simulator off; say so instead of a silent SIM button.
const TabletSimGuard = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); fn(e); });
  const MOVING_MPS = 0.3, TRAP_MS = 3000, RIGHT_MS = 2000, REFUSE_MS = 1500;
  const box = document.createElement('div');
  box.id = 'tui-simdir'; box.setAttribute('translate', 'no'); box.hidden = true;
  box.innerHTML = '<div class="sd-t"></div><div class="sd-x"></div><div class="sd-b"></div>';
  document.body.appendChild(box);
  box.addEventListener('pointerdown', e => e.stopPropagation());
  const [title, text, row] = box.children;
  const btn = el('button', 'tp-btn pri'); row.appendChild(btn);
  onTap(btn, () => {
    if (!iHoldControl) { showToast(T(tr('Take control to reset the direction'))); return; }
    transport.send('heading.resetDirection');
    resetAt = performance.now();
    showToast(T(tr('Direction reset. Drive forward above 1.5 kph.')));
  });
  let trapSince = 0, rightSince = 0, resetAt = 0, shownAt = 0, shown = false;
  let enablePressAt = 0, wasSim = null, simOffAt = 0;

  const realGps = () => !!(statusBar && statusBar.gpsSentence && statusBar.gpsSentence !== 'SIM' && !statusBar.gpsLost);
  function refusedHint() { showToast(T(tr('Real GPS active – simulator paused. To simulate, disconnect the GPS module and switch SIM on again.')), 7000); }
  // The SIM switch on the sim bar: if the host keeps it off, a live GPS source is the reason (#478).
  const simEnable = document.getElementById('sim-enable');
  if (simEnable) simEnable.addEventListener('pointerdown', () => {
    if (statusBar && !statusBar.simEnabled) enablePressAt = performance.now();
  }, true);

  function render() {
    const s = statusBar, now = performance.now();
    if (!s) return;
    // Refused switch-on, or switched off by the host because real GPS started arriving.
    if (enablePressAt && now - enablePressAt > REFUSE_MS) {
      if (!s.simEnabled) refusedHint();
      enablePressAt = 0;
    }
    // The source shown can still read SIM in the status that turns the sim off: watch 3 s.
    if (wasSim === true && !s.simEnabled && !enablePressAt) simOffAt = now;
    if (simOffAt && !s.simEnabled && realGps()) { refusedHint(); simOffAt = 0; }
    if (simOffAt && (s.simEnabled || now - simOffAt > 3000)) simOffAt = 0;
    wasSim = !!s.simEnabled;

    // Wrong way round: the sim's speed sign against the host's reverse flag.
    const gps = config && config.gps;
    const live = connState === 'connected' && !!lastTick && now - lastTick.t < 2000;
    const v = (s.simSpeedKph || 0);
    const moving = live && Math.abs(lastTick.speed || 0) > MOVING_MPS;
    const rev = !!(tick && tick.op && tick.op.reverse);
    const dual = gps && gps.isDualGps && !s.dualHeadingMissing;
    const checkable = s.simEnabled && moving && !dual && !(gps && gps.reverseDetection === false);
    const wrong = checkable && ((v > 0 && rev) || (v < 0 && !rev));
    trapSince = wrong ? (trapSince || now) : 0;
    // Shown after TRAP_MS of the mix-up; it stays while standing (stopping is the first step
    // of the fix) and goes after a reset, with the sim off, or after RIGHT_MS of travel the
    // right way round.
    rightSince = checkable && !wrong ? (rightSince || now) : 0;
    let show = shown;
    if (!shown && trapSince && now - trapSince >= TRAP_MS && now - resetAt > 3000) show = true;
    if (shown && (!s.simEnabled || resetAt > shownAt || (rightSince && now - rightSince >= RIGHT_MS))) show = false;
    if (show !== shown) {
      shown = show; box.hidden = !show;
      if (show) {
        shownAt = now;
        title.textContent = '⚠ ' + T(tr('Simulator: direction learned the wrong way round'));
        text.textContent = T(tr('The first travel was backwards, so the heading was learned facing backwards: reversing shows as forward and forward as reversing. Steering computed now is for the wrong direction; do not engage it. Stop, reset the direction, then drive forward.'));
        btn.textContent = T(tr('Reset direction'));
      }
    }
  }
  setInterval(render, 250);
  return { render, get shown() { return shown; } };
})();

// ===== Direction check before the first steering (fix/simulator-richtung) =====================
// With one antenna the host learns which way the vehicle faces from its first travel; backing
// first, it learns it the wrong way round and steering then runs for the wrong direction (see
// TabletSimGuard). After every (re)connection (a host start is one too) and before steering is
// first switched on, a card asks "Does the vehicle face the way it drives?", with a live
// sketch: the vehicle arrow as the host has it and the track it just drove. "Yes" closes it for
// this connection; "Learn the direction again" sends the existing heading.resetDirection (as a
// tap on the vehicle). The card does not block anything: Steer works with it open. Not with a
// dual antenna (the antennas give the heading). Display only.
const TabletSteerConfirm = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); fn(e); });
  const PX_PER_M = 6, TRAIL_M = 30;
  const box = el('div'); box.id = 'tui-dircheck'; box.setAttribute('translate', 'no'); box.hidden = true;
  box.addEventListener('pointerdown', e => e.stopPropagation());
  const cv = el('canvas', 'dc-map');
  const title = el('div', 'dc-t'), text = el('div', 'dc-x'), row = el('div', 'dc-b');
  const yes = el('button', 'tp-btn pri'), redo = el('button', 'tp-btn');
  row.append(yes, redo); box.append(title, cv, text, row);
  document.body.appendChild(box);
  let confirmed = false, wasConnected = false, resetAt = 0, lastLang = '';
  const trail = [];
  onTap(yes, () => { confirmed = true; render(); });
  onTap(redo, () => {
    if (!iHoldControl) { showToast(T(tr('Take control to reset the direction'))); return; }
    transport.send('heading.resetDirection');
    resetAt = performance.now(); trail.length = 0;
    showToast(T(tr('Direction reset. Drive forward above 1.5 kph.')));
    render();
  });
  function labels() {
    title.textContent = T(tr('Does the vehicle face the way it drives?'));
    yes.textContent = T(tr('Yes'));
    redo.textContent = T(tr('No – learn the direction again'));
    lastLang = I18n.language;
  }
  function draw() {
    const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(box);
    g.fillStyle = cs.getPropertyValue('--dc-bg') || '#e8edf3'; g.fillRect(0, 0, w, h);
    const p = tick && tick.pose; if (!p) return;
    // Heading up: the vehicle arrow points up, the driven track is drawn relative to it.
    const cx = w / 2, cy = h * 0.42, s = Math.sin(p.heading), c = Math.cos(p.heading);
    const toScr = (e, n) => { const de = e - p.e, dn = n - p.n; return [cx + (de * c - dn * s) * PX_PER_M, cy - (de * s + dn * c) * PX_PER_M]; };
    g.strokeStyle = cs.getPropertyValue('--dc-grid') || 'rgba(60,72,90,0.25)'; g.lineWidth = 1;
    for (let x = cx % 30; x < w; x += 30) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = cy % 30; y < h; y += 30) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    if (trail.length > 1) {
      g.strokeStyle = cs.getPropertyValue('--dc-trail') || '#2563eb'; g.lineWidth = 4; g.lineCap = 'round'; g.setLineDash([6, 6]);
      g.beginPath(); trail.forEach((q, i) => { const [x, y] = toScr(q[0], q[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); g.setLineDash([]);
    }
    g.fillStyle = cs.getPropertyValue('--dc-veh') || '#7b2d6e';
    g.beginPath(); g.moveTo(cx, cy - 22); g.lineTo(cx + 13, cy + 14); g.lineTo(cx, cy + 6); g.lineTo(cx - 13, cy + 14); g.closePath(); g.fill();
  }
  function render() {
    const now = performance.now();
    const connected = connState === 'connected';
    if (connected && !wasConnected) { confirmed = false; trail.length = 0; } // host start or reconnect
    wasConnected = connected;
    const p = tick && tick.pose;
    if (p) {
      const l = trail[trail.length - 1];
      if (!l || Math.hypot(p.e - l[0], p.n - l[1]) > 0.3) trail.push([p.e, p.n]);
      let len = 0;
      for (let i = trail.length - 1; i > 0; i--) { len += Math.hypot(trail[i][0] - trail[i - 1][0], trail[i][1] - trail[i - 1][1]); if (len > TRAIL_M) { trail.splice(0, i - 1); break; } }
    }
    const s = statusBar, gps = config && config.gps, op = tick && tick.op;
    const dual = !!(gps && gps.isDualGps && s && !s.dualHeadingMissing);
    const show = connected && !confirmed && !dual && !!iHoldControl && !!op && (op.autoSteerAvail || op.autoSteer);
    if (box.hidden === show) box.hidden = !show;
    if (!show) return;
    if (lastLang !== I18n.language || !title.textContent) labels();
    const moved = trail.length > 3;
    const after = resetAt && now - resetAt < 60000;
    text.textContent = T(after ? tr('Now drive forward above 1.5 km/h, then check again.')
      : moved ? tr('Arrow = where it faces, as the system has it. Dashed = driven track; driving forward it lies behind the arrow.')
        : tr('Arrow = where it faces, as the system has it. Drive a few metres forward to see the track.'));
    draw();
  }
  setInterval(render, 250);
  return { render, confirm: () => { confirmed = true; render(); }, get confirmed() { return confirmed; } };
})();

// ===== Bench checklist for AiO v4.5 + Keya (feature/pruefstand-checkliste), setup mode =========
// A guided list to tick off on the test bench: each step shows live values the host already
// sends, what "right" looks like, "OK" / "Problem" and a note. The result is kept on this device
// (localStorage) and goes into the diagnosis for support (TabletBrand.summary). Display only:
// it sends nothing and changes no value; where a step needs an action (roll zero, reset
// direction) it names the existing button. Board and motor are not tested on real hardware yet.
const TabletBench = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const KEY = 'aow.tui.bench';
  const fin = v => typeof v === 'number' && Number.isFinite(v);
  const num = (v, d, u) => fin(v) ? tuiNum(v, d) + (u || '') : '—';
  const live = () => connState === 'connected' && !!lastTick && performance.now() - lastTick.t < 2000;
  const yesNo = b => T(b ? tr('yes') : tr('no'));
  // A raw value that sits at exactly 0 for a while: the module probably sends none.
  const zeroWatch = () => { let since = 0; return (v, on) => { since = on && fin(v) && Math.abs(v) < 0.005 ? (since || performance.now()) : 0; return since && performance.now() - since > 5000; }; };
  const rollZeroLong = zeroWatch();

  const STEPS = [
    { id: 'link', t: tr('Steering module connection'),
      ok: tr('Steering module: data received. The address is in the module network (for example 192.168.5.126). Unplug the module: "no data" within a few seconds.'),
      rows: () => {
        const s = statusBar || {};
        return [[tr('Steering module (PGN received)'), s.autoSteerOk ? T(tr('data received')) : T(tr('no data'))],
          [tr('Address'), s.autoSteerIp || '—'], [tr('Set up in Network IO'), yesNo(s.autoSteerConf)],
          [tr('IMU module'), s.imuOk ? T(tr('data received')) : T(tr('no data'))],
          [tr('Firmware version'), T(tr('not shown by the host'))]];
      },
      warn: () => statusBar && !statusBar.autoSteerOk ? [tr('No data from the steering module. Check power, network cable and the module subnet (Network & GPS).')] : [] },
    { id: 'was', t: tr('Steering angle sensor'),
      ok: tr('Wheels straight = close to 0°. Steer left and right: the sign must match the side (else invert it in the AutoSteer settings). The value follows smoothly, without jumps.'),
      rows: () => {
        const s = statusBar || {}, a = config && config.autosteer;
        return [[tr('Steering angle (live)'), live() ? num(s.actualSteerAngle, 1, '°') : '—'],
          [tr('Sensor'), live() ? num(s.sensorPercent, 0, ' %') : '—'],
          [tr('WAS offset'), a ? String(a.wasOffset) : '—'], [tr('Counts per degree'), a ? num(a.countsPerDegree, 1) : '—']];
      },
      warn: () => [] },
    { id: 'heading', t: tr('Heading check'),
      ok: tr('Drive straight above 2 km/h: GPS heading and IMU heading (with offset) differ by only a few degrees. Without an IMU, "none" is right.'),
      rows: () => (TabletHeadingCheck.state.rows || []).map(r => [r[0], r[1]]),
      warn: () => TabletHeadingCheck.state.warnings || [],
      raw: true },
    { id: 'roll', t: tr('Roll'),
      ok: tr('Vehicle level: roll close to 0°. Lower the right side (or tilt the module to the right): the sign must match the side. If it is off when level, set the zero under Vehicle & Tool → Roll ("Zero Now").'),
      rows: () => {
        const r = config && config.roll;
        return [[tr('Roll (live)'), live() && tick ? num(tick.roll, 2, '°') : '—'],
          [tr('Roll zero'), r ? num(r.rollZero, 2, '°') : '—'], [tr('Roll inverted'), r ? yesNo(r.isRollInvert) : '—']];
      },
      warn: () => rollZeroLong(tick && tick.roll, live() && statusBar && statusBar.imuOk)
        ? [tr('Roll has been exactly 0.00° for 5 s with the IMU present. The module probably sends no real roll; since #356 the host takes 0 as a valid roll.')] : [] },
    { id: 'gps', t: tr('GPS'),
      ok: tr('RTK Fix, 10 or more satellites, correction age below 3 s. Without NTRIP, GPS or DGPS is expected.'),
      rows: () => {
        const s = statusBar || {};
        return [[tr('Fix quality'), s.fixQuality != null ? s.fixQuality + ' ' + (s.fixText || '') : '—'],
          [tr('Satellites'), s.sats != null ? String(s.sats) : '—'], [tr('Correction age'), num(s.age, 1, ' s')],
          [tr('HDOP'), num(s.hdop, 1)], [tr('Sentence'), s.gpsSentence || '—']];
      },
      warn: () => statusBar && statusBar.gpsLost ? [tr('GPS data lost.')] : [] },
    { id: 'steer', t: tr('Steering on / off'),
      ok: tr('Wheels free or raised, nobody at the wheels. Steering on: the status shows "on", set angle and PWM change, the wheels follow. Steering off: PWM 0, the motor lets go. "Not steering" must not appear while on.'),
      rows: () => {
        const s = statusBar || {}, op = tick && tick.op;
        return [[tr('Steering available'), op ? yesNo(op.autoSteerAvail) : '—'], [tr('Steering on'), op ? yesNo(op.autoSteer) : '—'],
          [tr('Module reports not steering'), op ? yesNo(op.moduleNotSteering) : '—'],
          [tr('Set angle'), live() ? num(s.setSteerAngle, 1, '°') : '—'], [tr('Actual angle'), live() ? num(s.actualSteerAngle, 1, '°') : '—'],
          [tr('PWM'), live() && tick ? num(tick.chartPwm, 0) : '—']];
      },
      warn: () => tick && tick.op && tick.op.autoSteer && tick.op.moduleNotSteering ? [tr('Steering is on, but the module reports it is not steering.')] : [] },
    { id: 'reverse', t: tr('Reverse start (on purpose)'),
      intro: [tr('With one antenna the system learns which way the vehicle faces from the first travel. This step reproduces the wrong case on purpose.'),
        tr('Steering stays OFF for the whole step.'),
        tr('1. Restart the host, or tap the vehicle on the map ("Reset direction").'),
        tr('2. Back up first: more than 1.5 km/h, about 10 m.'),
        tr('3. Expected: the "REVERSE" badge does not show although you back up; on the card "Does the vehicle face the way it drives?" the arrow points to the dashed track. In the simulator the warning "direction learned the wrong way round" appears after 3 s.'),
        tr('4. Stop, tap "No – learn the direction again" on the card, then drive forward above 1.5 km/h.'),
        tr('5. Expected: forward shows no "REVERSE", backing shows it; the dashed track lies behind the arrow.')],
      ok: tr('Rule: after the start, drive forward first or confirm the direction on the card.'),
      rows: () => {
        const s = statusBar || {}, op = tick && tick.op, dc = document.getElementById('tui-dircheck');
        const gps = config && config.gps;
        return [[tr('Speed'), live() ? (s.simEnabled ? num(s.simSpeedKph, 1, ' km/h') : num(Math.abs(lastTick.speed || 0) * 3.6, 1, ' km/h')) : '—'],
          [tr('Host: reversing'), op ? yesNo(op.reverse) : '—'],
          [tr('Direction card open'), dc ? yesNo(!dc.hidden) : '—'],
          [tr('Simulator warning shown'), s.simEnabled ? yesNo(TabletSimGuard.shown) : T(tr('simulator off'))],
          [tr('Dual antenna'), gps ? yesNo(!!gps.isDualGps) : '—']];
      },
      warn: () => config && config.gps && config.gps.isDualGps ? [tr('Dual antenna: the antennas give the heading, the reverse start case does not happen. Mark the step OK or note "dual".')] : [] },
  ];

  // --- Stored result: { at, r: { id: { s: 'ok' | 'prob', n: note, at } } } ----------------
  function load() { try { const v = JSON.parse(window.localStorage.getItem(KEY) || 'null'); if (v && v.r) return v; } catch (_) { /* none or blocked */ } return { at: '', r: {} }; }
  function save() { res.at = new Date().toISOString(); try { window.localStorage.setItem(KEY, JSON.stringify(res)); } catch (_) { /* private / blocked */ } }
  let res = load();

  // --- Sheet --------------------------------------------------------------------------------
  const sheet = el('div', 'tui-sheet tb-sheet tbn-sheet');
  sheet.id = 'tui-bench'; sheet.setAttribute('translate', 'no');
  sheet.innerHTML = '<div class="tui-sh-hdr"><span class="t"></span><button class="x">✕</button></div><div class="tui-sh-body"></div>';
  const scrim = el('div', 'tp-scrim');
  document.body.append(scrim, sheet);
  for (const n of [sheet, scrim]) n.addEventListener('pointerdown', e => e.stopPropagation());
  const shT = sheet.querySelector('.t'), shB = sheet.querySelector('.tui-sh-body');
  const close = () => { sheet.classList.remove('open'); scrim.classList.remove('open'); };
  onTap(sheet.querySelector('.x'), close); onTap(scrim, close);
  let cur = 0, valBox = null, warnBox = null, lastKey = '', clearArmed = 0;
  const drafts = {}; // notes typed before OK / Problem, per step, until the sheet is reloaded

  // The checklist belongs to setup mode: opening it switches the terminal layout there, and it
  // closes when the mode changes again (not merely because it was opened from drive mode, which
  // closed it within half a second: moritz.31 test, point 3).
  let openMode = null;
  function open(i) {
    tuiEnterSetup();
    if (typeof lnCloseAll === 'function') lnCloseAll();
    openMode = TabletTerminal.mode;
    cur = i == null ? Math.max(0, STEPS.findIndex(s => !res.r[s.id])) : i;
    fill();
    sheet.classList.add('open'); scrim.classList.add('open');
  }
  function fill() {
    const st = STEPS[cur], r = res.r[st.id] || {};
    shT.textContent = T(tr('Bench checklist')) + ' · ' + (cur + 1) + '/' + STEPS.length;
    shB.innerHTML = '';
    const chips = el('div', 'tbn-chips');
    STEPS.forEach((s, i) => {
      const x = res.r[s.id], c = el('button', 'tbn-chip' + (i === cur ? ' cur' : '') + (x ? ' ' + x.s : ''));
      c.appendChild(el('span', 'tbn-mk', x ? (x.s === 'ok' ? '✓' : '!') : String(i + 1)));
      c.appendChild(el('span', '', T(s.t)));
      onTap(c, () => { cur = i; fill(); });
      chips.appendChild(c);
    });
    shB.appendChild(chips);
    const main = el('div', 'tbn-main');
    const left = el('div', 'tbn-col');
    left.appendChild(el('div', 'tbn-h', T(st.t)));
    if (st.intro) { const ol = el('div', 'tbn-intro'); for (const x of st.intro) ol.appendChild(el('div', '', T(x))); left.appendChild(ol); }
    left.appendChild(el('div', 'tb-lbl', T(tr('Right is'))));
    left.appendChild(el('div', 'tbn-ok', T(st.ok)));
    const right = el('div', 'tbn-col');
    right.appendChild(el('div', 'tb-lbl', T(tr('Live'))));
    valBox = el('div', 'tbn-vals'); warnBox = el('div', 'tbn-warn');
    right.append(valBox, warnBox);
    const res2 = el('div', 'tb-row tbn-res');
    const bOk = el('button', 'tp-btn' + (r.s === 'ok' ? ' pri' : ''), '✓ OK');
    const bPr = el('button', 'tp-btn' + (r.s === 'prob' ? ' pri dan' : ' dan'), '! ' + T(tr('Problem')));
    const mark = s => { const n = note.value.trim().slice(0, 200); res.r[st.id] = { s, n, at: new Date().toISOString() }; delete drafts[st.id]; save(); fill(); };
    onTap(bOk, () => mark('ok')); onTap(bPr, () => mark('prob'));
    res2.append(bOk, bPr);
    if (r.s) res2.appendChild(el('span', 'tbn-at', new Date(r.at).toLocaleString(I18n.language)));
    right.appendChild(res2);
    const note = el('textarea', 'tbn-note'); note.rows = 2; note.maxLength = 200;
    note.placeholder = T(tr('Note (what you saw, values)')); note.value = drafts[st.id] != null ? drafts[st.id] : r.n || '';
    note.addEventListener('pointerdown', e => e.stopPropagation());
    note.addEventListener('input', () => { drafts[st.id] = note.value; });
    note.addEventListener('change', () => { if (res.r[st.id]) { res.r[st.id].n = note.value.trim().slice(0, 200); save(); delete drafts[st.id]; } });
    right.appendChild(note);
    main.append(left, right);
    shB.appendChild(main);
    const nav = el('div', 'tb-row tbn-nav');
    const prev = el('button', 'tp-btn', '← ' + T(tr('Back'))); prev.disabled = cur === 0; onTap(prev, () => { cur--; fill(); });
    const clr = el('button', 'tp-btn quiet', T(clearArmed && performance.now() - clearArmed < 4000 ? tr('Tap again to clear all') : tr('Clear all ticks')));
    onTap(clr, () => {
      if (clearArmed && performance.now() - clearArmed < 4000) { res = { at: '', r: {} }; try { window.localStorage.removeItem(KEY); } catch (_) { /* blocked */ } for (const k in drafts) delete drafts[k]; clearArmed = 0; cur = 0; }
      else clearArmed = performance.now();
      fill();
    });
    nav.append(prev, clr);
    if (cur < STEPS.length - 1) { const nx = el('button', 'tp-btn pri', T(tr('Next')) + ' →'); onTap(nx, () => { cur++; fill(); }); nav.appendChild(nx); }
    else { const dn = el('button', 'tp-btn pri', T(tr('Close'))); onTap(dn, close); nav.appendChild(dn); }
    shB.appendChild(nav);
    lastKey = ''; tickVals();
  }
  function tickVals() {
    if (!sheet.classList.contains('open') || !valBox) return;
    const st = STEPS[cur];
    const rows = st.rows(), w = st.warn();
    const key = JSON.stringify([rows, w, I18n.language]);
    if (key === lastKey) return;
    lastKey = key;
    valBox.innerHTML = '';
    for (const [k, v] of rows) { valBox.appendChild(el('span', '', st.raw ? k : T(k))); valBox.appendChild(el('b', '', v)); }
    warnBox.innerHTML = '';
    for (const x of w) warnBox.appendChild(el('div', '', '⚠ ' + (st.raw ? x : T(x))));
  }
  setInterval(tickVals, 250);
  // Close when leaving setup mode: the checklist is for the bench.
  setInterval(() => { if (sheet.classList.contains('open') && TabletTerminal.mode !== openMode) close(); }, 500);

  // --- Menu tile (setup) --------------------------------------------------------------------
  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M8.5 10l1.5 1.5 3-3M8.5 16l1.5 1.5 3-3M15 11h1M15 17h1"/></svg>';
  setInterval(() => {
    const m = document.getElementById('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const s = m.querySelector('.tui-tiles.tui-s'); if (!s || s.querySelector('[data-tile="tbn"]')) return;
    const t = el('button', 'tui-tile setup'); t.dataset.tile = 'tbn'; t.innerHTML = IC + '<span></span>';
    t.querySelector('span').textContent = T(tr('Bench checklist'));
    onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) tuiPress(x); open(); });
    s.appendChild(t);
  }, 300);

  // --- For the diagnosis: one status line, then the notes (cut short; the summary has 1 KB) --
  function lines() {
    if (!res.at) return [];
    const L = ['Bench ' + res.at.slice(0, 16) + ': ' + STEPS.map(s => s.id + ' ' + (res.r[s.id] ? (res.r[s.id].s === 'ok' ? 'OK' : 'PROBLEM') : '-')).join(', ')];
    for (const s of STEPS) { const x = res.r[s.id]; if (x && x.n) L.push('  ' + s.id + ': ' + x.n.replace(/\s+/g, ' ').slice(0, 60)); }
    return L;
  }
  return { open, lines, get result() { return res; }, steps: STEPS.map(s => s.id) };
})();

// ===== Back up and restore profiles (feature/profil-backup), setup mode =======================
// Export: the host packs vehicles, tools, fields and the NTRIP profiles (without password) into
// one ZIP (backup.create), offered as a
// download like the bug report. Import: a ZIP copied into the Import folder, with a preview
// "new / overwrites / same" per entry (backup.preview), then the chosen entries
// (backup.apply, the operating device only; the host first saves the current state and refuses
// while steering is on or the vehicle moves). The state comes as JSON in appInfo.backupStatus.
const TabletBackup = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const STILL_MPS = 0.15;
  const KIND = { vehicle: tr('Vehicle'), tool: tr('Tool'), field: tr('Field'), ntrip: tr('NTRIP profile') };
  const STATE = { new: tr('new'), overwrites: tr('overwrites'), same: tr('same') };
  const ERR = {
    notzip: tr('The file is not a readable ZIP file.'),
    nomanifest: tr('Not a backup of this app (manifest.json missing or another format).'),
    version: tr('This backup has a format version this app does not support.'),
    toolarge: tr('The backup is too large.'),
    badname: tr('File not found in the Import folder.'), notfound: tr('File not found in the Import folder.'),
    empty: tr('Nothing selected.'),
    steer: tr('Steering is on. Switch steering off to import.'),
    moving: tr('The vehicle is moving. Stop to import.'),
    fieldopen: tr('The field {f} is open. Close it to import it.'),
    io: tr('Reading or writing failed: {f}'),
  };
  const DAMAGED = tr('The backup is damaged or was changed ({f}). Nothing was imported.');
  let st = {}, sel = new Set(), selFile = '', confirm = false, applySeq = -1, done = null, scrollTo = false;

  function status() {
    try { return appInfo && appInfo.backupStatus ? JSON.parse(appInfo.backupStatus) : {}; } catch (_) { return {}; }
  }
  function errText(b) {
    const f = b.arg || '';
    return T(ERR[b.err] || DAMAGED).replace('{f}', f);
  }
  function lockReason() {
    if (connState !== 'connected') return tr('No connection to the guidance computer.');
    if (!lastTick || performance.now() - lastTick.t > 2000) return tr('No current data from the guidance computer.');
    if (!iHoldControl) return tr('Only the device that has control can import.');
    if (tick && tick.op && tick.op.autoSteer) return tr('Steering is on. Switch steering off to import.');
    if (Math.abs(lastTick.speed || 0) > STILL_MPS) return tr('The vehicle is moving. Stop to import.');
    return '';
  }
  const importDir = () => {
    const d = appInfo && (appInfo.directories || []).find(x => x.name === 'Vehicle Profiles');
    return d && d.path ? d.path.replace(/[\\/][^\\/]+[\\/]?$/, '') + (d.path.includes('\\') ? '\\' : '/') + 'Import' : 'AgOpenWeb/Import';
  };

  // --- Sheet --------------------------------------------------------------------------------
  const sheet = el('div', 'tui-sheet tb-sheet tbk-sheet');
  sheet.id = 'tui-backup'; sheet.setAttribute('translate', 'no');
  sheet.innerHTML = '<div class="tui-sh-hdr"><span class="t"></span><button class="x">✕</button></div><div class="tui-sh-body"></div>';
  const scrim = el('div', 'tp-scrim');
  document.body.append(scrim, sheet);
  for (const n of [sheet, scrim]) n.addEventListener('pointerdown', e => e.stopPropagation());
  const shT = sheet.querySelector('.t'), shB = sheet.querySelector('.tui-sh-body');
  const close = () => { sheet.classList.remove('open'); scrim.classList.remove('open'); };
  onTap(sheet.querySelector('.x'), close); onTap(scrim, close);
  const isOpen = () => sheet.classList.contains('open');

  let openMode = null; // closes when the mode changes, as the bench checklist
  function open() {
    tuiEnterSetup();
    if (typeof lnCloseAll === 'function') lnCloseAll();
    openMode = TabletTerminal.mode;
    confirm = false;
    sheet.classList.add('open'); scrim.classList.add('open');
    if (connState === 'connected') transport.send('backup.list');
    render(true);
  }
  const send = c => { if (connState === 'connected') transport.send(c); };

  function render(force) {
    if (!isOpen()) return;
    st = status();
    const lock = lockReason();
    const key = JSON.stringify([st.seq, lock, confirm, [...sel], selFile, I18n.language, connState]);
    if (!force && key === render.key) return;
    render.key = key;
    shT.textContent = T(tr('Back up and restore'));
    const top = shB.scrollTop;
    shB.innerHTML = '';
    // Export
    const ex = el('div', 'tb-box');
    ex.appendChild(el('div', 'tb-lbl', T(tr('Back up'))));
    ex.appendChild(el('div', '', T(tr('One file with all vehicles, tools, fields (boundaries, tracks, headland, background image) and NTRIP profiles.'))));
    ex.appendChild(el('div', 'tp-note', T(tr('Not included: the worked area of the jobs and all passwords (NTRIP, AgShare). NTRIP profiles come without their password; on restore a password stored on that device is kept.'))));
    ex.appendChild(el('div', 'tp-note warn', T(tr('The file contains your fields with their positions. Only pass it on to someone you trust.'))));
    const exRow = el('div', 'tb-row');
    const mk = el('button', 'tp-btn pri big', T(tr('Create backup')));
    const busyC = st.op === 'create' && st.busy;
    mk.disabled = connState !== 'connected' || busyC;
    onTap(mk, () => send('backup.create'));
    exRow.appendChild(mk);
    if (busyC) exRow.appendChild(el('span', 'tp-note', T(tr('Creating the file…'))));
    else if (st.op === 'create' && st.err) exRow.appendChild(el('span', 'tp-note bad', errText(st)));
    if (st.file && !(st.op === 'create' && (st.busy || st.err))) {
      const dl = el('button', 'tp-btn', T(tr('Download')) + ' ↓');
      onTap(dl, () => openExternal(location.origin + '/backups/' + encodeURIComponent(st.file)));
      exRow.appendChild(dl);
      const fn = el('div', 'tp-note'); fn.setAttribute('translate', 'no'); fn.textContent = st.file + ' · ' + T(tr('The download opens in the browser and lands in Downloads on this device.'));
      ex.append(exRow, fn);
    } else ex.appendChild(exRow);
    shB.appendChild(ex);

    // Import
    const im = el('div', 'tb-box');
    im.appendChild(el('div', 'tb-lbl', T(tr('Restore'))));
    im.appendChild(el('div', '', T(tr('Copy the backup ZIP by USB into the Import folder, then choose it here:'))));
    const p = el('div', 'tp-note'); p.setAttribute('translate', 'no'); p.textContent = importDir(); im.appendChild(p);
    const lr = el('div', 'tb-row');
    const files = st.list || [];
    for (const f of files) {
      const b = el('button', 'tp-btn' + (f === selFile ? ' pri' : ''), f); b.setAttribute('translate', 'no');
      onTap(b, () => { selFile = f; confirm = false; applySeq = -1; done = null; scrollTo = true; send('backup.preview|' + f); render(true); });
      lr.appendChild(b);
    }
    if (!files.length) lr.appendChild(el('span', 'tp-note', T(tr('No backup in the Import folder.'))));
    const rf = el('button', 'tp-btn quiet', '↻ ' + T(tr('Refresh list'))); onTap(rf, () => send('backup.list'));
    lr.appendChild(rf);
    im.appendChild(lr);
    const resBox = el('div', 'tbk-res'); im.appendChild(resBox); // the import's result, above the list
    const pv = st.preview && st.preview.file === selFile ? st.preview : null;
    if (selFile && st.op === 'preview' && st.busy) im.appendChild(el('div', 'tp-note', T(tr('Checking the backup…'))));
    else if (selFile && st.op === 'preview' && st.err) im.appendChild(el('div', 'tp-note bad', errText(st)));
    else if (pv) {
      const items = pv.items || [];
      // A new preview (another file, or after an import): new and overwriting entries preselected.
      const pvKey = pv.file + JSON.stringify(items);
      if (render.pvKey !== pvKey) { render.pvKey = pvKey; sel = new Set(); items.forEach((x, i) => { if (x.s !== 'same') sel.add(i); }); }
      const tb = el('div', 'tbk-list');
      items.forEach((x, i) => {
        const r = el('button', 'tbk-it ' + x.s + (sel.has(i) ? ' on' : ''));
        r.disabled = x.s === 'same';
        r.appendChild(el('span', 'tbk-ck', sel.has(i) ? '✓' : ''));
        const nm = el('span', 'tbk-nm'); nm.appendChild(el('small', '', T(KIND[x.k] || x.k)));
        const n = el('b', '', x.n); n.setAttribute('translate', 'no'); nm.appendChild(n);
        if (x.c && x.c.length) { const c = el('small', 'tbk-ch', x.c.join(' · ')); c.setAttribute('translate', 'no'); nm.appendChild(c); }
        r.appendChild(nm);
        r.appendChild(el('span', 'tbk-st', T(STATE[x.s] || x.s)));
        onTap(r, () => { if (sel.has(i)) sel.delete(i); else sel.add(i); confirm = false; render(true); });
        tb.appendChild(r);
      });
      im.appendChild(tb);
      const nOver = [...sel].filter(i => items[i] && items[i].s === 'overwrites').length;
      if (lock) im.appendChild(el('div', 'tp-note warn', T(lock)));
      const ar = el('div', 'tb-row');
      const busyA = st.op === 'apply' && st.busy;
      if (!confirm) {
        const go = el('button', 'tp-btn pri big', T(tr('Import selected ({n})')).replace('{n}', sel.size));
        go.disabled = !!lock || !sel.size || busyA;
        onTap(go, () => { confirm = true; render(true); });
        ar.appendChild(go);
      } else {
        im.appendChild(el('div', 'tp-note warn', T(nOver ? tr('{n} entries are overwritten. The current state is saved first.') : tr('The current state is saved first.')).replace('{n}', nOver)));
        const no = el('button', 'tp-btn', T(tr('Cancel'))); onTap(no, () => { confirm = false; render(true); });
        const yes = el('button', 'tp-btn pri big', T(tr('Import now')));
        yes.disabled = !!lock || !sel.size;
        onTap(yes, () => {
          if (lockReason()) { confirm = false; render(true); return; }
          scrollTo = true;
          applySeq = st.seq; confirm = false; done = null;
          send('backup.apply|' + selFile + '\t' + [...sel].sort((a, b) => a - b).join(','));
          render(true);
        });
        ar.append(no, yes);
      }
      im.appendChild(ar);
    }
    // The import's result stays shown while the preview is fetched again.
    if (st.op === 'apply' && applySeq >= 0 && st.seq > applySeq && !st.busy) { done = { err: st.err ? errText(st) : '', applied: st.applied, seq: st.seq }; applySeq = -1; }
    if (done) {
      if (done.err) resBox.appendChild(el('div', 'tp-note bad', done.err));
      else if (done.applied) {
        resBox.appendChild(el('div', 'tp-note', T(tr('Imported: {n} entries.')).replace('{n}', (done.applied.written || []).length)));
        for (const n of done.applied.needPassword || []) resBox.appendChild(el('div', 'tp-note warn', T(tr('Enter the password for NTRIP profile {n} again (Setup → Network & GPS).')).replace('{n}', n)));
        const ab = el('div', 'tb-row');
        const fn = el('span', 'tp-note', T(tr('Saved before the import:')) + ' ' + done.applied.auto); ab.appendChild(fn);
        const dl = el('button', 'tp-btn', T(tr('Download')) + ' ↓');
        onTap(dl, () => openExternal(location.origin + '/backups/' + encodeURIComponent(done.applied.auto)));
        ab.appendChild(dl); resBox.appendChild(ab);
        if (render.donePv !== done.seq) { render.donePv = done.seq; send('backup.preview|' + selFile); }
      }
    }
    shB.appendChild(im);
    shB.scrollTop = top;
    // At 1024×600 the restore part sits below the fold: bring it up once the preview is there.
    if (scrollTo && (pv || (st.op === 'preview' && st.err))) { scrollTo = false; im.scrollIntoView({ block: 'start' }); }
  }
  setInterval(() => render(false), 300);
  setInterval(() => { if (isOpen() && TabletTerminal.mode !== openMode) close(); }, 500);

  // --- Menu tile (setup) --------------------------------------------------------------------
  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16v13H4z"/><path d="M8 7V4h8v3M12 10v6M9 13l3 3 3-3"/></svg>';
  setInterval(() => {
    const m = document.getElementById('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const s = m.querySelector('.tui-tiles.tui-s'); if (!s || s.querySelector('[data-tile="tbk"]')) return;
    const t = el('button', 'tui-tile setup'); t.dataset.tile = 'tbk'; t.innerHTML = IC + '<span></span>';
    t.querySelector('span').textContent = T(tr('Back up and restore'));
    onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) tuiPress(x); open(); });
    s.appendChild(t);
  }, 300);
  return { open, get state() { return status(); }, get selection() { return [...sel]; } };
})();

// ===== Ready-to-steer light (feature/bedienung-1) =============================================
// A traffic light in the status bar, left of the steer chip: display only, from states the
// client already has; it never sends a command and the steering logic is untouched.
// Red = something steering needs is missing (no data, no RTK fix as the host reports it, steer
// module not heard, no line). Yellow = steering works but check first: no IMU heard, or with one
// antenna the direction not yet confirmed on the card "Does the vehicle face the way it drives?"
// (TabletSteerConfirm; driving forward can't be told from backing with one antenna, so only the
// confirmation counts). The module flags are the host's own (gpsOk / autoSteerOk / imuOk); RTK
// fix = NMEA fix quality 4, the host's default minimum (MinFixQuality, not sent to the client).
// Tap it for the list. In the demo mode (TabletDemo) it says "Demo" instead.
const TabletReady = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); fn(e); });
  const pill = el('button'); pill.id = 'tui-sb-ready'; pill.setAttribute('translate', 'no');
  pill.innerHTML = '<span class="rd-dot"></span><span class="rd-t"></span>';
  const pop = el('div'); pop.id = 'tui-ready'; pop.hidden = true; pop.setAttribute('translate', 'no');
  pop.addEventListener('pointerdown', e => e.stopPropagation());
  document.body.appendChild(pop);
  const sb = document.getElementById('statusbar'), steer = document.getElementById('tui-sb-steer');
  if (sb) sb.insertBefore(pill, steer && steer.parentNode === sb ? steer : document.getElementById('sb-fs'));
  onTap(pill, () => { pop.hidden = !pop.hidden; last = ''; render(); });
  let last = '';

  const live = () => connState === 'connected' && !!lastTick && performance.now() - lastTick.t < 2000;
  // [level, label, detail]: level 2 = ok, 1 = check, 0 = missing.
  function checks() {
    const s = statusBar || {}, op = tick && tick.op, gps = config && config.gps;
    if (!live()) return [[0, tr('Connection'), connState === 'connected' ? tr('No current data from the guidance computer.') : tr('No connection to the guidance computer.')]];
    const out = [];
    if (s.gpsSentence === 'SIM') out.push([1, tr('GPS'), tr('Simulator: not a real position')]);
    else if (s.gpsLost || !s.gpsOk) out.push([0, tr('GPS'), tr('No GPS data')]);
    else out.push([s.fixQuality === 4 ? 2 : 0, tr('GPS'), (s.fixText || '') + (s.fixQuality === 4 ? '' : ' – ' + T(tr('steering needs RTK Fix')))]);
    out.push([s.autoSteerOk ? 2 : 0, tr('Steer module'), s.autoSteerOk ? tr('connected') : tr('not heard')]);
    // An IMU module's hello (imuOk), or the steer module's IMU heading in PGN 253 (AiO boards).
    const sd = s.systemData, imu = !!s.imuOk || !!(sd && typeof sd.imuHeading === 'number' && Number.isFinite(sd.imuHeading));
    out.push([imu ? 2 : 1, tr('IMU'), imu ? tr('connected') : tr('not heard')]);
    out.push([op && scene && scene.hasField && op.autoSteerAvail ? 2 : 0, tr('Line'), op && op.autoSteerAvail ? tr('selected') : tr('No line')]);
    const dual = !!(gps && gps.isDualGps && !s.dualHeadingMissing);
    const conf = dual || (typeof TabletSteerConfirm !== 'undefined' && TabletSteerConfirm.confirmed);
    out.push([conf ? 2 : 1, tr('Direction'), dual ? tr('dual antenna') : conf ? tr('confirmed') : tr('not confirmed since the start')]);
    return out;
  }
  function render() {
    const demo = typeof TabletDemo !== 'undefined' && TabletDemo.active;
    const cs = checks(), lvl = Math.min(...cs.map(c => c[0]));
    const word = demo ? tr('Demo') : lvl === 2 ? tr('Ready') : lvl === 1 ? tr('Check') : tr('Not ready');
    const key = JSON.stringify([demo, cs, pop.hidden, I18n.language, T(word)]); // T(word): the dictionary may arrive after the language
    if (key === last) return;
    last = key;
    pill.dataset.lv = demo ? 'demo' : String(lvl);
    pill.querySelector('.rd-t').textContent = T(word);
    pill.title = T(tr('Ready to steer'));
    if (pop.hidden) return;
    pop.innerHTML = '';
    pop.appendChild(el('div', 'rd-h', T(tr('Ready to steer')) + ': ' + T(word)));
    if (demo) pop.appendChild(el('div', 'rd-n', T(tr('Demo: simulator only, no real outputs.'))));
    for (const [l, k, v] of cs) {
      const r = el('div', 'rd-r'); r.dataset.lv = String(l);
      r.append(el('span', 'rd-i', l === 2 ? '✓' : l === 1 ? '!' : '✗'), el('span', 'rd-k', T(k)), el('span', 'rd-v', T(v)));
      pop.appendChild(r);
    }
    pop.appendChild(el('div', 'rd-n', T(tr('Display only. Steering is switched on with the Steer button as before.'))));
  }
  setInterval(render, 300);
  return { checks, get level() { return Math.min(...checks().map(c => c[0])); } };
})();

// ===== Demo mode (feature/bedienung-1) ========================================================
// For showing the app: the existing simulator as the GPS source, with a striped "DEMO" band that
// can't be missed. It only starts while no module is heard (GPS, steer, machine): with a module
// on the network a simulated drive could switch real outputs (the host sends steer and section
// PGNs in the simulator too). If a module turns up while it runs, the demo ends with a warning
// to check steering and sections. Stops with "End demo"; the flag lives in this tab only.
// Ending never sends a command that switches steering or sections: the host only has toggles
// for them (autosteer.toggle, section.master, section.manual), and a toggle sent from a stale
// tick could switch them on. Explicit off commands would need a host change (docs/).
// demo:begin
const TabletDemo = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); fn(e); });
  const KEY = 'aow.demo';
  let active = false, simBefore = false; // simBefore: the simulator was already on; ending leaves it on
  try { const v = sessionStorage.getItem(KEY); active = !!v; simBefore = v === 'sim'; } catch (_) { /* blocked storage: off */ }
  const band = el('div'); band.id = 'tui-demo'; band.hidden = true; band.setAttribute('translate', 'no');
  band.addEventListener('pointerdown', e => e.stopPropagation());
  const bt = el('span', 'dm-t'), stop = el('button', 'tp-btn');
  band.append(bt, stop);
  document.body.appendChild(band);
  onTap(stop, () => end(''));
  const save = () => { try { if (active) sessionStorage.setItem(KEY, simBefore ? 'sim' : '1'); else sessionStorage.removeItem(KEY); } catch (_) { /* ignore */ } };
  // Real GPS = data that isn't the simulator's (as TabletSimGuard); steer and machine modules by the host's flags.
  const modules = () => { const s = statusBar || {}; return !!((s.gpsOk && s.gpsSentence && s.gpsSentence !== 'SIM') || s.autoSteerOk || s.machineOk); };
  function start() {
    if (connState !== 'connected' || !statusBar) { showToast(T(tr('No connection to the guidance computer.'))); return; }
    if (!iHoldControl) { showToast(T(tr('Only the device that has control can start the demo.'))); return; }
    if (modules()) { showToast(T(tr('A module is connected: the demo only runs without modules, so nothing real is switched.'))); return; }
    active = true; simBefore = !!statusBar.simEnabled; save();
    if (!statusBar.simEnabled) transport.send('sim.toggleEnable');
    if (!statusBar.simPanelVisible) transport.send('sim.togglePanel');
    render();
  }
  function end(why) {
    if (!active) return;
    if (statusBar && statusBar.simEnabled && !simBefore) transport.send('sim.toggleEnable');
    active = false; save();
    if (why) showToast(T(why), 15000);
    render();
  }
  function render() {
    // A module heard while the demo runs: end at once and tell the operator to check.
    if (active && connState === 'connected' && modules()) end(tr('Demo ended – kit detected. Check steering and sections.'));
    if (band.hidden === active) band.hidden = !active;
    document.documentElement.toggleAttribute('data-tui-demo', active);
    if (!active) return;
    bt.textContent = T(tr('DEMO – simulator only, no real outputs'));
    stop.textContent = T(tr('End demo'));
  }
  setInterval(render, 250);

  // --- Menu tile (setup) --------------------------------------------------------------------
  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M10 8l4 2-4 2z" fill="currentColor"/><path d="M8 20h8M12 16v4"/></svg>';
  setInterval(() => {
    const m = document.getElementById('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const s = m.querySelector('.tui-tiles.tui-s'); if (!s) return;
    let t = s.querySelector('[data-tile="demo"]');
    if (!t) {
      t = el('button', 'tui-tile setup'); t.dataset.tile = 'demo'; t.innerHTML = IC + '<span></span>';
      onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) tuiPress(x); if (active) end(''); else start(); });
      s.appendChild(t);
    }
    const lbl = T(active ? tr('End demo') : tr('Demo mode'));
    if (t.querySelector('span').textContent !== lbl) t.querySelector('span').textContent = lbl;
  }, 300);
  return { start, end, get active() { return active; } };
})();
// demo:end

// ===== Long press = explanation (feature/bedienung-2) =========================================
// Holding one of the main buttons or tiles for LONG_MS shows a short explanation instead of
// acting. A short press acts as before, only on release: the press is held back (capture phase)
// and given to the button when the finger lifts, so a long press never switches anything.
// Texts describe what the button does today (from the help and the buttons' own titles).
// Not here, on purpose: buttons that switch steering, sections, U-turn, the headland (hydraulic
// lift), the track or the demo (it switches the simulator). They act at once on touch, as before;
// their explanation is in the help ("Buttons that act at once").
// explain:begin
const TabletExplain = (() => {
  const T = k => I18n.text(k);
  const LONG_MS = 600, MOVE_PX = 12;
  const TEXT = [
    ['#bn-tracks', tr('Tracks: manage the AB lines and curves of this field.')],
    ['#bn-quickab', tr('Quick AB line: makes a track quickly, e.g. "A+" through your position in the direction you drive.')],
    ['#bn-abmenu', tr('AB line options: more ways to make and edit tracks.')],
    ['#bn-delcontours', tr('Deletes the recorded contour paths.')],
    ['#bn-nudge', tr('Shows how far the track is moved sideways. Tap to set it back to 0.')],
    ['#bn-skipcycle', tr('U-turn skip rows: tap to choose how many rows (0–9) each U-turn skips.')],
    ['#bn-skiptoggle', tr('U-turn skip mode: normal, alternative, or skip worked tracks.')],
    ['#bn-flags', tr('Flags: set a marker at your position or on the map, and see the list.')],
    ['#bn-tram', tr('Tram lines: changes how the tram lines are shown.')],
    ['#tui-menu-btn', tr('Menu: fields and jobs, field tools, help and setup.')],
    ['#tui-sb-steer', tr('Steering status: on, off, no line, or a fault such as "Not steering".')],
    ['#tui-sb-ready', tr('Ready to steer: green = all set, yellow = check first, red = something steering needs is missing. Tap for the list.')],
    ['#sb-fixbtn', tr('GPS: the fix quality. Solid frame = RTK Fix, dashed = RTK Float, dotted = DGPS/GPS. Tap for details.')],
    ['#sb-modbtn', tr('Modules: whether the steer, machine and GPS modules are heard. Tap for details.')],
    ['#sb-fs', tr('Fullscreen on or off.')],
    ['[data-tile="ln-fieldops"]', tr('Fields and Jobs: open, create or import a field, and start or resume a job.')],
    ['[data-tile="ln-fieldtools"]', tr('Field Tools: boundary, headland, flags and other tools for the open field.')],
    ['[data-tile="pages"]', tr('Work pages: choose which displays each page shows.')],
    ['[data-tile="quick"]', tr('Quick bar: choose the buttons in the quick bar.')],
    ['[data-tile="ln-vehicle"]', tr('Vehicle & Tool: profiles and dimensions of the vehicle and the tool.')],
    ['[data-tile="ln-autosteer"]', tr('AutoSteer: settings of the steering and the steer module.')],
    ['[data-tile="ln-network"]', tr('Network & GPS: modules, GPS receiver and NTRIP.')],
    ['[data-tile="ln-tools"]', tr('Tools & Wizards: setup assistants and calibration.')],
    ['[data-tile="ln-screenalerts"]', tr('Screen & Alerts: display and alarm settings.')],
    ['[data-tile="ln-filemenu"]', tr('App & Files: app settings, folders and files.')],
    ['[data-tile="language"]', tr('Language of the app.')],
    ['[data-tile="tb-help"]', tr('Help: short guides for the main tasks.')],
    ['[data-tile="tb-info"]', tr('Info: version, licence and source of this app.')],
    ['[data-tile="tb-diag"]', tr('Diagnosis for support: a file with the state of this system to send to support.')],
    ['[data-tile="tbk"]', tr('Back up and restore: one file with vehicles, tools, fields and NTRIP profiles.')],
    ['[data-tile="eama"]', tr('Fields from eAMA: import field boundaries from an eAMA Shapefile export.')],
    ['[data-tile="work"]', tr('Start work: step by step to field, track, direction and the ready light.')],
    ['[data-tile="worklog"]', tr('Work log: one entry per working session with time, area from the guidance computer, tool and your notes.')],
    ['[data-tile="setup1"]', tr('First setup: language, vehicle, tool, NTRIP, kit check and the direction trap.')],
  ];
  const SEL = TEXT.map(t => t[0]).join(',');
  const textFor = node => { for (const [s, t] of TEXT) if (node.matches(s)) return t; return null; };
  const pop = document.createElement('div'); pop.id = 'tui-explain'; pop.hidden = true; pop.setAttribute('translate', 'no');
  document.body.appendChild(pop);
  let press = null, swallowClick = false, hideAt = 0;

  function show(node, text) {
    pop.textContent = T(text);
    pop.hidden = false;
    const r = node.getBoundingClientRect(), w = Math.min(360, window.innerWidth - 20);
    pop.style.maxWidth = w + 'px';
    const ph = pop.offsetHeight, pw = pop.offsetWidth;
    let x = Math.min(Math.max(10, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 10);
    let y = r.bottom + 8; if (y + ph > window.innerHeight - 10) y = Math.max(10, r.top - ph - 8);
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
    hideAt = performance.now() + 8000;
  }
  setInterval(() => { if (!pop.hidden && performance.now() > hideAt) pop.hidden = true; }, 500);

  window.addEventListener('pointerdown', e => {
    if (e.__aowReplay || !e.isTrusted) return; // code that presses a button for the operator acts at once
    if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true;
    const node = e.target instanceof Element ? e.target.closest(SEL) : null;
    if (!node || node.disabled) return;
    e.stopImmediatePropagation();
    const init = { bubbles: true, cancelable: true, composed: true, clientX: e.clientX, clientY: e.clientY,
      pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary, button: e.button, buttons: e.buttons };
    press = { node, x: e.clientX, y: e.clientY, init, timer: setTimeout(() => {
      const t = textFor(node); press = null; swallowClick = true; if (t) show(node, t);
    }, LONG_MS) };
  }, true);
  const release = (e, act) => {
    if (!press) return;
    clearTimeout(press.timer);
    const p = press; press = null;
    if (!act) return;
    const ev = new PointerEvent('pointerdown', tuiPressInit(p.init)); ev.__aowReplay = true; // own pointerId (#465 filter)
    p.node.dispatchEvent(ev);
  };
  window.addEventListener('pointerup', e => { if (swallowClick) setTimeout(() => { swallowClick = false; }, 400); release(e, true); }, true);
  window.addEventListener('pointercancel', e => release(e, false), true);
  window.addEventListener('pointermove', e => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_PX) release(e, false); }, true);
  window.addEventListener('click', e => { if (swallowClick) { swallowClick = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  window.addEventListener('contextmenu', e => { if (e.target instanceof Element && e.target.closest(SEL)) e.preventDefault(); }, true);
  return { show };
})();
// explain:end

// ===== Start work (feature/bedienung-2) =======================================================
// One button that walks through: field → track → direction → ready light, then the drive view.
// Each step only opens what exists (Fields and Jobs, the track manager, the direction card's
// own two answers) and moves on by itself when the state is there. It finishes only on a green
// ready light and never switches steering on: that stays the operator's Steer button.
const TabletWork = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const sheet = el('div', 'tui-sheet tb-sheet tbk-sheet'); sheet.id = 'tui-work'; sheet.setAttribute('translate', 'no');
  sheet.innerHTML = '<div class="tui-sh-hdr"><span class="t"></span><button class="x">✕</button></div><div class="tui-sh-body"></div>';
  const scrim = el('div', 'tp-scrim');
  const mini = el('div'); mini.id = 'tui-work-mini'; mini.hidden = true; mini.setAttribute('translate', 'no');
  document.body.append(scrim, sheet, mini);
  for (const n of [sheet, scrim, mini]) n.addEventListener('pointerdown', e => e.stopPropagation());
  const shT = sheet.querySelector('.t'), shB = sheet.querySelector('.tui-sh-body');
  let running = false, last = '';
  const isOpen = () => sheet.classList.contains('open');
  const openSheet = () => { if (typeof lnCloseAll === 'function') lnCloseAll(); sheet.classList.add('open'); scrim.classList.add('open'); last = ''; render(); };
  const park = () => { sheet.classList.remove('open'); scrim.classList.remove('open'); last = ''; render(); }; // keep going in the mini bar
  const stop = () => { running = false; park(); };
  onTap(sheet.querySelector('.x'), stop); onTap(scrim, park);
  function start() { running = true; openSheet(); }

  const dual = () => { const g = config && config.gps; return !!(g && g.isDualGps && statusBar && !statusBar.dualHeadingMissing); };
  const steps = () => {
    const op = tick && tick.op, field = !!(scene && scene.hasField);
    return [
      { k: 'field', t: tr('Field'), done: field, v: field ? (fieldOps && fieldOps.activeField) || '' : tr('No field') },
      { k: 'track', t: tr('Track'), done: field && !!(op && op.autoSteerAvail), v: op && op.autoSteerAvail ? (tick.lineLabel || tr('selected')) : tr('No line') },
      { k: 'dir', t: tr('Direction'), done: dual() || (typeof TabletSteerConfirm !== 'undefined' && TabletSteerConfirm.confirmed),
        v: dual() ? tr('dual antenna') : (TabletSteerConfirm && TabletSteerConfirm.confirmed) ? tr('confirmed') : tr('not confirmed since the start') },
      { k: 'ready', t: tr('Ready to steer'), done: TabletReady.level === 2, v: TabletReady.level === 2 ? tr('Ready') : TabletReady.level === 1 ? tr('Check') : tr('Not ready') },
    ];
  };
  function actions(step) {
    const box = el('div', 'tb-row');
    const btn = (label, fn, pri) => { const b = el('button', 'tp-btn' + (pri ? ' pri big' : ''), T(label)); onTap(b, fn); box.appendChild(b); return b; };
    if (step.k === 'field') {
      btn(tr('Fields and Jobs'), () => { park(); openFieldsAndJobs(); }, true);
    } else if (step.k === 'track') {
      btn(tr('Tracks'), () => { park(); openTracksManager(); }, true);
      btn(tr('Quick AB line'), () => { park(); const q = document.getElementById('bn-quickab'); if (q) tuiPress(q); });
    } else if (step.k === 'dir') {
      btn(tr('Yes'), () => { TabletSteerConfirm.confirm(); render(); }, true);
      btn(tr('No – learn the direction again'), () => {
        if (!iHoldControl) { showToast(T(tr('Take control to reset the direction'))); return; }
        transport.send('heading.resetDirection'); showToast(T(tr('Direction reset. Drive forward above 1.5 kph.')));
      });
    } else if (step.k === 'ready') {
      btn(tr('Show the list'), () => { park(); const r = document.getElementById('tui-sb-ready'); if (r) tuiPress(r); }, true);
    }
    return box;
  }
  const HELP = {
    field: tr('Open the field you work, or create one: Fields and Jobs.'),
    track: tr('Choose the track to drive, or make one (e.g. "A+" through your position).'),
    dir: tr('Does the vehicle face the way it drives? With one antenna the direction is learned from the first travel; backing first, it is learned the wrong way round.'),
    ready: tr('The ready light must be green. Tap it for what is still missing.'),
  };
  function render() {
    const ss = steps(), cur = ss.findIndex(s => !s.done), allDone = cur < 0;
    const key = JSON.stringify([running, isOpen(), ss.map(s => [s.done, s.v]), I18n.language, iHoldControl]);
    if (key === last) return;
    last = key;
    // Mini bar: the wizard keeps going while another panel is open.
    const showMini = running && !isOpen();
    if (mini.hidden === showMini) mini.hidden = !showMini;
    if (showMini) {
      mini.innerHTML = '';
      const s = allDone ? null : ss[cur];
      mini.appendChild(el('span', 'wm-t', T(tr('Start work')) + ' · ' + (allDone ? T(tr('Ready')) : (cur + 1) + '/4 ' + T(s.t))));
      const b = el('button', 'tp-btn pri', T(allDone ? tr('Finish') : tr('Back to the steps'))); onTap(b, () => allDone ? finish() : openSheet()); mini.appendChild(b);
      const x = el('button', 'tp-btn', '✕'); onTap(x, stop); mini.appendChild(x);
    }
    if (!isOpen()) return;
    shT.textContent = T(tr('Start work'));
    shB.innerHTML = '';
    const box = el('div', 'tb-box');
    ss.forEach((s, i) => {
      const r = el('div', 'tw-step' + (s.done ? ' done' : i === cur ? ' cur' : ''));
      r.append(el('span', 'tw-n', s.done ? '✓' : String(i + 1)), el('span', 'tw-t', T(s.t)), el('span', 'tw-v', T(s.v)));
      box.appendChild(r);
      if (i === cur) { box.appendChild(el('div', 'tp-note', T(HELP[s.k]))); box.appendChild(actions(s)); }
    });
    if (allDone) {
      box.appendChild(el('div', 'tp-note', T(tr('All set. Switch steering on yourself with the Steer button when you drive.'))));
      const b = el('button', 'tp-btn pri big', T(tr('To the drive view'))); onTap(b, finish); box.appendChild(b);
    }
    if (!iHoldControl) box.appendChild(el('div', 'tp-note warn', T(tr('View only: another screen has control'))));
    shB.appendChild(box);
  }
  function finish() {
    if (TabletReady.level !== 2) { last = ''; openSheet(); return; } // never past a light that isn't green
    running = false; park();
    if (typeof lnCloseAll === 'function') lnCloseAll();
    if (TabletTerminal.mode !== 'drive') TabletTerminal.setMode('drive');
  }
  setInterval(render, 400);

  // --- Menu tile (in the field) ---------------------------------------------------------------
  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v16l13-8z"/></svg>';
  setInterval(() => {
    const m = document.getElementById('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const f = m.querySelector('.tui-tiles.tui-f'); if (!f || f.querySelector('[data-tile="work"]')) return;
    const t = el('button', 'tui-tile field'); t.dataset.tile = 'work'; t.innerHTML = IC + '<span></span>';
    t.querySelector('span').textContent = T(tr('Start work'));
    onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) tuiPress(x); start(); });
    f.insertBefore(t, f.firstChild);
  }, 300);
  return { start };
})();

// ===== First setup (feature/bedienung-2) ======================================================
// A guide through the first setup: language, vehicle, tool and working width (the existing
// profile cards and their wizard, TabletProfiles), NTRIP (Network & GPS), a live kit check
// (modules, GPS, IMU as the ready light sees them; the bench checklist for more) and the
// direction trap. It enters no values itself: everything is typed in the existing dialogs, an
// empty field stays empty. Shown by itself once, while no vehicle profile exists (on the device
// that has control), skippable at every step, and again any time from the menu ("First setup").
const TabletFirstSetup = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const KEY = 'aow.firstSetup';
  const lsOk = () => { try { return localStorage.getItem(KEY); } catch (_) { return 'blocked'; } };
  const mark = v => { try { localStorage.setItem(KEY, v); } catch (_) { /* ignore */ } };
  const sheet = el('div', 'tui-sheet tb-sheet tbk-sheet'); sheet.id = 'tui-setup1'; sheet.setAttribute('translate', 'no');
  sheet.innerHTML = '<div class="tui-sh-hdr"><span class="t"></span><button class="x">✕</button></div><div class="tui-sh-body"></div>';
  const scrim = el('div', 'tp-scrim');
  document.body.append(scrim, sheet);
  for (const n of [sheet, scrim]) n.addEventListener('pointerdown', e => e.stopPropagation());
  const shT = sheet.querySelector('.t'), shB = sheet.querySelector('.tui-sh-body');
  let step = 0, last = '';
  const isOpen = () => sheet.classList.contains('open');
  const hide = () => { sheet.classList.remove('open'); scrim.classList.remove('open'); };
  const close = () => { hide(); mark('done'); };
  onTap(sheet.querySelector('.x'), close); onTap(scrim, close);
  function open(at) {
    if (typeof lnCloseAll === 'function') lnCloseAll();
    if (typeof at === 'number') step = at;
    sheet.classList.add('open'); scrim.classList.add('open'); last = ''; render();
  }
  // Open an existing panel; the guide waits in the background and comes back with "Back to setup".
  const goPanel = id => { hide(); TabletTerminal.setMode('setup'); const b = document.getElementById(id); if (b) tuiPress(b); showBack(); };
  const back = el('button', 'tp-btn pri'); back.id = 'tui-setup1-back'; back.hidden = true; document.body.appendChild(back);
  back.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); back.hidden = true; open(); });
  function showBack() { back.textContent = '↩ ' + T(tr('Back to first setup')); back.hidden = false; }

  const STEPS = [
    { k: 'lang', t: tr('Language') },
    { k: 'vehicle', t: tr('Vehicle profile') },
    { k: 'tool', t: tr('Tool and working width') },
    { k: 'ntrip', t: tr('NTRIP') },
    { k: 'kit', t: tr('Check the kit') },
    { k: 'dir', t: tr('The direction trap') },
  ];
  const lv = l => l === 2 ? '✓' : l === 1 ? '!' : '✗';
  function body(s, box) {
    const note = t => box.appendChild(el('div', 'tp-note', T(t)));
    const row = el('div', 'tb-row'), btn = (label, fn, pri) => { const b = el('button', 'tp-btn' + (pri ? ' pri' : ''), T(label)); onTap(b, fn); row.appendChild(b); return b; };
    if (s.k === 'lang') {
      const cur = appInfo ? appInfo.currentLanguage : '';
      for (const l of (appInfo ? appInfo.languages : [])) {
        const b = el('button', 'tp-btn' + (l.code === cur ? ' pri' : ''), l.name);
        onTap(b, () => transport.send('app.setLanguage|' + l.code)); row.appendChild(b);
      }
    } else if (s.k === 'vehicle') {
      note(tr('Choose or create the profile of your tractor. The profile wizard asks for the dimensions; measure them, nothing is filled in for you.'));
      const v = config && config.vehicle;
      if (v) note(T(tr('Wheelbase')) + ': ' + (v.wheelbase > 0 ? fmtUnit(v.wheelbase, 'm') : '—'));
      btn(tr('Vehicle & Tool'), () => { hide(); TabletProfiles.open(); showBack(); }, true);
    } else if (s.k === 'tool') {
      note(tr('Choose or create the profile of your tool. The working width comes from its sections.'));
      const tw = typeof sectionsWidthM === 'function' ? sectionsWidthM() : 0;
      note(T(tr('Working width')) + ': ' + (tw > 0 ? fmtUnit(tw, 'm') : '—'));
      btn(tr('Vehicle & Tool'), () => { hide(); TabletProfiles.open(); showBack(); }, true);
    } else if (s.k === 'ntrip') {
      note(tr('For RTK corrections over the internet: an NTRIP profile with caster, port, mount point, user and password from your provider (e.g. APOS).'));
      const sb = statusBar || {};
      note(T(tr('NTRIP')) + ': ' + (sb.ntripConnected ? T(tr('connected')) : sb.ntripStatus ? T(sb.ntripStatus) : '—'));
      btn(tr('Network & GPS'), () => goPanel('ln-network'), true);
    } else if (s.k === 'kit') {
      note(tr('Power on the kit and connect it. The list follows live.'));
      const list = el('div', 'fs1-list');
      const KIT = [tr('Connection'), tr('GPS'), tr('Steer module'), tr('IMU')]; // line and direction belong to the work, not the kit
      for (const [l, k, v] of TabletReady.checks().filter(c => KIT.includes(c[1]))) {
        const r = el('div', 'fs1-r'); r.dataset.lv = String(l);
        r.append(el('span', 'fs1-i', lv(l)), el('span', 'fs1-k', T(k)), el('span', 'fs1-v', T(v)));
        list.appendChild(r);
      }
      box.appendChild(list);
      btn(tr('Network & GPS'), () => goPanel('ln-network'));
      if (typeof TabletBench !== 'undefined') btn(tr('Bench checklist'), () => { hide(); TabletBench.open(); showBack(); });
    } else if (s.k === 'dir') {
      for (const t of [
        tr('With one antenna the system learns which way the vehicle faces from the first travel.'),
        tr('If you back up first (e.g. out of the shed), it learns the direction the wrong way round: the steering then runs for the wrong direction.'),
        tr('After every start, drive forward first or confirm the direction on the card ("Does the vehicle face the way it drives?").'),
        tr('The ready light stays yellow until the direction is confirmed.'),
      ]) note(t);
    }
    if (row.children.length) box.appendChild(row);
  }
  function render() {
    if (!isOpen()) return;
    const s = STEPS[step];
    const key = JSON.stringify([step, I18n.language, appInfo && appInfo.currentLanguage, s.k === 'kit' ? TabletReady.checks() : 0,
      s.k === 'ntrip' ? [statusBar && statusBar.ntripConnected, statusBar && statusBar.ntripStatus] : 0, s.k === 'tool' && typeof sectionsWidthM === 'function' ? sectionsWidthM() : 0,
      s.k === 'vehicle' && config && config.vehicle ? config.vehicle.wheelbase : 0]);
    if (key === last) return;
    last = key;
    shT.textContent = T(tr('First setup')) + ' · ' + (step + 1) + '/' + STEPS.length;
    shB.innerHTML = '';
    const box = el('div', 'tb-box');
    box.appendChild(el('div', 'tb-lbl', T(s.t)));
    body(s, box);
    const nav = el('div', 'tb-row');
    const prev = el('button', 'tp-btn', '← ' + T(tr('Back'))); prev.disabled = step === 0; onTap(prev, () => { step--; last = ''; render(); });
    const next = el('button', 'tp-btn pri big', step === STEPS.length - 1 ? T(tr('Finish')) : T(tr('Next')) + ' →');
    onTap(next, () => { if (step === STEPS.length - 1) { close(); return; } step++; last = ''; render(); });
    const skip = el('button', 'tp-btn quiet', T(tr('Skip setup'))); onTap(skip, close);
    nav.append(prev, next, skip);
    box.appendChild(nav);
    box.appendChild(el('div', 'tp-note', T(tr('You can open the first setup again any time: Menu → First setup.'))));
    shB.appendChild(box);
  }
  setInterval(render, 500);
  // First start on this device: once, on the device that has control, not during a demo.
  const auto = setInterval(() => {
    if (lsOk() || navigator.webdriver) { clearInterval(auto); return; } // not in automated browsers (CI layout check)
    // Only while no vehicle profile exists yet (the profile list the client already has).
    if (profiles && profiles.vehicles && profiles.vehicles.length) { clearInterval(auto); return; }
    let legal = true; try { legal = TabletLegal.done; } catch (_) { legal = false; } // the notice at first start comes first
    if (legal && connState === 'connected' && iHoldControl && appInfo && config && profiles && !(typeof TabletDemo !== 'undefined' && TabletDemo.active)) {
      clearInterval(auto); mark('shown'); open(0);
    }
  }, 1000);

  // --- Menu tile (setup) ----------------------------------------------------------------------
  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16M6 16l9-9 3 3-9 9H6z"/><path d="M13 9l3 3"/></svg>';
  setInterval(() => {
    const m = document.getElementById('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const sBox = m.querySelector('.tui-tiles.tui-s'); if (!sBox || sBox.querySelector('[data-tile="setup1"]')) return;
    const t = el('button', 'tui-tile setup'); t.dataset.tile = 'setup1'; t.innerHTML = IC + '<span></span>';
    t.querySelector('span').textContent = T(tr('First setup'));
    onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) tuiPress(x); open(0); });
    sBox.insertBefore(t, sBox.firstChild);
  }, 300);
  return { open };
})();

// ===== Update check (feature/auslieferung) ====================================================
// Asks GitHub for the releases of this fork (BRAND.source) and says whether a newer one exists:
// a hint with a link, nothing is downloaded or installed. Runs from the browser (GitHub's API
// allows any origin), so the host is not involved; it needs internet on this device. "Newer" is
// only claimed when this build's commit (appInfo.gitHash) is itself one of the releases and a
// later one exists; otherwise the newest release is shown without comparing. On demand (Info) or
// at start, if switched on for this device.
// update:begin
const TabletUpdate = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const KEY = 'aow.update.onStart';
  const api = () => BRAND.source.replace('https://github.com/', 'https://api.github.com/repos/') + '/releases?per_page=30';
  let state = { busy: false, res: null };
  const onStart = () => { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } };

  // releases (GitHub JSON) + this build's hash → { kind: 'newer'|'current'|'unknown', latest, mine }
  function compare(releases, hash) {
    const list = (releases || []).filter(r => r && !r.draft && r.published_at)
      .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
    if (!list.length) return { kind: 'none' };
    const h = String(hash || '').replace(/-dirty$/, '').toLowerCase();
    const mine = h.length >= 7 ? list.find(r => String(r.target_commitish || '').toLowerCase().startsWith(h)) : null;
    const latest = list[0];
    if (!mine) return { kind: 'unknown', latest };
    return { kind: mine === latest ? 'current' : 'newer', latest, mine };
  }
  async function check() {
    state = { busy: true, res: null }; refresh();
    try {
      const r = await fetch(api(), { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      state = { busy: false, res: compare(await r.json(), appInfo && appInfo.gitHash) };
    } catch (e) { state = { busy: false, res: { kind: 'error', why: String(e && e.message || e) } }; }
    refresh();
    return state.res;
  }
  let host = null;
  function refresh() { if (host && host.isConnected) fill(host); }
  const day = s => { try { return new Date(s).toLocaleDateString(I18n.language || undefined); } catch (_) { return s; } };
  function fill(b) {
    b.innerHTML = '';
    b.appendChild(el('div', 'tb-lbl', T(tr('Updates'))));
    const r = state.res;
    if (state.busy) b.appendChild(el('div', 'tp-note', T(tr('Checking GitHub…'))));
    else if (r && r.kind === 'error') b.appendChild(el('div', 'tp-note warn', tr('No answer from GitHub ({f}). Internet on this device?', { f: r.why })));
    else if (r && r.kind === 'none') b.appendChild(el('div', 'tp-note', T(tr('No release published yet.'))));
    else if (r) {
      const L = r.latest, name = L.name || L.tag_name;
      const txt = r.kind === 'newer' ? tr('A newer version is available: {n} ({d}).', { n: name, d: day(L.published_at) })
        : r.kind === 'current' ? tr('This is the newest version ({n}).', { n: name })
          : tr('Newest published version: {n} ({d}). This build is not one of the published ones, so it is not compared.', { n: name, d: day(L.published_at) });
      b.appendChild(el('div', 'tp-note' + (r.kind === 'newer' ? ' warn' : ''), txt));
      if (r.kind !== 'current') {
        const a = el('button', 'tp-btn', T(tr('Open the release page')) + ' ↗'); onTap(a, () => openExternal(L.html_url)); b.appendChild(a);
      }
      b.appendChild(el('div', 'tp-note', T(tr('Installing stays with you: download and install the new version yourself.'))));
    }
    const row = el('div', 'tb-row');
    const go = el('button', 'tp-btn pri', T(tr('Check for updates'))); go.disabled = state.busy; onTap(go, check); row.appendChild(go);
    const tg = el('button', 'tp-btn' + (onStart() ? ' pri' : ''), (onStart() ? '✓ ' : '') + T(tr('Check at start')));
    onTap(tg, () => { try { localStorage.setItem(KEY, onStart() ? '0' : '1'); } catch (_) { /* ignore */ } refresh(); });
    row.appendChild(tg);
    b.appendChild(row);
  }
  function box() { host = el('div', 'tb-box'); fill(host); return host; }
  // At start (opt-in): once appInfo is there; only a newer version is announced.
  const auto = setInterval(() => {
    if (!onStart()) { clearInterval(auto); return; }
    if (!appInfo) return;
    clearInterval(auto);
    check().then(r => { if (r && r.kind === 'newer') showToast(T(tr('A newer version is available: {n} ({d}).', { n: r.latest.name || r.latest.tag_name, d: day(r.latest.published_at) })) + ' ' + T(tr('Setup → Info')), 8000); });
  }, 1000);
  return { check, box, compare };
})();
// update:end

// ===== Notice at first start (feature/auslieferung) ===========================================
// The liability notice from docs/Rechtliches-Entwurf.md (section A, a DRAFT, not legally checked),
// shown once per device and text version until "Read and understood". Stored only in this
// browser. It switches nothing; the first setup waits for it.
const TabletLegal = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const KEY = 'aow.legal', VERSION = '2026-10-draft2'; // a changed text is shown and confirmed again
  const TEXT = [
    tr('This app is a steering aid. It does not replace the driver.'),
    tr('You stay responsible for the vehicle, the tool and your surroundings at all times. Stay at the wheel and step in when something is wrong.'),
    tr('The app comes without any warranty. It can have faults; GPS, correction data, modules and settings can give wrong values.'),
    tr('Do not use on public roads. Switch steering off as soon as people are in the driving area.'),
    tr('Before the first use, check everything calmly: dimensions, steering direction, switching the steering off. This version is a test version.'),
    tr('The app is licensed under the Apache License 2.0. It is a changed version of AgOpenWeb; the source code is open.'),
  ];
  const acked = () => { try { return localStorage.getItem(KEY) === VERSION; } catch (_) { return false; } };
  const scrim = el('div', 'tp-scrim'), box = el('div'); box.id = 'tui-legal'; box.setAttribute('translate', 'no'); box.hidden = true;
  document.body.append(scrim, box);
  for (const n of [scrim, box]) n.addEventListener('pointerdown', e => e.stopPropagation());
  function show() {
    box.innerHTML = '';
    box.appendChild(el('div', 'lg-n', BRAND.name)); // product name, never translated (box is translate=no)
    box.appendChild(el('div', 'lg-t', T(tr('Please read before use'))));
    const ol = el('ol', 'lg-l'); for (const t of TEXT) ol.appendChild(el('li', '', T(t))); box.appendChild(ol);
    const ok = el('button', 'tp-btn pri big', T(tr('Read and understood')));
    ok.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      try { localStorage.setItem(KEY, VERSION); } catch (_) { /* blocked storage: shown again next time */ }
      box.hidden = true; scrim.classList.remove('open'); done = true;
    });
    box.appendChild(ok);
    box.hidden = false; scrim.classList.add('open');
  }
  // Automated browsers (CI's layout check, tests) get no notice: it would cover what they measure.
  let done = acked() || !!navigator.webdriver;
  const t = setInterval(() => {
    if (done) { clearInterval(t); return; }
    if (typeof I18n !== 'undefined' && appInfo) { clearInterval(t); show(); }
  }, 500);
  return { get done() { return done || acked(); }, show };
})();

// ===== Work log (feature/arbeitsdoku) =========================================================
// One entry per working session: from the moment this device (holding control) sees a job open
// on a field until the job closes, the field changes or the connection is gone. The numbers are
// the host's: worked area of the job (Status.workedAreaSqM), ground covered once
// (fieldData.actualAreaSqM), trip distance (fieldData.tripDistanceM), each at the start and at
// the end of the session; the session's own share is the difference. Times are this tablet's
// clock. Activity, product, amount and note are free text the operator types. Stored only in
// this browser (localStorage); docs/Arbeitsdoku.md says what a store on the guidance computer
// would need. The pure part (step, csv, sums) is tested by Tests/web/worklog.test.mjs.
// worklog:begin
const WorkLogCore = (() => {
  const GAP_MS = 5 * 60 * 1000; // a reload or a short drop within this continues the session
  const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
  // state: { entries: [...], open: entry|null }; s: snapshot of what the client sees; now: ms.
  function step(state, s, now) {
    const st = { entries: state.entries, open: state.open };
    const active = !!(s && s.live && s.control && s.field && s.job);
    const o = st.open;
    if (o && (!active || o.field !== s.field || o.job !== s.job || now - o.seenAt > GAP_MS)) {
      st.entries = st.entries.concat([{ ...o, open: false }]); st.open = null;
    }
    if (!active) return st;
    const vals = { worked: num(s.worked), actual: num(s.actual), trip: num(s.trip) };
    if (!st.open) {
      st.open = { id: 'w' + now.toString(36) + Math.random().toString(36).slice(2, 6), field: s.field, job: s.job,
        workType: s.workType || '', start: now, end: now, seenAt: now,
        workedStart: vals.worked, workedEnd: vals.worked, actualStart: vals.actual, actualEnd: vals.actual,
        tripStart: vals.trip, tripEnd: vals.trip, tool: s.tool || '', vehicle: s.vehicle || '', widthM: num(s.widthM),
        activity: '', product: '', amount: '', note: '', open: true };
      return st;
    }
    const e = { ...st.open, end: now, seenAt: now };
    if (vals.worked != null) { if (e.workedStart == null) e.workedStart = vals.worked; e.workedEnd = vals.worked; }
    if (vals.actual != null) { if (e.actualStart == null) e.actualStart = vals.actual; e.actualEnd = vals.actual; }
    if (vals.trip != null) { if (e.tripStart == null) e.tripStart = vals.trip; e.tripEnd = vals.trip; }
    if (num(s.widthM) != null) e.widthM = s.widthM;
    if (s.tool) e.tool = s.tool;
    if (s.vehicle) e.vehicle = s.vehicle;
    if (s.workType) e.workType = s.workType;
    st.open = e;
    return st;
  }
  // Session share of a host counter; null when it went down during the session (area deleted,
  // trip reset): then only the host's job totals are shown, nothing is made up.
  const delta = (a, b) => a == null || b == null || b < a ? null : b - a;
  const sessionArea = e => delta(e.workedStart, e.workedEnd);
  const overlap = e => e.workedEnd != null && e.actualEnd != null && e.workedEnd >= e.actualEnd ? e.workedEnd - e.actualEnd : null;
  const season = e => new Date(e.start).getFullYear();
  function sums(entries) {
    const out = new Map();
    for (const e of entries) {
      const k = e.field + '\u0000' + season(e);
      const r = out.get(k) || { field: e.field, season: season(e), count: 0, ms: 0, areaSqM: 0, areaMissing: 0 };
      r.count++; r.ms += Math.max(0, e.end - e.start);
      const a = sessionArea(e); if (a == null) r.areaMissing++; else r.areaSqM += a;
      out.set(k, r);
    }
    return [...out.values()].sort((a, b) => a.field.localeCompare(b.field) || b.season - a.season);
  }
  // CSV for Excel: ";" between fields, German decimal comma, UTF-8 with BOM, CRLF. Areas in ha
  // with 2 decimals and distance in m without decimals, as the app shows them.
  const p2 = n => String(n).padStart(2, '0');
  const dDate = ms => { const d = new Date(ms); return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear(); };
  const dTime = ms => { const d = new Date(ms); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const dur = ms => { const m = Math.round(Math.max(0, ms) / 60000); return Math.floor(m / 60) + ':' + p2(m % 60); };
  const ha = m2 => m2 == null ? '' : (m2 * 0.0001).toFixed(2).replace('.', ',');
  const metres = m => m == null ? '' : m.toFixed(0);
  const widthTxt = w => w == null ? '' : w.toFixed(2).replace('.', ',');
  const cell = v => { const t = String(v == null ? '' : v); return /[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  function csv(entries, head) {
    const rows = [head];
    for (const e of entries) rows.push([e.field, e.job, e.workType, dDate(e.start), dTime(e.start), dTime(e.end), dur(e.end - e.start),
      ha(sessionArea(e)), ha(e.workedEnd), ha(e.actualEnd), ha(overlap(e)), metres(delta(e.tripStart, e.tripEnd)),
      e.tool, widthTxt(e.widthM), e.vehicle, e.activity, e.product, e.amount, e.note]);
    return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
  }
  return { step, sums, csv, sessionArea, overlap, season, delta, dDate, dTime, dur, ha, GAP_MS };
})();
// worklog:end

// Recorder + overview sheet for WorkLogCore (feature/arbeitsdoku).
const TabletWorkLog = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const KEY = 'aow.worklog.v1';
  const C = WorkLogCore;
  let state = { entries: [], open: null }, storeOk = true, dirty = false, lastSave = 0;
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && Array.isArray(v.entries)) state = { entries: v.entries, open: v.open || null }; }
  catch (_) { storeOk = false; }
  function save(force) {
    const now = Date.now();
    if (!force && now - lastSave < 10000) { dirty = true; return; }
    try { localStorage.setItem(KEY, JSON.stringify(state)); storeOk = true; dirty = false; lastSave = now; } catch (_) { storeOk = false; }
  }
  window.addEventListener('pagehide', () => save(true));

  // --- Recording -------------------------------------------------------------------------------
  function snapshot() {
    const s = statusBar || {}, fd = s.fieldData || {};
    const field = fieldOps && fieldOps.activeField || '', job = s.jobName || '';
    const j = fieldOps && (fieldOps.jobs || []).find(x => x.fieldName === field && x.taskName === job);
    return {
      live: connState === 'connected' && !!lastTick && performance.now() - lastTick.t < 2000,
      control: !!iHoldControl, field, job, workType: j ? j.workType : '',
      worked: s.workedAreaSqM, actual: fd.actualAreaSqM, trip: fd.tripDistanceM,
      tool: profiles ? profiles.activeTool : '', vehicle: profiles ? profiles.activeVehicle : '',
      widthM: typeof sectionsWidthM === 'function' && sectionsWidthM() > 0 ? sectionsWidthM() : null,
    };
  }
  setInterval(() => {
    const before = state.entries.length, wasOpen = !!state.open;
    state = C.step(state, snapshot(), Date.now());
    save(state.entries.length !== before || wasOpen !== !!state.open);
    if (isOpen()) render();
  }, 2000);

  // --- Sheet -----------------------------------------------------------------------------------
  const sheet = el('div', 'tui-sheet tb-sheet tbk-sheet'); sheet.id = 'tui-worklog'; sheet.setAttribute('translate', 'no');
  sheet.innerHTML = '<div class="tui-sh-hdr"><span class="t"></span><button class="x">✕</button></div><div class="tui-sh-body"></div>';
  const scrim = el('div', 'tp-scrim');
  const fileIn = el('input'); fileIn.type = 'file'; fileIn.accept = '.json,application/json'; fileIn.style.display = 'none';
  const printBox = el('div'); printBox.id = 'tui-print';
  document.body.append(scrim, sheet, fileIn, printBox);
  for (const n of [sheet, scrim]) n.addEventListener('pointerdown', e => e.stopPropagation());
  const shT = sheet.querySelector('.t'), shB = sheet.querySelector('.tui-sh-body');
  const isOpen = () => sheet.classList.contains('open');
  const close = () => { sheet.classList.remove('open'); scrim.classList.remove('open'); edit = null; };
  onTap(sheet.querySelector('.x'), close); onTap(scrim, close);
  let fField = '', fSeason = '', fText = '', edit = null, last = '', msg = '';
  function open() { if (typeof lnCloseAll === 'function') lnCloseAll(); sheet.classList.add('open'); scrim.classList.add('open'); last = ''; render(); }

  const all = () => state.open ? state.entries.concat([state.open]) : state.entries.slice();
  function filtered() {
    const q = fText.trim().toLowerCase();
    return all().filter(e => (!fField || e.field === fField) && (!fSeason || String(C.season(e)) === fSeason)
      && (!q || [e.field, e.job, e.workType, e.tool, e.vehicle, e.activity, e.product, e.amount, e.note].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => a.field.localeCompare(b.field) || b.start - a.start);
  }
  const HEAD = () => [tr('Field'), tr('Job'), tr('Work type'), tr('Date'), tr('Start'), tr('End'), tr('Duration (h:mm)'), tr('Area this session (ha)'),
    tr('Job area total (ha)'), tr('Covered once, job total (ha)'), tr('Overlap, job total (ha)'), tr('Distance (m)'), tr('Tool'), tr('Working width (m)'), tr('Vehicle'),
    tr('Activity'), tr('Product / variety'), tr('Amount'), tr('Note')].map(T);
  const NOTE = tr('Records of this app; whether they meet legal record-keeping duties is not checked.');

  function selectBox(val, opts, onChange) {
    const s = el('select', 'tp-in wl-sel'); s.style.cssText = 'width:auto;text-align:left;font:inherit';
    for (const [v, t] of opts) { const o = el('option', '', t); o.value = v; if (v === val) o.selected = true; s.appendChild(o); }
    s.addEventListener('change', () => { onChange(s.value); last = ''; render(); });
    s.addEventListener('pointerdown', e => e.stopPropagation());
    return s;
  }
  function render() {
    if (!isOpen()) return;
    const list = filtered(), key = JSON.stringify([list.map(e => [e.id, e.end, e.activity, e.product, e.amount, e.note]), fField, fSeason, fText, edit, msg, storeOk, I18n.language]);
    if (key === last) return;
    if (document.activeElement && sheet.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; // don't rebuild under the cursor
    last = key;
    shT.textContent = T(tr('Work log'));
    const top = shB.scrollTop; shB.innerHTML = '';
    if (edit) { renderEdit(); return; }
    const box = el('div', 'tb-box');
    box.appendChild(el('div', 'tp-note', T(tr('One entry per working session, recorded on this tablet while it has control and a job is open. Areas and distance come from the guidance computer.'))));
    box.appendChild(el('div', 'tp-note warn', T(tr('Stored only on this tablet (in the browser). Back it up with "Save as file".'))));
    if (!storeOk) box.appendChild(el('div', 'tp-note bad', T(tr('This browser does not store data: entries are lost when the page is closed.'))));
    if (msg) box.appendChild(el('div', 'tp-note', T(msg)));
    // Filters
    const fields = [...new Set(all().map(e => e.field))].sort(), seasons = [...new Set(all().map(e => String(C.season(e))))].sort().reverse();
    const fr = el('div', 'tb-row');
    fr.appendChild(selectBox(fField, [['', T(tr('All fields'))], ...fields.map(f => [f, f])], v => { fField = v; }));
    fr.appendChild(selectBox(fSeason, [['', T(tr('All seasons'))], ...seasons.map(y => [y, y])], v => { fSeason = v; }));
    const q = el('input', 'tp-in'); q.placeholder = T(tr('Search')); q.value = fText; q.style.cssText = 'width:12em;text-align:left;font:inherit';
    q.addEventListener('input', () => { fText = q.value; }); q.addEventListener('change', () => { last = ''; render(); });
    fr.appendChild(q);
    box.appendChild(fr);
    // Sums per field and season (calendar year)
    const sm = C.sums(list);
    if (sm.length) {
      const t = el('div', 'wl-sums');
      for (const r of sm) t.appendChild(el('div', 'wl-sum', r.field + ' · ' + r.season + ': ' + tr('Sessions: {n}', { n: r.count }) + ' · ' + C.dur(r.ms) + ' h · '
        + fmtArea(r.areaSqM) + (r.areaMissing ? ' (' + tr('without area: {n}', { n: r.areaMissing }) + ')' : '')));
      box.appendChild(t);
    }
    // Entries
    const ul = el('div', 'tbk-list');
    if (!list.length) ul.appendChild(el('div', 'tp-note', T(tr('No entries yet.'))));
    for (const e of list) {
      const r = el('button', 'tbk-it wl-it' + (e.open ? ' on' : ''));
      const nm = el('span', 'tbk-nm');
      nm.appendChild(el('small', '', C.dDate(e.start) + ' · ' + C.dTime(e.start) + '–' + (e.open ? T(tr('running')) : C.dTime(e.end)) + ' · ' + C.dur(e.end - e.start) + ' h'));
      nm.appendChild(el('b', '', e.field + ' · ' + e.job));
      const a = C.sessionArea(e);
      nm.appendChild(el('small', '', [a == null ? T(tr('area: —')) : fmtArea(a), e.tool, e.widthM != null ? fmtUnit(e.widthM, 'm') : '', e.activity, e.product, e.amount].filter(Boolean).join(' · ')));
      if (e.note) nm.appendChild(el('small', 'tbk-ch', e.note));
      r.append(el('span', ''), nm, el('span', 'tbk-st', '✎')); // the list's three columns
      onTap(r, () => { edit = e.id; last = ''; render(); });
      ul.appendChild(r);
    }
    box.appendChild(ul);
    // Export, print, file
    const er = el('div', 'tb-row');
    const btn = (label, fn, pri) => { const b = el('button', 'tp-btn' + (pri ? ' pri' : ''), T(label)); onTap(b, fn); er.appendChild(b); return b; };
    btn(tr('Export CSV'), () => download('arbeitsprotokoll.csv', 'text/csv;charset=utf-8', C.csv(list, HEAD())), true);
    btn(tr('Copy CSV'), () => copy(C.csv(list, HEAD()).replace(/^﻿/, '')));
    btn(tr('Print page per field'), () => printFields(list));
    btn(tr('Save as file'), () => download('arbeitsprotokoll.json', 'application/json', JSON.stringify({ format: 'aow-worklog', version: 1, entries: all() }, null, 1)));
    btn(tr('Load from file'), () => fileIn.click());
    box.appendChild(er);
    box.appendChild(el('div', 'tp-note', T(NOTE)));
    shB.appendChild(box);
    shB.scrollTop = top;
  }
  function renderEdit() {
    const e = all().find(x => x.id === edit); if (!e) { edit = null; render(); return; }
    const box = el('div', 'tb-box');
    box.appendChild(el('div', 'tb-lbl', e.field + ' · ' + e.job + ' · ' + C.dDate(e.start)));
    const a = C.sessionArea(e), ov = C.overlap(e), tr0 = C.delta(e.tripStart, e.tripEnd);
    for (const [k, v] of [[tr('Time'), C.dTime(e.start) + '–' + (e.open ? T(tr('running')) : C.dTime(e.end)) + ' (' + C.dur(e.end - e.start) + ' h)'],
      [tr('Area this session'), a == null ? '—' : fmtArea(a)], [tr('Job area total'), e.workedEnd == null ? '—' : fmtArea(e.workedEnd)],
      [tr('Overlap, job total'), ov == null ? '—' : fmtArea(ov)], [tr('Distance'), tr0 == null ? '—' : fmtUnit(tr0, 'm', 0)],
      [tr('Tool'), e.tool || '—'], [tr('Working width'), e.widthM == null ? '—' : fmtUnit(e.widthM, 'm')], [tr('Vehicle'), e.vehicle || '—'], [tr('Work type'), e.workType || '—']])
      box.appendChild(el('div', 'tp-note', T(k) + ': ' + v));
    const inputs = {};
    for (const [k, label] of [['activity', tr('Activity')], ['product', tr('Product / variety')], ['amount', tr('Amount')], ['note', tr('Note')]]) {
      const row = el('label', 'wl-f'); row.appendChild(el('span', '', T(label)));
      const i = el('input', 'tp-in'); i.value = e[k] || ''; i.style.cssText = 'width:100%;text-align:left;font:inherit'; i.maxLength = 500;
      inputs[k] = i; row.appendChild(i); box.appendChild(row);
    }
    const r = el('div', 'tb-row');
    const ok = el('button', 'tp-btn pri big', T(tr('Save'))); onTap(ok, () => {
      const upd = x => x.id === e.id ? { ...x, ...Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()])) } : x;
      state = { entries: state.entries.map(upd), open: state.open ? upd(state.open) : null }; save(true); edit = null; last = ''; render();
    });
    const back = el('button', 'tp-btn', '← ' + T(tr('Back'))); onTap(back, () => { edit = null; last = ''; render(); });
    const del = el('button', 'tp-btn quiet', T(tr('Delete entry'))); del.disabled = !!e.open;
    let armed = false;
    onTap(del, () => {
      if (!armed) { armed = true; del.textContent = T(tr('Tap again to delete')); return; }
      state = { entries: state.entries.filter(x => x.id !== e.id), open: state.open }; save(true); edit = null; last = ''; render();
    });
    r.append(ok, back, del); box.appendChild(r);
    shB.appendChild(box);
  }

  // --- Files -----------------------------------------------------------------------------------
  // Browser download. The Android/iOS app views have no download or print hook (see
  // docs/Arbeitsdoku.md); "Copy CSV" is the way there.
  function download(name, type, text) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type }));
      const a = el('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      msg = tr('File created: {f}. If nothing is downloaded on this tablet, use "Copy CSV".', { f: name });
    } catch (_) { msg = tr('Download not possible here. Use "Copy CSV".'); }
    last = ''; render();
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); msg = tr('CSV copied. Paste it into a spreadsheet or an e-mail.'); }
    catch (_) { msg = tr('Copying is not possible in this browser.'); }
    last = ''; render();
  }
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (!f) return;
    try {
      const v = JSON.parse(await f.text());
      if (!v || v.format !== 'aow-worklog' || !Array.isArray(v.entries)) throw new Error('format');
      const have = new Set(all().map(e => e.id));
      const add = v.entries.filter(e => e && e.id && !have.has(e.id) && typeof e.field === 'string' && typeof e.start === 'number').map(e => ({ ...e, open: false }));
      state = { entries: state.entries.concat(add), open: state.open }; save(true);
      msg = tr('{n} entries loaded; entries already here are kept.', { n: add.length });
    } catch (_) { msg = tr('Not a work log file of this app.'); }
    last = ''; render();
  });

  // --- Print: one page per field, through the browser's print (save as PDF there) -------------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function printFields(list) {
    const by = new Map(); for (const e of list) { if (!by.has(e.field)) by.set(e.field, []); by.get(e.field).push(e); }
    let h = '';
    for (const [field, es] of by) {
      const s = C.sums(es);
      h += '<section class="wl-page"><h1>' + esc(T(tr('Work log'))) + ': ' + esc(field) + '</h1>'
        + '<p>' + s.map(r => esc(r.season + ': ' + tr('Sessions: {n}', { n: r.count }) + ' · ' + C.dur(r.ms) + ' h · ' + fmtArea(r.areaSqM))).join('<br>') + '</p>'
        + '<table><tr>' + [tr('Date'), tr('Time'), tr('Job'), tr('Area this session'), tr('Tool'), tr('Working width'), tr('Activity'), tr('Product / variety'), tr('Amount'), tr('Note')]
          .map(k => '<th>' + esc(T(k)) + '</th>').join('') + '</tr>'
        + es.slice().sort((a, b) => a.start - b.start).map(e => '<tr>' + [C.dDate(e.start), C.dTime(e.start) + '–' + C.dTime(e.end), e.job,
          C.sessionArea(e) == null ? '—' : fmtArea(C.sessionArea(e)), e.tool, e.widthM == null ? '' : fmtUnit(e.widthM, 'm'), e.activity, e.product, e.amount, e.note]
          .map(v => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('') + '</table>'
        + '<p class="wl-n">' + esc(T(NOTE)) + '</p></section>';
    }
    printBox.innerHTML = h;
    document.documentElement.setAttribute('data-print', 'worklog');
    const done = () => { document.documentElement.removeAttribute('data-print'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    try { window.print(); } catch (_) { done(); }
    setTimeout(() => { if (document.documentElement.hasAttribute('data-print')) { msg = tr('If no print dialog opened, this app view cannot print; use a browser on a PC.'); last = ''; render(); } }, 1500);
  }

  // --- Menu tile (in the field) ---------------------------------------------------------------
  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7M9 8h2"/></svg>';
  setInterval(() => {
    const m = document.getElementById('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const f = m.querySelector('.tui-tiles.tui-f'); if (!f || f.querySelector('[data-tile="worklog"]')) return;
    const t = el('button', 'tui-tile field'); t.dataset.tile = 'worklog'; t.innerHTML = IC + '<span></span>';
    t.querySelector('span').textContent = T(tr('Work log'));
    onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) x.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); open(); });
    f.appendChild(t);
  }, 300);
  return { open, get entries() { return all(); } };
})();
