// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: labels, moved buttons, camera pad, German units (TabletPolish).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

// ===== Tablet UI (Phase 2b): polish and German ===================================
// Display only, like Phases 1 and 2: the labels, the moved buttons and the camera pad change
// what is shown; every press still goes to the original button and its handler.
//   aow.ui.langChosen = auto | user   — German was set once as the default / a language was picked
// Numbers and units follow the language: German gets the decimal comma, km/h and ha/h. The
// formatters below are global so the Phase 2 renderers (called during their first frame) find them.
const TabletPolish = (() => {
  const root = document.documentElement;
  const $ = id => document.getElementById(id);
  const lsGet = (k, d) => { try { const v = window.localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch (_) { /* private / blocked */ } };

  // --- Units and numbers in German ------------------------------------------------------
  // German: decimal comma, and number and unit stay on one line (no-break space).
  fmtUnit = (orig => function (v, u, dec) { const r = tuiDec(orig(v, u, dec)); return tuiIsDe() ? r.replace(' ', '\u00a0') : r; })(fmtUnit);
  unitLabel = (orig => function (u) { const l = orig(u); return tuiIsDe() && l === 'kph' ? 'km/h' : l; })(unitLabel);
  fmtRate = (orig => function (h) { const r = orig(h); return tuiIsDe() ? r.replace(/\/hr$/, '/h') : r; })(fmtRate);
  // Readouts the upstream code writes with toFixed(): rewritten in place (decimal comma).
  // The rotating status line also carries field / job / track names (user data): there only
  // the degrees of the AB heading are rewritten; area and rate already come from fmtUnit.
  const DEC_IDS = ['sb-speed', 'sb-unit', 'sb-hdg', 'sb-age', 'sb-rot', 'lb', 'roll-deg', 'sim-speedval', 'sim-steerval', 'bn-nudgeval'];
  function fixText(node) {
    if (!tuiIsDe()) return;
    const v = node.nodeValue;
    if (!v || !/\d\.\d|kph|\/hr/.test(v)) return;
    const out = node.parentElement && node.parentElement.closest('#sb-rot')
      ? v.replace(/(\d)\.(\d+°)/g, '$1,$2')
      : tuiDec(v).replace(/\bkph\b/g, 'km/h').replace(/ha\/hr\b/g, 'ha/h');
    if (out !== v) node.nodeValue = out;
  }
  function fixAll(elm) {
    const w = document.createTreeWalker(elm, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) fixText(n);
  }
  const decObs = new MutationObserver(recs => {
    for (const r of recs) {
      if (r.type === 'characterData') fixText(r.target);
      else for (const n of r.addedNodes) { if (n.nodeType === Node.TEXT_NODE) fixText(n); else if (n.nodeType === Node.ELEMENT_NODE) fixAll(n); }
    }
  });
  for (const id of DEC_IDS) { const e = $(id); if (e) { decObs.observe(e, { subtree: true, childList: true, characterData: true }); fixAll(e); } }

  // --- German as the default language --------------------------------------------------------
  // Once per device: if the host still speaks English and German is offered, switch to German
  // with the existing language command. Picking a language in the language panel ends that.
  // Only the device holding control does it, so an observer tablet never flips the host.
  const LANG_KEY = 'aow.ui.langChosen';
  let langDone = false; // also in memory: with storage blocked it would switch back every second
  setInterval(() => {
    if (langDone || !appInfo || !iHoldControl || lsGet(LANG_KEY, '')) return;
    const de = (appInfo.languages || []).some(l => l.code === 'de');
    if (de && (appInfo.currentLanguage || 'en') === 'en') transport.send('app.setLanguage|de');
    lsSet(LANG_KEY, 'auto'); langDone = true;
  }, 1000);
  const langList = $('lang-list');
  if (langList) langList.addEventListener('pointerdown', () => { lsSet(LANG_KEY, 'user'); langDone = true; }, true);

  // --- Distances with a label ---------------------------------------------------------------
  // The name in the label size, the value as before: "Vorgewende 319,0 m". The upstream
  // renderers write the plain value every frame; the name goes in front of it again.
  function labelled(node, key) {
    const first = node.firstElementChild;
    if (first && first.classList.contains('tui-dk')) return;
    node.innerHTML = '<span class="tui-dk">' + esc(I18n.text(key)) + '</span> ' + esc(node.textContent);
  }
  updateHeadlandHud = (orig => function () {
    orig();
    if (hlHud.style.display === 'block' && tuiHeadlandText()) labelled(hlHud, tr('Headland'));
  })(updateHeadlandHud);
  renderUTurnIndicator = (orig => function () {
    orig();
    if (UTI.root && !UTI.root.hidden && tuiUTurnText()) labelled(UTI.dist, tr('U-Turn'));
  })(renderUTurnIndicator);

  // --- Camera pad: hidden while driving; a tap on the map shows it for 5 s -------------------------
  const pad = $('campad');
  let camTimer = 0;
  function showCam() {
    root.setAttribute('data-tui-cam', '');
    clearTimeout(camTimer);
    camTimer = setTimeout(() => root.removeAttribute('data-tui-cam'), 5000);
  }
  const ck = $('ck');
  // Only touches that reach the map: overlays stop their own pointer events.
  window.addEventListener('pointerdown', e => { if (e.target === ck || e.target === document.body) showCam(); });
  if (pad) pad.addEventListener('pointerdown', showCam); // keep it up while it is used

  // --- Bottom bar: a name under every button; rarely used ones go to the menu ---------------------
  const BN_LABEL = [ // [selector in .bn-bar, label, moved to the menu]
    ['#bn-skipcycle', tr('Skip rows'), true],
    ['#bn-skiptoggle', tr('Skip mode'), true],
    ['[data-cmd="map.cycleColor"]', tr('Coverage colour'), true],
    ['[data-cmd="tool.resetHeading"]', tr('Reset tool heading'), true],
    ['#bn-flags', tr('Flags'), false],
    ['[data-cmd="track.snapLeft"]', tr('Track left'), false],
    ['[data-cmd="track.snapRight"]', tr('Track right'), false],
    ['[data-cmd="track.snapPivot"]', tr('Line to me'), false],
    ['#bn-tram', tr('Tram lines'), true],
    ['#bn-abmenu', tr('AB Line'), false],
  ];
  const bar = document.querySelector('#bottomnav .bn-bar');
  if (bar) for (const [sel, label, moved] of BN_LABEL) {
    const b = bar.querySelector(':scope > ' + sel);
    if (!b) continue;
    const l = document.createElement('span'); l.className = 'tui-bn-lbl'; l.textContent = label;
    b.appendChild(l);
    if (moved) b.classList.add('tui-bnmove');
  }

  // --- On-screen U-turn / track shift: framed buttons with a name ----------------------------------
  const OSB_LABEL = { 'youturn.manualLeft': tr('U-turn left'), 'youturn.manualRight': tr('U-turn right'),
    'track.snapLeft': tr('Track left'), 'track.snapRight': tr('Track right') };
  for (const b of document.querySelectorAll('#onscreenbtns .osb-btn')) {
    const t = OSB_LABEL[b.dataset.cmd];
    if (!t) continue;
    const l = document.createElement('span'); l.className = 'tui-osb-lbl'; l.textContent = t;
    b.appendChild(l);
  }

  // With its label the U-turn readout can be too wide for the gap between the cross-track
  // readout and the quick bar (7" screens): then it moves under the readout, right-aligned.
  function placeUTurn() {
    const u = UTI.root, rn = $('rightnav');
    if (!u || u.hidden || !rn) { root.removeAttribute('data-tui-uti-low'); return; }
    const low = root.hasAttribute('data-tui-uti-low');
    if (low) root.removeAttribute('data-tui-uti-low'); // measure in the normal place
    const r = u.getBoundingClientRect(), q = rn.getBoundingClientRect();
    const hit = q.width > 0 && r.right > q.left - 6 && r.left < q.right && r.top < q.bottom && r.bottom > q.top;
    if (hit) { root.setAttribute('data-tui-uti-low', ''); root.style.setProperty('--tui-uti-r', (innerWidth - q.left + 8) + 'px'); }
  }
  setInterval(placeUTurn, 300);

  return { showCam };
})();
