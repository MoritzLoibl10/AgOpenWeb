// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: start work (TabletWork).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

// ===== Start work (feature/bedienung-2) =======================================================
// One button that walks through: field → track → direction → ready light, then the drive view.
// Each step only opens what exists (Fields and Jobs, the track manager, the direction card's
// own two answers) and moves on by itself when the state is there. It finishes only on a green
// ready light and never switches steering on: that stays the operator's Steer button.
// Tested by Tests/web/work.test.mjs (block work:begin/end).
// work:begin
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
    const key = JSON.stringify([running, isOpen(), ss.map(s => [s.done, s.v]), tuiLang(), iHoldControl]);
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
    const f = m.querySelector('.tui-tiles.tui-f'); if (!f || m.querySelector('[data-tile="work"]')) return;
    const t = el('button', 'tui-tile field'); t.dataset.tile = 'work'; t.innerHTML = IC + '<span></span>';
    t.querySelector('span').textContent = T(tr('Start work'));
    onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) tuiPress(x); start(); });
    f.insertBefore(t, f.firstChild);
  }, 300);
  return { start, steps, finish };
})();
// work:end
