// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: firewall warning, start time and loading screen, images decoded after the start (TabletFirewall, TabletStartup, TabletPreload).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

// ===== Firewall warning (feature/installer) =======================================================
// The desktop launcher sends "firewall|missing" when the setup was to create the Windows Firewall
// rules and they are not there (declined, failed, deleted later). Shows how to fix it; closable,
// back at the next start while the rules are missing. Desktop window only (Photino channel).
const TabletFirewall = (() => {
  const T = k => I18n.text(k);
  let box = null;
  function show() {
    if (box) return;
    box = document.createElement('div'); box.id = 'tui-fw'; box.setAttribute('role', 'alert');
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕';
    x.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); box.remove(); });
    const h = document.createElement('div'); h.className = 'fw-t'; h.textContent = T(tr('Windows Firewall: the release for the modules is missing'));
    const p = document.createElement('div');
    p.textContent = T(tr('Modules and tablets on the network may be blocked. To fix it: Start menu → {n} → “Allow through firewall” (Windows asks for administrator rights), or run the setup again and allow the prompt.', { n: BRAND.name }));
    box.append(x, h, p);
    box.addEventListener('pointerdown', e => e.stopPropagation());
    document.body.appendChild(box);
  }
  try {
    if (window.external && typeof window.external.receiveMessage === 'function')
      window.external.receiveMessage(m => { if (m === 'firewall|missing') show(); });
  } catch (_) { /* not the desktop window */ }
  return { show };
})();

// startup:begin
// ===== Start time (feature/installer) ===========================================================
// Time stamps of the page's start phases, from the navigation start: HTML received, DOM ready,
// app.js run, CanvasKit ready, first data from the host, first map frame. Logged to the console;
// in the desktop window also sent to the launcher (startup|{json}), which writes them into its
// start log with the host's phases. Then the loading screen (#tui-boot, index.html) goes. Reads
// state only; changes nothing in the app.
const TabletStartup = (() => {
  const marks = [];
  const nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || null;
  const mark = (name, ms) => marks.push([name, Math.round(ms == null ? performance.now() : ms)]);
  // Automated browsers (CI layout checks, tests) measure the app at once: no loading screen.
  if (navigator.webdriver) { const b = document.getElementById('tui-boot'); if (b) b.style.display = 'none'; }
  if (nav) { mark('page: HTML received', nav.responseEnd); }
  mark('page: app.js run');
  let ckAt = 0, tickAt = 0, sent = false;
  function finish(reason) {
    if (sent) return; sent = true;
    const n = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || nav;
    if (n && n.domContentLoadedEventEnd) marks.push(['page: DOM ready', Math.round(n.domContentLoadedEventEnd)]);
    const w = performance.getEntriesByType ? performance.getEntriesByType('resource').find(r => /canvaskit\.wasm/.test(r.name)) : null;
    if (w) marks.push(['page: canvaskit.wasm fetched (' + Math.round(w.duration) + ' ms)', Math.round(w.responseEnd)]);
    marks.push(['page: loading screen off (' + reason + ')', Math.round(performance.now())]);
    marks.sort((a, b) => a[1] - b[1]);
    const boot = document.getElementById('tui-boot');
    if (boot) { boot.style.opacity = '0'; setTimeout(() => boot.remove(), 300); }
    try { console.log('[startup] ' + marks.map(m => m[1] + ' ms ' + m[0]).join(' | ')); } catch (_) { /* no console */ }
    try {
      if (window.external && typeof window.external.sendMessage === 'function')
        window.external.sendMessage('startup|' + JSON.stringify({ origin: performance.timeOrigin, marks }));
    } catch (_) { /* not the desktop window */ }
  }
  function poll() {
    if (sent) return;
    const t = performance.now();
    if (!ckAt && (CK && skSurface || /error|missing|no WebGL/.test(ckStatus || ''))) { ckAt = t; mark('page: CanvasKit ready', t); }
    if (!tickAt && tick) { tickAt = t; mark('page: first data from host', t); }
    // The frame after both: the map has drawn with data.
    if (ckAt && tickAt) { requestAnimationFrame(() => { mark('page: first map frame'); finish('map drawn'); }); return; }
    // Never hide the app's own messages (no host, no WebGL) behind the loading screen for long.
    if (t > 15000) { finish('15 s'); return; }
    requestAnimationFrame(poll);
  }
  requestAnimationFrame(poll);
  return { get marks() { return marks.slice(); } };
})();
// startup:end

// preload:begin
// ===== Images decoded after the start (moritz.31 test, point 2) ===================================
// The page fetches all its symbols at the start, but the browser decodes an image only when it is
// first shown: a page opened for the first time decoded its pictures then (trace: 5–26 ms per page
// here, several times that on a tablet), the second time not. Once the loading screen is gone and
// the page has been idle for a moment, the images are decoded one at a time in idle time, so the
// first opening finds them ready. Changes nothing the operator sees; stops when the page is hidden.
const TabletPreload = (() => {
  const seen = new Set();
  let n = 0, ms = 0, busy = false, finished = false;
  const idle = fn => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 50));
  function pending() {
    const out = [];
    for (const img of document.images) {
      const src = img.currentSrc || img.src;
      if (!src || seen.has(src) || !img.complete || !img.naturalWidth || typeof img.decode !== 'function') continue;
      out.push([src, img]);
    }
    return out;
  }
  function step() {
    if (document.hidden) { busy = false; return; }
    // Four at a time: decoding runs beside the page's own thread; on a weak tablet the page is
    // seldom idle, and one at a time took over 90 s there (CPU limited to 0.4 of a core).
    const next = pending().slice(0, 4);
    if (!next.length) { busy = false; finished = true; return; }
    const t = performance.now();
    Promise.all(next.map(([src, img]) => { seen.add(src); return img.decode().catch(() => {}); }))
      .then(() => { n += next.length; ms += performance.now() - t; idle(step); });
  }
  function start() { if (busy) return; busy = true; idle(step); }
  // After the loading screen (#tui-boot) is gone, 2 s later; again for images added since (30 s).
  const wait = setInterval(() => { if (!document.getElementById('tui-boot')) { clearInterval(wait); setTimeout(start, 2000); setInterval(start, 30000); } }, 500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && seen.size) start(); });
  return { get decoded() { return n; }, get ms() { return Math.round(ms); }, get done() { return finished && !busy; } };
})();
// preload:end
