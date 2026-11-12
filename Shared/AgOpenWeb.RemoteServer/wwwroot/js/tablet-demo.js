// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: demo mode and where the simulator switch is shown (TabletDemo, TabletSimAccess).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

// ===== Demo mode (feature/bedienung-1) ========================================================
// For showing the app: the existing simulator as the GPS source, with a striped "DEMO" band that
// can't be missed. It only starts while no module is heard (GPS, steer, machine): with a module
// on the network a simulated drive could switch real outputs (the host sends steer and section
// PGNs in the simulator too). If a module turns up while it runs, the demo ends with a warning
// to check steering and sections. Stops with "End demo"; the flag lives in this tab only.
// Ending switches steering and sections off with the host's explicit off commands
// (autosteer.off, sections.alloff: off only, harmless when nothing is on), never with a toggle,
// which sent from a stale tick could switch them on.
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
    transport.send('autosteer.off'); transport.send('sections.alloff');
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
    let t = m.querySelector('[data-tile="demo"]');
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

// ===== Simulator only for test versions, demo and experts (feature/installer) =====================
// In the customer version the simulator switch is not in the normal menu: App & Files shows it
// under "Expert" (collapsed), and the demo mode switches it on as before. Test versions keep the
// menu entry and the SIM button on the map. Test version = this build was found as a pre-release
// at the last update check (Menu → Settings → Info), or, before any check, the device's update channel is
// "Test". A running simulator keeps its bar, so it can always be switched off. Display only: the
// host's simulator, its commands and the demo are unchanged.
// simaccess:begin
function tuiSimInMenu(buildKind, hash, channel) {
  const h = String(hash || '').replace(/-dirty$/, '');
  if (buildKind && h && buildKind.hash === h) return !!buildKind.pre; // known from the last check
  return channel === 'test';
}
// simaccess:end
const TabletSimAccess = (() => {
  const T = k => I18n.text(k);
  const $ = id => document.getElementById(id);
  const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const kind = () => { try { return JSON.parse(lsGet('aow.build.kind') || 'null'); } catch (_) { return null; } };
  const testVersion = () => tuiSimInMenu(kind(), appInfo && appInfo.gitHash, lsGet('aow.update.channel') === 'test' ? 'test' : 'stable');
  // "Expert" in App & Files: the simulator switch (the same command as the upstream entry).
  const fm = $('filemenu');
  let exp = null;
  if (fm) {
    exp = document.createElement('details'); exp.className = 'tui-expert';
    exp.innerHTML = '<summary></summary><div class="fo-grid"><button class="fo-btn" id="fm-sim-expert"></button></div><div class="tui-exp-n"></div>';
    fm.appendChild(exp);
    $('fm-sim-expert').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('sim.togglePanel'); if (typeof lnCloseAll === 'function') lnCloseAll(); });
  }
  let wasOn = false, demoAt = -1e9;
  const upEntry = $('fm-simulator'), upGrid = upEntry && upEntry.parentElement, upLabel = upGrid && upGrid.previousElementSibling;
  function render() {
    const inMenu = testVersion() || (typeof TabletDemo !== 'undefined' && TabletDemo.active);
    for (const n of [upGrid, upLabel]) if (n) n.style.display = inMenu ? '' : 'none'; // .fo-grid's display beats [hidden]
    // The map's SIM button (opens the bar): test versions, or while the simulator runs.
    const simOn = !!(statusBar && statusBar.simEnabled);
    document.documentElement.toggleAttribute('data-tui-nosim', !inMenu && !simOn);
    // Switched off here, the SIM button goes with it: say where it is (moritz.31, point 5: "with a
    // field open the simulator can't be switched on" was this, with or without a field).
    const demo = typeof TabletDemo !== 'undefined' && TabletDemo.active;
    if (statusBar && wasOn && !simOn && !inMenu && performance.now() - demoAt > 5000) showToast(T(tr('Simulator off. To switch it on again: Menu → Settings → App & Files → Expert → Simulator.')), 8000);
    if (statusBar) wasOn = simOn;
    if (demo) demoAt = performance.now(); // the demo's end has its own message
    if (exp) {
      exp.querySelector('summary').textContent = T(tr('Expert'));
      $('fm-sim-expert').textContent = T(tr('Simulator'));
      exp.querySelector('.tui-exp-n').textContent = T(tr('Simulator: for tests and demos. While it runs, the guidance computer uses no real position.'));
    }
  }
  setInterval(render, 1000);
  render();
  return { render, testVersion };
})();
