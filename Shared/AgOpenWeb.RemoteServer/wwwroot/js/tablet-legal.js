// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: notice at first start (TabletLegal).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

// ===== Notice at first start (feature/auslieferung) ===========================================
// The liability notice from docs/Rechtliches-Entwurf.md (section A, a DRAFT, not legally checked),
// shown once per device and text version until "Read and understood". Stored only in this
// browser. It switches nothing; the first setup waits for it.
// legal:begin
const TabletLegal = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const KEY = 'aow.legal', VERSION = '2026-10-draft2'; // a changed text is shown and confirmed again
  const TEXT = [
    tr('This app is a steering aid. It does not replace the driver.'),
    tr('You stay responsible for the vehicle, the tool and your surroundings at all times. Stay at the wheel and step in when something is wrong.'),
    tr('The app comes without any warranty. It can have faults; GPS, correction data, modules and settings can give wrong values.'),
    tr('Do not use on public roads. Switch steering off as soon as people are in the driving area.'),
    tr('Before the first use, check everything calmly: dimensions, steering direction, switching the steering off. This version is a test version.'),
    tr('The app is licensed under the Apache License 2.0. It is a changed version of AgOpenWeb; the source code is open.'),
  ];
  const acked = () => { try { return localStorage.getItem(KEY) === VERSION; } catch (_) { return false; } };
  const scrim = el('div', 'tp-scrim'), box = el('div'); box.id = 'tui-legal'; box.setAttribute('translate', 'no'); box.hidden = true;
  document.body.append(scrim, box);
  for (const n of [scrim, box]) n.addEventListener('pointerdown', e => e.stopPropagation());
  function show() {
    box.innerHTML = '';
    box.appendChild(el('div', 'lg-n', BRAND.name)); // product name, never translated (box is translate=no)
    box.appendChild(el('div', 'lg-t', T(tr('Please read before use'))));
    const ol = el('ol', 'lg-l'); for (const t of TEXT) ol.appendChild(el('li', '', T(t))); box.appendChild(ol);
    const ok = el('button', 'tp-btn pri big', T(tr('Read and understood')));
    ok.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      try { localStorage.setItem(KEY, VERSION); } catch (_) { /* blocked storage: shown again next time */ }
      box.hidden = true; scrim.classList.remove('open'); done = true;
    });
    box.appendChild(ok);
    box.hidden = false; scrim.classList.add('open');
  }
  // Automated browsers (CI's layout check, tests) get no notice: it would cover what they measure.
  let done = acked() || !!navigator.webdriver;
  // The language is set at once, its dictionary arrives a moment later; the box is translate=no,
  // so the page never translates it afterwards: drawn again when the translation is there
  // (moritz.31 sweep: the notice stayed English on a German tablet).
  const title = () => T(tr('Please read before use'));
  const since = performance.now();
  const ready = () => String(I18n.language).startsWith('en') || title() !== 'Please read before use' || performance.now() - since > 5000;
  const t = setInterval(() => {
    if (done) { clearInterval(t); return; }
    if (box.hidden && typeof I18n !== 'undefined' && appInfo && ready()) show();
    else if (!box.hidden && box.querySelector('.lg-t').textContent !== title()) show();
  }, 500);
  return { get done() { return done || acked(); }, show };
})();
// legal:end
