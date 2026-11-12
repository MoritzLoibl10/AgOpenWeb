// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: bench checklist for AiO v4.5 + Keya (TabletBench).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

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
    const key = JSON.stringify([rows, w, tuiLang()]);
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
    const s = m.querySelector('.tui-tiles.tui-s'); if (!s || m.querySelector('[data-tile="tbn"]')) return;
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
