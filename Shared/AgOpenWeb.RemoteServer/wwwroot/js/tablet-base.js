// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: shared helpers: presses made by code (tuiPress), the language signal (tuiLang, onI18n), number formatters.
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

// fork: a press made by code (a menu tile pressing the original button, the long-press replay).
// Upstream's ghost-press filter (js/map-input.js, #465) drops a pointerdown from a pointer that is
// already down. Presses made by code have no release, so with the default pointerId 0 every
// second one was dropped: a tile acted only on the second tap. Each press gets its own pointerId.
// press:begin
let tuiPressId = 1000000;
function tuiPressInit(init) { return { bubbles: true, cancelable: true, ...(init || {}), pointerId: ++tuiPressId }; }
function tuiPress(node, init) {
  if (!node) return false;
  return node.dispatchEvent(new PointerEvent('pointerdown', tuiPressInit(init)));
}
// press:end
// fork: the page's language as the fork modules must see it (review 10.11.2026, measure 3). The
// language is set at once, its dictionary arrives a moment later (i18n.js fetches it): a module
// that drew "de" before the dictionary was there kept its English. tuiLang() changes when the
// language or what its dictionary says changes; modules put it into their redraw keys instead of
// I18n.language, and onI18n(fn) runs fn then (event "aow:i18n" on window). Checked every 200 ms
// against a few words every dictionary has.
// i18n:begin
let tuiI18nGen = 0, tuiI18nKey = null;
const TUI_I18N_PROBES = ['Steering', 'Menu', 'Yes', 'Off', 'Back'];
function tuiI18nCheck() {
  if (typeof I18n === 'undefined') return false;
  const k = I18n.language + '|' + TUI_I18N_PROBES.map(w => I18n.text(w)).join('|');
  if (k === tuiI18nKey) return false;
  tuiI18nKey = k; tuiI18nGen++;
  try { window.dispatchEvent(new CustomEvent('aow:i18n', { detail: { language: I18n.language, gen: tuiI18nGen } })); } catch (_) { /* old engine */ }
  return true;
}
function tuiLang() { tuiI18nCheck(); return (typeof I18n !== 'undefined' ? I18n.language : 'en') + '#' + tuiI18nGen; }
function onI18n(fn) { window.addEventListener('aow:i18n', () => { try { fn(); } catch (e) { console.error(e); } }); }
setInterval(tuiI18nCheck, 200);
// i18n:end
// A setup sheet (bench checklist, backup) opened from the menu: in the terminal layout the
// terminal goes to setup mode first, as the setup tiles of TabletUi do.
function tuiEnterSetup() {
  if (typeof TabletTerminal !== 'undefined' && TabletTerminal.layout === 'terminal' && TabletTerminal.mode !== 'setup') TabletTerminal.setMode('setup');
}
// Upstream's panel hotkeys (F field menu, V vehicle) press with pointerId 0 as well, so every
// second key press did nothing (upstream too: docs/Upstream-Issues.md Nr. 7). Same press here.
if (typeof HOTKEY_UI !== 'undefined') {
  HOTKEY_UI.FieldMenu = () => tuiPress(document.getElementById('ln-fieldops'));
  HOTKEY_UI.VehicleSettings = () => tuiPress(document.getElementById('ln-vehicle'));
}

// Number and unit formatters (from Phase 2b, TabletPolish): global and in this first file, because
// TabletTerminal's renderers use them during their first frame, while the files load.
// fmt:begin
function tuiIsDe() { return String(I18n.language || 'en').split('-')[0] === 'de'; }
// "12.5" → "12,5" in German. Not for IP addresses or versions (two dots or more).
function tuiDec(s) {
  s = String(s);
  if (!tuiIsDe() || /\d\.\d+\.\d/.test(s)) return s;
  return s.replace(/(\d)\.(\d)/g, '$1,$2');
}
function tuiNum(v, dec) { return tuiDec(Number(v).toFixed(dec)); }
// Driving distances with what they measure: to the headland line ahead (tool pivot, along the
// heading) and to the start of the armed auto U-turn.
function tuiHeadlandText() {
  const on = config && config.display && config.display.headlandDistanceVisible;
  const d = tick ? tick.headlandDist : -1;
  if (!on || d == null || d < 0 || document.body.classList.contains('maptap')) return '';
  return tr('Headland {d}', { d: isMetric() ? fmtUnit(d, 'm', 1) : fmtUnit(d, 'm', 0) });
}
function tuiUTurnText() {
  const op = tick && tick.op;
  if (!(scene && scene.hasField && op && op.youturn && op.distToTrigger > 0)) return '';
  return tr('U-turn {d}', { d: fmtUnit(op.distToTrigger, 'm', 0) });
}
// fmt:end
