// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: steering off with one tap whatever is open (TabletSteerOff).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

// ===== Steering off with one tap, whatever is open (review 10.11.2026, measure 1) ================
// While steering is on, the place of the Steer button (#rn-steer) always switches it off with one
// tap. When something covers that place (the menu, a sheet, a settings page, a dialog, the
// keyboard, the loading screen, any layer now or later), a red "Steering off" button is put over
// it, above every layer. It only ever sends the host's explicit off (autosteer.off, never a
// toggle: from a stale state it can't switch steering on), and it swallows the tap and the click
// the browser makes after it, so a tap there never reaches what lies underneath; after the tap it
// stays a moment as "Steering is off", so the finger's click lands on it, not on a tile.
// Uncovered, the Steer button is upstream's own and toggles as before. Only on the device that
// has control (an observer's command would be dropped). Tested by Tests/web/steeroff.test.mjs
// (block steeroff:begin/end) and, on every layer of the real app, Tools/steer-off-check.mjs.
// steeroff:begin
const TabletSteerOff = (() => {
  const HOLD_MS = 900; // after the tap: dead zone for the click that follows a touch
  const btn = document.createElement('button');
  btn.id = 'tui-steeroff'; btn.type = 'button'; btn.hidden = true; btn.setAttribute('translate', 'no');
  btn.innerHTML = '<span class="so-ic">✕</span><span class="so-t"></span>';
  document.body.appendChild(btn);
  const label = btn.querySelector('.so-t');
  let lastRect = null, holdUntil = 0;
  const steerOn = () => connState === 'connected' && !!iHoldControl && !!(tick && tick.op && tick.op.autoSteer);
  function steerRect() {
    const s = document.getElementById('rn-steer');
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight ? r : null;
  }
  // The Steer button is what a finger there hits: checked at its middle and near its corners.
  function covered(r) {
    const s = document.getElementById('rn-steer');
    const pts = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]];
    for (const [fx, fy] of pts) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      const top = document.elementsFromPoint(x, y).find(e => e !== btn && !btn.contains(e));
      if (!top || !(top === s || s.contains(top))) return true;
    }
    return false;
  }
  function place(r) {
    btn.style.left = Math.round(r.left) + 'px'; btn.style.top = Math.round(r.top) + 'px';
    btn.style.width = Math.round(r.width) + 'px'; btn.style.height = Math.round(r.height) + 'px';
  }
  // Without the button on screen (never laid out yet): its usual place, right edge, middle.
  const fallback = () => ({ left: window.innerWidth - 104, top: Math.round(window.innerHeight / 2 - 42), width: 96, height: 84 });
  function update() {
    const now = performance.now();
    const r = steerRect();
    if (r) lastRect = { left: r.left, top: r.top, width: r.width, height: r.height };
    const holding = now < holdUntil;
    const show = holding || (steerOn() && (!r || covered(r)));
    if (show) {
      place(r || lastRect || fallback());
      const t = I18n.text(holding ? tr('Steering is off') : tr('Steering off'));
      if (label.textContent !== t) label.textContent = t;
      btn.classList.toggle('done', holding);
    }
    if (btn.hidden === show) btn.hidden = !show;
  }
  function frame() { update(); requestAnimationFrame(frame); }
  const swallow = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  btn.addEventListener('pointerdown', e => {
    swallow(e);
    if (performance.now() < holdUntil) return; // the dead zone: nothing at all
    transport.send('autosteer.off');
    holdUntil = performance.now() + HOLD_MS;
    update();
  });
  for (const t of ['pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'contextmenu']) btn.addEventListener(t, swallow);
  requestAnimationFrame(frame);
  return { update, get shown() { return !btn.hidden; } };
})();
// steeroff:end
