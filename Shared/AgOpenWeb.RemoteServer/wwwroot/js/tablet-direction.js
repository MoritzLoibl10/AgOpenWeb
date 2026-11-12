// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: heading check, simulator direction, direction card before steering (TabletHeadingCheck, TabletSimGuard, TabletSteerConfirm).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

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
    lastLang = tuiLang();
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
    if (lastLang !== tuiLang() || !title.textContent) labels();
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
