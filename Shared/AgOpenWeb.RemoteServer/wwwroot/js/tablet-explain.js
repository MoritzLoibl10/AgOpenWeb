// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: long press = explanation (TabletExplain).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

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
    ['#tui-menu-btn', tr('Menu: start work, fields, tracks, work log, help; settings and service one page deeper.')],
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
    ['[data-tile="tracks"]', tr('Tracks: choose, make and edit the AB lines and curves of this field.')],
    ['[data-tile="page:settings"]', tr('Settings: vehicle and tool, steering, network and GPS, display, language, backups.')],
    ['[data-tile="page:service"]', tr('Service: for the fitter and support – calibration, bench checklist, acceptance record, diagnosis, demo.')],
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
