// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: terminal layout: status bar, module column, quick bar, menu and its pages (TabletTerminal).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

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
    tracks: svg('<path d="M7 21 L9 3 M17 21 L15 3"/><circle cx="8" cy="12" r="1.6"/><circle cx="16" cy="12" r="1.6"/>', STROKE),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>', STROKE),
    service: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.4-.4-2.4z"/>', STROKE),
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
    ['tracks', tr('Tracks'), 'tracks', () => { if (typeof openTracksManager === 'function') openTracksManager(); }], // review measure 7
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
  // --- Menu pages (docs/Menue-Aufteilung.md, review 10.11.2026, measure 7) ----------------
  // The menu opens on the everyday tiles; settings for the customer and "Service" for the fitter
  // and support are one page deeper. Nothing removed: every tile keeps its key, its action and
  // its setup mode. Modules add their tiles to the two staging boxes (.tui-f, .tui-s) as before;
  // placeTiles() moves each to its page and place (MENU_PLACE; one not listed goes to Settings).
  const MENU_PLACE = [
    ['main', ['work', 'ln-fieldops', 'tracks', 'worklog', 'tb-help', 'page:settings']],
    ['tools', ['ln-fieldtools', '#bn-skipcycle', '#bn-skiptoggle', '#bn-tram', '#bottomnav .bn-bar [data-cmd="map.cycleColor"]', '#bottomnav .bn-bar [data-cmd="tool.resetHeading"]']],
    ['foot', ['page:service']],
    ['settings', ['ln-vehicle', 'ln-autosteer', 'ln-network', 'ln-screenalerts', 'pages', 'quick', 'language', 'ln-filemenu', 'setup1', 'tbk', 'eama', 'tb-info']],
    ['service', ['ln-tools', 'tbn', 'accept', 'tb-diag', 'demo']],
  ];
  const PLACE_OF = {};
  MENU_PLACE.forEach(([box, keys]) => keys.forEach((k, i) => { PLACE_OF[k] = [box, i]; }));
  const PAGE_OF_BOX = { main: 'main', tools: 'main', foot: 'main', settings: 'settings', service: 'service' };
  const PAGE_TITLE = { main: tr('Menu'), settings: tr('Settings'), service: tr('Service') };
  let menuPage = 'main';
  function showMenuPage(pg) {
    menuPage = pg;
    for (const d of menuBody.querySelectorAll('.tui-mpage')) d.hidden = d.dataset.mpage !== pg;
    menuSheet.querySelector('.tui-sh-hdr .t').textContent = I18n.text(PAGE_TITLE[pg]);
    menuBody.scrollTop = 0;
  }
  function placeTiles() {
    const boxes = {};
    for (const b of menuBody.querySelectorAll('[data-box]')) boxes[b.dataset.box] = b;
    if (!boxes.main) return;
    const now = menuBody.querySelector(':scope > .tp-now'); // the vehicle and tool cards: on the first page
    if (now) boxes.main.parentNode.insertBefore(now, boxes.main.parentNode.firstChild);
    for (const t of menuBody.querySelectorAll('.tui-tiles [data-tile]')) {
      const [box, i] = PLACE_OF[t.dataset.tile] || ['settings', 99];
      t.dataset.order = String(i);
      const dst = boxes[box];
      if (t.parentNode !== dst) {
        const next = [...dst.children].find(c => +c.dataset.order > i);
        dst.insertBefore(t, next || null);
      }
      t.classList.toggle('big', box === 'main');
    }
  }
  // A module's tile lands in a staging box: placed at once (and every 150 ms as a fallback).
  new MutationObserver(() => { if (menuSheet.classList.contains('open')) placeTiles(); }).observe(menuBody, { childList: true, subtree: true });
  setInterval(() => { if (menuSheet.classList.contains('open')) placeTiles(); }, 150);
  function renderMenu() {
    const back = '<button class="tui-mback" type="button"></button>';
    menuBody.innerHTML =
      '<div class="tui-mpage" data-mpage="main">' +
        '<div class="tui-tiles tui-big" data-box="main"></div>' +
        '<div class="tui-sh-sec">' + esc(tr('Field tools')) + '</div><div class="tui-tiles tui-m" data-box="tools"></div>' +
        '<div class="tui-tiles tui-foot" data-box="foot"></div>' +
      '</div>' +
      '<div class="tui-mpage" data-mpage="settings" hidden>' + back +
        '<div class="tui-sh-sec"><small>' + esc(tr('opens setup mode; the left bar comes back')) + '</small></div>' +
        '<div class="tui-tiles setup-band" data-box="settings"></div>' +
      '</div>' +
      '<div class="tui-mpage" data-mpage="service" hidden>' + back +
        '<div class="tui-sh-sec"><small>' + esc(I18n.text(tr('for fitting, checking and support')) + ' · ' + I18n.text(tr('opens setup mode; the left bar comes back'))) + '</small></div>' +
        '<div class="tui-tiles setup-band" data-box="service"></div>' +
      '</div>' +
      // Staging: where the modules put their tiles (unchanged); placeTiles() moves them on.
      '<div class="tui-tiles tui-f" hidden></div><div class="tui-tiles tui-s" hidden></div>';
    for (const b of menuBody.querySelectorAll('.tui-mback')) {
      b.textContent = '← ' + I18n.text(tr('Menu')); // the arrow keeps the page's translator from it
      onTap(b, () => showMenuPage('main'));
    }
    const fBox = menuBody.querySelector('.tui-f'), sBox = menuBody.querySelector('.tui-s');
    const mBox = fBox;
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
    // The two page entries: they turn the page, nothing else (no setup mode).
    for (const [ic, label, pg, cls] of [['settings', tr('Settings'), 'settings', 'field nav'], ['service', tr('Service'), 'service', 'setup nav quiet']]) {
      const t = el('button', 'tui-tile ' + cls, IC[ic] + '<span></span><span class="m-go">›</span>'); t.querySelector('span').textContent = label;
      t.dataset.tile = 'page:' + pg;
      onTap(t, () => showMenuPage(pg));
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
    placeTiles();
    showMenuPage('main');
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
