// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: acceptance record (AcceptCore, TabletAcceptance).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

// ===== Acceptance record (feature/abnahme) =====================================================
// A guided handover of a fitted kit to the customer: kit data (tractor, customer, date, the
// antenna and dual settings as they are set), time to RTK Fix, a straight run with steering
// (cross-track error as the host reports it: mean, maximum, spread), a run on a slope (the same,
// plus the host's roll), a U-turn, the steering-off checks (button; overriding at the wheel) and
// the direction check or dual heading. Each step: passed, failed or skipped, with a remark. The
// limits are the fitter's own (typed, none given by the app); a measured value is only compared
// with a limit the fitter entered. Printable (browser print, PDF there) and CSV. Kept like the
// work log: on this tablet and on the guidance computer (TabletWorkLog's store, kind
// 'acceptance', /worklog). Only data the host already sends; docs/Abnahme.md lists what is missing.
// acceptance:begin
const AcceptCore = (() => {
  const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
  // Steps in the order they are done. kind: what is measured.
  const STEPS = [
    { k: 'kit', kind: 'kit', t: tr('Kit data') },
    { k: 'rtk', kind: 'timer', t: tr('Time to RTK Fix') },
    { k: 'straight', kind: 'run', t: tr('Straight run with steering') },
    { k: 'slope', kind: 'run', roll: true, t: tr('Run on a slope') },
    { k: 'uturn', kind: 'run', turn: true, t: tr('U-turn') },
    { k: 'offButton', kind: 'off', t: tr('Steering off: button') },
    { k: 'offWheel', kind: 'off', t: tr('Steering off: overriding at the wheel') },
    { k: 'direction', kind: 'direction', t: tr('Direction check / dual heading') },
  ];
  // A sample of a run: only while the host steers on a line (engaged, guidance active, the module
  // not reporting "not steering"); for straight and slope also not in a U-turn. One per host tick.
  function sample(rec, t, turn) {
    if (!t || !t.op || num(t.hostMs) == null || t.hostMs === rec.lastMs) return rec;
    const r = { ...rec, lastMs: t.hostMs };
    if (turn && t.op.executing) r.turned = true;
    const steering = t.op.autoSteer && t.guidanceActive && !t.op.moduleNotSteering && (turn || !t.op.executing);
    if (!steering || num(t.crossTrackError) == null) return r;
    r.xte = (rec.xte || []).concat([t.crossTrackError]);
    if (num(t.roll) != null) r.roll = (rec.roll || []).concat([t.roll]);
    return r;
  }
  // Mean (signed: the side it keeps to), maximum of the amount, spread (standard deviation).
  function stats(xs) {
    const a = (xs || []).filter(x => num(x) != null);
    if (!a.length) return null;
    const mean = a.reduce((s, x) => s + x, 0) / a.length;
    const sd = Math.sqrt(a.reduce((s, x) => s + (x - mean) * (x - mean), 0) / a.length);
    return { n: a.length, mean, max: Math.max(...a.map(Math.abs)), sd };
  }
  // The fitter's limits (m) against the measured values; null where no limit was entered.
  function within(st, lim) {
    if (!st || !lim) return null;
    const checks = [['mean', Math.abs(st.mean)], ['max', st.max], ['sd', st.sd]].filter(([k]) => num(lim[k]) != null);
    if (!checks.length) return null;
    return checks.every(([k, v]) => v <= lim[k]);
  }
  // Steering off: armed while the host steers; seen when it stops (engaged → off, or the module
  // reports not steering).
  function off(rec, t, now) {
    if (!t || !t.op || rec.seenAt != null) return rec;
    if (t.op.autoSteer && !t.op.moduleNotSteering) return rec.armed != null ? rec : { ...rec, armed: now };
    if (rec.armed != null) return { ...rec, seenAt: now, how: t.op.autoSteer ? 'module' : 'off' };
    return rec;
  }
  const RES = { pass: tr('passed'), fail: tr('failed'), skip: tr('skipped') };
  const cm = m => m == null ? '' : (m * 100).toFixed(1).replace('.', ',');
  const p2 = n => String(n).padStart(2, '0');
  const dDate = ms => { const d = new Date(ms); return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear(); };
  const cell = v => { const x = String(v == null ? '' : v); return /[;"\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
  // One row per step: step; result; measured; limits; remark. Lengths in cm with a decimal comma.
  const dec1 = v => v.toFixed(1).replace('.', ',');
  function values(step, d) {
    if (!d) return '';
    if (step.kind === 'timer') return d.seconds == null ? '' : tr('{s} s', { s: d.seconds });
    if (step.kind === 'run') {
      const st = stats(d.xte), parts = [];
      if (st) parts.push(tr('cross-track: mean {m} cm, maximum {x} cm, spread {s} cm ({n} values)', { m: cm(st.mean), x: cm(st.max), s: cm(st.sd), n: st.n }));
      const rl = stats(d.roll); if (step.roll && rl) parts.push(tr('roll: mean {m}°, maximum {x}°', { m: dec1(rl.mean), x: dec1(rl.max) }));
      if (step.turn) parts.push(d.turned ? tr('U-turn driven') : tr('no U-turn seen'));
      return parts.join('; ');
    }
    if (step.kind === 'off') return d.seenAt ? tr('steering stopped {s} s after it was armed', { s: dec1((d.seenAt - d.armed) / 1000) })
      + (d.how === 'module' ? ' (' + tr('module reports not steering') + ')' : '') : '';
    if (step.kind === 'direction') return d.dual == null ? '' : d.dual ? (d.dualOk ? tr('dual heading present') : tr('dual heading missing'))
      : d.confirmed ? tr('one antenna, direction confirmed') : tr('one antenna, direction not confirmed');
    return '';
  }
  const LIM = { mean: tr('mean'), max: tr('maximum'), sd: tr('spread') };
  const limits = d => d && d.lim ? ['mean', 'max', 'sd'].filter(k => num(d.lim[k]) != null).map(k => tr('{what} ≤ {v} cm', { what: I18n.text(LIM[k]), v: cm(d.lim[k]) })).join(', ') : '';
  // head: translated column names; name: translates a step's title or a result word.
  function csv(rec, head, name = x => x) {
    const k = rec.kit || {};
    const rows = [head.kit, [k.customer, k.tractor, k.vehicleProfile, dDate(rec.start), k.antennaHeight, k.antennaPivot, k.antennaOffset, k.wheelbase, k.dual ? 'dual' : 'single', k.dualHeadingOffset],
      [], head.steps];
    for (const s of STEPS.filter(x => x.kind !== 'kit')) {
      const d = (rec.steps || {})[s.k] || {};
      rows.push([name(s.t), d.res ? name(RES[d.res]) : '', values(s, d), limits(d), d.note || '']);
    }
    return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
  }
  return { STEPS, sample, stats, within, off, values, limits, csv, cm, dDate, RES };
})();
// acceptance:end

const TabletAcceptance = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const A = AcceptCore, KIND = 'acceptance';
  const sheet = el('div', 'tui-sheet tb-sheet tbk-sheet'); sheet.id = 'tui-accept'; sheet.setAttribute('translate', 'no');
  sheet.innerHTML = '<div class="tui-sh-hdr"><span class="t"></span><button class="x">✕</button></div><div class="tui-sh-body"></div>';
  const scrim = el('div', 'tp-scrim');
  document.body.append(scrim, sheet);
  for (const n of [sheet, scrim]) n.addEventListener('pointerdown', e => e.stopPropagation());
  const shT = sheet.querySelector('.t'), shB = sheet.querySelector('.tui-sh-body');
  const isOpen = () => sheet.classList.contains('open');
  const close = () => { sheet.classList.remove('open'); scrim.classList.remove('open'); stopAll(); };
  onTap(sheet.querySelector('.x'), close); onTap(scrim, close);
  let cur = null, step = null, last = '', msg = '';   // cur: the record being edited; step: its open step key
  let running = null;                                 // { k, kind } of a measurement in progress
  function open() { if (typeof lnCloseAll === 'function') lnCloseAll(); sheet.classList.add('open'); scrim.classList.add('open'); last = ''; render(); }
  const list = () => (typeof TabletWorkLog !== 'undefined' ? TabletWorkLog.records(KIND) : []).slice().sort((a, b) => b.start - a.start);
  const save = () => { if (cur) TabletWorkLog.put(cur); };
  const sd = k => (cur.steps || {})[k] || {};
  const setStep = (k, d) => { cur = { ...cur, steps: { ...(cur.steps || {}), [k]: { ...sd(k), ...d } }, end: Date.now() }; };
  function stopAll() { if (running) { running = null; save(); } }

  // What the host has set now: copied into the record when the kit step is saved.
  function kitNow() {
    const v = config && config.vehicle || {}, g = config && config.gps || {};
    return { vehicleProfile: profiles ? profiles.activeVehicle || '' : '', antennaHeight: v.antennaHeight, antennaPivot: v.antennaPivot,
      antennaOffset: v.antennaOffset, wheelbase: v.wheelbase, dual: !!g.isDualGps, dualHeadingOffset: g.isDualGps ? g.dualHeadingOffset : null };
  }
  function newRecord() {
    const now = Date.now();
    cur = { id: 'a' + now.toString(36) + Math.random().toString(36).slice(2, 6), kind: KIND, start: now, end: now,
      kit: { customer: '', tractor: '', ...kitNow() }, steps: {} };
    step = 'kit'; save();
  }

  // Measurements, fed from the host's ticks and status.
  setInterval(() => {
    if (!running || !cur) return;
    const s = A.STEPS.find(x => x.k === running.k), d = sd(running.k), now = Date.now();
    if (running.kind === 'timer') {
      if (statusBar && statusBar.fixQuality === 4 && !statusBar.gpsLost) { setStep(running.k, { seconds: Math.round((now - d.t0) / 1000) }); running = null; save(); }
    } else if (running.kind === 'run') {
      const r = A.sample(d, tick, !!s.turn); if (r !== d) setStep(running.k, r);
    } else if (running.kind === 'off') {
      const r = A.off(d, tick, now); if (r !== d) { setStep(running.k, r); if (r.seenAt) { running = null; save(); } }
    }
    if (isOpen()) render();
  }, 100);

  function render() {
    if (!isOpen()) return;
    const key = JSON.stringify([cur, step, running, msg, tuiLang(), list().length, statusBar && statusBar.fixQuality,
      tick && tick.op && [tick.op.autoSteer, tick.op.moduleNotSteering]]);
    if (key === last) return;
    if (document.activeElement && sheet.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    last = key;
    shT.textContent = T(tr('Acceptance record'));
    shB.innerHTML = '';
    const box = el('div', 'tb-box'); shB.appendChild(box);
    if (msg) box.appendChild(el('div', 'tp-note', T(msg)));
    if (!cur) return renderList(box);
    if (step) return renderStep(box);
    renderRecord(box);
  }
  const btn = (row, label, fn, cls) => { const b = el('button', 'tp-btn' + (cls ? ' ' + cls : ''), T(label)); onTap(b, fn); row.appendChild(b); return b; };

  function renderList(box) {
    box.appendChild(el('div', 'tp-note', T(tr('Handing over a fitted kit: work through the steps with the customer. The limits are yours to enter; the app gives none.'))));
    const r = el('div', 'tb-row'); btn(r, tr('New acceptance record'), () => { msg = ''; newRecord(); last = ''; render(); }, 'pri'); box.appendChild(r);
    const ul = el('div', 'tbk-list');
    const recs = list();
    if (!recs.length) ul.appendChild(el('div', 'tp-note', T(tr('No acceptance records yet.'))));
    for (const a of recs) {
      const it = el('button', 'tbk-it'), nm = el('span', 'tbk-nm');
      nm.appendChild(el('small', '', A.dDate(a.start)));
      nm.appendChild(el('b', '', [a.kit && a.kit.customer, a.kit && a.kit.tractor].filter(Boolean).join(' · ') || T(tr('(no name)'))));
      const res = A.STEPS.filter(s => s.kind !== 'kit').map(s => ((a.steps || {})[s.k] || {}).res);
      nm.appendChild(el('small', '', T(tr('passed: {p}, failed: {f}, skipped: {s}, open: {o}', { p: res.filter(x => x === 'pass').length,
        f: res.filter(x => x === 'fail').length, s: res.filter(x => x === 'skip').length, o: res.filter(x => !x).length }))));
      it.append(el('span', ''), nm, el('span', 'tbk-st', '›'));
      onTap(it, () => { cur = a; step = null; msg = ''; last = ''; render(); });
      ul.appendChild(it);
    }
    box.appendChild(ul);
  }

  function renderRecord(box) {
    const k = cur.kit || {};
    box.appendChild(el('div', 'tb-lbl', [k.customer, k.tractor, A.dDate(cur.start)].filter(Boolean).join(' · ')));
    const ul = el('div', 'tbk-list');
    for (const s of A.STEPS) {
      const d = sd(s.k), it = el('button', 'tbk-it'), nm = el('span', 'tbk-nm');
      nm.appendChild(el('b', '', T(s.t)));
      const v = s.kind === 'kit' ? [k.customer, k.tractor].filter(Boolean).join(' · ') : A.values(s, d);
      if (v) nm.appendChild(el('small', '', v));
      if (d.note) nm.appendChild(el('small', 'tbk-ch', d.note));
      it.append(el('span', ''), nm, el('span', 'tbk-st', s.kind === 'kit' ? '›' : d.res ? T(A.RES[d.res]) : '—'));
      onTap(it, () => { step = s.k; msg = ''; last = ''; render(); });
      ul.appendChild(it);
    }
    box.appendChild(ul);
    const r = el('div', 'tb-row');
    btn(r, tr('Print / PDF'), () => print(cur), 'pri');
    btn(r, tr('Export CSV'), () => download(cur));
    btn(r, '← ' + T(tr('All records')), () => { stopAll(); cur = null; last = ''; render(); });
    let armed = false;
    const del = btn(r, tr('Delete record'), () => {
      if (!armed) { armed = true; del.textContent = T(tr('Tap again to delete')); return; }
      TabletWorkLog.remove(cur.id); cur = null; last = ''; render();
    }, 'quiet');
    box.appendChild(r);
    box.appendChild(el('div', 'tp-note', T(tr('Kept on this tablet and on the guidance computer, like the work log.'))));
  }

  const field = (box, label, value, onInput, type) => {
    const row = el('label', 'wl-f'); row.appendChild(el('span', '', T(label)));
    const i = el('input', 'tp-in'); i.value = value == null ? '' : String(value); if (type) i.inputMode = type;
    i.style.cssText = 'width:100%;text-align:left;font:inherit'; i.maxLength = 200;
    i.addEventListener('change', () => onInput(i.value.trim()));
    row.appendChild(i); box.appendChild(row); return i;
  };
  const shown = (v, u) => v == null || !Number.isFinite(v) ? '—' : fmtUnit(v, u);
  const parseCm = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n / 100 : null; };

  function renderStep(box) {
    const s = A.STEPS.find(x => x.k === step), d = sd(step);
    box.appendChild(el('div', 'tb-lbl', T(s.t)));
    if (s.kind === 'kit') {
      const k = cur.kit || {};
      field(box, tr('Customer'), k.customer, v => { cur = { ...cur, kit: { ...cur.kit, customer: v } }; save(); });
      field(box, tr('Tractor'), k.tractor, v => { cur = { ...cur, kit: { ...cur.kit, tractor: v } }; save(); });
      box.appendChild(el('div', 'tp-note', T(tr('Date')) + ': ' + A.dDate(cur.start)));
      box.appendChild(el('div', 'tp-note', T(tr('As set in the app (vehicle profile "{p}"):', { p: k.vehicleProfile || '—' }))));
      for (const [l, v, u] of [[tr('Antenna height'), k.antennaHeight, 'm'], [tr('Antenna pivot'), k.antennaPivot, 'm'],
        [tr('Antenna offset'), k.antennaOffset, 'm'], [tr('Wheelbase'), k.wheelbase, 'm']])
        box.appendChild(el('div', 'tp-note', T(l) + ': ' + shown(v, u)));
      box.appendChild(el('div', 'tp-note', T(tr('Dual antenna')) + ': ' + (k.dual ? T(tr('yes')) + ', ' + T(tr('heading offset')) + ' ' + (k.dualHeadingOffset == null ? '—' : k.dualHeadingOffset + '°') : T(tr('no')))));
      const r = el('div', 'tb-row');
      btn(r, tr('Take the current settings'), () => { cur = { ...cur, kit: { ...cur.kit, ...kitNow() } }; save(); last = ''; render(); });
      btn(r, tr('Done'), () => { step = null; save(); last = ''; render(); }, 'pri');
      box.appendChild(r);
      return;
    }
    const isRunning = running && running.k === step;
    if (s.kind === 'timer') {
      box.appendChild(el('div', 'tp-note', T(tr('Start when the receiver is switched on; it stops by itself at RTK Fix (fix quality 4 from the guidance computer).'))));
      box.appendChild(el('div', 'tp-note', T(tr('Now')) + ': ' + ((statusBar && statusBar.fixText) || '—')
        + (isRunning ? ' · ' + Math.round((Date.now() - d.t0) / 1000) + ' s' : d.seconds != null ? ' · ' + T(tr('Time to RTK Fix')) + ': ' + d.seconds + ' s' : '')));
      const r = el('div', 'tb-row');
      if (!isRunning) btn(r, tr('Start'), () => { setStep(step, { t0: Date.now(), seconds: null }); running = { k: step, kind: s.kind }; save(); last = ''; render(); }, 'pri');
      else btn(r, tr('Stop'), () => { running = null; save(); last = ''; render(); });
      box.appendChild(r);
    } else if (s.kind === 'run') {
      box.appendChild(el('div', 'tp-note', T(s.turn
        ? tr('Engage steering on a line with U-turns on, start, let it turn and come back onto the next line, then stop.')
        : s.roll ? tr('Engage steering on a line across the slope, start, drive, stop.') : tr('Engage steering on a straight line, start, drive, stop.'))));
      box.appendChild(el('div', 'tp-note', T(tr('Counted only while the guidance computer steers on the line (engaged, not "not steering"){x}.', { x: s.turn ? '' : T(tr(', not in a U-turn')) }))));
      const st = A.stats(d.xte);
      box.appendChild(el('div', 'tp-note', st ? T(tr('Cross-track error: mean {m} cm, maximum {x} cm, spread {s} cm ({n} values)', { m: A.cm(st.mean), x: A.cm(st.max), s: A.cm(st.sd), n: st.n })) : T(tr('No values yet.'))));
      const rl = A.stats(d.roll);
      if (s.roll && rl) box.appendChild(el('div', 'tp-note', T(tr('Roll from the guidance computer: mean {m}°, maximum {x}°', { m: rl.mean.toFixed(1), x: rl.max.toFixed(1) }))));
      if (s.turn) box.appendChild(el('div', 'tp-note', T(d.turned ? tr('U-turn driven.') : tr('No U-turn seen yet.'))));
      box.appendChild(el('div', 'tp-note', T(tr('Your limits in cm (empty = not checked):'))));
      const lim = d.lim || {}, lr = el('div', ''); lr.style.cssText = 'display:flex;gap:12px';
      for (const [k2, l] of [['mean', tr('Mean, amount')], ['max', tr('Maximum')], ['sd', tr('Spread')]]) {
        const c = el('div', ''); c.style.cssText = 'flex:1;min-width:0'; lr.appendChild(c);
        field(c, l, lim[k2] == null ? '' : A.cm(lim[k2]), v => { setStep(step, { lim: { ...(sd(step).lim || {}), [k2]: parseCm(v) } }); save(); last = ''; render(); }, 'decimal');
      }
      box.appendChild(lr);
      const w = A.within(st, d.lim);
      if (w != null) box.appendChild(el('div', 'tp-note' + (w ? '' : ' warn'), T(w ? tr('Within your limits.') : tr('Outside your limits.'))));
      const r = el('div', 'tb-row');
      if (!isRunning) btn(r, d.xte && d.xte.length ? tr('Measure again') : tr('Start'), () => { setStep(step, { xte: [], roll: [], turned: false, lastMs: null }); running = { k: step, kind: s.kind }; last = ''; render(); }, 'pri');
      else btn(r, tr('Stop'), () => { running = null; save(); last = ''; render(); });
      box.appendChild(r);
    } else if (s.kind === 'off') {
      box.appendChild(el('div', 'tp-note', T(step === 'offButton'
        ? tr('Engage steering, start, then switch it off with the button (on the screen or the steer switch).')
        : tr('Engage steering, start, then turn the steering wheel by hand until the steering lets go.'))));
      box.appendChild(el('div', 'tp-note', T(tr('The guidance computer reports only that steering stopped, not why; whether it was this action is your call.'))));
      box.appendChild(el('div', 'tp-note', d.seenAt ? T(tr('Steering stopped {s} s after it was armed.', { s: ((d.seenAt - d.armed) / 1000).toFixed(1) }))
        : isRunning ? T(d.armed ? tr('Armed: steering is on. Now switch it off.') : tr('Waiting for steering to be engaged…')) : T(tr('Not measured yet.'))));
      const r = el('div', 'tb-row');
      if (!isRunning) btn(r, tr('Start'), () => { setStep(step, { armed: null, seenAt: null, how: null }); running = { k: step, kind: s.kind }; last = ''; render(); }, 'pri');
      else btn(r, tr('Stop'), () => { running = null; save(); last = ''; render(); });
      box.appendChild(r);
    } else if (s.kind === 'direction') {
      const g = config && config.gps || {}, dual = !!g.isDualGps;
      const now = { dual, dualOk: dual && !!statusBar && !statusBar.dualHeadingMissing,
        confirmed: typeof TabletSteerConfirm !== 'undefined' && TabletSteerConfirm.confirmed };
      box.appendChild(el('div', 'tp-note', T(dual ? (now.dualOk ? tr('Dual antenna: the dual heading arrives.') : tr('Dual antenna: no dual heading.'))
        : now.confirmed ? tr('One antenna: the direction was confirmed on the card since the start.') : tr('One antenna: the direction is not confirmed yet. Drive forward a few metres and confirm it on the card.'))));
      const r = el('div', 'tb-row');
      btn(r, tr('Take this state'), () => { setStep(step, now); save(); last = ''; render(); }, 'pri');
      box.appendChild(r);
      if (d.dual != null) box.appendChild(el('div', 'tp-note', T(tr('Taken')) + ': ' + A.values(s, d)));
    }
    // Result and remark
    const rr = el('div', 'tb-row');
    for (const res of ['pass', 'fail', 'skip']) {
      const b = btn(rr, A.RES[res], () => { setStep(step, { res: d.res === res ? '' : res }); save(); last = ''; render(); }, d.res === res ? 'pri' : '');
      b.setAttribute('aria-pressed', d.res === res ? 'true' : 'false');
    }
    box.appendChild(rr);
    field(box, tr('Note'), d.note, v => { setStep(step, { note: v }); save(); });
    const nav = el('div', 'tb-row');
    const i = A.STEPS.findIndex(x => x.k === step);
    btn(nav, '← ' + T(tr('Back')), () => { stopAll(); step = null; last = ''; render(); });
    if (i < A.STEPS.length - 1) btn(nav, tr('Next step'), () => { stopAll(); step = A.STEPS[i + 1].k; last = ''; render(); });
    box.appendChild(nav);
  }

  // --- Export ------------------------------------------------------------------------------------
  const HEAD = () => ({ kit: [tr('Customer'), tr('Tractor'), tr('Vehicle profile'), tr('Date'), tr('Antenna height (m)'), tr('Antenna pivot (m)'),
    tr('Antenna offset (m)'), tr('Wheelbase (m)'), tr('Antenna'), tr('Dual heading offset (°)')].map(T),
    steps: [tr('Step'), tr('Result'), tr('Measured'), tr('Limits'), tr('Note')].map(T) });
  function download(rec) {
    const out = A.csv(rec, HEAD(), T);
    try {
      const url = URL.createObjectURL(new Blob([out], { type: 'text/csv;charset=utf-8' }));
      const a = el('a'); a.href = url; a.download = 'abnahme-' + A.dDate(rec.start).split('.').reverse().join('-') + '.csv';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      msg = tr('File created. If nothing is downloaded on this tablet, print it as a PDF from a browser on a PC.');
    } catch (_) { msg = tr('Download not possible here.'); }
    last = ''; render();
  }
  const esc = x => String(x == null ? '' : x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function print(rec) {
    const box = document.getElementById('tui-print'); if (!box) return;
    const k = rec.kit || {}, H = HEAD();
    const kv = H.kit.map((h, i) => [h, [k.customer, k.tractor, k.vehicleProfile, A.dDate(rec.start), k.antennaHeight, k.antennaPivot, k.antennaOffset, k.wheelbase,
      k.dual ? T(tr('dual')) : T(tr('single')), k.dualHeadingOffset][i]]);
    // Product name and version under the heading; origin and licence (Apache 2.0) at the foot.
    const ver = (typeof appInfo !== 'undefined' && appInfo && appInfo.version) || '';
    box.innerHTML = '<section class="wl-page"><h1>' + esc(T(tr('Acceptance record'))) + '</h1>'
      + '<p class="wl-n">' + esc(BRAND.name + (ver ? ' ' + ver : '')) + '</p>'
      + '<table>' + kv.map(([h, v]) => '<tr><th>' + esc(h) + '</th><td>' + esc(v == null ? '—' : v) + '</td></tr>').join('') + '</table><p></p>'
      + '<table><tr>' + H.steps.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr>'
      + A.STEPS.filter(s => s.kind !== 'kit').map(s => { const d = (rec.steps || {})[s.k] || {};
        return '<tr>' + [T(s.t), d.res ? T(A.RES[d.res]) : '—', A.values(s, d), A.limits(d), d.note].map(v => '<td>' + esc(v) + '</td>').join('') + '</tr>'; }).join('')
      + '</table><p class="wl-n">' + esc(T(tr('Cross-track error and roll as the guidance computer reports them. Limits entered by the fitter. Signatures:'))) + '</p>'
      + '<p>' + esc(T(tr('Fitter'))) + ': ______________________ &nbsp; ' + esc(T(tr('Customer'))) + ': ______________________</p>'
      + '<p class="wl-n">' + esc(T(tr('Changed version (fork) of AgOpenWeb, based on AgOpenWeb; changed since October 2026. AgOpenWeb builds on AgOpenGPS (Brian Tee and contributors).')))
      + ' ' + esc(T(tr('Licensed under the Apache License 2.0. You may use, change and pass it on; the source code is open.'))) + '</p></section>';
    document.documentElement.setAttribute('data-print', 'worklog');
    const done = () => { document.documentElement.removeAttribute('data-print'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    try { window.print(); } catch (_) { done(); }
    setTimeout(() => { if (document.documentElement.hasAttribute('data-print')) { msg = tr('If no print dialog opened, this app view cannot print; use a browser on a PC.'); last = ''; render(); } }, 1500);
  }

  // --- Menu tile (setup) ------------------------------------------------------------------------
  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6v3H9z"/><path d="M6 5h12v16H6z"/><path d="M9 13l2 2 4-4"/></svg>';
  setInterval(() => {
    const m = document.getElementById('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const sBox = m.querySelector('.tui-tiles.tui-s'); if (!sBox || m.querySelector('[data-tile="accept"]')) return;
    const t = el('button', 'tui-tile setup'); t.dataset.tile = 'accept'; t.innerHTML = IC + '<span></span>';
    t.querySelector('span').textContent = T(tr('Acceptance record'));
    onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) tuiPress(x); open(); });
    sBox.appendChild(t);
  }, 300);
  return { open };
})();
