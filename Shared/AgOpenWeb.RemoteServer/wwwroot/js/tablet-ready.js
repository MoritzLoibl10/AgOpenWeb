// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: ready-to-steer light (TabletReady).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

// ===== Ready-to-steer light (feature/bedienung-1) =============================================
// A traffic light in the status bar, left of the steer chip: display only, from states the
// client already has; it never sends a command and the steering logic is untouched.
// Red = something steering needs is missing (no data, no RTK fix as the host reports it, steer
// module not heard, no line). Yellow = steering works but check first: no IMU heard, or with one
// antenna the direction not yet confirmed on the card "Does the vehicle face the way it drives?"
// (TabletSteerConfirm; driving forward can't be told from backing with one antenna, so only the
// confirmation counts). The module flags are the host's own (gpsOk / autoSteerOk / imuOk); the
// fix is judged against the host's MinFixQuality (fixOk below), never looser than the host.
// Tap it for the list. In the demo mode (TabletDemo) it says "Demo" instead. Tested by
// Tests/web/ready.test.mjs (block ready:begin/end).
// ready:begin
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
  // Fix quality by goodness, not by its NMEA number: RTK Fix (4) > RTK Float (5) > DGPS (2) and
  // PPS (3) > GPS (1); 0 and the estimated/manual/simulated kinds (6, 7, 8) count as no fix. Green
  // needs both: the host's own gate (GpsFixQualityValidator: number < MinFixQuality is refused)
  // and at least the goodness of the minimum, so the light is never looser than the host and
  // RTK Float is not green when the minimum is RTK Fix. No minimum known (older host): RTK Fix.
  const RANK = { 4: 4, 5: 3, 2: 2, 3: 2, 1: 1 };
  const rank = q => RANK[q] || 0;
  function fixOk(q, minQ) {
    if (minQ == null) return q === 4;
    return q >= minQ && rank(q) >= rank(minQ) && rank(q) > 0;
  }
  // [level, label, detail]: level 2 = ok, 1 = check, 0 = missing.
  function checks() {
    const s = statusBar || {}, op = tick && tick.op, gps = config && config.gps;
    if (!live()) return [[0, tr('Connection'), connState === 'connected' ? tr('No current data from the guidance computer.') : tr('No connection to the guidance computer.')]];
    const out = [];
    if (s.gpsSentence === 'SIM') out.push([1, tr('GPS'), tr('Simulator: not a real position')]);
    else if (s.gpsLost || !s.gpsOk) out.push([0, tr('GPS'), tr('No GPS data')]);
    else {
      const minQ = gps && Number.isInteger(gps.minFixQuality) ? gps.minFixQuality : null, q = s.fixQuality | 0;
      const ok = fixOk(q, minQ);
      out.push([ok ? 2 : 0, tr('GPS'), (s.fixText || '') + (ok ? '' : ' – ' + (minQ != null
        ? tr('the guidance computer needs fix quality {n} or higher (now {q})', { n: minQ, q }) : T(tr('steering needs RTK Fix'))))]);
    }
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
    const key = JSON.stringify([demo, cs, pop.hidden, tuiLang(), T(word)]); // T(word): the dictionary may arrive after the language
    if (key === last) return;
    last = key;
    pill.dataset.lv = demo ? 'demo' : String(lvl);
    // A symbol in the light as well as the word (moritz.31, point 6): readable without colour.
    pill.querySelector('.rd-dot').textContent = demo ? '' : lvl === 2 ? '✓' : lvl === 1 ? '!' : '✕';
    pill.querySelector('.rd-t').textContent = T(word);
    pill.title = T(tr('Ready to steer')) + ': ' + T(word);
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
  return { checks, fixOk, get level() { return Math.min(...checks().map(c => c[0])); } };
})();
// ready:end
