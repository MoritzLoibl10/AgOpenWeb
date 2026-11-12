// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: first setup guide (TabletFirstSetup).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

// ===== First setup (feature/bedienung-2) ======================================================
// A guide through the first setup: language, vehicle, tool and working width (the existing
// profile cards and their wizard, TabletProfiles), NTRIP (Network & GPS), a live kit check
// (modules, GPS, IMU as the ready light sees them; the bench checklist for more) and the
// direction trap. It enters no values itself: everything is typed in the existing dialogs, an
// empty field stays empty. Shown by itself once, while no vehicle profile exists (on the device
// that has control), skippable at every step, and again any time from the menu ("First setup").
// Tested by Tests/web/firstsetup.test.mjs (block firstsetup:begin/end).
// firstsetup:begin
const TabletFirstSetup = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const KEY = 'aow.firstSetup';
  // Kept on the guidance computer too (host-paket D: appInfo.firstSetup, command setup.first), so
  // another tablet or a cleared browser doesn't start the guide again; this browser's copy stays.
  const local = () => { try { return localStorage.getItem(KEY); } catch (_) { return 'blocked'; } };
  const lsOk = () => (appInfo && appInfo.firstSetup) || local();
  const mark = v => {
    try { localStorage.setItem(KEY, v); } catch (_) { /* ignore */ }
    if (iHoldControl) transport.send('setup.first|' + v);
  };
  // A host that doesn't know yet what this browser already did learns it (once it can tell).
  setInterval(() => {
    const l = local();
    if (iHoldControl && appInfo && appInfo.firstSetup === '' && (l === 'shown' || l === 'done')) transport.send('setup.first|' + l);
  }, 5000);
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
    const key = JSON.stringify([step, tuiLang(), appInfo && appInfo.currentLanguage, s.k === 'kit' ? TabletReady.checks() : 0,
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
    box.appendChild(el('div', 'tp-note', T(tr('You can open the first setup again any time: Menu → Settings → First setup.'))));
    shB.appendChild(box);
  }
  setInterval(render, 500);
  // The host's untouched vehicle profile: the host saves its active profile "Default" as soon as
  // anything is saved (leaving the vehicle settings, loading another profile), with the values
  // it gives every new store. Those values are the host's own (VehicleConfig.cs initializers, the
  // same in VehicleProfileService.CreateDefaultProfile; Tests/web/firstsetup.test.mjs reads them
  // from both files), not suggestions: they only tell "nothing set up yet" (moritz.31, point 4).
  const HOST_DEFAULT_VEHICLE = { type: 0, wheelbase: 2.5, trackWidth: 1.8, antennaHeight: 3.0, antennaPivot: 0, antennaOffset: 0, hitchLength: 1.8, imuPivot: 0, imuHeight: 0, imuOffset: 0 };
  // null while the client can't tell yet (profile list or active config not received).
  function noVehicleYet() {
    if (!profiles || !profiles.vehicles) return null;
    const v = profiles.vehicles;
    if (!v.length) return true;
    if (v.length !== 1 || v[0].name !== 'Default' || profiles.activeVehicle !== 'Default') return false;
    const c = config && config.vehicle;
    if (!c) return null;
    return Object.keys(HOST_DEFAULT_VEHICLE).every(k => Math.abs(+c[k] - HOST_DEFAULT_VEHICLE[k]) < 1e-9);
  }
  // First start on this device: once, on the device that has control, not during a demo.
  const auto = setInterval(() => {
    if (lsOk() || navigator.webdriver) { clearInterval(auto); return; } // not in automated browsers (CI layout check)
    // Only while no vehicle is set up: no vehicle profile, or only the host's untouched "Default".
    const none = noVehicleYet();
    if (none === false) { clearInterval(auto); return; }
    if (none !== true) return;
    let legal = true; try { legal = TabletLegal.done; } catch (_) { legal = false; } // the notice at first start comes first
    if (legal && connState === 'connected' && iHoldControl && appInfo && config && profiles && !(typeof TabletDemo !== 'undefined' && TabletDemo.active)) {
      clearInterval(auto); mark('shown'); open(0);
    }
  }, 1000);

  // --- Menu tile (setup) ----------------------------------------------------------------------
  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16M6 16l9-9 3 3-9 9H6z"/><path d="M13 9l3 3"/></svg>';
  setInterval(() => {
    const m = document.getElementById('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const sBox = m.querySelector('.tui-tiles.tui-s'); if (!sBox || m.querySelector('[data-tile="setup1"]')) return;
    const t = el('button', 'tui-tile setup'); t.dataset.tile = 'setup1'; t.innerHTML = IC + '<span></span>';
    t.querySelector('span').textContent = T(tr('First setup'));
    onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) tuiPress(x); open(0); });
    sBox.insertBefore(t, sBox.firstChild);
  }, 300);
  return { open, get isOpen() { return isOpen(); } };
})();
// firstsetup:end
