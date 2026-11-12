// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: the host's English texts in German (TabletHostText).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

// ===== Tablet UI (Phase 2c): known host texts in German ==============================
// The host sends the fix quality and the NTRIP state as fixed English texts. Known ones are
// translated for display; addresses and caster replies inside them stay as they are, and
// anything unknown stays English. Exact texts are keys (the page translates them itself);
// texts with a variable part are rewritten on the elements that show them.
// hosttext:begin
const TabletHostText = (() => {
  [tr('No Fix'), tr('GPS Fix'), tr('DGPS Fix'), tr('RTK Fixed'), tr('RTK Float'), tr('Connected'), tr('Caster sent an invalid reply'),
   tr('Success: Connected to caster and mount point')];
  const FIX = /\b(No Fix|GPS Fix|DGPS Fix|RTK Fixed|RTK Float)\b/g;
  // The NTRIP outcome behind "Error: …" (Test button), "Connection failed: …" and "Rejected: …"
  // (host: ConnectionErrors, NtripConnection, NtripResponse, NtripConnectionTester): the sentence
  // in German, the address, port and caster reply as the host wrote them (moritz.31, point 8).
  const NT_EXACT = new Set([tr('No network connection.'), tr('The caster sent an invalid reply.'), tr('Caster sent an empty reply'),
    tr('Mount point not found (the caster sent its source table)'), tr('Mount point not found'),
    tr('This address answered with a web page, not an NTRIP caster. Check the address and port.'),
    tr('Authentication failed (check username, password and mount point)'), tr('Authentication failed (check username and password)'),
    tr('The caster cannot take another connection now: it is busy, starting up, or this login is in use.'),
    tr('This caster needs your e-mail address as user name.'), tr('The caster closed the connection.'),
    tr('Caster host is required'), tr('Mount point is required')]);
  const NT_RX = [
    [/^No answer from (.+)\.$/s, w => tr('No answer from {w}.', { w })],
    [/^Cannot reach (.+)\. Is the base station or caster switched on\?$/s, w => tr('Cannot reach {w}. Is the base station or caster switched on?', { w })],
    [/^Cannot find (.+)\. Check the address and your internet connection\.$/s, w => tr('Cannot find {w}. Check the address and your internet connection.', { w })],
    [/^Cannot reach (.+) \(no route\)\.$/s, w => tr('Cannot reach {w} (no route).', { w })],
    [/^(.+) closed the connection without answering\.$/s, w => tr('{w} closed the connection without answering.', { w })],
    [/^(\S+) closed the connection\.$/s, w => tr('{w} closed the connection.', { w })],
    [/^Cannot connect to (.+) \((\w+)\)\.$/s, (w, c) => tr('Cannot connect to {w} ({c}).', { w, c })],
    [/^Caster is busy or unavailable: (.+)$/s, r => tr('Caster is busy or unavailable: {r}', { r })],
    [/^Caster refused: (.+)$/s, r => tr('Caster refused: {r}', { r })],
    [/^Access denied: (.+)$/s, r => tr('Access denied: {r}', { r })],
    [/^Unexpected caster reply: (.+)$/s, r => tr('Unexpected caster reply: {r}', { r })],
  ];
  function ntDe(x) {
    if (NT_EXACT.has(x)) return I18n.text(x);
    for (const [re, f] of NT_RX) { const m = re.exec(x); if (m) return f(...m.slice(1)); }
    return x;
  }
  const PAT = [
    [/^Connecting to (.+)…$/s, x => tr('Connecting to {x}…', { x })],
    [/^Connected to (.+)$/s, x => tr('Connected to {x}', { x })],
    [/^Connection failed: (.+)$/s, x => tr('Connection failed: {x}', { x: ntDe(x) })],
    [/^Rejected: (.+)$/s, x => tr('Rejected: {x}', { x: ntDe(x) })],
    [/^Error: (.+)$/s, x => tr('Error: {x}', { x: ntDe(x) })],
    [/^(.+) — reconnecting…$/s, x => tr('{x} — reconnecting…', { x })],
  ];
  // Point 11: the host's fixed failure texts (MainViewModel ReportFailure → toast). Texts with a
  // value inside (file names, counts, error messages) stay English.
  const TOASTS = new Set([
    tr('A and B must be at least 1 m apart'),
    tr('AutoSteer is off while the steer wizard is open'),
    tr('AutoSteer not available - no active track'),
    tr('AutoSteer off: no GPS/guidance update for over 1 s'),
    tr('Boundary not saved - need at least 3 points'),
    tr('Cannot flip U-turn direction while executing'),
    tr('Cannot save boundary - no field is open'),
    tr('Cannot smooth AB lines (only 2 points)'),
    tr('Cannot start playback (need at least 5 points)'),
    tr('Close the field before deleting it'),
    tr('Close the job before deleting it'),
    tr('Guidance stopped - contour off'),
    tr('Guidance stopped: track changed'),
    tr('ISO-XML file contains no field (PFD)'),
    tr('ISO-XML file has no coordinates to import'),
    tr('ISO-XML file has no usable boundary'),
    tr('Invalid heading'),
    tr('Invalid latitude (must be -90 to 90)'),
    tr('Invalid longitude (must be -180 to 180)'),
    tr('Invalid point selection'),
    tr('Load a field with a boundary first'),
    tr('Module check error'),
    tr('Need at least 2 tracks to build a boundary'),
    tr('Network error'),
    tr('No GPS fix — Drive In needs current position'),
    tr('No GPS position - cannot create A+ line'),
    tr('No GPS position - cannot place flag'),
    tr('No boundary available'),
    tr('No boundary for headland'),
    tr('No boundary polygons found in KML'),
    tr('No clip line defined'),
    tr('No field open'),
    tr('No field open or no KML polygons parsed'),
    tr('No fields directory found'),
    tr('No fields within 0.5 km'),
    tr('No flags to delete'),
    tr('No headland defined'),
    tr('No headland to adjust - build one first'),
    tr('No headland to clip - use Build first'),
    tr('No other fields with tracks found'),
    tr('No previous field to resume'),
    tr('No track selected'),
    tr('No track selected for U-turn'),
    tr('No tracks found in selected field'),
    tr('No tracks to cycle'),
    tr('No tracks to delete'),
    tr('No valid boundary'),
    tr('No valid boundary to create headland from'),
    tr('No visible tracks'),
    tr('Not enough points in segment'),
    tr('Nothing to undo'),
    tr('Open a field first'),
    tr('Open a field first before importing a boundary'),
    tr('Open a field first before importing tracks'),
    tr('Open a field first before recording a boundary'),
    tr('Open a field first to add boundary'),
    tr('Press Drive In again'),
    tr('Select 2 points on the boundary first'),
    tr('Select a boundary first'),
    tr('Select a boundary to delete'),
    tr('Steer module stopped steering (kickout, switch or button)'),
    tr('This track has no ends to adjust'),
    tr('Too few points to smooth (need at least 5)'),
    // Why the app turned the steering off (upstream #442) and other plain host toasts.
    tr('AutoSteer disengaged - outside boundary'), tr('AutoSteer disengaged - RTK fix lost'),
    tr('AutoSteer disengaged'), tr('Guidance stopped: track changed'), tr('No aerial imagery: no internet?')]);
  // Toasts with a value inside: the value stays as the host wrote it.
  const TOAST_RX = [
    [/^AutoSteer disengaged - above maximum steering speed \((.+)\)$/s, s => tr('AutoSteer disengaged - above maximum steering speed ({s})', { s })],
    [/^AutoSteer disengaged - below minimum steering speed \((.+)\)$/s, s => tr('AutoSteer disengaged - below minimum steering speed ({s})', { s })],
  ];
  const toastDe = msg => { for (const [rx, f] of TOAST_RX) { const m = rx.exec(msg); if (m) return I18n.text(f(m[1])); } return msg; };
  // Host-paket D (#11): the host's failure texts with values, sent as a key with {name}
  // placeholders and the values; the sentence is translated, the values (error messages, file
  // names, counts) stay as they are. Listed so the extractor finds the keys.
  const KEYED = new Set([
    tr('Error creating boundary: {error}'), tr('Error deleting field: {error}'), tr('Error creating field: {error}'),
    tr('Error importing KML: {error}'), tr('Error importing ISO-XML: {error}'), tr('Debug dump failed: {error}'),
    tr('Bug report capture failed: {error}'), tr('Bug report saved (no details): {path}'), tr('Bug report failed: {error}'),
    tr('Need at least 3 points for a curve (have {n})'), tr('Need at least 2 points (have {n})'), tr('Save failed: {error}'),
    tr('Failed to load: {file}'), tr('Failed to load: {error}'), tr('Import failed: {error}'),
    tr('Need at least 3 points for contour (have {n})'), tr('Failed to open field: {error}'), tr('Error parsing KML: {error}'),
    tr('Error importing KML boundary: {error}')]);
  function keyed(msg, key, args) {
    let a = null; try { a = JSON.parse(args); } catch (_) { /* no values */ }
    return KEYED.has(key) && a && typeof a === 'object' ? tr(key, a) : msg;
  }
  showToast = (orig => function (msg, ms) { return orig(typeof msg !== 'string' || !tuiIsDe() ? msg : TOASTS.has(msg) ? I18n.text(msg) : toastDe(msg), ms); })(showToast);
  function de(s) {
    if (!tuiIsDe()) return s;
    for (const [re, f] of PAT) { const m = s.match(re); if (m) return f(m[1]); }
    return s.replace(FIX, k => I18n.text(k));
  }
  function fix(node) {
    const v = node.nodeValue;
    if (!v || !/[A-Za-z]{3}/.test(v)) return;
    const out = de(v);
    if (out !== v) node.nodeValue = out;
  }
  const obs = new MutationObserver(recs => {
    for (const r of recs) {
      if (r.type === 'characterData') fix(r.target);
      else for (const n of r.addedNodes) {
        if (n.nodeType === Node.TEXT_NODE) fix(n);
        else if (n.nodeType === Node.ELEMENT_NODE) { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); for (let t = w.nextNode(); t; t = w.nextNode()) fix(t); }
      }
    }
  });
  // Where the host's texts are shown: status bar, GPS popup, Network IO, System Data, NTRIP test.
  const IDS = ['sb-fix', 'sb-gps-d', 'gc-fix', 'nio-ntrip-status', 'nio-ntrip-rx', 'sd-fix', 'nte-teststatus', 'nte-fb-teststatus'];
  for (const id of IDS) { const e = document.getElementById(id); if (e) obs.observe(e, { subtree: true, childList: true, characterData: true }); }
  return { de, keyed };
})();
// hosttext:end
