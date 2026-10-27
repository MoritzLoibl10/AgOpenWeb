// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// Renderer — consumes plain Scene + Tick objects via the transport interface.
// It has NO knowledge of SignalR or the wire format (see transport.js); swapping
// the transport at Phase 2 leaves this file untouched. Canvas2D for now; the
// CanvasKit swap (and client-side dead-reckoning) slot in here without touching
// the transport seam.

const ckcv = document.getElementById('ck'); // CanvasKit (Skia) — the sole renderer (matches native)

// Logical (CSS-pixel) canvas size. The backing store is scaled by the device
// pixel ratio so vectors render at native resolution on hi-DPI screens (tablets,
// retina) — otherwise thin strokes look faint and shimmer when panning. All draw
// code works in these logical coordinates; the Skia canvas applies scale(dpr) per frame.
let vw = innerWidth, vh = innerHeight, dpr = 1;
// Skia/CanvasKit renderer state — declared before resize() (which calls
// recreateSkSurface) to avoid a temporal-dead-zone ReferenceError.
let CK = null, skSurface = null, skTri = null, SKP = null;
let grCtx = null; // WebGL GrDirectContext — hoisted so the coverage render target shares it
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2); // cap: 3× phones don't need 9× fill
  vw = innerWidth; vh = innerHeight;
  ckcv.width = Math.round(vw * dpr);
  ckcv.height = Math.round(vh * dpr);
  ckcv.style.width = vw + 'px';
  ckcv.style.height = vh + 'px';
  recreateSkSurface(); // the GL surface is tied to the canvas size
}
addEventListener('resize', resize); resize();

// ---- model (fed by the transport) ----
let scene = null;      // SceneDto
let tick = null;       // TickDto (latest — for sections/HUD)
let lastTick = null;
const reverseBadge = document.getElementById('reverse-badge');   // newest authoritative pose (HUD readouts + guards)
// Ring of recent authoritative poses (oldest→newest). The render INTERPOLATES between
// the two that bracket the playback head. A MULTI-pose buffer (not just prev+last) is
// what lets RENDER_DELAY exceed the ~100 ms pose interval without the playhead falling
// off the old end → that off-the-end clamp was the 10 Hz "judder".
const poseBuf = [];
const POSE_BUF_MAX = 12; // ~1.2 s @ 10 Hz — plenty of bracket for the delay + WiFi jitter
// Render slightly in the PAST so every frame interpolates between two REAL poses instead of
// extrapolating/predicting past the latest. This is what kills the per-tick re-anchor snap
// (the whole-world jump at speed) AND the straight-line turn deviation — both are
// extrapolation artifacts. Cost: a small constant display lag (~RENDER_DELAY × speed). Must
// exceed the pose interval (~100 ms @ 10 Hz) plus arrival jitter so we rarely run out of buffer.
// Buffer depth behind the newest pose. Kept SMALL (low display lag) so the dead-reckoned
// vehicle sprite stays aligned with the host-accumulated coverage — a large delay made the
// tractor visibly trail its own coverage. WiFi inter-arrival spikes that would otherwise
// drain the buffer are bridged by EXTRAPOLATION (sample(), below) rather than a freeze, so
// we get smoothness without the lag. ~130 ms covers the pose interval + interpolation room.
const RENDER_DELAY = 130; // ms
// Max coverage cells rasterized per frame. A full-coverage snapshot (sent by the host on
// grid bounds-expansion / reconnect / field reload) can be hundreds of thousands of cells;
// draining it all in one frame is a multi-hundred-ms main-thread block that froze the map
// then jumped the tractor forward (issue #34). We instead drain up to this many cells per
// frame and resume the rest next frame (progress stored on batch.off), so a big snapshot
// paints over a handful of frames with no visible hitch. ~40k rects ≈ 1-2 ms/frame.
const COV_DRAIN_BUDGET = 40000;
// Max time we'll extrapolate past the newest pose when the buffer underruns (WiFi spike /
// dropped pose) before settling to a hold — bridges spikes without flying off on a real
// dropout. At field speed 200 ms is well under a pose-pair's worth of travel.
const EXTRAP_CAP_MS = 200;
// Smoothed client↔host clock offset: host_time ≈ client_time − clockOffset. Estimated from the
// host monotonic timestamp on each Tick (EMA, so one jittery arrival can't shift the timeline).
let clockOffset = null;
let connState = 'connecting…';
let ckStatus = 'loading…'; // CanvasKit init status (renderer migration prep)
let statusBar = null;  // top status-bar readouts (fix/age/sats/units/modules)
let config = null;     // config read-frame (vehicle config, …) for the left-nav panels
let configDirty = false; // a new config frame arrived → settings panels re-read it
let mapIsDay = false;  // day/night theme (mirrors config.display.isDayMode) — drives the
                       // CSS palette ([data-theme]) and the Skia map clear/grid colours
let profiles = null;   // Vehicle & Tool picker hub: profile lists + active pair
let profilesDirty = false;
let ntripProfiles = null; // Network IO: saved NTRIP profiles + associable fields
let ntripDirty = false;
let fieldOps = null;   // Field Operations: field list + jobs + suggestions + import files
let fieldOpsDirty = false;
let agShare = null;    // AgShare: settings + cloud action status/results
let agShareDirty = false;
let appInfo = null;    // File/App menu: version, languages, directories, hotkeys, logs
let appInfoDirty = false;
let fieldTools = null; // Field Tools read-frame: import-track field list
let fieldToolsDirty = false;
let recPath = null;    // Recorded Path read-frame: rec files + record/play state
let recPathTab = 0;    // client-side tab: 0 Record, 1 Playback
let recSelFile = null; // client-side selected saved path
let boundary = null;   // Boundary read-frame: menu list + drive-around recording state
let wizard = null;     // Steer Wizard frame (host-driven); null when not open
let wizardDirty = false;
let fps = 0;           // smoothed client render rate (for the GPS-detail card)
let _fpsFrames = 0, _fpsT0 = 0;
let _diagT0 = 0;       // throttle (~4 Hz) for the marker-gated diag line's DOM writes
let linkRttMs = null;  // EMA of server↔client round-trip (ms), from diag.ping/PONG
// Remote actuation authority (Phase 2 safety layer): our connection id (from the
// Hello frame), the latest broadcast control state, and whether we hold control.
let myClientId = null;
let lastControl = { held: false, holderId: '', holderName: '' };
let iHoldControl = false;

// ---- Units (issue #65) -------------------------------------------------------
// Everything the host sends and accepts is METRIC — vehicle/tool geometry in m,
// section widths / nudge / coverage margin in cm, speeds in km/h, areas in ha.
// Imperial is a *display/input boundary* conversion only, mirroring the native
// UnitConversion helper: convert when filling a control or formatting a readout,
// convert back before sending. Never store or transmit imperial.
//
// Markup contract (index.html):
//   <span class="u" data-unit="m"></span>   → unit label, text filled by applyUnits()
//   <input data-unit="m" …>                 → value converted on populate + on send
// The `step` attribute in the HTML is the METRIC step; imperial swaps in impStep
// (captured once into data-mstep so a unit flip is reversible). impStep matches dec so
// a written value always lands on the step grid — spinners are hidden by CSS, so step
// only drives input validation here, and a mismatch would flag a valid entry.
const UNIT_DEFS = {
  m:   { metric: 'm',    imp: 'ft',  toImp: v => v * 3.280839895, fromImp: v => v / 3.280839895, dec: 2, impStep: 0.01 },
  cm:  { metric: 'cm',   imp: 'in',  toImp: v => v / 2.54,        fromImp: v => v * 2.54,        dec: 1, impStep: 0.1 },
  kmh: { metric: 'kph', imp: 'mph', toImp: v => v * 0.621371192, fromImp: v => v / 0.621371192, dec: 1, impStep: 0.1 },
  km:  { metric: 'km',   imp: 'mi',  toImp: v => v * 0.621371192, fromImp: v => v / 0.621371192, dec: 2, impStep: 0.01 },
  ha:  { metric: 'ha',   imp: 'ac',  toImp: v => v * 2.471053815, fromImp: v => v / 2.471053815, dec: 2, impStep: 0.01 },
};
// The status frame is the single source of truth for the unit system; before the
// first frame arrives we assume metric (matches the host default).
function isMetric() { return !statusBar || statusBar.isMetric !== false; }
function unitLabel(u) { const d = UNIT_DEFS[u]; return d ? (isMetric() ? d.metric : d.imp) : (u || ''); }
function toDisplayUnit(v, u) { const d = UNIT_DEFS[u]; return (!d || isMetric()) ? v : d.toImp(v); }
function fromDisplayUnit(v, u) { const d = UNIT_DEFS[u]; return (!d || isMetric()) ? v : d.fromImp(v); }
// Round a display value to the precision that unit deserves (2 dp for m/ft, 1 for
// cm/in, …). Metric keeps the old 3-dp behaviour so stored values aren't truncated.
function roundDisplay(v, u) {
  const d = UNIT_DEFS[u];
  if (!d || isMetric()) return Math.round(v * 1000) / 1000;
  const p = Math.pow(10, d.dec);
  return Math.round(v * p) / p;
}
// "12.3 ft" — value (metric in) + unit suffix, formatted for the active system.
function fmtUnit(v, u, dec) {
  const d = UNIT_DEFS[u];
  const n = toDisplayUnit(v, u);
  return n.toFixed(dec != null ? dec : (d ? d.dec : 1)) + ' ' + unitLabel(u);
}
// Fill every `.u` label and re-step every `[data-unit]` input for the active system.
// Cheap enough to run on any unit flip (a few dozen nodes).
function applyUnits() {
  for (const el of document.querySelectorAll('span.u[data-unit]')) el.textContent = unitLabel(el.dataset.unit);
  for (const inp of document.querySelectorAll('input[data-unit]')) {
    if (inp.dataset.mstep == null) inp.dataset.mstep = inp.getAttribute('step') || '';
    const d = UNIT_DEFS[inp.dataset.unit];
    if (!d) continue;
    if (isMetric()) { if (inp.dataset.mstep) inp.step = inp.dataset.mstep; }
    else inp.step = String(d.impStep);
    // min/max are metric bounds; drop them in imperial rather than convert (the host
    // clamps anyway) so a valid imperial entry isn't rejected by the browser.
    if (inp.dataset.mmin == null) inp.dataset.mmin = inp.getAttribute('min') || '';
    if (isMetric()) { if (inp.dataset.mmin) inp.setAttribute('min', inp.dataset.mmin); }
    else if (inp.dataset.mmin) inp.removeAttribute('min');
  }
}
// Read a number input as a METRIC value: parse what the user typed (a display value)
// and convert back. Fields whose metric step is a whole unit are integer-backed
// host-side (nudge distance), so round after converting —
// otherwise 8" → 20.32 cm would fail the host's int parse and silently do nothing.
function readUnitInput(inp) {
  const v = parseFloat(inp.value);
  if (!Number.isFinite(v)) return NaN;
  const u = inp.dataset.unit;
  if (!u || isMetric()) return v;
  const m = fromDisplayUnit(v, u);
  return Number(inp.dataset.mstep || inp.getAttribute('step')) >= 1 ? Math.round(m) : Math.round(m * 1000) / 1000;
}
// Fill a number input from a stored METRIC value, converting for display. A whole-unit
// metric step means an integer-backed field (cm counts), so metric shows no decimals.
function writeUnitInput(inp, metricVal) {
  const u = inp.dataset.unit;
  if (!u) { inp.value = Math.round(metricVal * 1000) / 1000; return; }
  if (isMetric() && Number(inp.dataset.mstep || inp.getAttribute('step')) >= 1) { inp.value = Math.round(metricVal); return; }
  inp.value = roundDisplay(toDisplayUnit(metricVal, u), u);
}
// Unit flips arrive on the Status frame (the host persists the setting, then echoes
// it). Relabel + force every open panel to re-read so values convert immediately.
let _lastMetric = null;
function syncUnits() {
  const m = isMetric();
  if (m === _lastMetric) return;
  _lastMetric = m;
  applyUnits();
  onUnitsChanged();
}
// Everything unit-bearing that isn't redrawn every frame: mark the read-frames dirty so
// the open panels re-populate through the (now converting) populate path, and drop the
// wizard's step cache so its hand-built markup is rebuilt with the new labels.
function onUnitsChanged() {
  configDirty = true;
  fieldOpsDirty = true;
  _wzKey = '';
  if (document.getElementById('fieldbuilder').classList.contains('open')) { renderFbHeadland(); renderFbTram(); }
  if (document.getElementById('boundarymenu').classList.contains('open')) renderBoundaryMenu();
  if (document.getElementById('boundaryplayer').classList.contains('open')) renderBoundaryPlayer();
}
applyUnits();   // fill the static labels now (metric default) — the first Status frame corrects it


// ---- coverage offscreen (Phase 2): cells painted into a cell-grid canvas,
//      blitted to world space each frame. Snapshot on connect, deltas after. ----
let cov = null;        // { cellSize, originE, originN, width, height, canvas, cctx }
let covCells = 0;
let coverageEdges = null;   // crisp worked-area perimeter polylines (server-fed, field-local m)
let covEdgeRgb = 0x98fb98;  // last coverage colour seen → the perimeter stroke matches the fill
const EDGE_OFF = new URLSearchParams(location.search).has('noedge'); // ?noedge → A/B the edge off

// ---- ground texture: the tiled field backdrop. Two variants — a dark (night) and a
//      light (day) version of the same texture — picked by mapIsDay so the field reads
//      against the matching theme. Drawn as a repeating shader in world space, gated on
//      Display.FieldTextureVisible. Each decoded to an SkImage on first use. ----
const groundImgNight = new Image(), groundImgDay = new Image();
let groundReadyNight = false, groundReadyDay = false;
let skGroundNight = null, skGroundDay = null;
groundImgNight.onload = () => { groundReadyNight = true; };
groundImgDay.onload = () => { groundReadyDay = true; };
groundImgNight.src = '/icons/GroundTextureDark.png';
groundImgDay.src = '/icons/GroundTextureLight.png';

// ---- tractor sprite (TractorAoG.png) — drawn world-sized on the ground, replacing the
//      fallback triangle. Sized from the vehicle track-width/wheelbase like native. ----
const tractorImg = new Image();
let tractorReady = false, skTractor = null;
tractorImg.onload = () => { tractorReady = true; };
tractorImg.src = '/icons/TractorAoG.png';
// Steerable front-wheel sprite (single wheel, drawn at both front-axle ends, rotated by
// the live wheel angle) — matches native SkiaMapControl's FrontWheels.png.
const frontWheelImg = new Image();
let frontWheelReady = false, skFrontWheel = null;
frontWheelImg.onload = () => { frontWheelReady = true; };
frontWheelImg.src = '/icons/FrontWheels.png';
// Harvester + articulated body sprites (issue #88) — AgOpenGPS's AoG brand textures,
// drawn with CVehicle's per-type layout in vehicleSk. Lazily turned into SkImages.
function loadSprite(src) {
  const s = { img: new Image(), ready: false, sk: null };
  s.img.onload = () => { s.ready = true; };
  s.img.src = src;
  return s;
}
function skSprite(s) { return s.ready ? (s.sk || (s.sk = CK.MakeImageFromCanvasImageSource(s.img))) : null; }
const harvesterSpr = loadSprite('/icons/HarvesterAoG.png');
const artFrontSpr = loadSprite('/icons/ArticulatedFrontAoG.png');
const artRearSpr = loadSprite('/icons/ArticulatedRearAoG.png');

// ---- background imagery: extent from the Scene, PNG fetched over HTTP. ----
let imageryRect = null;  // { minE, minN, maxE, maxN, version }
let imageryImg = null;   // loaded <img> once ready
let imageryVer = null;   // version currently loaded (cache-bust on change)

// ---- field geo origin (lat/lon at E=0,N=0) — for the satellite-tile underlay. ----
let originLat = 0, originLon = 0;
let satEnabled = false;  // true while drawing a boundary on satellite imagery

// ---- client-owned camera (never crosses the wire) ----
let pxPerM = 4.0;
let camE = 0, camN = 0;
// Camera follow mode, matching native SkiaMapControl: 0 NorthUp (lock to vehicle),
// 1 HeadingUp (lock + rotate map to heading), 2 Free (manual pan holds), 3 Map
// (map-centric auto-pan with a safe zone). Default Map, like native.
let cameraMode = 3;
let mapRotation = 0;          // radians the map is rotated (−heading in HeadingUp)
let _cosRR = 1, _sinRR = 0;   // cos/sin of the screen rotation (−mapRotation), per frame
const AUTO_PAN_SAFE = 0.65, AUTO_PAN_SMOOTH = 0.15; // match native tuning
// Map-rotation easing (HeadingUp). ADAPTIVE: heavily damp SMALL heading errors so the
// whole heading-up map doesn't wobble with autosteer line-holding dither, but stay
// responsive for LARGE errors (real headland turns). alpha ramps MIN→MAX as the heading
// error grows to ROT_SMOOTH_FULL rad. (A single fixed value either wobbles on the line or
// lags the turns.)
const ROT_SMOOTH_MIN = 0.035; // ~0.5 s settle — kills line-holding dither (~0.2-0.3°)
const ROT_SMOOTH_MAX = 0.35;  // crisp on real turns (≈ the old fixed 0.3)
const ROT_SMOOTH_FULL = 0.12; // rad (~7°) error at which we're fully responsive
function isFollowMode() { return cameraMode !== 2; }
// 3D perspective tilt (Skia only — Canvas2D can't do true perspective). pitch 0 =
// top-down (identical to the ortho path); up to MAX_PITCH tilts toward the horizon.
// perspM is the world→CSS-px matrix for the current frame (null when top-down).
let pitch = 0;          // radians
let perspM = null;      // 16-elem M44 (world→CSS px) or null
let perspMInv = null;   // cached 4×4 inverse of perspM (CSS px→world ray); null until built
const DEFAULT_PITCH = Math.PI / 3;        // 60° — the one-key tilt
const MAX_PITCH = 65 * Math.PI / 180;     // v1 cap: keeps the local field in front
const PITCH_STEP = 5 * Math.PI / 180;
// Persist the 3D tilt + zoom across reloads (issue #35: tilting to 3D was lost on
// restart). The camera is client-owned live, but its last tilt+zoom are stored
// HOST-side (appstate.json, via the view.save command) and replayed to every client
// in the connection seed (onViewPrefs). This restores identically on any client —
// browser or WebView — independent of browser localStorage behaviour.
// The follow mode (N/H/M) rides the same path (#176); Free (2) is a temporary "I panned"
// state and is never saved — the last followed mode stays saved.
let _savedPitch = pitch, _savedZoom = pxPerM, _savedMode = cameraMode, _viewSaveT = 0;
function applyViewPrefs(p, z, m) {
  if (typeof p === 'number' && isFinite(p)) pitch = Math.max(0, Math.min(MAX_PITCH, p));
  if (typeof z === 'number' && isFinite(z)) pxPerM = Math.min(200, Math.max(0.2, z));
  if (m === 0 || m === 1 || m === 3) cameraMode = m;
  _savedPitch = pitch; _savedZoom = pxPerM; _savedMode = cameraMode; // hydrated == saved: no echo-back
}
function maybeSaveView() {
  const mode = cameraMode === 2 ? _savedMode : cameraMode;
  if (pitch === _savedPitch && pxPerM === _savedZoom && mode === _savedMode) return;
  const now = performance.now();
  if (now - _viewSaveT < 800) return;        // debounce: at most ~1.25 writes/s while adjusting
  _viewSaveT = now; _savedPitch = pitch; _savedZoom = pxPerM; _savedMode = mode;
  transport.send('view.save|' + pitch + '|' + pxPerM + '|' + mode); // host writes it to appstate.json
}
const PERSP_FOV = 0.7;                     // rad, matches native SkiaMapControl

// ---- transport wiring (the only coupling point) ----
const transport = RemoteTransport.create({
  onScene(s) {
    scene = s;
    originLat = s.originLat; originLon = s.originLon; // for the satellite underlay geo math
    if (isFollowMode() && (!tick || !tick.pose) && s.boundaries.length && s.boundaries[0].length) {
      const r = s.boundaries[0];
      camE = r.reduce((a, p) => a + p.e, 0) / r.length;
      camN = r.reduce((a, p) => a + p.n, 0) / r.length;
    }
    // Background imagery: (re)load the PNG only when the version changes.
    if (s.imagery) {
      imageryRect = s.imagery;
      if (s.imagery.version !== imageryVer) {
        imageryVer = s.imagery.version;
        const img = new Image();
        img.onload = () => { imageryImg = img; };
        img.src = '/backpic.png?v=' + s.imagery.version;
      }
    } else {
      imageryRect = null; imageryImg = null; imageryVer = null;
    }
    // Keep the Tracks manager list live (activate/add/delete/hide change the Scene).
    if (document.getElementById('dlg-tracks').classList.contains('open')) renderTracksList();
    if (document.getElementById('fieldbuilder').classList.contains('open') && fbTab === 'tracks'
        && !document.querySelector('#fb-tracklist .flg-nameedit')) renderFbTracks();
    if (document.getElementById('fieldbuilder').classList.contains('open') && fbTab === 'headland'
        && document.getElementById('fb-addhl').hidden
        && !document.querySelector('#fb-hllist .flg-nameedit')) renderFbHeadland();
    if (document.getElementById('fieldbuilder').classList.contains('open') && fbTab === 'tram') {
      if (document.getElementById('fb-tramedit').hidden) renderFbTram(); else populateTramEdit();
    }
    // Refresh the flag list on add/delete/rename/recolour, unless the user is mid-edit.
    if (document.getElementById('dlg-flags').classList.contains('open')
        && !document.querySelector('.flg-nameedit') && !document.querySelector('.flg-colorpick'))
      renderFlagList();
  },
  onTick(t) {
    tick = t;
    reverseBadge.classList.toggle('show', !!(t.op && t.op.reverse)); // #125
    if (t.pose) {
      lastTick = {
        e: t.pose.e, n: t.pose.n, heading: t.pose.heading, speed: t.pose.speed,
        tool: t.tool, goal: t.goal, t: performance.now(), hostT: t.hostMs,
      };
      // Keep the buffer strictly increasing in host time. The 30 Hz render-pull vs 10 Hz
      // broadcast can occasionally resend the same pose (equal hostT) — a duplicate/
      // backward stamp would break the bracket search, so replace rather than append.
      const prev = poseBuf[poseBuf.length - 1];
      if (prev && typeof t.hostMs === 'number' && typeof prev.hostT === 'number' && t.hostMs <= prev.hostT)
        poseBuf[poseBuf.length - 1] = lastTick;
      else {
        poseBuf.push(lastTick);
        if (poseBuf.length > POSE_BUF_MAX) poseBuf.shift();
      }
      // Track the client↔host clock offset (EMA). The interp SPAN comes from the
      // jitter-free host timestamps; this offset only aligns the playback timeline, so a
      // single late/early arrival shifts it by ≤5% instead of warping the whole frame.
      if (typeof t.hostMs === 'number') {
        const raw = lastTick.t - t.hostMs;
        // Very slow EMA (0.01): the client↔host clock barely drifts (ppm), so adapting
        // slowly keeps the playhead velocity steady — a faster EMA chased arrival jitter and
        // left residual position stutter (offline sim: 0.02→12%, 0.01→6% spread). The
        // RENDER_DELAY buffer absorbs the slower settle. Errs high (more lag) = edge-safe.
        clockOffset = (clockOffset === null) ? raw : clockOffset + 0.01 * (raw - clockOffset);
      }
    }
    pushChartData(t);
  },
  onCoverageInit(init) {
    const cs = init.cellSize;
    // An empty reset grid means the field closed: drop the raster and the perimeter.
    if (init.reset && (init.width <= 0 || init.height <= 0)) {
      if (cov) {
        if (cov.skImg) cov.skImg.delete();
        if (cov.surface) cov.surface.delete();
        if (cov.covPaint) cov.covPaint.delete();
      }
      cov = null; covCells = 0; coverageEdges = null;
      return;
    }
    // Grid GROWTH at the same cell size (host bounds-expansion, reset=false): the added ground is
    // empty, so the host resends nothing. Keep the coverage we already have, re-anchor it into the
    // larger grid, and carry on with incremental deltas — no rescan, no repaint, no flicker. A
    // reset init (new field / reload / cell-size change) always falls through to a clean rebuild.
    if (!init.reset && cov && Math.abs(cov.cellSize - cs) < 1e-9 &&
        (init.width !== cov.width || init.height !== cov.height ||
         Math.abs(init.originE - cov.originE) > 1e-9 || Math.abs(init.originN - cov.originN) > 1e-9)) {
      reanchorCoverage(init);
      return;
    }
    // Fresh field / resolution (cell-size) change: tear down and rebuild. A full snapshot follows.
    if (cov) {
      if (cov.skImg) cov.skImg.delete();
      if (cov.surface) cov.surface.delete();
      if (cov.covPaint) cov.covPaint.delete();
    }
    cov = makeCovGrid(init);
    covCells = 0;
  },
  onCoverageCells(msg) {
    if (!cov || !msg.cells) return;
    // Queue with arrival time; the actual rasterization is delayed by RENDER_DELAY in
    // drawCoverageSk (both render paths) so freshly-laid coverage appears on the SAME
    // playback timeline as the render-delayed tool/pose. Drawing it on arrival put the
    // real-time coverage front AHEAD of the delayed tool sprite, so coverage poked out in
    // front of the tool at speed (gap = speed × RENDER_DELAY; hidden under the tool below
    // ~5 km/h, visible above). arrival + RENDER_DELAY matches the host-timeline pose
    // playback exactly (same socket/latency), so the front now tracks the tool at any speed.
    cov.pending.push({ cells: msg.cells, t: performance.now() });
  },
  onCoverageEdge(polylines) { coverageEdges = polylines; }, // crisp worked-area perimeter (~2 Hz)
  onStatusBar(s) { statusBar = s; syncUnits(); if (typeof applySimBarVisible === 'function') applySimBarVisible(); syncUnsavedCov(); syncDualHeadingWarning(s); syncGpsLost(s); },
  onConfig(c) { config = c; configDirty = true; applyTheme(c && c.display && c.display.isDayMode); applyUiScale(c && c.display && c.display.uiScale); },
  onProfiles(p) { profiles = p; profilesDirty = true; },
  onNtripProfiles(p) { ntripProfiles = p; ntripDirty = true; },
  onFieldOps(f) { fieldOps = f; fieldOpsDirty = true; },
  onAgShare(a) { agShare = a; agShareDirty = true; },
  onAppInfo(a) { appInfo = a; appInfoDirty = true; I18n.setLanguage(a.currentLanguage); },
  onFieldTools(f) { fieldTools = f; fieldToolsDirty = true; if (document.getElementById('importtracks').classList.contains('open')) renderImportTracks(); },
  onRecordedPath(r) { recPath = r; if (document.getElementById('recpath').classList.contains('open')) renderRecPath(); },
  onBoundary(b) {
    boundary = b;
    if (document.getElementById('boundarymenu').classList.contains('open')) renderBoundaryMenu();
    if (document.getElementById('boundaryplayer').classList.contains('open')) renderBoundaryPlayer();
  },
  onWizard(w) { wizard = w; wizardDirty = true; },
  onHello(id) { myClientId = id; updateControlUi(); claimSeatIfFree(); Vt.render(); },
  onControlState(s) { lastControl = s; updateControlUi(); claimSeatIfFree(); Vt.render(); },
  onSound(id) { Sounds.play(id); },
  onPrompt(p) { hostPrompt = p; renderHostPrompt(); },
  onToast(msg) { showToast(msg); },
  onHardwareMessage(text, seconds, warning) { showHardwareMessage(text, seconds, warning); },
  onDrivePick(fields) { showDrivePick(fields); },
  onVt(m, t) { Vt.message(m, t); },
  onVtImage(id, w, h, rgba) { Vt.image(id, w, h, rgba); },
  // Round-trip link probe reply: token is the performance.now() we sent in diag.ping, so
  // RTT = now − token measures the pure server↔client link (one client clock, no skew).
  onPong(token) {
    const rtt = performance.now() - parseFloat(token);
    if (rtt >= 0 && rtt < 60000) linkRttMs = (linkRttMs === null) ? rtt : linkRttMs + 0.3 * (rtt - linkRttMs);
  },
  onStatus(s) { connState = s; renderRole(); claimSeatIfFree(); },
  // Persisted web-camera view (issue #35): restore last tilt+zoom from the host seed.
  onViewPrefs(pitch, zoom, mode) { applyViewPrefs(pitch, zoom, mode); },
});

// ---- Host prompt + failure notifications (#109) ----------------------------
// The host's ShowConfirmationDialog / ShowErrorDialog (e.g. "GPS far from field",
// settings recovery, "No boundary") arrive as a Prompt frame. It stays up until the
// host clears it (kind 0), so a reconnecting browser still sees it. Only the browser
// holding control can answer (prompt.answer is gated); the seq stops a stale tap
// answering a newer prompt.
let hostPrompt = null;
const HP = {
  root: document.getElementById('hostprompt'), title: document.getElementById('hp-title'),
  msg: document.getElementById('hp-msg'), check: document.getElementById('hp-check'),
  checkbox: document.getElementById('hp-checkbox'), checkLabel: document.getElementById('hp-checklabel'),
  ok: document.getElementById('hp-ok'), cancel: document.getElementById('hp-cancel'),
  wait: document.getElementById('hp-wait'),
};
let hpShownSeq = -1;
function renderHostPrompt() {
  const p = hostPrompt;
  if (!p || !p.kind) { HP.root.classList.remove('open'); hpShownSeq = -1; return; }
  const isError = p.kind === 2;
  HP.title.textContent = p.title || (isError ? tr('Error') : tr('Confirm'));
  HP.msg.textContent = p.message || '';
  HP.check.hidden = isError || !p.checkboxLabel;
  HP.checkLabel.textContent = p.checkboxLabel || '';
  if (hpShownSeq !== p.seq) HP.checkbox.checked = !!p.checkboxChecked; // keep the operator's tick on re-render
  HP.cancel.hidden = isError;
  HP.ok.textContent = p.confirmLabel || (isError ? tr('OK') : tr('Yes'));
  HP.cancel.textContent = p.cancelLabel || tr('No');
  HP.ok.disabled = HP.cancel.disabled = !iHoldControl;
  HP.wait.hidden = iHoldControl;
  HP.wait.textContent = lastControl.held
    ? tr('Waiting for {name} to answer', { name: lastControl.holderName || tr('the operator', {}) })
    : tr('Take control to answer');
  hpShownSeq = p.seq;
  HP.root.classList.add('open');
}
function answerHostPrompt(yes) {
  const p = hostPrompt;
  if (!p || !p.kind || !iHoldControl) return;
  transport.send('prompt.answer|' + p.seq + ',' + (yes ? 1 : 0) + ',' + (HP.checkbox.checked ? 1 : 0));
  hostPrompt = null; renderHostPrompt(); // the host's cleared frame follows
}
HP.root.addEventListener('pointerdown', e => e.stopPropagation()); // no dismiss, no map pan
HP.ok.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); answerHostPrompt(true); });
HP.cancel.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); answerHostPrompt(false); });

let toastTimer = null;
// AiO board message (PGN 221): AgOpenGPS's lblHardwareMessage — black text on salmon
// (warning) or bisque, shown for the seconds the module asks (#110).
let hwMsgTimer = 0;
function showHardwareMessage(text, seconds, warning) {
  const el = document.getElementById('hwmsg');
  el.textContent = text;
  el.style.background = warning ? 'salmon' : 'bisque';
  el.classList.add('show');
  clearTimeout(hwMsgTimer);
  if (seconds > 0) hwMsgTimer = setTimeout(() => el.classList.remove('show'), seconds * 1000);
}
// Dual GPS on, but the receiver sends no antenna heading ($PANDA, $GNTHS void, HPR
// quality 0), so the host uses the single-antenna heading (#157). The host holds the flag
// back while the receiver starts up (#313). Toast once each time it starts; take it down
// if a fix with a heading clears it while still showing.
const DUAL_HEADING_MISSING_MSG =
  tr("Dual GPS is on, but the receiver isn't sending a dual-antenna heading. Using single-antenna heading.");
let dualHeadingMissingShown = false;
function syncDualHeadingWarning(s) {
  const missing = !!s.dualHeadingMissing;
  if (missing === dualHeadingMissingShown) return;
  dualHeadingMissingShown = missing;
  if (missing) { showToast(DUAL_HEADING_MISSING_MSG, 10000); return; }
  const t = document.getElementById('toast');
  if (toastMsg === DUAL_HEADING_MISSING_MSG) { clearTimeout(toastTimer); t.classList.remove('show'); }
}
// GPS data lost: the host's debounced flag (it has already switched autosteer and the
// sections off); the panel clears as soon as data flows again, module or simulator.
function syncGpsLost(s) {
  document.getElementById('gpslost').classList.toggle('show', !!s.gpsLost);
}
let toastMsg = '';
function showToast(msg, ms = 4000) {
  const t = document.getElementById('toast');
  toastMsg = msg; // what was asked for; the element's text may be a translation
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---- Alert sounds ----------------------------------------------------------
// The host (which may be a headless box with no speaker) decides WHAT is audible
// — it already applied each sound's config toggle — and pushes a SoundEffect id.
// We just play the matching .wav here, on the operator's device. Effect ids match
// the C# SoundEffect enum order. Browsers block audio until the page has had a user
// gesture, so we prime the elements on the first pointer/key event; until then an
// alert that fires before any interaction is silently dropped (unavoidable on web).
const Sounds = (() => {
  // index === (int)SoundEffect. Files as AgOpenGPS CSound: TF012 = U-turn failed,
  // Alarm10 = boundary alarm and the U-turn approach alarm (#110).
  const FILES = [
    'Alarm10',    // 0 BoundaryAlarm
    'TF012',      // 1 UTurnTooClose
    'SteerOn',    // 2 AutoSteerOn
    'SteerOff',   // 3 AutoSteerOff
    'HydUp',      // 4 HydraulicLiftUp
    'HydDown',    // 5 HydraulicLiftDown
    'rtk_lost',   // 6 RtkLost
    'rtk_back',   // 7 RtkRecovered
    'SectionOn',  // 8 SectionOn
    'SectionOff', // 9 SectionOff
    'Headland',   // 10 Headland
    'Alarm10',    // 11 YouTurnApproach
  ];
  const cache = new Map();   // name -> HTMLAudioElement (fallback path)
  let unlocked = false;

  // Web Audio: each .wav is fetched and DECODED ONCE into an AudioBuffer, and a play is
  // then just a buffer source — no work on the main thread. The old path cloned a
  // preloaded <audio> element per play, and a clone carries no decoded data, so every
  // alert re-decoded its file inline: a visible frame hitch on the bigger ones (Alarm10
  // is 335 KB) right as the sound started (#150). The element path stays as a fallback
  // for engines where decodeAudioData isn't available or fails.
  const AC = window.AudioContext || window.webkitAudioContext;
  const buffers = new Map();  // name -> AudioBuffer
  let actx = null;
  function ensureCtx() {
    if (!actx && AC) { try { actx = new AC(); } catch (_) { actx = null; } }
    return actx;
  }
  function decodeInto(name) {
    const ctx = ensureCtx();
    if (!ctx || buffers.has(name)) return;
    buffers.set(name, null); // in flight — don't fetch twice
    fetch('/sounds/' + name + '.wav')
      .then(r => r.arrayBuffer())
      .then(b => new Promise((res, rej) => { const p = ctx.decodeAudioData(b, res, rej); if (p && p.then) p.then(res, rej); }))
      .then(buf => buffers.set(name, buf))
      .catch(() => buffers.delete(name)); // fall back to the element path
  }

  function el(name) {
    let a = cache.get(name);
    if (!a) { a = new Audio('/sounds/' + name + '.wav'); a.preload = 'auto'; cache.set(name, a); }
    return a;
  }
  // Preload every distinct file so the first real alert isn't delayed by a fetch.
  for (const n of new Set(FILES)) { el(n); decodeInto(n); }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    // A context created before any gesture starts suspended; resume it on the first one.
    const ctx = ensureCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    for (const n of new Set(FILES)) decodeInto(n);
    // Nudge each element into a "played once" state so later programmatic play()
    // (not tied to a gesture) is allowed by the autoplay policy. Do it MUTED: the pause
    // lands asynchronously in .then(), so an unmuted prime plays a burst of every alert
    // audibly on the first UI click — notably the Hyd up/down 3-pt-hitch sounds. Muted
    // playback still primes the element (and is always autoplay-allowed). Real plays clone
    // the element, so they're unaffected by this temporary mute; restore it afterward anyway.
    for (const a of cache.values()) {
      a.muted = true;
      a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
    }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  }
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);

  return {
    play(id) {
      const name = FILES[id];
      if (!name) return;
      // Decoded buffer → a source node costs nothing to start, and repeats overlap.
      const buf = buffers.get(name);
      if (actx && buf) {
        try {
          if (actx.state === 'suspended') actx.resume().catch(() => {});
          const src = actx.createBufferSource();
          src.buffer = buf;
          src.connect(actx.destination);
          src.start();
          return;
        } catch (_) { /* fall through to the element path */ }
      }
      // Fallback: clone the preloaded element so rapid repeats overlap.
      try { el(name).cloneNode().play().catch(() => {}); } catch { /* not ready */ }
    },
  };
})();

// Mobile auto-quality. Phones/tablets get GPU-overloaded at Ultra resolution (large
// coverage + imagery textures), so on connect a mobile client asks the host to CAP the
// display quality at Medium (multiplier 2.5). The host command only ever coarsens and is
// idempotent, so it never raises a manually-chosen lower quality and never fights a manual
// change made afterwards (we send it ONCE per session). Desktop browsers are left untouched.
// iPadOS reports a desktop ("Macintosh") UA, so also treat a touch-capable "Macintosh".
const IS_MOBILE = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
let mobileQualityCapped = false;
function applyMobileQualityCap() {
  if (mobileQualityCapped || !IS_MOBILE) return;
  mobileQualityCapped = true;
  transport.send('display.capResolution|2.5'); // 2.5 = Medium
}

// An observer (a browser without control) sees everything and changes nothing (#397): the
// host drops its commands, so say why when a tap of its own was refused. The host's
// ObserverIds plus the hub's own control.* / diag.ping are what it may send.
const OBSERVER_IDS = new Set(['control.acquire', 'control.release', 'control.presence', 'diag.ping', 'boundary.refresh']);
let _viewOnlyToastT = -Infinity;
const _send = transport.send;
transport.send = cmd => {
  const id = String(cmd).split('|')[0];
  if (!iHoldControl && !OBSERVER_IDS.has(id)) {
    const now = performance.now();
    if (navigator.userActivation && navigator.userActivation.isActive && now - _viewOnlyToastT > 3000) {
      _viewOnlyToastT = now;
      showToast(tr('View only: another screen has control'));
    }
    return;
  }
  _send(cmd);
};

transport.start();

// ---- CanvasKit (Skia) renderer — built alongside Canvas2D for A/B (toggle K).
//      Phase A: vector layers at parity; coverage/imagery/tool/lightbar next.
//      (State declared near the top so resize() can call recreateSkSurface.) ----
function recreateSkSurface() {
  if (!CK) return;
  if (skSurface) { skSurface.delete(); skSurface = null; }
  // Reuse the GrDirectContext across resizes. Resizing the canvas does NOT lose its WebGL
  // context, and rebuilding grCtx would orphan every GPU-resident SkImage created on the old
  // context — the coverage render target (MakeRenderTarget(grCtx, …)) plus the ground/tractor/
  // imagery sprites — so those layers vanish after a resize (coverage being the obvious one).
  // Only the on-screen surface (render target sized to the canvas) needs rebuilding.
  // Non-color-managed surface (null colorSpace) so Skia blends semi-transparent fills
  // (section footprint, lightbar) in encoded sRGB space — matching the 2D canvas. The default
  // MakeWebGLCanvasSurface attaches an sRGB color space and blends in LINEAR space, which
  // lightens/washes out transparent colors. Build via the explicit GL path; fall back to the
  // color-managed helper if needed.
  if (!grCtx) {
    const ctxHandle = CK.GetWebGLContext(ckcv);
    if (ctxHandle) grCtx = CK.MakeWebGLContext(ctxHandle);
  }
  if (grCtx) skSurface = CK.MakeOnScreenGLSurface(grCtx, ckcv.width, ckcv.height, null);
  if (!skSurface) skSurface = CK.MakeWebGLCanvasSurface(ckcv);
}
// Hex (#rrggbb) or rgb(a)(...) → CanvasKit color (CK.Color: r,g,b 0-255, a 0-1).
function ckColor(s) {
  if (s[0] === '#') return CK.Color(parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1);
  const m = s.match(/\(([^)]+)\)/)[1].split(',').map(Number);
  return CK.Color(m[0], m[1], m[2], m.length > 3 ? m[3] : 1);
}
// Day/Night theme. CSS chrome flips via [data-theme]; the Skia map (clear + grid) is
// recoloured here. Grid greys read on dark; dark-blue greys read on the light day field.
const MAP_CLEAR = { night: '#0f1115', day: '#d7dee7' };
const GRID_MINOR = { night: 'rgba(180,180,180,0.314)', day: 'rgba(80,92,110,0.33)' };
const GRID_MAJOR = { night: 'rgba(200,200,200,0.47)', day: 'rgba(60,72,90,0.5)' };
function applyMapTheme() {
  if (!CK || !SKP) return; // paints not built yet — buildSkPaints() re-applies on init
  const k = mapIsDay ? 'day' : 'night';
  SKP.gridMinor.setColor(ckColor(GRID_MINOR[k]));
  SKP.gridMajor.setColor(ckColor(GRID_MAJOR[k]));
}
// UI size (Screen & Alerts): the controls are zoomed by CSS (--ui-zoom), the map is not.
// Anything that turns screen pixels into a zoomed element's left/top divides by uiZoom.
// Engines differ: current Chromium and WebKit give a zoomed element's rects in screen
// pixels and grow vw/vh with the zoom; older WebKit (iPadOS 17) gives the rects in the
// element's own pixels. calibrateZoom measures which, so rects are always screen pixels
// (zoomRect) and --vw/--vh always come out at one viewport percent.
let uiZoom = 1;
let rectScale = 1;
function applyUiScale(pct) {
  const z = pct >= 100 && pct <= 200 ? pct / 100 : 1;
  if (z === uiZoom) return;
  uiZoom = z;
  document.documentElement.style.setProperty('--ui-zoom', String(z));
  calibrateZoom();
  placeCorner();
}
function calibrateZoom() {
  const root = document.documentElement.style;
  root.removeProperty('--vw'); root.removeProperty('--vh');
  rectScale = 1;
  if (uiZoom === 1) return;
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;left:0;top:0;width:calc(100 * var(--vw));height:1px;visibility:hidden;pointer-events:none';
  document.body.appendChild(p);
  const w = p.getBoundingClientRect().width, own = p.offsetWidth;
  if (w > 0 && own > 0) {
    // 1 when rects are already screen pixels, else uiZoom (offsetWidth is rounded)
    rectScale = Math.abs(w / own - uiZoom) < Math.abs(w / own - 1) ? 1 : uiZoom;
    // vw/vh not grown by the zoom here: one viewport percent is plain vw.
    if (Math.abs(w * rectScale - innerWidth) > 4) { root.setProperty('--vw', '1vw'); root.setProperty('--vh', '1vh'); }
  }
  p.remove();
}
// An element's rect in screen pixels, whichever way the engine reports zoomed rects.
function zoomRect(el) {
  const r = el.getBoundingClientRect(), k = rectScale;
  if (k === 1) return r;
  return { left: r.left * k, right: r.right * k, top: r.top * k, bottom: r.bottom * k, width: r.width * k, height: r.height * k };
}
// The right nav grows down from the top, the bottom bar up from the bottom, and the gauge
// + camera pad and the clock sit in the bottom-right corner between them. When they meet
// (a big UI size, a short screen, many buttons) the corner moves rather than being
// covered: the gauge + pad beside the nav, and the clock and gauge + pad above the bar.
function placeCorner() {
  const rn = document.getElementById('rightnav'), lr = document.getElementById('lowerright');
  const clock = document.getElementById('clock'), bar = document.getElementById('bottomstack');
  if (!rn || !lr || !clock || !bar) return;
  lr.style.right = ''; lr.style.bottom = ''; clock.style.bottom = '';
  const b = zoomRect(bar);
  // Screen pixels from the bottom edge to y, in the zoomed pixels bottom is set in.
  const above = (y, gap) => `${(innerHeight - y) / uiZoom + gap}px`;
  const meets = q => b.height > 0 && q.left < b.right && q.right > b.left && q.bottom > b.top;
  if (meets(zoomRect(clock))) clock.style.bottom = above(b.top, 8);
  // Lift the gauge + pad clear of the bar and the clock; lifting can carry it into the
  // nav, and moving it beside the nav can bring it over the bar, so lift again after.
  const lift = () => {
    lr.style.bottom = '';
    const r = zoomRect(lr), c = zoomRect(clock);
    let top = Infinity;
    if (meets(r)) top = b.top;
    if (r.left < c.right && r.right > c.left && r.bottom > c.top) top = Math.min(top, c.top);
    if (top < Infinity) lr.style.bottom = above(top, 10);
  };
  lift();
  const nav = zoomRect(rn), r = zoomRect(lr);
  if (nav.height > 0 && nav.bottom > r.top && nav.left < r.right) {
    lr.style.right = `calc(14px + var(--sar) + ${nav.width / uiZoom}px)`;
    lift();
  }
}
if (window.ResizeObserver) {
  const ro = new ResizeObserver(placeCorner);
  ro.observe(document.getElementById('rightnav'));
  ro.observe(document.getElementById('bottomstack'));
}
addEventListener('resize', placeCorner);
function applyTheme(isDay) {
  mapIsDay = !!isDay;
  document.documentElement.setAttribute('data-theme', mapIsDay ? 'day' : 'night');
  applyMapTheme();
}
function buildSkPaints() {
  const mk = (color, w, dash) => {
    const p = new CK.Paint();
    p.setStyle(CK.PaintStyle.Stroke);
    p.setColor(ckColor(color));
    p.setStrokeWidth(w);
    p.setAntiAlias(true);
    p.setStrokeJoin(CK.StrokeJoin.Round);
    p.setStrokeCap(CK.StrokeCap.Round);
    if (dash) p.setPathEffect(CK.PathEffect.MakeDash(dash, 0));
    return p;
  };
  const fill = (color) => { const p = new CK.Paint(); p.setStyle(CK.PaintStyle.Fill); p.setColor(ckColor(color)); p.setAntiAlias(true); return p; };
  SKP = {
    // Colours mirror native SkiaMapControl paints; widths are set per frame in
    // updateLineWidths() (world metres × pxPerM, like native's world-space strokes).
    boundary: mk('rgba(242,112,89,0.8)', 5), boundaryInner: mk('rgb(245,245,77)', 5), headland: mk('rgb(251,235,107)', 4),
    track: mk('#ffd24a', 4), reference: mk('rgb(180,100,255)', 5, [9, 7]),
    guidance: mk('rgb(252,86,186)', 5), uturn: mk('rgb(77,242,77)', 5), next: mk('rgb(0,200,200)', 4),
    // Extra guidelines (adjacent passes) — native _extraGuidePaint green(51,153,50,153)
    // over a black shadow, both 0.3 m. Widths set per frame in updateLineWidths.
    extraGuide: mk('rgba(51,153,50,0.6)', 1), extraGuideShadow: mk('rgba(0,0,0,0.5)', 1),
    // Match native (night-mode) grid: grey, ~0.31/0.47 alpha, major ~2× thickness.
    gridMinor: mk('rgba(180,180,180,0.314)', 1), gridMajor: mk('rgba(200,200,200,0.47)', 2),
    axisX: mk('rgba(204,51,51,0.275)', 1.5), axisY: mk('rgba(51,204,51,0.275)', 1.5),
    vehicle: fill('#39FF6A'),
    flagFill: fill('#FF0000'), flagOutline: mk('#101010', 1.5), // colour set per flag
    // Field Builder headland-editor offset lines: yellow = contributes to the closed
    // headland loop, red = doesn't (yet). Width set per frame in drawHeadlandSegEditLinesSk.
    hlEdit: mk('rgba(245,235,90,0.95)', 3), hlEditOff: mk('rgba(232,86,74,0.95)', 3),
    // Tram lines (wheel tracks) — orange, set per frame in drawTramLinesSk.
    tram: mk('rgba(255,140,60,0.9)', 2),
    // Saved recorded paths / contour strips — AgOpenGPS's pale-yellow lines (#110).
    recPath: mk('rgb(250,235,117)', 2), contourStrip: mk('rgb(250,235,107)', 2),
  };
  // Section footprint bars: one stroke paint per ColorCode (butt cap so adjacent
  // sections abut without rounded overhang), matching the 2D SECTION_COLORS.
  SKP.section = SECTION_COLORS.map((c) => {
    const p = new CK.Paint();
    p.setStyle(CK.PaintStyle.Stroke);
    p.setColor(ckColor(c));
    p.setStrokeWidth(7);
    p.setStrokeCap(CK.StrokeCap.Butt);
    p.setAntiAlias(true);
    return p;
  });
  // Section footprint as native: filled 2 m-deep rects per ColorCode + a thin black
  // outline (DrawToolSk DrawRect fill + _sectionOutlinePaint).
  SKP.sectionFill = SECTION_COLORS.map((c) => fill(c));
  SKP.sectionOutline = mk('#000000', 1.2);
  SKP.sectionOutline.setStrokeCap(CK.StrokeCap.Butt);
  SKP.sectionOutline.setStrokeJoin(CK.StrokeJoin.Miter);
  // Lightbar LED fill — one reusable paint, recoloured per cell (crisp rects, no AA).
  SKP.lbFill = new CK.Paint();
  SKP.lbFill.setStyle(CK.PaintStyle.Fill);
  SKP.lbFill.setAntiAlias(false);
  // Vehicle triangle in marker-local px (drawn under canvas translate+rotate).
  skTri = CK.Path.MakeFromSVGString('M 0 -14 L 9 11 L -9 11 Z');
  applyMapTheme(); // sync grid colours if the theme arrived before paints were built
}
if (typeof CanvasKitInit === 'function') {
  CanvasKitInit({ locateFile: f => '/vendor/' + f }).then(ck => {
    CK = ck;
    buildSkPaints();
    recreateSkSurface();
    ckStatus = skSurface ? 'ready (Skia WebGL)' : 'no WebGL surface';
  }).catch(e => { ckStatus = 'load error: ' + e.message; });
} else {
  ckStatus = 'loader missing';
}

// ---- camera controls ----
// Issue #87: a wheel over a pop-up that can scroll (hotkey list, logs, wizards…)
// scrolls that pop-up; everywhere else it zooms the map. ctrl+wheel (trackpad pinch
// / browser page zoom) is always swallowed so the page itself never zooms.
function wheelScrollsPanel(e) {
  for (let el = e.target; el && el !== document.body && el.nodeType === 1; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return true;
  }
  return false;
}
addEventListener('wheel', e => {
  if (!e.ctrlKey && wheelScrollsPanel(e)) return;
  e.preventDefault();
  pxPerM *= e.deltaY < 0 ? 1.1 : 0.9;
  pxPerM = Math.min(200, Math.max(0.2, pxPerM));
}, { passive: false });

// Block BROWSER zoom so only the map zooms. iOS Safari IGNORES the viewport's
// user-scalable=no, so a two-finger pinch (esp. one starting over a panel, whose
// touch-action:manipulation still permits page pinch) magnifies the whole page —
// chrome and all — off-screen ("erratic zoom"). Preventing Safari's gesture* events
// stops that; trackpad/ctrl+wheel page-zoom is already covered by the wheel handler's
// preventDefault above. Multi-touch on the map canvas is covered by touch-action:none.
for (const t of ['gesturestart', 'gesturechange', 'gestureend'])
  addEventListener(t, e => e.preventDefault(), { passive: false });
// Belt-and-suspenders for touch browsers without gesture* (e.g. some Android): a
// 2+-finger move is a pinch — swallow it so the page can't zoom/pan. Single-finger
// touches pass through to the map pan / panel scroll untouched.
addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
// iOS double-tap-to-zoom is NOT a gesture* event and slips past per-element touch-action when
// rapid taps land between/across nav buttons → it magnifies the whole page (chrome off-screen)
// and thrashes layout (render stutter / audio glitch / LINK spike are that main-thread jank).
// Swallow the 2nd tap's default within 300 ms; the UI runs on pointerdown, so button presses
// still register.
let _lastTapEnd = 0;
addEventListener('touchend', e => {
  const now = Date.now();
  if (now - _lastTapEnd <= 300) e.preventDefault();
  _lastTapEnd = now;
}, { passive: false });

// A tap on the vehicle resets its direction, as in AgOpenGPS: the heading is learned again
// from the next forward travel. It is the way out when the first heading was taken while
// backing, after which (with an IMU) forward travel reads as reverse.
const VEHICLE_TAP_RADIUS = 44; // px
function vehicleTap(px, py) {
  const rp = renderPose();
  if (!rp) return;
  const p = w2s(rp.e, rp.n);
  if (!p || Math.hypot(p[0] - px, p[1] - py) > VEHICLE_TAP_RADIUS) return;
  const gps = config && config.gps;
  // With dual GPS the antennas give the heading: there is no direction to learn.
  if (gps && gps.isDualGps && !gps.autoDualFix && statusBar && !statusBar.dualHeadingMissing) return;
  if (!iHoldControl) { showToast(tr('Take control to reset the direction')); return; }
  transport.send('heading.resetDirection');
  showToast(tr('Direction reset. Drive forward above 1.5 kph.'));
}

// Pan + tap. A gesture that moves past TAP_SLOP px pans (and drops to Free mode); one
// that stays put is a TAP. Overlays (panels/toolbars) stopPropagation their pointerdown,
// so window-level pointerdown only fires for gestures that began on the map — gestureOnMap
// guards the pointerup tap against panel taps that bubble their pointerup.
// A finger (or pen) in a moving cab drifts further between press and release than a mouse does,
// so it gets a wider slop: at 5 px a touch tap on the vehicle was read as a pan and did nothing (#266).
const TAP_SLOP = 5, TAP_SLOP_TOUCH = 15; // px — below this, a press-release is a tap, not a pan
let dragging = false, moved = false, gestureOnMap = false, lastX = 0, lastY = 0, downX = 0, downY = 0, tapSlop = TAP_SLOP;
addEventListener('pointerdown', e => {
  // Stage-4 edit: grab a handle if the press starts on one (else fall through to pan).
  if (editSession) {
    const hi = editHitTest(e.clientX, e.clientY);
    if (hi >= 0) { editDragIdx = hi; gestureOnMap = false; dragging = false; return; }
  }
  gestureOnMap = true; dragging = true; moved = false;
  tapSlop = e.pointerType === 'mouse' ? TAP_SLOP : TAP_SLOP_TOUCH;
  downX = lastX = e.clientX; downY = lastY = e.clientY;
});
// A gesture the browser takes over (system gesture, palm rejection) ends without a pointerup.
addEventListener('pointercancel', () => { editDragIdx = -1; dragging = false; gestureOnMap = false; });
addEventListener('pointerup', e => {
  if (editDragIdx >= 0) { editDragIdx = -1; return; } // finished dragging an edit handle
  dragging = false;
  // A clean tap while a map-tap capture mode is armed → unproject and dispatch.
  if (gestureOnMap && !moved && mapTap) {
    const w = s2w(e.clientX, e.clientY);
    if (w) mapTap.onTap(w.e, w.n);
  } else if (gestureOnMap && !moved && !editSession) {
    vehicleTap(e.clientX, e.clientY);
  }
  gestureOnMap = false;
});
addEventListener('pointermove', e => {
  // #40: the crosshair letter is a MOUSE-hover affordance — only for a real pointer. On
  // touch/pen there's no hover to ride, and a tap's micro-move would drop the "big A" under
  // the finger/button and clash with the placed-dot label; touch relies on the dot letters
  // + the "Tap Point A/B" banner instead.
  // Only over the map itself: over a button or a menu it isn't where the next point goes (#399).
  if (mapTap && (abFlow === 'straight' || abFlow === 'curve') && e.pointerType === 'mouse') {
    if (e.target && e.target.id === 'ck') updateAbCursorLabel(e.clientX, e.clientY);
    else if (abLabelEl) abLabelEl.classList.remove('show');
  }
  if (editDragIdx >= 0 && editSession) {       // drag the grabbed handle
    const w = s2w(e.clientX, e.clientY);
    if (w) editSession.points[editDragIdx] = editSession.kind === 'headland' ? hlSnap(w.e, w.n) : { e: w.e, n: w.n };
    return;
  }
  if (!dragging) return;
  // Some tablets report a finger or pen just above the glass as a hover: moves with nothing
  // pressed. Those are not part of a drag, and must not use up the tap slop or pan the map.
  if (e.buttons === 0) return;
  if (!moved) {
    // Stay still until the slop is exceeded so a tap doesn't pan or drop follow mode.
    if (Math.hypot(e.clientX - downX, e.clientY - downY) <= tapSlop) return;
    moved = true; cameraMode = 2; lastX = e.clientX; lastY = e.clientY; // reset origin, no jump
    return;
  }
  // Pan in the rotated frame: invert the screen rotation so the grabbed point
  // tracks the cursor. Reduces to the plain north-up pan at rotation 0.
  const dsx = e.clientX - lastX, dsy = e.clientY - lastY;
  camE += (-_cosRR * dsx + _sinRR * dsy) / pxPerM;
  camN += (_sinRR * dsx + _cosRR * dsy) / pxPerM;
  lastX = e.clientX; lastY = e.clientY;
});
// ---- map-tap capture mode (Phase MT) — the reusable on-map point-picking primitive ----
// A feature arms capture with startMapTap({hint, onTap}); the next clean tap unprojects via
// s2w and calls onTap(e,n) (field metres). One mode at a time; the map stays pan/zoomable
// (only a tap captures) so the operator can frame the view first. Esc / endMapTap() exits.
let mapTap = null;
function startMapTap(cfg) {
  mapTap = cfg;
  document.body.classList.add('maptap'); // crosshair cursor (CSS)
  const h = document.getElementById('maptap-hint');
  h.textContent = cfg.hint || tr('Tap the map'); h.classList.add('show');
  // Touch cancel: only for bare flows (no draw toolbar) — flag placement. The AB/sat/headland
  // flows show the toolbar whose own Cancel handles them, so don't double it up.
  const tbUp = document.getElementById('draw-toolbar').classList.contains('show');
  document.getElementById('maptap-cancel').classList.toggle('show', !tbUp);
}
function endMapTap() {
  mapTap = null;
  document.body.classList.remove('maptap');
  document.getElementById('maptap-hint').classList.remove('show');
  document.getElementById('maptap-cancel').classList.remove('show'); // hide the touch-cancel pill
  if (abLabelEl) abLabelEl.classList.remove('show'); // #40 hide the A/B crosshair letter
  if (abDotLabelsEl) for (const s of abDotLabelsEl.children) s.style.display = 'none'; // + the dot letters
}
// True when the user is typing into a field — global hotkeys (tilt, sim drive) must not
// fire then (e.g. typing "300" into the boundary offset shouldn't toggle 3D tilt on "3").
function isTyping() {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}
addEventListener('keydown', e => {
  if (e.key === 'Escape' && satBnd) { satCancel(); return; }  // cancel boundary draw-on-map
  if (e.key === 'Escape' && abFlow) { abCancel(); return; }   // cancel AB-line creation (tells host)
  if (e.key === 'Escape' && hlFlow) { endHeadlandDraw(); return; } // cancel headland draw
  if (e.key === 'Escape' && editSession) { endEdit(); return; }    // cancel on-map edit
  if (e.key === 'Escape' && mapTap) { endMapTap(); return; }  // cancel on-map capture
  if (isTyping() || boundHotkey(e)) return; // a configured hotkey owns this key (#98)
  if (e.key === 'f' || e.key === 'F') cameraMode = 3; // resume map-follow
  // 3D tilt: 3 toggles between top-down and 60°, [ / ] nudge the pitch.
  else if (e.key === '3') pitch = pitch > 0.001 ? 0 : DEFAULT_PITCH;
  else if (e.key === '[') pitch = Math.max(0, pitch - PITCH_STEP);
  else if (e.key === ']') pitch = Math.min(MAX_PITCH, pitch + PITCH_STEP);
});

// ---- sim drive keys (client→host commands) ----
// Arrow keys / space for desktop; the simulator bar (#simbar, below) covers touch.
// The host maps these ids to the matching VM command on its UI thread (allowlist).
const KEY_CMD = {
  ArrowLeft: 'sim.steerLeft', ArrowRight: 'sim.steerRight',
  ArrowUp: 'sim.speedUp', ArrowDown: 'sim.speedDown', ' ': 'sim.stop',
};
addEventListener('keydown', e => {
  if (isTyping() || boundHotkey(e)) return; // a configured hotkey owns this key (#98)
  const cmd = KEY_CMD[e.key];
  if (cmd) { e.preventDefault(); transport.send(cmd); }
});
// ---- configured hotkeys (#98) ----
// Bindings live on the host (File → Hotkeys, ConfigStore.Hotkeys) and arrive on the AppInfo
// frame. The client resolves key → action and sends the SAME command id as the matching
// button, so Tier-2 gating and the host allowlist apply unchanged. Screen actions open the
// web panel here — the host's HandleHotkey would open a native dialog the web never renders.
// A bound key takes priority over the built-in map/sim keys above (F, 3, [, ], arrows, space).
const HOTKEY_CMD = {
  AutoSteer: 'autosteer.toggle', CycleLines: 'track.cycle', SnapPivot: 'track.snapPivot',
  NudgeLeft: 'track.nudgeLeft', NudgeRight: 'track.nudgeRight',
  ManualSection: 'section.manual', AutoSection: 'section.master',
};
const HOTKEY_TIER1 = { Flag: 'flag.placeHere' }; // markers (still need control, like every command)
const HOTKEY_UI = {
  FieldMenu: () => document.getElementById('ln-fieldops').dispatchEvent(new PointerEvent('pointerdown')),
  VehicleSettings: () => document.getElementById('ln-vehicle').dispatchEvent(new PointerEvent('pointerdown')),
  SteerWizard: () => openSteerWizard(),
};
// Case-insensitive, so named keys match however they were saved: older builds stored
// "ARROWUP" for ArrowUp, which never matched and the hotkey never fired (#111, #98).
function normHotkey(k) { return k.toUpperCase(); }
// The action bound to this key event, or null. Modifier combos stay with the browser/OS.
function boundHotkey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || !appInfo) return null;
  const key = normHotkey(e.key);
  const hk = appInfo.hotkeys.find(h => h.key && normHotkey(h.key) === key);
  return hk ? hk.action : null;
}
// Hotkeys are off while typing, capturing a binding, or behind a modal (native blocked
// them while any dialog was open).
function hotkeysBlocked() {
  return isTyping()
    || document.getElementById('hotkeys').classList.contains('open')
    || !!document.querySelector('#dialoghost.open, .sw-backdrop.open, .wz-overlay.open');
}
addEventListener('keydown', e => {
  const action = boundHotkey(e);
  if (!action || hotkeysBlocked()) return;
  e.preventDefault();
  if (e.repeat) return; // holding a key must not re-toggle autosteer / sections
  if (HOTKEY_UI[action]) { HOTKEY_UI[action](); return; }
  if (HOTKEY_TIER1[action]) { transport.send(HOTKEY_TIER1[action]); return; }
  const sec = /^Section([1-8])$/.exec(action);
  const cmd = sec ? 'section.toggle|' + (sec[1] - 1) : HOTKEY_CMD[action];
  if (!cmd) return;
  if (!iHoldControl) { flashHint(tr('Observing — take control to use hotkeys')); return; }
  transport.send(cmd);
});
// ---- simulator bar (Phase 6) — mirrors the native SimulatorPanel ----
// Like every command, the bar's need control (an observer changes nothing, #397). Panel *visibility* is client-local
// (the host's IsSimulatorPanelVisible is a native-only concept); enabled/speed/
// steer are host state, mirrored back over the Status frame.
const SIM = {
  bar: document.getElementById('simbar'), launch: document.getElementById('sim-launch'),
  enable: document.getElementById('sim-enable'), tenx: document.getElementById('sim-10x'),
  steer: document.getElementById('sim-steer'), steerVal: document.getElementById('sim-steerval'),
  speedVal: document.getElementById('sim-speedval'), gps: document.getElementById('sim-gps'),
};
let _steerDragging = false;     // suppress state→slider sync while the user drags
// Sim-bar visibility is host-driven (PersistentAppState.SimulatorPanelVisible) so the
// choice persists across app restarts. Shown until the first Status frame arrives.
function applySimBarVisible() {
  const open = !statusBar || statusBar.simPanelVisible !== false;
  SIM.bar.classList.toggle('open', open);
  SIM.launch.classList.toggle('show', !open);
}
applySimBarVisible();
SIM.bar.addEventListener('pointerdown', e => e.stopPropagation()); // don't pan the map
SIM.launch.addEventListener('pointerdown', e => e.stopPropagation());
// Generic argless commands (data-cmd) — fire on pointerdown for snappy feel.
for (const b of document.querySelectorAll('#simbar button[data-cmd]')) {
  b.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    transport.send(b.dataset.cmd);
  });
}
// Steer slider → command-with-arg; optimistic local readout while dragging.
SIM.steer.addEventListener('input', () => {
  _steerDragging = true;
  const deg = parseFloat(SIM.steer.value);
  SIM.steerVal.textContent = deg.toFixed(1) + '°';
  transport.send('sim.setSteer|' + deg);
});
SIM.steer.addEventListener('change', () => { _steerDragging = false; });
// GPS button opens the SimCoords dialog (client-local open; OK sends sim.setCoords).
SIM.gps.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  if (statusBar && statusBar.simEnabled) return; // native guard: disable sim first
  openSimCoords();
});
document.getElementById('sim-close').addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation(); transport.send('sim.togglePanel');
});
SIM.launch.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation(); transport.send('sim.togglePanel');
});

// ---- dialog host (Phase 6) — the web mirror of DialogOverlayHost ----
// One modal at a time over a dimming backdrop. SimCoords is the first card; later
// phases add more cards into the same host and reuse openDialog/closeDialog.
const dialogHost = document.getElementById('dialoghost');
let _confirmCb = null;
let _confirmBack = null; // reopens the dialog the confirm was asked from, after OK or Cancel
function openDialog(cardId) {
  for (const c of dialogHost.querySelectorAll('.dlg-card')) c.classList.toggle('open', c.id === cardId);
  dialogHost.classList.add('open');
}
function closeDialog() {
  hideKeyboard();
  dialogHost.classList.remove('open'); _confirmCb = null; _confirmBack = null;
}
// Lower the Android soft keyboard via the native bridge (window.agnative, wired by the Android
// head to InputMethodManager). No-op on iOS/desktop, where blur() already dismisses.
function nativeKeyboardHide() {
  try { if (window.agnative && window.agnative.hideKeyboard) window.agnative.hideKeyboard(); } catch (_) {}
}
function hideKeyboard() {
  const a = document.activeElement;
  if (a && typeof a.blur === 'function') a.blur(); // iOS WKWebView + desktop dismiss on blur
  nativeKeyboardHide();                            // Android: only InputMethodManager drops it
}
// Global safety net: on Android WebView a field's blur() never lowers the IME, and only the
// GPS dialog routes through closeDialog()/hideKeyboard. So whenever focus leaves ANY text field
// and doesn't land on another one — closing a config/tool dialog, tapping a button, tapping the
// map — drop the keyboard. The next-tick activeElement check (rather than relatedTarget, which
// Android sets unreliably) keeps the keyboard up during field-to-field navigation.
document.addEventListener('focusout', e => {
  if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) return;
  setTimeout(() => {
    const a = document.activeElement;
    const stillEditing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
    if (!stillEditing) nativeKeyboardHide();
  }, 0);
});
// Shared confirm (unified nav model) — replaces browser confirm() + the native
// ShowConfirmationDialog. Transparent light-dismiss scrim (backdrop tap / Cancel = no
// action); Confirm runs the callback. Hosted in the dialog host (now a transparent leaf).
function showConfirm(title, message, onConfirm, onBack) {
  _confirmCb = onConfirm || null;
  _confirmBack = onBack || null;
  document.getElementById('dlgc-title').textContent = title || tr('Confirm');
  document.getElementById('dlgc-msg').textContent = message || '';
  openDialog('dlg-confirm');
}
dialogHost.querySelector('.dlg-backdrop').addEventListener('pointerdown', e => {
  e.stopPropagation();
  // Backdrop-dismiss of the unsaved-coverage guard must resolve it (= Cancel), else the
  // host stays blocked with its dialog open and the field never closes.
  if (_ucovOpen) { _ucovOpen = false; transport.send('coverage.cancelClose'); }
  closeDialog();
});
dialogHost.addEventListener('pointerdown', e => e.stopPropagation()); // keep map from panning
const dlgLat = document.getElementById('dlg-lat'), dlgLon = document.getElementById('dlg-lon');
// On-screen keyboard (App Settings › On-screen Kbd; AgOpenGPS FormKeyboard for text,
// FormNumeric for numbers) (#110). For touch boxes with no OS keyboard (kiosk/Linux): when
// on, focusing a text field opens a QWERTY panel, a numeric field a number pad, and the OS
// keyboard is suppressed (inputmode=none). Keys edit the field in place and fire 'input', so
// every existing handler sees them; OK sends Enter and closes.
const OSK = (() => {
  const root = document.getElementById('osk');
  let target = null, shift = false;
  const TEXT = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const NUM = ['789', '456', '123', '-0.'];
  const on = () => !!(config && config.display && config.display.keyboardEnabled);
  const isField = el => el instanceof HTMLTextAreaElement
    || (el instanceof HTMLInputElement && ['text', 'password', 'search', 'email', 'url', ''].includes(el.type) && !el.readOnly && !el.disabled);
  function render() {
    const num = !!(target && target.dataset.numField);
    root.classList.toggle('num', num);
    const rows = (num ? NUM : TEXT).map(r => [...r].map(c => ({ k: c, t: shift ? c.toUpperCase() : c })));
    if (num) rows.push([{ k: 'BS', t: '⌫', c: 'wide' }, { k: 'OK', t: 'OK', c: 'wide ok' }]);
    else {
      rows[3].unshift({ k: 'SH', t: shift ? '⇧' : '⇪', c: 'wide' });
      rows[3].push({ k: 'BS', t: '⌫', c: 'wide' });
      rows.push([{ k: '-', t: '-' }, { k: '_', t: '_' }, { k: ' ', t: 'space', c: 'xwide' }, { k: '.', t: '.' }, { k: 'CLR', t: 'Clear', c: 'wide' }, { k: 'OK', t: 'OK', c: 'wide ok' }]);
    }
    root.innerHTML = '';
    for (const r of rows) {
      const row = document.createElement('div'); row.className = 'osk-row';
      for (const b of r) {
        const btn = document.createElement('button'); btn.type = 'button';
        btn.textContent = b.t; btn.dataset.k = b.k; if (b.c) btn.className = b.c;
        row.appendChild(btn);
      }
      root.appendChild(row);
    }
  }
  function insert(s) {
    const el = target; if (!el) return;
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    try { el.setRangeText(s, a, b, 'end'); } catch (_) { el.value += s; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function key(k) {
    const el = target; if (!el) return;
    if (k === 'SH') { shift = !shift; render(); return; }
    if (k === 'OK') {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      close(); el.blur(); return;
    }
    if (k === 'CLR') { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); return; }
    if (k === 'BS') {
      const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
      if (a !== b) insert('');
      else if (a > 0) { try { el.setRangeText('', a - 1, a, 'end'); } catch (_) { el.value = el.value.slice(0, -1); } el.dispatchEvent(new Event('input', { bubbles: true })); }
      return;
    }
    insert(shift ? k.toUpperCase() : k);
    if (shift) { shift = false; render(); }
  }
  function open(el) {
    target = el; shift = false;
    if (!el.dataset.oskIm) el.dataset.oskIm = el.getAttribute('inputmode') ?? '';
    el.setAttribute('inputmode', 'none'); // no OS keyboard on top of ours
    render(); root.hidden = false;
  }
  function close() {
    if (target && target.dataset.oskIm !== undefined) {
      if (target.dataset.oskIm) target.setAttribute('inputmode', target.dataset.oskIm); else target.removeAttribute('inputmode');
      delete target.dataset.oskIm;
    }
    target = null; root.hidden = true;
  }
  // Keep focus in the field while tapping keys (pointerdown would blur it), and don't pan the map.
  root.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    const b = e.target.closest('button'); if (b) key(b.dataset.k);
  });
  document.addEventListener('focusin', e => { if (on() && isField(e.target)) open(e.target); else if (!root.contains(e.target)) close(); });
  document.addEventListener('focusout', e => {
    if (e.target !== target) return;
    setTimeout(() => { if (document.activeElement !== target) close(); }, 0);
  });
  return { close };
})();
// Uniform numeric input, everywhere. A tablet's decimal keypad (Android Samsung / iOS) has no
// minus key, so signed values couldn't be typed. Every numeric field is instead a type=text
// input with the FULL keyboard (which has "-"), and a filter keeps only digits, one decimal
// point, and a single leading minus. This converts every input[type=number] (config dialogs,
// tool dims, offsets, IP octets, …) and any added later — some config inputs are built
// dynamically — so all fields behave identically. parseFloat/parseInt readers are unaffected.
function filterNumericValue(s) {
  s = s.replace(/[^0-9.\-]/g, '');                                 // digits, dot, minus only
  s = s.replace(/(?!^)-/g, '');                                    // minus only at the start
  const d = s.indexOf('.');
  if (d !== -1) s = s.slice(0, d + 1) + s.slice(d + 1).replace(/\./g, ''); // one dot
  return s;
}
function makeNumericField(el) {
  if (el.dataset.numField) return;
  el.dataset.numField = '1';
  if (el.type === 'number') el.type = 'text';
  el.removeAttribute('inputmode');                                 // full keyboard (no flash, has "-")
  // It's a number field on a full (text) keyboard, so suppress the keyboard's auto-shift/caps,
  // autocorrect, suggestions and spellcheck — otherwise the tablet opens these with caps-lock
  // on (and inconsistently between fields), which is just noise for numeric entry.
  el.setAttribute('autocapitalize', 'none');
  el.setAttribute('autocorrect', 'off');
  el.setAttribute('autocomplete', 'off');
  el.setAttribute('spellcheck', 'false');
  el.classList.add('num-field');
}
function scanNumericFields(root) {
  // Accept the document (nodeType 9) AND elements (nodeType 1); the feature checks below
  // harmlessly skip text nodes the MutationObserver may pass. (An earlier nodeType===1 guard
  // made the initial scanNumericFields(document) a no-op, so static fields like the hitch
  // length kept the decimal keypad while only dynamically-added fields got converted.)
  if (!root) return;
  if (root.matches && root.matches('input[type="number"], .num-field')) makeNumericField(root);
  if (root.querySelectorAll)
    root.querySelectorAll('input[type="number"], .num-field').forEach(makeNumericField);
}
// Filter as the user types — delegated so dynamically-added fields are covered with no re-wiring.
document.addEventListener('input', e => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || !el.dataset.numField) return;
  const before = el.value, after = filterNumericValue(before);
  if (after !== before) {
    const pos = Math.max(0, el.selectionStart - (before.length - after.length));
    el.value = after;
    try { el.setSelectionRange(pos, pos); } catch (_) {}
  }
});
scanNumericFields(document);
new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) scanNumericFields(n); })
  .observe(document.documentElement, { childList: true, subtree: true });
function openSimCoords() {
  // Pre-fill with the current vehicle position (from the Status frame), matching
  // the native dialog's GetSimulatorPosition() seed.
  dlgLat.value = statusBar && statusBar.lat != null ? statusBar.lat.toFixed(8) : '';
  dlgLon.value = statusBar && statusBar.lon != null ? statusBar.lon.toFixed(8) : '';
  openDialog('dlg-simcoords');
  dlgLat.focus();
}
document.getElementById('dlg-cancel').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); closeDialog(); });
// Coordinates line (#335, AgOpenGPS Build Tracks "Lat/Lon + Heading" / "Lat/Lon"): A is
// pre-filled with the vehicle's position, as AgOpenGPS does; the host converts through the
// field's local plane and reports anything it refuses.
let llMode = 'latLonHeading';
const llEl = id => document.getElementById(id);
function llFill(pt) {
  if (!statusBar || statusBar.lat == null || (!statusBar.lat && !statusBar.lon)) return;
  llEl('ll-lat-' + pt).value = statusBar.lat.toFixed(8);
  llEl('ll-lon-' + pt).value = statusBar.lon.toFixed(8);
}
function openLatLonLine(mode) {
  llMode = mode;
  const ab = mode === 'latLonAB';
  llEl('ll-title').textContent = ab ? tr('AB Line from Two Points') : tr('AB Line from Point and Heading');
  llEl('ll-heading-row').hidden = ab;
  llEl('ll-b-row').hidden = !ab;
  for (const id of ['ll-lat-a', 'll-lon-a', 'll-heading', 'll-lat-b', 'll-lon-b']) llEl(id).value = '';
  llEl('ll-err').textContent = '';
  llFill('a');
  openDialog('dlg-latlonab');
}
document.querySelectorAll('[data-ll-fill]').forEach(b => b.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation(); llFill(b.dataset.llFill);
}));
llEl('ll-cancel').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); closeDialog(); });
llEl('ll-ok').addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // commit the edit
  const num = id => { const v = llEl(id).value.trim(); return v === '' ? NaN : +v; };
  const okLat = v => Number.isFinite(v) && Math.abs(v) <= 90, okLon = v => Number.isFinite(v) && Math.abs(v) <= 180;
  const latA = num('ll-lat-a'), lonA = num('ll-lon-a');
  let err = !okLat(latA) || !okLon(lonA) ? tr('Point A needs a latitude (−90 to 90) and longitude (−180 to 180)') : '';
  let cmd = '';
  if (!err && llMode === 'latLonAB') {
    const latB = num('ll-lat-b'), lonB = num('ll-lon-b');
    if (!okLat(latB) || !okLon(lonB)) err = tr('Point B needs a latitude (−90 to 90) and longitude (−180 to 180)');
    else cmd = 'track.latLonAB|' + [latA, lonA, latB, lonB].join(',');
  } else if (!err) {
    const h = num('ll-heading');
    if (!Number.isFinite(h)) err = tr('Enter a heading in degrees');
    else cmd = 'track.latLonHeading|' + [latA, lonA, h].join(',');
  }
  if (err) { llEl('ll-err').textContent = err; return; }
  closeDialog();
  transport.send(cmd);
});

document.getElementById('dlg-ok').addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  // Commit any in-progress field edit before reading: type=text inputs can hold uncommitted
  // text until blur, and preventDefault above keeps focus on the field.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const lat = parseFloat(dlgLat.value), lon = parseFloat(dlgLon.value);
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
    transport.send('sim.setCoords|' + lat + ',' + lon);
  closeDialog();
});
document.getElementById('dlgc-cancel').addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  const back = _confirmBack; closeDialog(); if (back) back();
});
document.getElementById('dlgc-ok').addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  const cb = _confirmCb, back = _confirmBack; closeDialog(); if (cb) cb(); if (back) back();
});

// ---- unsaved-coverage guard (server-driven) ----
// CloseFieldCommand opens DialogType.UnsavedCoverage on the host when coverage was painted
// with no open job. The host has no UI, so we render the prompt here off the Status flag and
// resolve it with the matching host commands (SaveCoverageToJob / DiscardCoverageAndClose /
// CancelUnsavedCoverage). Without this the host opens a dialog nothing shows and the close hangs.
let _ucovOpen = false;
function syncUnsavedCov() {
  const want = !!(statusBar && statusBar.unsavedCoveragePrompt);
  if (want && !_ucovOpen) { _ucovOpen = true; openDialog('dlg-unsavedcov'); }
  else if (!want && _ucovOpen) {
    _ucovOpen = false;
    if (document.getElementById('dlg-unsavedcov').classList.contains('open')) closeDialog();
  }
}
// Resolve optimistically (close now); the host command also flips the Status flag false, so
// the next frame is a no-op rather than a re-open.
function ucovResolve(cmd) { _ucovOpen = false; transport.send(cmd); closeDialog(); }
document.getElementById('ucov-save').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); ucovResolve('coverage.saveJob'); });
document.getElementById('ucov-discard').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); ucovResolve('coverage.discardClose'); });
document.getElementById('ucov-cancel').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); ucovResolve('coverage.cancelClose'); });

// ---- section bar (Phase 7) — per-section colour strip + manual toggle ----
// Read state (per-section ColorCode + master/manual mode) already rides the Tick;
// each tap cycles one section Off->Auto->On (Tier-2 — gated by control authority on
// both ends). Buttons are (re)built when the section count changes; colours update
// per frame. Delegated click handler reads the section index off data-idx.
const sectionBar = document.getElementById('sectionbar');
sectionBar.addEventListener('pointerdown', e => {
  e.stopPropagation(); // don't pan the map
  const zb = e.target.closest('button[data-zone]');
  if (zb) { if (iHoldControl) transport.send('section.toggleZone|' + zb.dataset.zone); return; }
  const btn = e.target.closest('button[data-idx]');
  if (btn && iHoldControl) transport.send('section.toggle|' + btn.dataset.idx);
});

// ---- bottom nav (Phase 8) — field-tools toolbar + Flags/AB-line flyouts ----
// Direct-action field tools. Tier-2 ids (data-t2: track.* / headland.* / youturn.skip*)
// are dimmed and fire only while we hold control; every other command needs it too (#397). Toggle
// READ state rides the Tick (tick.tools); AB-dependent buttons key off activeTrackName.
const bottomNav = document.getElementById('bottomnav');
const bnFlags = document.getElementById('bn-flyout-flags');
const bnAb = document.getElementById('bn-flyout-ab');
bottomNav.addEventListener('pointerdown', e => {
  e.stopPropagation(); // don't pan the map
  const btn = e.target.closest('button[data-cmd]');
  if (!btn) return;
  if (btn.hasAttribute('data-t2') && !iHoldControl) return; // gated; host re-checks
  transport.send(btn.dataset.cmd);
});
// Delete contour paths — confirm first (#107); not a data-cmd so the generic handler skips it.
document.getElementById('bn-delcontours').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (!iHoldControl) return;
  showConfirm(tr('Delete Contour Paths'), tr('Delete all recorded contour paths in this field? Coverage and AB lines are kept.'),
    () => transport.send('track.deleteContours'));
});
// ---- On-screen U-Turn (yellow) / Lateral (cyan) buttons over the map ----
// Bare glyph buttons mirroring native AgOpenGPS; shown per the Screen & Alerts
// "On-Screen Buttons" toggles. U-turn → manual you-turn L/R, lateral → snap the track
// one pass (1 tool width) L/R.
const onScreenBtns = document.getElementById('onscreenbtns');
onScreenBtns.addEventListener('pointerdown', e => {
  const btn = e.target.closest('button[data-cmd]');
  if (!btn) return;
  e.stopPropagation(); // tap the glyph, don't pan the map
  // #50: mid-turn snaps/u-turns are ignored by the pipeline (they'd shift the
  // displayed track while the tractor stays committed to the executing arc, then
  // seek across after). Block them here with a hint instead of silently no-op'ing.
  if (tick && tick.op && tick.op.executing) { flashHint(tr('Finish the U-turn first')); return; }
  transport.send(btn.dataset.cmd);
});
function applyOnScreenButtons() {
  const d = config && config.display;
  const hasField = !!(scene && scene.hasField); // native gate: IsFieldOpen
  // U-turn (manual you-turn) and Lateral (snap track) only act while AutoSteer is engaged,
  // so hide them otherwise (issue #36). Runs every frame via renderBottomNav, so it tracks
  // engage/disengage live.
  // Neither in contour mode (AgOpenGPS skips DrawManUTurnBtn then) (#110).
  const asActive = !!(tick && tick.op && tick.op.autoSteer && !tick.op.contour);
  document.getElementById('osb-uturn').hidden = !(hasField && asActive && d && d.uTurnButtonVisible);
  document.getElementById('osb-lateral').hidden = !(hasField && asActive && d && d.lateralButtonVisible);
}
function bnToggleFly(fly, btn) {
  const open = !fly.classList.contains('open');
  bnFlags.classList.remove('open'); bnAb.classList.remove('open');
  document.getElementById('bn-flags').classList.remove('menuopen');
  document.getElementById('bn-abmenu').classList.remove('menuopen');
  if (open) { fly.classList.add('open'); btn.classList.add('menuopen'); }
}
document.getElementById('bn-flags').addEventListener('pointerdown', e => { e.stopPropagation(); bnToggleFly(bnFlags, e.currentTarget); });
// "Place Flag on Map" (Phase MT) — arm tap capture; the next map tap drops a flag at the
// tapped field point via flag.placeAt (host PlaceFlagAtWorldPosition). No data-cmd, so the
// bottomNav delegate ignores it. Closes the flyout, then captures one tap.
function armPlaceFlagOnMap() {
  startMapTap({
    hint: tr('Tap the map to place a flag'),
    onTap: (e2, n2) => { transport.send('flag.placeAt|' + e2.toFixed(3) + ',' + n2.toFixed(3)); endMapTap(); },
  });
}
document.getElementById('bn-flag-onmap').addEventListener('pointerdown', e => {
  e.stopPropagation();
  bnFlags.classList.remove('open');
  document.getElementById('bn-flags').classList.remove('menuopen');
  armPlaceFlagOnMap();
});

// ---- flag list (mirrors native FlagListDialogPanel) ----
// Colour swatch (tap → 10-colour picker), name (tap → inline rename), distance+bearing
// from the vehicle (computed here off the Tick), locate (pan the camera to the flag),
// delete. Footer: Place Here / Place on Map / Delete All / Close. Reads scene.flags
// (index = the projected order, which matches the host's Flags list).
const FLAG_HEX = ['#FF0000', '#00CC00', '#FFCC00', '#2080E0', '#FF8800', '#9933CC', '#00BBCC', '#FF66AA', '#FFFFFF', '#333333'];
const FLAG_NAMES = [tr('Red'), tr('Green'), tr('Yellow'), tr('Blue'), tr('Orange'), tr('Purple'), tr('Cyan'), tr('Pink'), tr('White'), tr('Black')];
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
document.getElementById('bn-flag-list').addEventListener('pointerdown', e => {
  e.stopPropagation();
  bnFlags.classList.remove('open');
  document.getElementById('bn-flags').classList.remove('menuopen');
  openFlagList();
});
function openFlagList() { renderFlagList(); openDialog('dlg-flags'); }
function renderFlagList() {
  const list = document.getElementById('flag-list');
  const fl = (scene && scene.flags) || [];
  if (!fl.length) { list.innerHTML = '<div class="trk-empty">No flags placed</div>'; return; }
  list.innerHTML = '';
  fl.forEach((f, i) => {
    let dist = '';
    if (tick && tick.pose) {
      const de = f.e - tick.pose.e, dn = f.n - tick.pose.n;
      const brg = (Math.atan2(de, dn) * 180 / Math.PI + 360) % 360;
      dist = Math.hypot(de, dn).toFixed(0) + ' m ' + COMPASS[Math.round(brg / 45) % 8];
    }
    const row = document.createElement('div');
    row.className = 'flg-row';
    row.innerHTML =
      '<button class="flg-sw"></button>' +
      '<span class="flg-name"></span>' +
      '<span class="flg-dist"></span>' +
      '<button class="flg-loc" title="Locate (pan to flag)">⊕</button>' +
      '<button class="flg-del" title="Delete flag">✕</button>';
    row.querySelector('.flg-sw').style.background = f.color;
    const nameEl = row.querySelector('.flg-name');
    nameEl.textContent = f.name || tr('Flag {n}', { n: i + 1 });
    row.querySelector('.flg-dist').textContent = dist;
    // Colour swatch → toggle an inline 10-colour picker under the row.
    row.querySelector('.flg-sw').addEventListener('pointerdown', ev => { ev.stopPropagation(); toggleFlagColorPick(row, i); });
    // Name → inline rename.
    nameEl.addEventListener('pointerdown', ev => { ev.stopPropagation(); editFlagName(nameEl, i); });
    // Locate → pan the camera to the flag, close the dialog to reveal the map.
    row.querySelector('.flg-loc').addEventListener('pointerdown', ev => {
      ev.stopPropagation(); camE = f.e; camN = f.n; cameraMode = 2; closeDialog();
    });
    row.querySelector('.flg-del').addEventListener('pointerdown', ev => { ev.stopPropagation(); transport.send('flag.delete|' + i); });
    list.appendChild(row);
  });
}
function toggleFlagColorPick(row, idx) {
  const existing = row.nextSibling;
  if (existing && existing.classList && existing.classList.contains('flg-colorpick')) { existing.remove(); return; }
  for (const c of document.querySelectorAll('.flg-colorpick')) c.remove();
  const pick = document.createElement('div');
  pick.className = 'flg-colorpick';
  FLAG_HEX.forEach((hex, ci) => {
    const b = document.createElement('button');
    b.style.background = hex; b.title = FLAG_NAMES[ci];
    b.addEventListener('pointerdown', ev => { ev.stopPropagation(); transport.send('flag.setColor|' + idx + ',' + FLAG_NAMES[ci]); pick.remove(); });
    pick.appendChild(b);
  });
  row.after(pick);
}
function editFlagName(nameEl, idx) {
  const cur = nameEl.textContent;
  const input = document.createElement('input');
  input.className = 'flg-nameedit'; input.value = cur;
  nameEl.replaceWith(input); input.focus(); input.select();
  const commit = () => { const v = input.value.trim(); if (v && v !== cur) transport.send('flag.rename|' + idx + ',' + v); renderFlagList(); };
  input.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') commit(); else if (ev.key === 'Escape') renderFlagList(); });
  input.addEventListener('blur', commit);
}
document.getElementById('flag-placehere').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); transport.send('flag.placeHere'); });
document.getElementById('flag-placemap').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); closeDialog(); armPlaceFlagOnMap(); });
document.getElementById('flag-deleteall').addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  showConfirm(tr('Delete All Flags'), tr('Delete all flags? This cannot be undone.'), () => transport.send('flag.deleteAll'));
});
document.getElementById('flag-close').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); closeDialog(); });
document.getElementById('bn-abmenu').addEventListener('pointerdown', e => { e.stopPropagation(); bnToggleFly(bnAb, e.currentTarget); });

// ---- AB-line creation (mirrors native QuickABSelector + DrawAB dialogs) ----
// All four modes run the REAL native commands on the host (no geometry in JS):
//   straight/curve   — DrawAB/DrawCurve: tap points on the map (s2w → track.drawPoint)
//   driveAB          — set A then B at the vehicle's live GPS (track.setABGps)
//   recordCurve      — record a curve by driving, Finish to create
// The client only captures input, mirrors a live preview for the map-tap modes, and
// ships points/commands. `drawMode` drives the map-tap preview; `abFlow` is the active
// creation flow (any of the four) that the bottom toolbar + hint follow.
let drawMode = null;     // 'straight' | 'curve' (map-tap modes only) — drives the preview
let drawPts = [];        // [{e,n}] captured so far — preview only (host holds the real list)
let abFlow = null;       // 'straight' | 'curve' | 'driveAB' | 'recordCurve' | null
let driveStep = 0;       // Drive-AB / record-curve step: 0 → next press sets A/Start, 1 → sets B/End
let curveMarks = [];     // client-side path dots dropped while driving a record-curve (Set Start→End)
let _lastCurveMark = null;
const drawBar = document.getElementById('draw-toolbar');
const hintEl = document.getElementById('maptap-hint');
function abHint() {
  switch (abFlow) {
    case 'straight': return drawPts.length === 0 ? tr('Tap Point A') : tr('Tap Point B');
    case 'curve': return tr('Tap points ({n}) — Finish when done', { n: drawPts.length });
    case 'driveAB': return driveStep === 0 ? tr('Drive to A, then Set Point') : tr('Drive to B, then Set Point');
    case 'recordCurve': return driveStep === 0 ? tr('Drive to A, then Set Point A') : tr('Drive the curve to B, then Set Point B');
  }
  return '';
}
function setAbHint() { hintEl.textContent = abHint(); }
// #40: while drawing a straight AB line, ride an "A"/"B" letter on the crosshair so it's
// clear which point the next tap places, and render the placed points as native-style dots
// (orange A / blue B, matching FormABDraw's DrawABTouchPoints colours).
const AB_A_COLOR = '#FFBF59', AB_B_COLOR = '#8080FF';
const abLabelEl = document.getElementById('maptap-ab');
const abDotLabelsEl = document.getElementById('ab-dot-labels');
// Sequential point label: A, B, C … then 27, 28 … for very long curves.
function abLetter(i) { return i < 26 ? String.fromCharCode(65 + i) : String(i + 1); }
function abLabelColor(i) { return i === 0 ? AB_A_COLOR : i === 1 ? AB_B_COLOR : '#FFFFFF'; }
// A/B (straight) or A,B,C… (curve) letter riding the crosshair — the letter the NEXT tap places.
function updateAbCursorLabel(x, y) {
  if (!abLabelEl) return;
  if (mapTap && (abFlow === 'straight' || abFlow === 'curve')) {
    const i = drawPts.length;
    abLabelEl.textContent = abLetter(i);
    abLabelEl.style.color = abLabelColor(i);
    if (x != null) { abLabelEl.style.left = x + 'px'; abLabelEl.style.top = y + 'px'; }
    abLabelEl.classList.add('show');
  } else {
    abLabelEl.classList.remove('show');
  }
}
// Persistent letter beside each dropped point (straight A/B, curve A,B,C…). Positioned per
// frame from drawPts (world→screen); cleared when the draw ends. DOM (CanvasKit has no text).
function renderAbDotLabels() {
  if (!abDotLabelsEl) return;
  const n = drawPts.length || 0; // letters for map-tap AND Drive-AB markers (drawMode may be null)
  while (abDotLabelsEl.children.length < n) abDotLabelsEl.appendChild(document.createElement('span'));
  for (let i = 0; i < abDotLabelsEl.children.length; i++) {
    const span = abDotLabelsEl.children[i];
    if (i >= n || pw(drawPts[i].e, drawPts[i].n) < 1.0) { span.style.display = 'none'; continue; }
    const xy = w2s(drawPts[i].e, drawPts[i].n);
    span.textContent = abLetter(i);
    span.style.color = abLabelColor(i);
    span.style.left = xy[0] + 'px';
    span.style.top = xy[1] + 'px';
    span.style.display = 'block';
  }
}
// Configure the bottom toolbar buttons for the active flow.
function showAbBar(setPoint, undo, finish) {
  drawBar.querySelector('#draw-setpoint').style.display = setPoint ? '' : 'none';
  drawBar.querySelector('#draw-undo').style.display = undo ? '' : 'none';
  drawBar.querySelector('#draw-finish').style.display = finish ? '' : 'none';
  drawBar.classList.add('show');
}
function startDrawTrack(mode) {           // map-tap straight/curve
  abFlow = mode; drawMode = mode; drawPts = [];
  transport.send(mode === 'straight' ? 'track.drawStraight' : 'track.drawCurve');
  showAbBar(false, mode === 'curve', mode === 'curve');
  startMapTap({ hint: abHint(), onTap: drawTap });
}
function startDriveAB() {                  // GPS: set A then B at the vehicle
  abFlow = 'driveAB'; driveStep = 0; drawPts = []; driveRaw = []; // drawPts holds the dropped A/B markers
  transport.send('track.driveAB');
  showAbBar(true, false, false);
  document.getElementById('draw-setpoint').textContent = tr('Set Point A');
  hintEl.classList.add('show'); setAbHint();
}
function startRecordCurve() {              // GPS: record by driving — Set Start → Set End
  abFlow = 'recordCurve'; driveStep = 0; curveMarks = []; _lastCurveMark = null;
  // Recording doesn't begin until "Set Start" (deferred track.recordCurve), so the operator
  // can position at the curve's start first. The set-point button drives the two-step.
  showAbBar(true, false, false);
  document.getElementById('draw-setpoint').textContent = tr('Set Point A');
  hintEl.classList.add('show'); setAbHint();
}
// "Bnd. Curve" — tap point A then point B on the boundary; the host walks the shorter arc
// between them and builds a curve following the boundary. Each tap lands on the fence where
// it's nearest (a corner when one is close) for display; the host projects it again.
function startBoundaryCurve() {
  abFlow = 'boundaryCurve'; drawPts = [];
  showAbBar(false, false, false);          // draw toolbar shows just Cancel
  startMapTap({ hint: tr('Tap point A on the boundary'), onTap: boundaryCurveTap });
}
function boundaryCurveTap(e, n) {
  drawPts.push(snapToFence(e, n, Infinity)); // A/B on the fence (dot shown)
  if (drawPts.length < 2) { hintEl.textContent = tr('Tap point B on the boundary'); return; }
  const a = drawPts[0], b = drawPts[1];
  transport.send('track.boundaryCurveSeg|' + a.e.toFixed(3) + ',' + a.n.toFixed(3) + ',' + b.e.toFixed(3) + ',' + b.n.toFixed(3));
  endAbFlow();
}
// A drawn line is the edge between passes (PassGeometry), as in AgOpenGPS's FormABDraw,
// whose taps all land on fence points. A tap near the fence snaps onto it (a corner when
// one is close, else the nearest point on the fence), so a line drawn along the boundary
// lies on it and its first pass is half a width inside. Measured on screen, so the reach
// is the same at any zoom or tilt.
const FENCE_SNAP_PX = 24;
function snapToFence(e, n, reach = FENCE_SNAP_PX) {
  const bs = scene && scene.boundaries;
  if (!bs) return { e, n };
  const t = w2s(e, n);
  const px = (q) => { const s = w2s(q.e, q.n); return Math.hypot(s[0] - t[0], s[1] - t[1]); };
  let corner = null, cd = FENCE_SNAP_PX, edge = null, ed = reach;
  for (const ring of bs) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const d = px(a);
    if (d < cd) { cd = d; corner = a; }
    const dx = b.e - a.e, dn = b.n - a.n, len2 = dx * dx + dn * dn;
    if (len2 === 0) continue;
    const u = Math.max(0, Math.min(1, ((e - a.e) * dx + (n - a.n) * dn) / len2));
    const q = { e: a.e + u * dx, n: a.n + u * dn }, dq = px(q);
    if (dq < ed) { ed = dq; edge = q; }
  }
  const p = corner || edge;
  return p ? { e: p.e, n: p.n } : { e, n };
}
function drawTap(e, n) {                    // map-tap point captured (straight/curve)
  ({ e, n } = snapToFence(e, n));
  drawPts.push({ e, n });
  transport.send('track.drawPoint|' + e.toFixed(3) + ',' + n.toFixed(3));
  // Straight = exactly 2 points; the host auto-creates the line on the 2nd, so we're done.
  if (abFlow === 'straight' && drawPts.length >= 2) { endAbFlow(); return; }
  setAbHint();
}
// A driven line's reference goes to the implement's edge on the First pass side (the host's
// RefSideOffset), so the A/B markers and path dots go there too, not under the tractor.
let driveRaw = [];       // Drive-AB A/B at the vehicle, to re-place both on the A→B heading
function refEdgePt(e, n, h) {
  const t = config && config.tool;
  const half = Math.max(0, toolWidthM() - ((t && t.overlap) || 0)) * 0.5;
  const d = (qabSide === 'right' ? half : -half) + ((t && t.offset) || 0);
  return { e: e + Math.sin(h + Math.PI / 2) * d, n: n + Math.cos(h + Math.PI / 2) * d };
}
function poseEdgePt() { const p = tick.pose; return refEdgePt(p.e, p.n, p.heading || 0); }
function abSetPoint() {                     // Set-point button — drives Drive-AB and record-curve
  const btn = document.getElementById('draw-setpoint');
  if (abFlow === 'driveAB') {
    if (driveStep > 1) return;             // guard a double-B while B lingers
    transport.send('track.setABGps');      // SetABPoint uses live GPS in DriveAB mode
    // Drop an A/B marker where the line will lie. B fixes the heading the host shifts by
    // (A→B), so both markers are placed again on it.
    if (tick && tick.pose) {
      driveRaw.push({ e: tick.pose.e, n: tick.pose.n });
      if (driveRaw.length >= 2) {
        const a = driveRaw[0], b = driveRaw[driveRaw.length - 1];
        const h = Math.atan2(b.e - a.e, b.n - a.n);
        drawPts = driveRaw.slice(0, 2).map(p => refEdgePt(p.e, p.n, h));
      } else drawPts.push(poseEdgePt());
    }
    if (driveStep === 0) { driveStep = 1; btn.textContent = tr('Set Point B'); setAbHint(); }
    else {                                  // B set → host created the line; show B a beat, then clear
      driveStep = 2;
      setTimeout(() => { if (abFlow === 'driveAB') endAbFlow(); }, 700);
    }
  } else if (abFlow === 'recordCurve') {
    if (driveStep > 1) return;              // guard a double-B while B lingers
    if (driveStep === 0) {                  // Set Point A → drop the A endpoint + begin recording
      transport.send('track.recordCurve');
      driveStep = 1; btn.textContent = tr('Set Point B');
      if (tick && tick.pose) {
        drawPts.push(poseEdgePt());                          // labeled "A" endpoint dot (orange)
        _lastCurveMark = { e: tick.pose.e, n: tick.pose.n }; // seed green-dot spacing; no dot at A itself
      }
      setAbHint();
    } else {                                // Set Point B → drop the B endpoint + finish
      driveStep = 2;
      if (tick && tick.pose) drawPts.push(poseEdgePt());    // labeled "B" endpoint dot (blue)
      transport.send('track.finishCurve');  // host builds the curve from its recorded points
      setTimeout(() => { if (abFlow === 'recordCurve') endAbFlow(); }, 700);   // show B a beat, then clear
    }
  }
}
function abUndo() {
  if (abFlow !== 'curve' || !drawPts.length) return;
  drawPts.pop();
  transport.send('track.drawUndo');
  setAbHint();
}
function abFinish() {
  if (abFlow === 'curve') transport.send('track.drawFinish');
  else if (abFlow === 'recordCurve') transport.send('track.finishCurve');
  else return;
  endAbFlow();
}
function abCancel() {
  if (!abFlow) return;
  transport.send('track.drawCancel'); // CancelABCreationCommand — universal (all modes)
  endAbFlow();
}
function endAbFlow() {
  abFlow = null; drawMode = null; drawPts = []; driveRaw = []; driveStep = 0;
  curveMarks = []; _lastCurveMark = null; // clear record-curve path dots
  drawBar.classList.remove('show');
  endMapTap();
  hintEl.classList.remove('show');
}
// Drop a path dot every ~1.5 m while recording a drive-curve (between Set Point A and B), so
// the operator sees the shape being captured. Visual only — the host records the real curve.
function sampleCurveMark() {
  if (abFlow !== 'recordCurve' || driveStep !== 1 || !tick || !tick.pose) return;
  const p = tick.pose;
  if (_lastCurveMark && Math.hypot(p.e - _lastCurveMark.e, p.n - _lastCurveMark.n) < 1.5) return;
  _lastCurveMark = { e: p.e, n: p.n };
  curveMarks.push(poseEdgePt());
}
function drawCurveMarksSk(canvas) {
  if (!curveMarks.length) return;
  const rad = Math.max(3, 0.4 * pxPerM);
  SKP.flagFill.setColor(ckColor('#39FF6A')); // recording green
  for (const p of curveMarks) {
    if (pw(p.e, p.n) < 1.0) continue; // behind the near plane
    const xy = w2s(p.e, p.n);
    canvas.drawCircle(xy[0], xy[1], rad, SKP.flagFill);
    canvas.drawCircle(xy[0], xy[1], rad, SKP.flagOutline);
  }
}
// ---- boundary draw-on-map (Phase MT) — native BoundaryMapDialog equivalent ----
// Shows a Bing aerial underlay (satEnabled) and captures the boundary polygon by tapping
// the imagery (s2w → field E/N). On finish the host builds the boundary AND assembles the
// covered Bing tiles into the field-background PNG (boundary.fromMapPoints). Client-side
// point buffer for the live preview; no geometry in JS.
let satBnd = false;      // drawing a boundary on the satellite underlay
let satPts = [];         // [{e,n}] polygon vertices (preview only)
function startSatBoundary() {
  satEnabled = true; satBnd = true; satPts = [];
  lnCloseAll();                           // close the boundary menu
  showAbBar(false, true, true);           // Undo + Finish + Cancel
  startMapTap({ hint: tr('Tap the field corners on the imagery — Finish when done'), onTap: satTap });
}
function satTap(e, n) { satPts.push({ e, n }); setSatHint(); }
function setSatHint() { hintEl.textContent = satPts.length === 1 ? tr('Boundary: 1 point — Finish when done') : tr('Boundary: {n} points — Finish when done', { n: satPts.length }); }
function satUndo() { if (satPts.length) { satPts.pop(); setSatHint(); } }
function satFinish() {
  if (satPts.length >= 3)
    transport.send('boundary.fromMapPoints|' + satPts.map(p => p.e.toFixed(3) + ',' + p.n.toFixed(3)).join(';'));
  endSatBoundary();
}
function satCancel() { endSatBoundary(); }
function endSatBoundary() {
  satBnd = false; satEnabled = false; satPts = [];
  drawBar.classList.remove('show'); endMapTap(); hintEl.classList.remove('show');
}

// ---- headland draw-on-map (Field Builder stage 2) — tap two boundary points -----------
// Preview snaps each tap to the nearest boundary vertex (visual only; the host re-snaps and
// builds the inward offset + headland). Ships headland.fromMapPoints on the 2nd tap.
let hlFlow = null;       // 'line' | 'curve' — drawing a headland segment, else null
let hlPts = [];          // [{e,n}] tapped+snapped boundary points (preview)
let hlOffset = 12;       // inward offset (m) chosen in the Add sub-view
function hlSnap(e, n) {
  const ring = scene && scene.boundaries && scene.boundaries[0];
  if (!ring || !ring.length) return { e, n };
  let best = ring[0], bd = Infinity;
  for (const p of ring) { const d = (p.e - e) ** 2 + (p.n - n) ** 2; if (d < bd) { bd = d; best = p; } }
  return { e: best.e, n: best.n };
}
function setHlHint() { hintEl.textContent = hlPts.length === 0 ? tr('Tap the start of an edge (add a line per edge to enclose the headland)') : tr('Tap the end of the edge'); }
function startHeadlandDraw(mode, offset) {
  const ring = scene && scene.boundaries && scene.boundaries[0];
  if (!ring || ring.length < 3) {
    const h = document.getElementById('maptap-hint');
    h.textContent = tr('No boundary to offset'); h.classList.add('show');
    setTimeout(() => h.classList.remove('show'), 1800);
    return;
  }
  hlFlow = mode; hlOffset = offset; hlPts = [];
  showAbBar(false, true, true);   // Undo + Finish + Cancel — draw MANY lines, Finish to stop
  startMapTap({ hint: 'Tap the start of an edge (add a line per edge to enclose the headland)', onTap: hlTap });
}
function hlTap(e, n) {
  hlPts.push(hlSnap(e, n));
  if (hlPts.length >= 2) {
    // Ship this edge line and immediately re-arm for the NEXT edge — headland drawing is
    // continuous (one line per edge) until the operator taps Finish, mirroring native.
    transport.send('headland.fromMapPoints|' + hlFlow + ',' + hlOffset + ',' +
      hlPts[0].e.toFixed(3) + ',' + hlPts[0].n.toFixed(3) + ',' +
      hlPts[1].e.toFixed(3) + ',' + hlPts[1].n.toFixed(3));
    hlPts = [];
    hintEl.textContent = tr('Edge added — draw the next edge, or tap Finish');
    return;
  }
  setHlHint();
}
function hlUndo() { if (hlPts.length) { hlPts.pop(); setHlHint(); } }
function endHeadlandDraw() {
  hlFlow = null; hlPts = [];
  drawBar.classList.remove('show'); endMapTap(); hintEl.classList.remove('show');
}

// ---- Field Builder stage 4 — on-map point editing -----------------------------------
// Drag a track's / headland segment's points on the main map, then Save. The client only
// captures the dragged positions; the host rebuilds (track heading recompute, or headland
// snap-to-boundary + re-offset + rebuild). One handle drag at a time; the map still pans
// when the press doesn't start on a handle.
let editSession = null;  // { kind:'track'|'headland', index, points:[{e,n}] }
let editDragIdx = -1;
function flashHint(t) { const h = document.getElementById('maptap-hint'); h.textContent = t; h.classList.add('show'); setTimeout(() => h.classList.remove('show'), 1800); }
function startTrackEdit() {
  const active = (scene && scene.trackList || []).find(t => t.active);
  const at = scene && scene.tracks && scene.tracks[0];
  if (!active || !at || !at.points || at.points.length < 2) { flashHint(tr('Select/activate a track to edit')); return; }
  editSession = { kind: 'track', index: active.index, points: at.points.map(p => ({ e: p.e, n: p.n })) };
  beginEdit(tr('Drag the track points, then Save'));
}
function startHeadlandEdit() {
  const hs = scene && scene.headlandSegs; if (fbHlSel < 0 || !hs || !hs[fbHlSel]) return;
  const s = hs[fbHlSel];
  if (s.type === 'Boundary') { flashHint(tr('Whole-boundary headland is not point-edited')); return; }
  editSession = { kind: 'headland', index: s.index, points: [{ e: s.endA.e, n: s.endA.n }, { e: s.endB.e, n: s.endB.n }] };
  beginEdit(tr('Drag the two endpoints (snap to boundary), then Save'));
}
function beginEdit(hint) {
  showAbBar(false, false, true);  // Save (Finish) + Cancel
  document.getElementById('draw-finish').textContent = tr('Save');
  hintEl.textContent = hint; hintEl.classList.add('show'); document.body.classList.add('maptap');
}
function editHitTest(px, py) {
  if (!editSession) return -1;
  let best = -1, bd = 22 * 22;
  for (let i = 0; i < editSession.points.length; i++) {
    const p = editSession.points[i];
    if ((pw(p.e, p.n)) < 1.0) continue;
    const xy = w2s(p.e, p.n); const dx = xy[0] - px, dy = xy[1] - py; const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function saveEdit() {
  if (!editSession) return;
  const pts = editSession.points;
  if (editSession.kind === 'track')
    transport.send('track.editSave|' + editSession.index + ';' + pts.map(p => p.e.toFixed(3) + ',' + p.n.toFixed(3)).join(';'));
  else if (pts.length >= 2)
    transport.send('headland.editSave|' + editSession.index + ',' + pts[0].e.toFixed(3) + ',' + pts[0].n.toFixed(3) + ',' + pts[1].e.toFixed(3) + ',' + pts[1].n.toFixed(3));
  endEdit();
}
function endEdit() {
  editSession = null; editDragIdx = -1;
  drawBar.classList.remove('show'); document.getElementById('draw-finish').textContent = tr('Finish');
  hintEl.classList.remove('show'); document.body.classList.remove('maptap');
}
function drawEditHandlesSk(canvas) {
  if (!editSession) return;
  if (editSession.points.length >= 2) strokePtsSk(canvas, editSession.points, false, SKP.track);
  const rad = Math.max(5, 0.7 * pxPerM);
  for (let i = 0; i < editSession.points.length; i++) {
    const p = editSession.points[i];
    if ((pw(p.e, p.n)) < 1.0) continue;
    const xy = w2s(p.e, p.n);
    SKP.flagFill.setColor(ckColor(i === editDragIdx ? '#FFD24A' : '#40E0FF'));
    canvas.drawCircle(xy[0], xy[1], rad, SKP.flagFill);
    canvas.drawCircle(xy[0], xy[1], rad, SKP.flagOutline);
  }
}
document.getElementById('fb-hl-edit').addEventListener('pointerdown', e => { e.stopPropagation(); startHeadlandEdit(); });

// Draw toolbar serves whichever map-draw flow is active (AB line / boundary-on-map / headland).
drawBar.addEventListener('pointerdown', e => e.stopPropagation()); // don't pan / not a map tap
document.getElementById('draw-setpoint').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); abSetPoint(); });
document.getElementById('draw-undo').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); hlFlow ? hlUndo() : satBnd ? satUndo() : abUndo(); });
document.getElementById('draw-finish').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); editSession ? saveEdit() : hlFlow ? endHeadlandDraw() : satBnd ? satFinish() : abFinish(); });
document.getElementById('draw-cancel').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); editSession ? endEdit() : hlFlow ? endHeadlandDraw() : satBnd ? satCancel() : abCancel(); });
// Touch cancel for bare map-tap flows (flag). stopPropagation so the pill isn't taken as a map tap.
document.getElementById('maptap-cancel').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (mapTap && mapTap.onCancel) mapTap.onCancel(); else endMapTap(); });

// ---- AB flyout launchers → the three creation/management dialogs ----
function abFlyoutClose() { bnAb.classList.remove('open'); document.getElementById('bn-abmenu').classList.remove('menuopen'); }
document.getElementById('bn-tracks').addEventListener('pointerdown', e => { e.stopPropagation(); abFlyoutClose(); openTracksManager(); });
document.getElementById('bn-quickab').addEventListener('pointerdown', e => { e.stopPropagation(); abFlyoutClose(); qabHeadingReset(); qabSetSide('right'); openDialog('dlg-quickab'); });
// A+ heading box (#335): empty each time the dialog opens, the vehicle's heading as its
// placeholder (refreshed on focus); a typed value goes with track.aPlus.
const qabHeading = document.getElementById('qab-aplus-heading');
function vehicleHeadingDeg() {
  const h = tick && tick.pose && tick.pose.heading;
  return typeof h === 'number' ? ((h * 180 / Math.PI) % 360 + 360) % 360 : null;
}
function qabHeadingReset() {
  qabHeading.value = '';
  const d = vehicleHeadingDeg();
  qabHeading.placeholder = d === null ? '' : d.toFixed(1);
}
qabHeading.addEventListener('focus', () => { const d = vehicleHeadingDeg(); if (d !== null) qabHeading.placeholder = d.toFixed(1); });
// First-pass side for the driven modes (#345): Right each time the dialog opens, like
// AgOpenGPS; sent just before A+ / Drive AB / Curve so the host moves the line to that side.
const qabRefSide = document.getElementById('qab-refside');
let qabSide = 'right';
function qabSetSide(s) {
  qabSide = s;
  for (const b of qabRefSide.children) b.classList.toggle('active', b.dataset.side === s);
}
for (const b of qabRefSide.children)
  b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); qabSetSide(b.dataset.side); });
// Quick-AB selector buttons.
// Quick AB — the single creation hub: GPS-driven, from-boundary, and draw-on-map modes.
document.getElementById('dlg-quickab').querySelectorAll('[data-qab]').forEach(b => b.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation(); closeDialog();
  const m = b.dataset.qab;
  if (m === 'aPlus' || m === 'driveAB' || m === 'recordCurve') transport.send('track.refSide|' + qabSide);
  if (m === 'aPlus') {
    // A+ builds an AB line from the vehicle's current position + heading. It needs a GPS
    // fix; the host bails silently without one, so give feedback here (StatusMessage isn't
    // on the wire). flashHint after a tick so it isn't cleared by the dialog close.
    const p = tick && tick.pose;
    if (!p || (!p.e && !p.n)) setTimeout(() => flashHint(tr('A+ needs a GPS position — start the simulator or GPS')), 0);
    else {
      const v = qabHeading.value.trim();
      transport.send('track.aPlus' + (v !== '' && isFinite(+v) ? '|' + (+v) : ''));
    }
  }
  else if (m === 'latLonHeading' || m === 'latLonAB') openLatLonLine(m);
  else if (m === 'driveAB') startDriveAB();
  else if (m === 'recordCurve') startRecordCurve();
  else if (m === 'boundaryEdge') transport.send('track.createFromBoundary');
  else if (m === 'boundaryCurve') startBoundaryCurve();
  else if (m === 'allEdges') transport.send('track.allEdges');
  else if (m === 'drawStraight') startDrawTrack('straight');
  else if (m === 'drawCurve') startDrawTrack('curve');
}));
document.getElementById('dlg-qab-cancel').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); closeDialog(); });

// ---- Tracks manager (mirrors native TracksDialogPanel) ----
// View-only without control (just reads scene.trackList); the actions are Tier-2.
// Like AgOpenGPS's track list: tapping a row only highlights it (trkSel); guidance
// changes when Activate is pressed. Delete / Swap act on the highlighted row (#109).
let trkSel = -1; // index into scene.trackList, or -1
function openTracksManager() { trkSel = -1; renderTracksList(); openDialog('dlg-tracks'); }
function renderTracksList() {
  // Dim the guidance-affecting actions when we're not the operator. Delete/swap/activate
  // change the active line (every action needs control, #397; these are dimmed).
  for (const id of ['trk-delete', 'trk-swap', 'trk-activate'])
    document.getElementById(id).classList.toggle('disabled', !iHoldControl);
  const list = document.getElementById('trk-list');
  const tl = (scene && scene.trackList) || [];
  if (trkSel >= tl.length) trkSel = -1;
  if (!tl.length) { list.innerHTML = '<div class="trk-empty">No tracks in this field</div>'; return; }
  list.innerHTML = '';
  tl.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'trk-row' + (t.active ? ' active' : '') + (i === trkSel ? ' sel' : '');
    row.innerHTML =
      '<input type="checkbox" class="trk-vis"' + (t.visible ? ' checked' : '') + '>' +
      '<span class="trk-name"></span>' +
      '<span class="trk-type"></span>' +
      '<span class="trk-dot"></span>';
    row.querySelector('.trk-name').textContent = t.name;
    row.querySelector('.trk-type').textContent = t.type || '—';
    // Tap row (not the checkbox) → that track becomes the active one, and stays
    // highlighted for Delete/Swap. A hidden track can't be activated (AgOpenGPS) (#148).
    // Checkbox → toggle visibility.
    row.addEventListener('pointerdown', e => {
      if (e.target.classList.contains('trk-vis')) return; // let the checkbox handle it
      e.stopPropagation();
      trkSel = t.visible ? i : -1;
      if (t.visible && iHoldControl) transport.send('track.select|' + t.index);
      renderTracksList();
    });
    const cb = row.querySelector('.trk-vis');
    cb.addEventListener('change', e => {
      e.stopPropagation();
      transport.send('track.setVisible|' + t.index + ',' + (cb.checked ? 1 : 0));
    });
    list.appendChild(row);
  });
}
document.getElementById('trk-delete').addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  if (!iHoldControl) return;
  const t = (scene && scene.trackList || [])[trkSel];
  if (!t) { showToast(tr('Select a track first')); return; }
  showConfirm(tr('Delete Track'), tr("Delete '{name}'? This cannot be undone.", { name: t.name }),
    () => { transport.send('track.delete|' + t.index); trkSel = -1; },
    () => { renderTracksList(); openDialog('dlg-tracks'); }); // stay in the manager to delete more
});
document.getElementById('trk-swap').addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  if (!iHoldControl) return;
  const t = (scene && scene.trackList || [])[trkSel];
  if (!t) { showToast(tr('Select a track first')); return; }
  transport.send('track.swapAB|' + t.index);
});
// Activate = AgOpenGPS "Use": the highlighted track (or the first visible one) becomes
// active and the dialog closes. On the already-active track it turns guidance off.
document.getElementById('trk-activate').addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  if (!iHoldControl) return;
  const t = (scene && scene.trackList || [])[trkSel];
  transport.send('track.activate|' + (t ? t.index : -1));
  closeDialog();
});
document.getElementById('trk-recpaths').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); transport.send('track.toggleRecPaths'); });
document.getElementById('trk-import').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); closeDialog(); lnOpen('importtracks'); });
document.getElementById('dlg-tracks-close').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); closeDialog(); });

// ---- left nav (Phase 9) — config/settings panels via the config bridge ----
// Vertical button bar; each button toggles a non-modal panel (only one open at a
// time). Panels READ from the config frame (or existing frames, e.g. units =
// Status.isMetric) and WRITE via `config.set|key:value` (needs control; the host applies it
// to ConfigurationStore). Grows one entry per sub-phase.
// Navigation: top-level buttons open a panel; sub-panels (vehicle/tool config) are
// reached from the hub and carry a Back button. One panel open at a time.
const LN_NAV_PANELS = ['screenalerts', 'tools', 'rollcorr', 'fieldtools', 'fieldbuilder', 'offsetfix', 'importtracks', 'recpath', 'boundarymenu', 'boundaryplayer', 'kmlboundary', 'vehtoolhub', 'vehiclecfg', 'toolcfg', 'autosteercfg', 'networkio', 'systemdata', 'ntripprofiles', 'ntripeditor', 'smartwas', 'fieldops', 'fieldsandjobs', 'newfield', 'fromexisting', 'isoimport', 'kmlimport', 'resumejob', 'agsettings', 'agupload', 'agdownload', 'filemenu', 'appsettings', 'language', 'viewsettings', 'logviewer', 'hotkeys', 'help', 'about', 'bugreport'];
// Watch-the-tractor panels opt OUT of the light-dismiss scrim — the map must stay
// interactive (pan/zoom to follow the tractor while capturing). They close only via
// the header (Back / ✕).
// The bug report panel too: leave it open while driving and press the button the
// moment a problem shows, since the dump holds only the last 60 s of GPS data.
const NO_SCRIM = new Set(['smartwas', 'recpath', 'boundaryplayer', 'fieldbuilder', 'bugreport']);
const lnScrim = document.getElementById('ln-scrim');
function lnCloseAll() {
  for (const id of LN_NAV_PANELS) document.getElementById(id).classList.remove('open');
  lnScrim.classList.remove('open');
  document.getElementById('ln-screenalerts').classList.remove('active');
  document.getElementById('ln-vehicle').classList.remove('active');
  document.getElementById('ln-autosteer').classList.remove('active');
  document.getElementById('ln-network').classList.remove('active');
  document.getElementById('ln-fieldops').classList.remove('active');
  document.getElementById('ln-filemenu').classList.remove('active');
  document.getElementById('ln-tools').classList.remove('active');
  document.getElementById('ln-fieldtools').classList.remove('active');
}
function lnOpen(panelId, navBtnId, onOpen) {
  // Opening a menu leaves an AB line being drawn on the map, like Esc (#399).
  if (abFlow === 'straight' || abFlow === 'curve') abCancel();
  lnCloseAll();
  document.getElementById(panelId).classList.add('open');
  if (!NO_SCRIM.has(panelId)) lnScrim.classList.add('open'); // transparent light-dismiss
  if (navBtnId) document.getElementById(navBtnId).classList.add('active');
  if (onOpen) onOpen();
}
// Outside tap on the scrim closes the chain and is CONSUMED (stopPropagation keeps the
// map from panning / the background from actuating).
lnScrim.addEventListener('pointerdown', e => { e.stopPropagation(); lnCloseAll(); });
for (const id of LN_NAV_PANELS) document.getElementById(id).addEventListener('pointerdown', e => e.stopPropagation());
document.getElementById('ln-screenalerts').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (document.getElementById('screenalerts').classList.contains('open')) lnCloseAll();
  else lnOpen('screenalerts', 'ln-screenalerts', populateScreenAlerts);
});
document.getElementById('ln-vehicle').addEventListener('pointerdown', e => {
  e.stopPropagation();
  const anyOpen = ['vehtoolhub', 'vehiclecfg', 'toolcfg'].some(id => document.getElementById(id).classList.contains('open'));
  if (anyOpen) lnCloseAll(); else lnOpen('vehtoolhub', 'ln-vehicle', refreshHub);
});
document.getElementById('ln-autosteer').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (document.getElementById('autosteercfg').classList.contains('open')) lnCloseAll();
  else lnOpen('autosteercfg', 'ln-autosteer', () => {
    // Always open collapsed (left pane only), like the native panel.
    asPanel.classList.remove('expanded');
    document.getElementById('as-expand').textContent = tr('▶ Full');
    populateAutoSteer(true);
  });
});
document.getElementById('ln-network').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (document.getElementById('networkio').classList.contains('open')) lnCloseAll();
  else lnOpen('networkio', 'ln-network', renderNetworkIo);
});
document.getElementById('ln-fieldops').addEventListener('pointerdown', e => {
  e.stopPropagation();
  const anyOpen = ['fieldops', 'fieldsandjobs', 'newfield'].some(id => document.getElementById(id).classList.contains('open'));
  if (anyOpen) lnCloseAll(); else lnOpen('fieldops', 'ln-fieldops', renderFieldOps);
});
document.getElementById('ln-tools').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (document.getElementById('tools').classList.contains('open')) lnCloseAll();
  else lnOpen('tools', 'ln-tools', renderToolsPanel);
});
// Tools fly-out items. Steer Wizard + Log Viewer reuse existing flows; Roll
// Correction is an inert placeholder (matches the native button, which has no
// command bound). The three chart buttons toggle their floating chart cards.
document.getElementById('tl-wizard').addEventListener('pointerdown', e => {
  e.stopPropagation(); lnCloseAll();
  if (typeof openSteerWizard === 'function') openSteerWizard();
});
// Log Viewer is a shortcut to the App Log Viewer (the File menu owns the same panel);
// track which parent opened it so Back returns to the right place.
let logViewerParent = 'filemenu';
document.getElementById('tl-logviewer').addEventListener('pointerdown', e => {
  e.stopPropagation(); logViewerParent = 'tools'; lnOpen('logviewer', 'ln-tools', renderLogViewer);
});
document.getElementById('lv-back').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (logViewerParent === 'tools') lnOpen('tools', 'ln-tools', renderToolsPanel);
  else lnOpen('filemenu', 'ln-filemenu');
});
// Roll Correction → the wizard's roll-cal piece as a standalone chain panel.
document.getElementById('tl-rollcorr').addEventListener('pointerdown', e => {
  e.stopPropagation(); lnOpen('rollcorr', 'ln-tools', renderRollCorr);
});
document.getElementById('rc-back').addEventListener('pointerdown', e => {
  e.stopPropagation(); lnOpen('tools', 'ln-tools', renderToolsPanel);
});
document.getElementById('rc-invert').addEventListener('pointerdown', e => {
  e.stopPropagation(); cfgSend('roll.isRollInvert', cfgGet('roll.isRollInvert') ? '0' : '1');
});
document.getElementById('rc-zero').addEventListener('pointerdown', e => {
  e.stopPropagation(); transport.send('roll.zeroCalibrate');
});
for (const b of document.querySelectorAll('.tl-chartbtn'))
  b.addEventListener('pointerdown', e => { e.stopPropagation(); toggleChart(b.dataset.chart); });
for (const b of document.querySelectorAll('.chart-x'))
  b.addEventListener('pointerdown', e => { e.stopPropagation(); setChartOpen(b.dataset.chart, false); });
// Field Tools fly-out.
document.getElementById('ln-fieldtools').addEventListener('pointerdown', e => {
  e.stopPropagation();
  const anyOpen = ['fieldtools', 'offsetfix'].some(id => document.getElementById(id).classList.contains('open'));
  if (anyOpen) lnCloseAll(); else lnOpen('fieldtools', 'ln-fieldtools');
});
// Field Tools work on the open field; without one, say so instead of asking (#305).
function requireField() {
  if (scene && scene.hasField) return true;
  showToast(tr('Open a field first'));
  return false;
}
document.getElementById('ft-deleteapplied').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (!requireField()) return;
  showConfirm(tr('Delete Applied Area'),
    tr('Delete all applied area coverage? This cannot be undone.'),
    () => transport.send('field.deleteApplied'));
});
document.getElementById('ft-offsetfix').addEventListener('pointerdown', e => {
  e.stopPropagation(); lnOpen('offsetfix', 'ln-fieldtools', renderOffsetFix);
});
document.getElementById('of-back').addEventListener('pointerdown', e => {
  e.stopPropagation(); lnOpen('fieldtools', 'ln-fieldtools');
});
document.getElementById('ft-importtracks').addEventListener('pointerdown', e => {
  e.stopPropagation(); lnOpen('importtracks', 'ln-fieldtools', renderImportTracks);
});
document.getElementById('it-back').addEventListener('pointerdown', e => {
  e.stopPropagation(); lnOpen('fieldtools', 'ln-fieldtools');
});
// Recorded Path.
document.getElementById('ft-recpath').addEventListener('pointerdown', e => {
  e.stopPropagation(); lnOpen('recpath', 'ln-fieldtools', renderRecPath);
});
document.getElementById('rp-back').addEventListener('pointerdown', e => {
  e.stopPropagation(); lnOpen('fieldtools', 'ln-fieldtools');
});
document.getElementById('rp-tab-rec').addEventListener('pointerdown', e => { e.stopPropagation(); recPathTab = 0; renderRecPath(); });
document.getElementById('rp-tab-play').addEventListener('pointerdown', e => { e.stopPropagation(); recPathTab = 1; renderRecPath(); });
document.getElementById('rp-start').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('recpath.start'); });
document.getElementById('rp-stop').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('recpath.stop'); });
document.getElementById('rp-save').addEventListener('pointerdown', e => {
  e.stopPropagation(); transport.send('recpath.save|' + document.getElementById('rp-name').value);
});
document.getElementById('rp-playbtn').addEventListener('pointerdown', e => { e.stopPropagation(); rnSend('recpath.play'); });
document.getElementById('rp-resume').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('recpath.cycleResume'); });
document.getElementById('rp-reverse').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('recpath.reverse'); });
// Boundary recording menu.
document.getElementById('ft-boundary').addEventListener('pointerdown', e => {
  e.stopPropagation(); if (!requireField()) return; transport.send('boundary.refresh'); lnOpen('boundarymenu', 'ln-fieldtools', renderBoundaryMenu);
});
document.getElementById('bm-back').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('fieldtools', 'ln-fieldtools'); });

// ---- Field Builder (Phase MT) — Tracks / Headland / Tram editor (NO_SCRIM: the map
// stays interactive so you draw/edit on it). Stage 1 = Tracks tab; reuses the existing
// AB-draw / create-from-boundary flows on the main map. ----
let fbTab = 'tracks';   // active FB tab
let fbSel = -1;         // selected track index in the Tracks tab
document.getElementById('ft-fieldbuilder').addEventListener('pointerdown', e => {
  e.stopPropagation(); if (!requireField()) return; fbTab = 'tracks'; fbSel = -1; lnOpen('fieldbuilder', 'ln-fieldtools', renderFieldBuilder);
});
document.getElementById('fieldbuilder').addEventListener('pointerdown', e => e.stopPropagation()); // panel taps don't pan the map (NO_SCRIM)
document.querySelector('#fieldbuilder .fb-back').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('fieldtools', 'ln-fieldtools'); });
function showFbTab(tab) {
  fbTab = tab;
  document.getElementById('fb-addtrack').hidden = true;
  document.getElementById('fb-addhl').hidden = true;
  document.getElementById('fb-tramedit').hidden = true;
  for (const t of document.querySelectorAll('#fieldbuilder .fb-tab')) t.classList.toggle('active', t.dataset.fbtab === tab);
  for (const p of document.querySelectorAll('#fieldbuilder .fb-pane[data-fbpane]')) p.hidden = (p.dataset.fbpane !== tab);
  if (tab === 'tracks') renderFbTracks();
  else if (tab === 'headland') renderFbHeadland();
  else if (tab === 'tram') renderFbTram();
}
function renderFieldBuilder() { showFbTab(fbTab); }
for (const t of document.querySelectorAll('#fieldbuilder .fb-tab'))
  t.addEventListener('pointerdown', e => { e.stopPropagation(); showFbTab(t.dataset.fbtab); });
function renderFbTracks() {
  const list = document.getElementById('fb-tracklist');
  const tl = (scene && scene.trackList) || [];
  if (fbSel >= tl.length) fbSel = -1;
  if (!tl.length) { list.innerHTML = '<div class="trk-empty">No tracks</div>'; return; }
  list.innerHTML = '';
  tl.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'fb-trkrow' + (t.active ? ' active' : '') + (i === fbSel ? ' sel' : '');
    row.innerHTML = '<span class="fb-dot"></span><span class="fb-tname"></span>';
    row.querySelector('.fb-tname').textContent = t.name;
    row.addEventListener('pointerdown', ev => {
      ev.stopPropagation(); fbSel = i;
      if (iHoldControl) transport.send('track.select|' + t.index); // activate (highlights on map)
      renderFbTracks();
    });
    list.appendChild(row);
  });
}
// Add-track sub-view.
document.getElementById('fb-trk-add').addEventListener('pointerdown', e => {
  e.stopPropagation();
  for (const p of document.querySelectorAll('#fieldbuilder .fb-pane[data-fbpane]')) p.hidden = true;
  document.getElementById('fb-addtrack').hidden = false;
});
document.getElementById('fb-add-back').addEventListener('pointerdown', e => { e.stopPropagation(); showFbTab('tracks'); });
for (const b of document.querySelectorAll('#fb-addtrack .fb-addbtn'))
  b.addEventListener('pointerdown', e => {
    e.stopPropagation();
    const m = b.dataset.fbadd;
    showFbTab('tracks');
    if (m === 'ab') startDrawTrack('straight');        // map-tap draw (FB stays open, NO_SCRIM)
    else if (m === 'curve') startDrawTrack('curve');
    else if (m === 'aplus') { transport.send('track.refSide|right'); transport.send('track.aPlus'); }
    else if (m === 'bedge') transport.send('track.createFromBoundary');
    else if (m === 'bcurve') transport.send('track.boundaryCurve');
    else if (m === 'ball') transport.send('track.allEdges');
  });
// Track actions (Edit = stage 4).
document.getElementById('fb-trk-edit').addEventListener('pointerdown', e => { e.stopPropagation(); startTrackEdit(); });
document.getElementById('fb-trk-delete').addEventListener('pointerdown', e => {
  e.stopPropagation();
  const tl = scene && scene.trackList; if (fbSel < 0 || !tl || !tl[fbSel] || !iHoldControl) return;
  transport.send('track.delete|' + tl[fbSel].index); fbSel = -1;
});
document.getElementById('fb-trk-deleteall').addEventListener('pointerdown', e => {
  e.stopPropagation();
  showConfirm(tr('Delete All Tracks'), tr('Delete all tracks? This cannot be undone.'),
    () => { if (iHoldControl) transport.send('track.deleteAll'); fbSel = -1; });
});
document.getElementById('fb-trk-rename').addEventListener('pointerdown', e => {
  e.stopPropagation();
  const tl = scene && scene.trackList; if (fbSel < 0 || !tl || !tl[fbSel]) return;
  const t = tl[fbSel];
  renderFbTracks();
  const row = document.querySelectorAll('#fb-tracklist .fb-trkrow')[fbSel]; if (!row) return;
  const nameEl = row.querySelector('.fb-tname');
  const input = document.createElement('input'); input.className = 'flg-nameedit'; input.value = t.name;
  nameEl.replaceWith(input); input.focus(); input.select();
  const commit = () => { const v = input.value.trim(); if (v && v !== t.name) transport.send('track.rename|' + t.index + ',' + v); renderFbTracks(); };
  input.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') commit(); else if (ev.key === 'Escape') renderFbTracks(); });
  input.addEventListener('blur', commit);
});
// ---- Field Builder Headland tab (stage 2) — segment list + build ----------------------
// Line/Curve = tap two boundary points
// on the main map (host snaps + builds the inward offset + the headland polygon); Whole
// Boundary = the entire boundary offset inward. The host runs ALL geometry — the client
// only captures the two taps + the offset and ships them (no headland math in JS).
let fbHlSel = -1;        // selected segment index in the Headland tab
function fbDefaultOffset() {  // tool width × 2 (host re-defaults to the same if 0 is sent)
  const tw = sectionsWidthM(); // fork: no made-up width; 0 = none (the inset must be typed in)
  return tw > 0 ? +(tw * 2).toFixed(1) : 0;
}
function renderFbHeadland() {
  const list = document.getElementById('fb-hllist');
  const hs = (scene && scene.headlandSegs) || [];
  if (fbHlSel >= hs.length) fbHlSel = -1;
  const offrow = document.getElementById('fb-hl-offrow');
  if (!hs.length) { list.innerHTML = '<div class="trk-empty">No headland yet. Add a line along each edge (or Whole Boundary). Where the lines cross they enclose the headland.</div>'; offrow.hidden = true; return; }
  list.innerHTML = '';
  hs.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'fb-hlrow' + (s.effective ? '' : ' noeffect') + (i === fbHlSel ? ' sel' : '');
    row.innerHTML = '<span class="fb-dot"></span><span class="fb-hlname"></span><span class="fb-hlmeta"></span>';
    row.querySelector('.fb-hlname').textContent = s.name;
    row.querySelector('.fb-hlmeta').textContent = s.type + ' · ' + fmtUnit(+s.offset, 'm', 1);
    row.addEventListener('pointerdown', ev => { ev.stopPropagation(); fbHlSel = i; renderFbHeadland(); });
    list.appendChild(row);
  });
  // Offset editor for the selected segment (re-runs the build on change).
  if (fbHlSel >= 0 && hs[fbHlSel]) {
    offrow.hidden = false;
    const off = document.getElementById('fb-hl-off');
    if (document.activeElement !== off) writeUnitInput(off, +hs[fbHlSel].offset);
  } else offrow.hidden = true;
}
document.getElementById('fb-hl-off').addEventListener('change', e => {
  e.stopPropagation();
  const hs = scene && scene.headlandSegs; if (fbHlSel < 0 || !hs || !hs[fbHlSel]) return;
  const v = readUnitInput(e.target);   // display → metres before it reaches the host
  if (Number.isFinite(v) && v > 0) transport.send('headland.setOffset|' + hs[fbHlSel].index + ',' + v);
});
// Inset = N tool widths (dropdown, mirrors AgOpen's cboxToolWidths) → fills the metre box;
// editing the metre box directly flips the dropdown to Custom.
const fbTwSel = document.getElementById('fb-hl-tw');
const fbNewOff = document.getElementById('fb-hl-newoff');
// fork: without sections there is no working width to multiply: leave the box empty and say so.
function fbApplyTw() {
  const n = parseInt(fbTwSel.value), tw = sectionsWidthM();
  if (n > 0) { if (tw > 0) writeUnitInput(fbNewOff, n * tw); else fbNewOff.value = ''; }
  document.getElementById('fb-hl-twmiss').hidden = !(n > 0 && !(tw > 0));
}
fbTwSel.addEventListener('change', e => { e.stopPropagation(); fbApplyTw(); });
fbNewOff.addEventListener('input', e => { e.stopPropagation(); fbTwSel.value = '0'; document.getElementById('fb-hl-twmiss').hidden = true; });
document.getElementById('fb-hl-add').addEventListener('pointerdown', e => {
  e.stopPropagation();
  fbTwSel.value = '2'; fbApplyTw();   // default 2 tool widths
  for (const p of document.querySelectorAll('#fieldbuilder .fb-pane[data-fbpane]')) p.hidden = true;
  document.getElementById('fb-addhl').hidden = false;
});
document.getElementById('fb-hl-addback').addEventListener('pointerdown', e => { e.stopPropagation(); showFbTab('headland'); });
for (const b of document.querySelectorAll('#fb-addhl .fb-addbtn'))
  b.addEventListener('pointerdown', e => {
    e.stopPropagation();
    const off = readUnitInput(document.getElementById('fb-hl-newoff'));
    const offset = (Number.isFinite(off) && off > 0) ? off : fbDefaultOffset();
    if (!(offset > 0)) { document.getElementById('fb-hl-twmiss').hidden = false; return; } // fork: no inset, no width
    const m = b.dataset.fbhl;
    showFbTab('headland');
    if (m === 'whole') transport.send('headland.wholeBoundary|' + offset);
    else startHeadlandDraw(m, offset);   // 'line' | 'curve' — map-tap two boundary points
  });
document.getElementById('fb-hl-delete').addEventListener('pointerdown', e => {
  e.stopPropagation();
  const hs = scene && scene.headlandSegs; if (fbHlSel < 0 || !hs || !hs[fbHlSel]) return;
  transport.send('headland.delete|' + hs[fbHlSel].index); fbHlSel = -1;
});
document.getElementById('fb-hl-deleteall').addEventListener('pointerdown', e => {
  e.stopPropagation();
  showConfirm(tr('Delete All Headland'), tr('Delete all headland segments? The headland reverts to the boundary.'),
    () => { transport.send('headland.deleteAll'); fbHlSel = -1; });
});
document.getElementById('fb-hl-rename').addEventListener('pointerdown', e => {
  e.stopPropagation();
  const hs = scene && scene.headlandSegs; if (fbHlSel < 0 || !hs || !hs[fbHlSel]) return;
  const s = hs[fbHlSel];
  renderFbHeadland();
  const row = document.querySelectorAll('#fb-hllist .fb-hlrow')[fbHlSel]; if (!row) return;
  const nameEl = row.querySelector('.fb-hlname');
  const input = document.createElement('input'); input.className = 'flg-nameedit'; input.value = s.name;
  nameEl.replaceWith(input); input.focus(); input.select();
  const commit = () => { const v = input.value.trim(); if (v && v !== s.name) transport.send('headland.rename|' + s.index + ',' + v); renderFbHeadland(); };
  input.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') commit(); else if (ev.key === 'Escape') renderFbHeadland(); });
  input.addEventListener('blur', commit);
});
// ---- Field Builder Tram tab (stage 3) — system list + per-system editor --------------
// Systems live in ConfigStore.Tram.Systems (host SoT); the browser sends field edits and
// the host regenerates the lines + persists.
let fbTramSel = -1;
let fbTramPendingEdit = false; // open the editor on the system we just added (native parity)
function openTramEditor() {
  for (const p of document.querySelectorAll('#fieldbuilder .fb-pane[data-fbpane]')) p.hidden = true;
  document.getElementById('fb-tramedit').hidden = false;
  populateTramEdit();
}
function renderFbTram() {
  const list = document.getElementById('fb-tramlist');
  const ts = (scene && scene.tramSystems) || [];
  if (fbTramPendingEdit && ts.length) { fbTramPendingEdit = false; fbTramSel = ts.length - 1; openTramEditor(); return; }
  if (fbTramSel >= ts.length) fbTramSel = -1;
  if (!ts.length) { list.innerHTML = '<div class="trk-empty">No tram systems. Add one referencing a track or the boundary.</div>'; return; }
  list.innerHTML = '';
  ts.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'fb-hlrow' + (s.enabled ? '' : ' noeffect') + (i === fbTramSel ? ' sel' : '');
    row.innerHTML = '<span class="fb-dot"></span><span class="fb-hlname"></span><span class="fb-hlmeta"></span>';
    row.querySelector('.fb-hlname').textContent = s.name;
    row.querySelector('.fb-hlmeta').textContent = fmtUnit(s.width, 'm', 1) + ' · ' + (s.passCount ? tr('{n} pass', { n: s.passCount }) : tr('all', {}));
    row.addEventListener('pointerdown', ev => { ev.stopPropagation(); fbTramSel = i; renderFbTram(); });
    list.appendChild(row);
  });
}
function curTram() { const ts = scene && scene.tramSystems; return (fbTramSel >= 0 && ts && ts[fbTramSel]) ? ts[fbTramSel] : null; }
function tramSet(field, value) { const s = curTram(); if (s) transport.send('tram.set|' + s.index + ',' + field + ',' + value); }
document.getElementById('fb-tram-add').addEventListener('pointerdown', e => { e.stopPropagation(); fbTramPendingEdit = true; transport.send('tram.add'); });
document.getElementById('fb-tram-delete').addEventListener('pointerdown', e => {
  e.stopPropagation();
  const s = curTram(); if (!s) return;
  showConfirm(tr('Delete Tram System'), tr('Delete "{name}"?', { name: s.name }), () => { transport.send('tram.delete|' + s.index); fbTramSel = -1; });
});
document.getElementById('fb-tram-edit').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (curTram()) openTramEditor();
});
document.getElementById('fb-tram-back').addEventListener('pointerdown', e => { e.stopPropagation(); showFbTab('tram'); });
document.getElementById('fb-tram-done').addEventListener('pointerdown', e => { e.stopPropagation(); showFbTab('tram'); });
function populateTramEdit() {
  const s = curTram(); if (!s) { showFbTab('tram'); return; }
  document.getElementById('fb-tram-title').textContent = tr('Edit: {name}', { name: s.name });
  const en = document.getElementById('fb-tram-en'); en.classList.toggle('active', s.enabled); en.textContent = s.enabled ? tr('On') : tr('Off');
  const ref = document.getElementById('fb-tram-ref');
  const opts = [tr('(Boundary)')];
  for (const t of (scene.trackList || [])) if (t.type !== 'Path' && t.type !== 'Contour') opts.push(t.name);
  ref.innerHTML = opts.map(o => { const e = document.createElement('option'); e.textContent = o; return e.outerHTML; }).join('');
  ref.value = s.refLabel;
  const wEl = document.getElementById('fb-tram-w'); if (document.activeElement !== wEl) writeUnitInput(wEl, s.width);
  const offEl = document.getElementById('fb-tram-off'); if (document.activeElement !== offEl) writeUnitInput(offEl, s.offset);
  // A boundary system is rings around the boundary: there's no "all", 0 means 1 (#112).
  const pEl = document.getElementById('fb-tram-passes');
  pEl.min = s.isBoundary ? 1 : 0;
  document.getElementById('fb-tram-passes-lbl').textContent = s.isBoundary ? tr('Passes') : tr('Passes (0 = all)');
  if (document.activeElement !== pEl) pEl.value = s.isBoundary ? Math.max(1, s.passCount) : s.passCount;
  for (const b of document.querySelectorAll('#fb-tramedit [data-tmode]')) b.classList.toggle('sel', +b.dataset.tmode === s.mode);
  for (const b of document.querySelectorAll('#fb-tramedit [data-tdir]')) b.classList.toggle('sel', +b.dataset.tdir === s.direction);
  document.getElementById('fb-tram-offrow').hidden = s.isBoundary;   // offset/direction don't apply
  document.getElementById('fb-tram-dirlbl').hidden = s.isBoundary;   // to boundary-referenced systems
  document.getElementById('fb-tram-dir').hidden = s.isBoundary;
}
document.getElementById('fb-tram-en').addEventListener('pointerdown', e => { e.stopPropagation(); const s = curTram(); if (s) tramSet('enabled', s.enabled ? '0' : '1'); });
document.getElementById('fb-tram-ref').addEventListener('change', e => { e.stopPropagation(); tramSet('ref', e.target.value); });
document.getElementById('fb-tram-w').addEventListener('change', e => { e.stopPropagation(); const v = readUnitInput(e.target); if (v > 0) tramSet('width', v); });
document.getElementById('fb-tram-off').addEventListener('change', e => { e.stopPropagation(); const v = readUnitInput(e.target); if (Number.isFinite(v)) tramSet('offset', v); });
document.getElementById('fb-tram-passes').addEventListener('change', e => { e.stopPropagation(); const v = parseInt(e.target.value); const s = curTram(); if (Number.isFinite(v)) tramSet('passes', Math.max(s && s.isBoundary ? 1 : 0, v)); });
for (const b of document.querySelectorAll('#fb-tramedit [data-tmode]')) b.addEventListener('pointerdown', e => { e.stopPropagation(); tramSet('mode', b.dataset.tmode); });
for (const b of document.querySelectorAll('#fb-tramedit [data-tdir]')) b.addEventListener('pointerdown', e => { e.stopPropagation(); tramSet('dir', b.dataset.tdir); });
document.getElementById('bm-delete').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (!boundary || boundary.selectedIndex < 0) return;
  const it = boundary.items.find(i => i.index === boundary.selectedIndex);
  showConfirm(tr('Delete Boundary'), tr('Delete the {type} boundary? This cannot be undone.', { type: it ? it.boundaryType : tr('selected', {}) }),
    () => transport.send('boundary.delete'));
});
document.getElementById('bm-buildtracks').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('boundary.buildFromTracks'); });
document.getElementById('bm-drawmap').addEventListener('pointerdown', e => { e.stopPropagation(); startSatBoundary(); });
// Import-KML boundary picker: lists KML/KMZ from the Import folder (FieldOps frame),
// tapping one imports it as the field boundary (host parses + imports, replacing the outer).
document.getElementById('bm-importkml').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('kmlboundary', 'ln-fieldtools', renderKmlBoundary); });
document.getElementById('kb-back').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('boundarymenu', 'ln-fieldtools', renderBoundaryMenu); });
function renderKmlBoundary() {
  const list = document.getElementById('kb-list'); list.innerHTML = '';
  const files = (fieldOps && fieldOps.kmlFiles) || [];
  if (!files.length) { list.innerHTML = '<div class="trk-empty">No KML/KMZ files in the Import folder.</div>'; return; }
  for (const f of files) {
    const row = document.createElement('div'); row.className = 'fb-trkrow';
    row.innerHTML = '<span class="fb-dot"></span><span class="fb-tname"></span>';
    row.querySelector('.fb-tname').textContent = f;
    row.addEventListener('pointerdown', ev => {
      ev.stopPropagation();
      showConfirm(tr('Import KML Boundary'), tr('Import "{file}" as the field boundary? This replaces the current outer boundary.', { file: f }),
        () => { transport.send('boundary.importKmlFile|' + f); lnCloseAll(); });
    });
    list.appendChild(row);
  }
}
document.getElementById('bm-drivearound').addEventListener('pointerdown', e => {
  e.stopPropagation(); transport.send('boundary.driveAround'); lnOpen('boundaryplayer', 'ln-fieldtools', renderBoundaryPlayer);
});
document.getElementById('bm-driveinner').addEventListener('pointerdown', e => {
  e.stopPropagation(); transport.send('boundary.driveAroundInner'); lnOpen('boundaryplayer', 'ln-fieldtools', renderBoundaryPlayer);
});
document.getElementById('bm-accept').addEventListener('pointerdown', e => { e.stopPropagation(); lnCloseAll(); }); // edits are already saved
// Boundary player.
document.getElementById('bp-back').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('boundary.refresh'); lnOpen('boundarymenu', 'ln-fieldtools', renderBoundaryMenu); });
document.getElementById('bp-offset').addEventListener('change', e => { e.stopPropagation(); const v = readUnitInput(e.target); if (Number.isFinite(v)) transport.send('boundary.setOffset|' + v); });
document.getElementById('bp-clear').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('boundary.clear'); });
document.getElementById('bp-section').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('boundary.toggleSectionControl'); });
document.getElementById('bp-undo').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('boundary.undo'); });
document.getElementById('bp-add').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('boundary.addPoint'); });
document.getElementById('bp-leftright').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('boundary.toggleLeftRight'); });
document.getElementById('bp-antennatool').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('boundary.toggleAntennaTool'); });
document.getElementById('bp-stop').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('boundary.stop'); transport.send('boundary.refresh'); lnOpen('boundarymenu', 'ln-fieldtools', renderBoundaryMenu); });
document.getElementById('bp-record').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('boundary.toggleRecording'); });
// Offset Fix D-pad (argless commands).
for (const b of document.querySelectorAll('#offsetfix .of-btn'))
  b.addEventListener('pointerdown', e => { e.stopPropagation(); transport.send(b.dataset.cmd); });
// Manual Easting/Northing entry → absolute set (offset.set|E,N).
function sendOffsetSet() {
  const ns = readUnitInput(document.getElementById('of-ns-in'));
  const ew = readUnitInput(document.getElementById('of-ew-in'));
  if (Number.isFinite(ns) && Number.isFinite(ew)) transport.send('offset.set|' + ew + ',' + ns);
}
for (const id of ['of-ns-in', 'of-ew-in'])
  document.getElementById(id).addEventListener('change', e => { e.stopPropagation(); sendOffsetSet(); });
for (const b of document.querySelectorAll('.ln-back'))
  b.addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('vehtoolhub', 'ln-vehicle', refreshHub); });
// Standard header close (X) → close the chain to the map. Tagged .ln-closex so the
// NTRIP chain Back/X buttons (which need parent-aware nav) keep their own handlers.
for (const b of document.querySelectorAll('.ln-closex'))
  b.addEventListener('pointerdown', e => { e.stopPropagation(); lnCloseAll(); });
// Units (Screen & Alerts) → config bridge write.
const saPanel = document.getElementById('screenalerts');
// Units + device settings (keyboard/fullscreen/elevation) moved to App Settings (File menu).
// Screen & Alerts toggles → config.set|display.X; action rows (theme/quality) → command.
for (const b of saPanel.querySelectorAll('.sa-tgl'))
  b.addEventListener('pointerdown', e => { e.stopPropagation(); cfgSend(b.dataset.key, b.classList.contains('active') ? '0' : '1'); });
for (const b of saPanel.querySelectorAll('.sa-act'))
  b.addEventListener('pointerdown', e => { e.stopPropagation(); transport.send(b.dataset.cmd); });
// On click, not pointerdown: the panel resizes under the finger once the new size applies.
for (const b of saPanel.querySelectorAll('.sa-scale'))
  b.addEventListener('click', e => { e.stopPropagation(); cfgSend('display.uiScale', b.dataset.scale); });
const saExtra = document.getElementById('sa-extracount');
saExtra.addEventListener('change', () => { const v = parseInt(saExtra.value); if (Number.isFinite(v)) cfgSend('display.extraGuidelinesCount', v); });
function populateScreenAlerts() {
  if (!config || !config.display) return;
  const d = config.display;
  for (const b of saPanel.querySelectorAll('.sa-tgl')) b.classList.toggle('active', !!d[b.dataset.key.split('.')[1]]);
  if (document.activeElement !== saExtra) saExtra.value = d.extraGuidelinesCount;
  document.getElementById('sa-quality').textContent = d.resolutionLabel || '—';
  for (const b of saPanel.querySelectorAll('.sa-scale')) b.classList.toggle('active', +b.dataset.scale === (d.uiScale || 100));
}
// Vehicle config panel — full native VehicleConfigDialog surface (Vehicle/GPS/Roll).
// Generic config controls keyed by data-key="<section>.<field>"; reused by later
// sub-phases. Writes via config.set; Save Profile via profile.save.
const vcPanel = document.getElementById('vehiclecfg'), vcName = document.getElementById('vc-name');
// Hitch-type labels (mirrors ConfigurationViewModel.HitchTypeOptions); value = code =
// index − 1 (code −1 → "Not available").
const HITCH_OPTS = [tr('Not available'), tr('Unknown'), tr('ISO 6489-3 Tractor drawbar'),
  tr('ISO 730 Three-point-hitch semi-mounted'), tr('ISO 730 Three-point-hitch mounted'),
  tr('ISO 6489-1 Hitch-hook'), tr('ISO 6489-2 Clevis coupling 40'), tr('ISO 6489-4 Piton type coupling'),
  tr('ISO 6489-5 CUNA hitch'), tr('ISO 24347 Ball type hitch'), tr('Chassis Mounted - Self-Propelled'),
  tr('ISO 5692-2 Pivot wagon hitch')];
const vcHitchSel = vcPanel.querySelector('.cfg-sel[data-key="vehicle.hitchType"]');
HITCH_OPTS.forEach((label, i) => { const o = document.createElement('option'); o.value = i - 1; o.textContent = label; vcHitchSel.appendChild(o); });
const vcFw = vcPanel.querySelector('.cfg-slider[data-key="gps.headingFusionWeight"]');
function cfgGet(key) {
  if (!config) return undefined;
  // Write-only preset derived from the offset's sign, so its buttons can show which is active (#238).
  if (key === 'vehicle.antennaSide') {
    const off = config.vehicle && config.vehicle.antennaOffset;
    return typeof off !== 'number' ? undefined : off < -0.005 ? 'left' : off > 0.005 ? 'right' : 'center';
  }
  const p = key.split('.'); return config[p[0]] && config[p[0]][p[1]];
}
function cfgSend(key, val) { transport.send('config.set|' + key + ':' + val); }
// Tabs.
for (const t of vcPanel.querySelectorAll('.cfg-tab'))
  t.addEventListener('pointerdown', e => {
    e.stopPropagation();
    for (const b of vcPanel.querySelectorAll('.cfg-tab')) b.classList.toggle('active', b === t);
    for (const body of vcPanel.querySelectorAll('.cfg-body')) body.hidden = (body.id !== t.dataset.tab);
  });
// Generic config controls keyed by data-key="<section>.<field>" — reused by the
// Vehicle and Tool panels. Tab strips, selects, sliders and dynamic lists wire per
// panel. cfg-typebtn active state compares the config value to data-active (falling
// back to data-val) so name-valued buttons (tool type) can match an int field.
// Slider readout formatter (data-fmt): f0/f1/f2 fixed decimals, p0 = value×100 %,
// pct = value %, deg = value °. Used by generic .cfg-slider controls.
function fmtRo(v, fmt) {
  const n = Number(v);
  switch (fmt) {
    case 'f0': return n.toFixed(0);
    case 'f1': return n.toFixed(1);
    case 'f2': return n.toFixed(2);
    case 'p0': return Math.round(n * 100) + '%';
    case 'pct': return Math.round(n) + '%';
    case 'deg': return Math.round(n) + '°';
    default: return String(v);
  }
}
function wireCfgControls(panel) {
  // A data-unit input holds a DISPLAY value; readUnitInput converts it back to the
  // stored metric unit (and rounds whole-unit fields). Without data-unit it is the
  // old raw parseFloat, so untagged controls are unaffected.
  for (const inp of panel.querySelectorAll('.cfg-num'))
    inp.addEventListener('change', () => { const v = readUnitInput(inp); if (Number.isFinite(v)) cfgSend(inp.dataset.key, v); });
  for (const b of panel.querySelectorAll('.cfg-tgl'))
    b.addEventListener('pointerdown', e => { e.stopPropagation(); cfgSend(b.dataset.key, b.classList.contains('active') ? '0' : '1'); });
  for (const b of panel.querySelectorAll('.cfg-typebtn'))
    b.addEventListener('pointerdown', e => { e.stopPropagation(); cfgSend(b.dataset.key, b.dataset.val); });
  // .cfg-act = config.set action buttons; .rn-gated ones carry data-cmd (a gated
  // command, not a config key) and are wired separately, so exclude them here.
  for (const b of panel.querySelectorAll('.cfg-act[data-key]:not(.rn-gated)')) // keyless = wired by hand
    b.addEventListener('pointerdown', e => { e.stopPropagation(); cfgSend(b.dataset.key, b.dataset.val); });
  for (const sel of panel.querySelectorAll('.cfg-isel'))
    sel.addEventListener('change', () => cfgSend(sel.dataset.key, sel.value));
  // Sliders with a data-fmt are generic: drag updates the readout live; the value
  // commits on release ('change') to avoid flooding the bridge. (Sliders without
  // data-fmt — e.g. the Vehicle heading-fusion slider — are wired by hand.)
  for (const s of panel.querySelectorAll('.cfg-slider[data-fmt]')) {
    const ro = panel.querySelector('.cfg-ro[data-for="' + s.dataset.key + '"]');
    s.addEventListener('input', () => { if (ro) ro.textContent = fmtRo(s.value, s.dataset.fmt); });
    s.addEventListener('change', () => cfgSend(s.dataset.key, s.value));
  }
}
function populateCfgControls(panel, force) {
  for (const inp of panel.querySelectorAll('.cfg-num')) {
    if (!force && document.activeElement === inp) continue;
    const val = cfgGet(inp.dataset.key);
    if (typeof val === 'number') writeUnitInput(inp, val);
  }
  for (const b of panel.querySelectorAll('.cfg-tgl')) {
    const on = !!cfgGet(b.dataset.key);
    b.classList.toggle('active', on);
    if (!b.dataset.keepLabel) b.textContent = on ? tr('On') : tr('Off');
  }
  for (const b of panel.querySelectorAll('.cfg-typebtn'))
    b.classList.toggle('active', String(cfgGet(b.dataset.key)) === (b.dataset.active != null ? b.dataset.active : b.dataset.val));
  // Segmented preset buttons (antenna Left / Center / Right) mark the current choice.
  for (const b of panel.querySelectorAll('.ln-seg .cfg-act[data-key][data-val]'))
    b.classList.toggle('active', String(cfgGet(b.dataset.key)) === b.dataset.val);
  for (const s of panel.querySelectorAll('.cfg-slider[data-fmt]')) {
    if (!force && document.activeElement === s) continue;
    const val = cfgGet(s.dataset.key);
    if (typeof val === 'number') {
      s.value = val;
      const ro = panel.querySelector('.cfg-ro[data-for="' + s.dataset.key + '"]');
      if (ro) ro.textContent = fmtRo(val, s.dataset.fmt);
    }
  }
  for (const sel of panel.querySelectorAll('.cfg-isel')) {
    if (document.activeElement === sel) continue;
    const val = cfgGet(sel.dataset.key);
    if (typeof val === 'number') sel.value = String(val);
  }
}
// Tab strip switcher: tabs + bodies share a data-strip id (so nested strips don't
// cross-toggle). Active tab → its data-tab body shown, siblings in the strip hidden.
function wireTabStrip(panel, stripId) {
  for (const t of panel.querySelectorAll('.cfg-tab[data-strip="' + stripId + '"]'))
    t.addEventListener('pointerdown', e => {
      e.stopPropagation();
      for (const b of panel.querySelectorAll('.cfg-tab[data-strip="' + stripId + '"]')) b.classList.toggle('active', b === t);
      for (const body of panel.querySelectorAll('.cfg-body[data-strip="' + stripId + '"]')) body.hidden = (body.id !== t.dataset.tab);
    });
}
wireCfgControls(vcPanel);
vcHitchSel.addEventListener('change', () => cfgSend('vehicle.hitchType', vcHitchSel.value));
// Heading fusion = GPS share (0–1), shown like AgOpenGPS: "GPS 30% · IMU 70%" (#112).
const fusionLabel = w => tr('GPS {gps}% · IMU {imu}%', { gps: Math.round(w * 100), imu: 100 - Math.round(w * 100) });
vcFw.addEventListener('input', () => { document.getElementById('vc-hfw').textContent = fusionLabel(+vcFw.value); cfgSend('gps.headingFusionWeight', vcFw.value); });
document.getElementById('vc-save').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('profile.save'); });
// Zero Now captures the current roll as the offset, like AgOpenGPS Zero Roll and
// Tools › Roll Correction; it used to clear the offset (that's Remove Offset, #111).
document.getElementById('vc-rollzero').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); transport.send('roll.zeroCalibrate'); });
// Populate every control from the config frame. force (on open) fills all; otherwise
// skip the focused number input so we don't clobber what the user is typing.
function populateVehicleCfg(force) {
  if (!config || !config.vehicle) return;
  vcName.textContent = config.vehicle.name || '—';
  populateCfgControls(vcPanel, force);
  // Type-dependent measurement diagrams (mirror VehicleConfig.*ImageSource switches:
  // index by VehicleType 0 Tractor / 1 Harvester / 2 FourWD; '' = no image).
  const ty = Math.max(0, Math.min(2, cfgGet('vehicle.type') | 0));
  const setImg = (id, names) => {
    const el = document.getElementById(id), n = names[ty];
    if (!el) return;
    if (n) { const p = '/icons/' + n + '.png'; if (!el.src.endsWith(p)) el.src = p; el.style.display = ''; }
    else el.style.display = 'none';
  };
  setImg('vc-img-hitch', ['Hitch', '', 'HitchArticulated']);
  setImg('vc-img-wheelbase', ['WheelbaseTractor', 'WheelbaseHarvester', 'WheelbaseArticulated']);
  setImg('vc-img-track', ['TrackWidthTractor', 'TrackWidthHarvester', 'TrackWidthArticulated']);
  setImg('vc-img-antside', ['AntennaTractorTop', 'AntennaHarvesterTop', 'AntennaArticulatedTop']);
  setImg('vc-img-antoffset', ['AntennaTractorOffset', 'AntennaHarvesterOffset', 'AntennaArticulatedOffset']);
  vcHitchSel.value = cfgGet('vehicle.hitchType');
  const w = cfgGet('gps.headingFusionWeight') || 0;
  vcFw.value = w; document.getElementById('vc-hfw').textContent = fusionLabel(w);
  // Dual-only fields are live only in Dual GPS mode; reverse detection only in single
  // (mirrors the native enable/disable gating).
  const dual = !!cfgGet('gps.isDualGps');
  const setEn = (key, en) => { const el = vcPanel.querySelector('[data-key="' + key + '"]'); if (el) { el.disabled = !en; el.style.opacity = en ? '1' : '0.4'; } };
  ['gps.dualHeadingOffset', 'gps.dualReverseDistance', 'gps.autoDualFix', 'gps.dualSwitchSpeed'].forEach(k => setEn(k, dual));
  setEn('gps.reverseDetection', !dual);
}

// ---- Tool config panel (full native ToolConfigDialog) ----
const tcPanel = document.getElementById('toolcfg'), tcName = document.getElementById('tc-name');
const tcHitchSel = tcPanel.querySelector('.cfg-sel[data-key="tool.hitchType"]');
HITCH_OPTS.forEach((label, i) => { const o = document.createElement('option'); o.value = i - 1; o.textContent = label; tcHitchSel.appendChild(o); });
const tcSingleColor = document.getElementById('tc-singlecolor');
wireCfgControls(tcPanel);
wireTabStrip(tcPanel, 'tc-top');
wireTabStrip(tcPanel, 'tc-sub');
wireTabStrip(tcPanel, 'tc-mac');
tcHitchSel.addEventListener('change', () => cfgSend('tool.hitchType', tcHitchSel.value));
tcSingleColor.addEventListener('change', () => cfgSend('tool.singleCoverageColor', tcSingleColor.value.slice(1)));
document.getElementById('tc-resetpins').addEventListener('pointerdown', e => { e.stopPropagation(); cfgSend('machine.resetPins', '1'); });
document.getElementById('tc-save').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('profile.save'); });
// PinFunction enum labels (mirror MachineConfig.PinFunction).
const PIN_FUNCS = ['None', 'Sec1', 'Sec2', 'Sec3', 'Sec4', 'Sec5', 'Sec6', 'Sec7', 'Sec8', 'Sec9', 'Sec10',
  'Sec11', 'Sec12', 'Sec13', 'Sec14', 'Sec15', 'Sec16', 'HydUp', 'HydDown', 'TramLeft', 'TramRight', 'GeoStop'];
const _tcBuilt = { sw: -1, ze: -1, sc: false, pins: false };
function tcDynInput(parent, idx, label, type, onChange, unit, step) {
  const c = document.createElement('div'); c.className = 'tc-cell';
  const sp = document.createElement('span'); sp.textContent = label;
  const inp = document.createElement(type === 'pin' ? 'select' : 'input');
  if (type === 'pin') PIN_FUNCS.forEach((l, fi) => { const o = document.createElement('option'); o.value = fi; o.textContent = l; inp.appendChild(o); });
  else { inp.type = type; if (type === 'number') inp.step = step || '1'; }
  if (unit) inp.dataset.unit = unit;   // stored-unit tag → applyUnits() re-steps it
  inp.dataset.idx = idx;
  inp.addEventListener('change', () => onChange(inp));
  c.appendChild(sp); c.appendChild(inp); parent.appendChild(c);
}
function tcShow(name, on) { for (const el of tcPanel.querySelectorAll('[data-show="' + name + '"]')) el.hidden = !on; }
function hex6(v) { return '#' + ((v >>> 0) & 0xFFFFFF).toString(16).padStart(6, '0'); }
function populateToolCfg(force) {
  // Harvester: front-mounted tool only, like AgOpenGPS ConfigTool (#111).
  const harvester = (cfgGet('vehicle.type') | 0) === 1;
  for (const b of document.querySelectorAll('.cfg-typebtn[data-key="tool.type"]'))
    b.hidden = harvester && b.dataset.val !== 'front';
  if (!config || !config.tool) return;
  const t = config.tool;
  tcName.textContent = tr('Tool: {name}', { name: profiles ? profiles.activeTool : '—' });
  populateCfgControls(tcPanel, force);
  if (document.activeElement !== tcHitchSel) tcHitchSel.value = t.hitchType;
  const hi = document.getElementById('tc-img-hitch');
  const hp = '/icons/' + (['ToolHitchPageFront', 'ToolHitchPageRear', 'ToolHitchPageTBT', 'ToolHitchPageTrailing'][t.type] || 'ToolHitchPageRear') + '.png';
  if (!hi.src.endsWith(hp)) hi.src = hp;
  // Conditional visibility by tool type (0 front, 1 rear, 2 TBT, 3 trailing).
  const trailing = t.type === 3, tbt = t.type === 2, trailtbt = trailing || tbt;
  tcShow('rigid', !trailing); tcShow('trailtbt', trailtbt); tcShow('tbt', tbt); tcShow('notrailtbt', !trailtbt);
  tcShow('individual', t.isSectionsNotZones); tcShow('zones', !t.isSectionsNotZones);
  tcShow('multicolor', t.isMultiColoredSections); tcShow('singlecolor', !t.isMultiColoredSections);
  tcShow('worksw', t.isWorkSwitchEnabled); tcShow('steersw', t.isSteerSwitchEnabled);
  const wsi = document.getElementById('tc-img-worksw');
  wsi.src = '/icons/' + (t.isWorkSwitchActiveLow ? 'SwitchActiveClosed' : 'SwitchActiveOpen') + '.png';
  // Dynamic lists — rebuild on count change, fill values (skip the focused control).
  const nSec = Math.max(1, Math.min(64, t.numSections)); // ToolConfig.MaxSections — backend supports 64
  if (_tcBuilt.sw !== nSec) {
    const g = document.getElementById('tc-sectionwidths'); g.innerHTML = '';
    for (let i = 0; i < nSec; i++) tcDynInput(g, i, 'S' + (i + 1), 'number', inp => { const v = readUnitInput(inp); if (Number.isFinite(v)) cfgSend('tool.sectionWidth', i + ',' + v); }, 'cm', '0.1');  // 0.1 cm: 30" = 76.2 cm (issue #89)
    _tcBuilt.sw = nSec;
    applyUnits();   // freshly built boxes need the active unit's step
  }
  for (const inp of document.querySelectorAll('#tc-sectionwidths input')) if (force || document.activeElement !== inp) writeUnitInput(inp, t.sectionWidths[+inp.dataset.idx]);
  const nZone = Math.max(1, Math.min(8, t.zones));
  if (_tcBuilt.ze !== nZone) {
    const g = document.getElementById('tc-zoneends'); g.innerHTML = '';
    for (let i = 1; i <= nZone; i++) tcDynInput(g, i, tr('Zone {n}', { n: i }), 'number', inp => { const v = parseInt(inp.value); if (Number.isFinite(v)) cfgSend('tool.zoneEnd', i + ',' + v); });
    _tcBuilt.ze = nZone;
  }
  for (const inp of document.querySelectorAll('#tc-zoneends input')) if (force || document.activeElement !== inp) inp.value = t.zoneRanges[+inp.dataset.idx];
  if (_tcBuilt.sc !== nSec) { // rebuild on count change; one swatch per section (was capped at 16)
    const g = document.getElementById('tc-sectioncolors'); g.innerHTML = '';
    for (let i = 0; i < nSec; i++) tcDynInput(g, i, 'S' + (i + 1), 'color', inp => cfgSend('tool.sectionColor', i + ',' + inp.value.slice(1)));
    _tcBuilt.sc = nSec;
  }
  for (const inp of document.querySelectorAll('#tc-sectioncolors input')) if (document.activeElement !== inp) inp.value = hex6(t.sectionColors[+inp.dataset.idx]);
  if (document.activeElement !== tcSingleColor) tcSingleColor.value = hex6(t.singleCoverageColor);
  if (!_tcBuilt.pins) {
    const g = document.getElementById('tc-pins'); g.innerHTML = '';
    for (let i = 0; i < 24; i++) tcDynInput(g, i, tr('Pin {n}', { n: i + 1 }), 'pin', sel => cfgSend('machine.pin', i + ',' + sel.value));
    _tcBuilt.pins = true;
  }
  for (const sel of document.querySelectorAll('#tc-pins select')) if (document.activeElement !== sel) sel.value = config.machine.pinAssignments[+sel.dataset.idx];
  document.getElementById('tc-totalwidth').textContent = tr('Total width: {width}', { width: fmtUnit(t.totalWidth || 0, 'm') });
}

// ---- AutoSteer config panel (Phase 9) — full native 9-tab surface + live Test Mode ----
// Field edits ride the generic config bridge (config.set|autosteer.*). Hardware-push
// actions (Send&Save / Zero-WAS / Reset / free-drive) are gated autosteer.* commands —
// routed through AutoSteerConfigViewModel host-side so PGN/free-drive logic isn't dupd.
const asPanel = document.getElementById('autosteercfg');
const asResetConfirm = document.getElementById('as-resetconfirm');
wireCfgControls(asPanel);
wireTabStrip(asPanel, 'as-left');   // left pane: 4 tabs
wireTabStrip(asPanel, 'as-right');  // right pane: 5 tabs
function hideAsResetConfirm() { asResetConfirm.hidden = true; }
// Generic gated action buttons (Zero-WAS, Send&Save, OK, free-drive) → send only while
// we hold control; the host re-checks (IsRestrictedCommand).
for (const b of asPanel.querySelectorAll('.rn-gated[data-cmd]'))
  b.addEventListener('pointerdown', e => { e.stopPropagation(); rnSend(b.dataset.cmd); });
// OK (green check) = Send&Save then close the panel.
document.getElementById('as-apply').addEventListener('pointerdown', e => { e.stopPropagation(); lnCloseAll(); });
document.getElementById('as-close').addEventListener('pointerdown', e => { e.stopPropagation(); lnCloseAll(); });
// Expand / collapse (native IsFullMode): collapsed = left pane only.
document.getElementById('as-expand').addEventListener('pointerdown', e => {
  e.stopPropagation();
  const exp = asPanel.classList.toggle('expanded');
  e.currentTarget.textContent = exp ? tr('◀ Less') : tr('▶ Full');
});
// Reset → inline confirm bar (mirrors native ResetToDefaults confirmation).
document.getElementById('as-reset').addEventListener('pointerdown', e => { e.stopPropagation(); asResetConfirm.hidden = false; });
document.getElementById('as-reset-no').addEventListener('pointerdown', e => { e.stopPropagation(); hideAsResetConfirm(); });
document.getElementById('as-reset-yes').addEventListener('pointerdown', e => { e.stopPropagation(); hideAsResetConfirm(); rnSend('autosteer.reset'); });
// Algorithm mode switch (Pure Pursuit ↔ Stanley) — native puts this on the Algorithm
// tab as a single tap-to-toggle button.
document.getElementById('as-modeswitch').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (config && config.autosteer) cfgSend('autosteer.isStanleyMode', config.autosteer.isStanleyMode ? '0' : '1');
});
// Satellite-dialog launchers — defined by their own sub-phases (Smart-WAS / Wizard).
document.getElementById('as-smartwas').addEventListener('pointerdown', e => { e.stopPropagation(); if (typeof openSmartWas === 'function') openSmartWas(); });
document.getElementById('as-wizard').addEventListener('pointerdown', e => { e.stopPropagation(); if (typeof openSteerWizard === 'function') openSteerWizard(); });

function asSetText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
// Dim/disable gated controls when this browser doesn't hold control.
function updateAsGated() {
  for (const el of asPanel.querySelectorAll('.rn-gated')) el.classList.toggle('disabled', !iHoldControl);
}
function populateAutoSteer(force) {
  if (!config || !config.autosteer) return;
  const a = config.autosteer;
  populateCfgControls(asPanel, force);
  // Mode title + tab icon track Pure Pursuit / Stanley.
  asSetText('as-modetitle', a.isStanleyMode ? tr('Stanley') : tr('Pure Pursuit'));
  const modeIc = document.getElementById('as-modetab-ic');
  if (modeIc) modeIc.src = a.isStanleyMode ? '/icons/ModeStanley.png' : '/icons/ModePurePursuit.png';
  const msw = document.getElementById('as-modeswitch');
  if (msw) { msw.textContent = a.isStanleyMode ? tr('Stanley') : tr('Pure Pursuit'); msw.classList.toggle('stanley', a.isStanleyMode); }
  asSetText('as-wasoffset', a.wasOffset);
  // Conditional sections (data-show) mirror native enable/visibility gating.
  const show = (name, on) => { for (const el of asPanel.querySelectorAll('[data-show="' + name + '"]')) el.style.display = on ? '' : 'none'; };
  show('purepursuit', !a.isStanleyMode);
  show('stanley', a.isStanleyMode);
  show('turnsensor', a.turnSensorEnabled);
  show('pressuresensor', a.pressureSensorEnabled);
  show('currentsensor', a.currentSensorEnabled);
  updateAsGated();
}
// Live steer telemetry — the status bar (Set/Act/Err) + Test-mode angle + free-drive
// button state. Refreshed every status frame.
function renderAutoSteerLive() {
  if (!statusBar) return;
  const set = statusBar.setSteerAngle || 0, act = statusBar.actualSteerAngle || 0;
  asSetText('as-stat-set', set.toFixed(1) + '°');
  asSetText('as-stat-act', act.toFixed(1) + '°');
  asSetText('as-stat-err', (set - act).toFixed(1) + '°');
  asSetText('as-live-angle', act.toFixed(1) + '°');
  const fdBtn = document.getElementById('as-fd-toggle'), fdIc = document.getElementById('as-fd-ic');
  if (fdBtn) {
    const on = !!statusBar.steerFreeDrive;
    fdBtn.classList.toggle('on', on);
    if (fdIc) fdIc.src = on ? '/icons/SteerDriveOn.png' : '/icons/SteerDriveOff.png';
  }
}

// ---- Smart WAS Calibration — chain sub-panel of AutoSteer (watch-the-tractor; no
// scrim, map stays interactive). Live stats ride the Status frame; Start/Stop/Reset/
// Apply are gated smartwas.* cmds. Opening REPLACES AutoSteer; ← Back reopens it
// (sw-back), ✕ → map (sw-x carries .ln-closex → generic close).
const swPanel = document.getElementById('smartwas');
function openSmartWas() { lnOpen('smartwas', 'ln-autosteer', populateSmartWas); }
document.getElementById('sw-back').addEventListener('pointerdown', e => {
  e.stopPropagation();
  lnOpen('autosteercfg', 'ln-autosteer', () => populateAutoSteer(true));
});
for (const b of swPanel.querySelectorAll('.rn-gated[data-cmd]'))
  b.addEventListener('pointerdown', e => { e.stopPropagation(); rnSend(b.dataset.cmd); });
function populateSmartWas() {
  if (!statusBar) return;
  const collecting = !!statusBar.swCollecting;
  asSetText('sw-status', collecting ? tr('Collecting') : tr('Stopped'));
  asSetText('sw-samples', tr('{n} / 200 min', { n: statusBar.swSamples || 0 }));
  asSetText('sw-mean', (statusBar.swMean || 0).toFixed(2) + '°');
  asSetText('sw-median', (statusBar.swMedian || 0).toFixed(2) + '°');
  asSetText('sw-stddev', (statusBar.swStdDev || 0).toFixed(2) + '°');
  const cpd = (config && config.autosteer && config.autosteer.countsPerDegree) || 0;
  const counts = Math.round((statusBar.swOffsetDeg || 0) * cpd);
  asSetText('sw-offset', tr('{deg}° ({n} counts)', { deg: (statusBar.swOffsetDeg || 0).toFixed(2), n: counts }));
  asSetText('sw-confidence', Math.round(statusBar.swConfidence || 0) + '%');
  // Button enable: gated by control + per-button state (start when stopped, stop when
  // collecting, apply when a valid calibration exists).
  const gate = (id, ok) => { const el = document.getElementById(id); if (el) el.classList.toggle('disabled', !(iHoldControl && ok)); };
  gate('sw-reset', true);
  gate('sw-start', !collecting);
  gate('sw-stop', collecting);
  gate('sw-apply', !!statusBar.swValid);
}

// ---- Network IO (Phase 9) — modules / scan / subnet / host IPs / NTRIP. Reads ride
// the Status frame; writes are config.set (module-present), net.scan, net.subnet and
// ntrip.* profile CRUD, all needing control. The NTRIP editor keeps its
// editing buffer client-side; Save sends every field at once. ----
const nioPanel = document.getElementById('networkio');
nioPanel.addEventListener('pointerdown', e => e.stopPropagation());
for (const cb of nioPanel.querySelectorAll('.nio-chk'))
  cb.addEventListener('change', () => cfgSend(cb.dataset.key, cb.checked ? '1' : '0'));
document.getElementById('nio-scan').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('net.scan'); });
const nioO1 = document.getElementById('nio-o1'), nioO2 = document.getElementById('nio-o2'), nioO3 = document.getElementById('nio-o3');
const nioSubnetBtn = document.getElementById('nio-subnet');
nioSubnetBtn.addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (!iHoldControl) return; // gated; host re-checks
  const o1 = clampOct(nioO1.value), o2 = clampOct(nioO2.value), o3 = clampOct(nioO3.value);
  showConfirm(tr('Change Module Subnet'),
    tr('Set ALL connected modules to subnet {subnet}.x and restart them?', { subnet: o1 + '.' + o2 + '.' + o3 }),
    () => transport.send('net.subnet|' + o1 + '.' + o2 + '.' + o3));
});
document.getElementById('nio-ntprofiles').addEventListener('pointerdown', e => { e.stopPropagation(); openNtripProfiles(); });
function clampOct(v) { let n = parseInt(v); if (!Number.isFinite(n)) n = 0; return Math.max(0, Math.min(255, n)); }
function nioDotColor(configured, ok) { return !configured ? '#6b7280' : (ok ? '#22c55e' : '#ef4444'); }
let _lastModuleSubnet = '';
function renderNetworkIo() {
  const s = statusBar; if (!s) return;
  const setMod = (cfgId, dotId, ipId, configured, ok, ip) => {
    const cb = document.getElementById(cfgId);
    if (document.activeElement !== cb) cb.checked = !!configured;
    document.getElementById(dotId).style.background = nioDotColor(configured, ok);
    document.getElementById(ipId).textContent = ip || '—';
  };
  setMod('nio-gps-cfg', 'nio-gps-dot', 'nio-gps-ip', s.gpsConf, s.gpsOk, s.gpsIp);
  setMod('nio-as-cfg', 'nio-as-dot', 'nio-as-ip', s.autoSteerConf, s.autoSteerOk, s.autoSteerIp);
  setMod('nio-ma-cfg', 'nio-ma-dot', 'nio-ma-ip', s.machineConf, s.machineOk, s.machineIp);
  setMod('nio-imu-cfg', 'nio-imu-dot', 'nio-imu-ip', s.imuConf, s.imuOk, s.imuIp);
  // Seed the subnet octets from the detected /24 when it changes (a PGN 203 reply),
  // unless the operator is editing that box — mirrors the native ModuleSubnet binding.
  // A module on a subnet this device isn't on (a phone hotspot, #334) can answer a scan
  // but its data never arrives. Offer the subnet to move it to, as AgIO's Auto Set does:
  // the scan reply's bytes 9–11, the subnet the scan came from (AgOpenGPS firmware). AiO
  // v26 repeats the module's own subnet there; then, with this device on exactly one
  // network, offer that network's /24.
  const usable = n => /^\d+\.\d+\.\d+$/.test(n || '') && !n.startsWith('127.') && !n.startsWith('169.254.') && !n.startsWith('0.');
  const hostNets = [...new Set((s.hostIps || '').split('\n')
    .filter(ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip))
    .map(ip => ip.split('.').slice(0, 3).join('.')).filter(usable))];
  const fromScan = usable(s.scanReplySubnet) && s.scanReplySubnet !== s.moduleSubnet ? s.scanReplySubnet : '';
  const offer = fromScan || (hostNets.length === 1 && s.moduleSubnet && hostNets[0] !== s.moduleSubnet ? hostNets[0] : '');
  const elsewhere = !!s.moduleSubnet && (!!offer || (hostNets.length > 0 && !hostNets.includes(s.moduleSubnet)));
  const seed = offer || s.moduleSubnet;
  const mismatch = document.getElementById('nio-subnet-mismatch');
  mismatch.hidden = !elsewhere;
  if (elsewhere) mismatch.textContent = offer
    ? tr('The modules are on {m}.x, this device is on {h}.x. Send moves the modules to {h}.x.', { m: s.moduleSubnet, h: offer })
    : tr('The modules are on {m}.x, which isn\'t one of this device\'s networks.', { m: s.moduleSubnet });
  const seedKey = (s.moduleSubnet || '') + '|' + (seed || '');
  if (s.moduleSubnet && seedKey !== _lastModuleSubnet) {
    _lastModuleSubnet = seedKey;
    const p = seed.split('.');
    if (p.length === 3) {
      if (document.activeElement !== nioO1) nioO1.value = p[0];
      if (document.activeElement !== nioO2) nioO2.value = p[1];
      if (document.activeElement !== nioO3) nioO3.value = p[2];
    }
  }
  if (!nioO1.value && document.activeElement !== nioO1) nioO1.value = 192;
  if (!nioO2.value && document.activeElement !== nioO2) nioO2.value = 168;
  if (!nioO3.value && document.activeElement !== nioO3) nioO3.value = 5;
  document.getElementById('nio-hostips').textContent = s.hostIps || '—';
  document.getElementById('nio-ntrip-dot').style.background = s.ntripConnected ? '#22c55e' : '#6b7280';
  document.getElementById('nio-ntrip-status').textContent = !s.ntripEnabled ? tr('Off') : (s.ntripStatus || tr('Not Connected'));
  document.getElementById('nio-ntrip-bytes').textContent = Math.floor((s.ntripBytes || 0) / 1024).toLocaleString() + ' KB';
  // Where the corrections go: the GPS module's own address, or the subnet broadcast.
  document.getElementById('nio-ntrip-dest').textContent = !s.ntripDestination ? ''
    : s.ntripUnicast ? tr('Corrections go to the GPS module at {ip}', { ip: s.ntripDestination })
    : tr('Corrections are broadcast to {ip}', { ip: s.ntripDestination });
  const bc = document.getElementById('nio-rtcm-bc');
  if (document.activeElement !== bc) bc.checked = !!s.rtcmBroadcast;
  const nen = document.getElementById('nio-ntrip-on');
  if (document.activeElement !== nen) nen.checked = !!s.ntripEnabled;
  const p100 = document.getElementById('nio-pgn100');
  if (document.activeElement !== p100) p100.checked = !!s.sendCorrectedPosition;
  renderNtripRtcm(s);
  nioSubnetBtn.classList.toggle('disabled', !iHoldControl);
}

// What the caster is sending (RTCM plan, Phase 5): the receiver's fix and correction age,
// a plain warning when the base position or the observations are missing, and the message
// types with how often each comes. The receiver can keep reporting RTK Fixed for minutes
// with no corrections arriving, so the age and these warnings are what show a problem.
const RTCM_SYSTEMS = ['GPS', 'GLONASS', 'Galileo', 'SBAS', 'QZSS', 'BeiDou', 'NavIC'];
const rtcmIsMsm = t => t >= 1071 && t <= 1137 && t % 10 >= 1 && t % 10 <= 7;
const rtcmIsObs = t => (t >= 1001 && t <= 1004) || (t >= 1009 && t <= 1012) || rtcmIsMsm(t);
function rtcmDescribe(t) {
  if (rtcmIsMsm(t)) return tr('{system} observations (MSM{n})', { system: RTCM_SYSTEMS[Math.floor((t - 1070) / 10)] || '?', n: t % 10 });
  if (t >= 1001 && t <= 1004) return tr('GPS observations (legacy)');
  if (t >= 1009 && t <= 1012) return tr('GLONASS observations (legacy)');
  if (t >= 4001 && t <= 4095) return tr('Proprietary');
  switch (t) {
    case 1005: return tr('Base position');
    case 1006: return tr('Base position and antenna height');
    case 1007: case 1008: return tr('Antenna descriptor');
    case 1013: return tr('System parameters');
    case 1019: return tr('GPS ephemeris');
    case 1020: return tr('GLONASS ephemeris');
    case 1033: return tr('Receiver and antenna descriptor');
    case 1042: return tr('BeiDou ephemeris');
    case 1044: return tr('QZSS ephemeris');
    case 1045: case 1046: return tr('Galileo ephemeris');
    case 1230: return tr('GLONASS code-phase biases');
    default: return '';
  }
}
// The one thing wrong with the stream that the operator should know about, or ''.
function ntripRtcmWarning(r) {
  if (r.unframed) return tr('This mount point does not send RTCM 3. Its data is forwarded as it comes.');
  const newest = pred => r.types.filter(x => pred(x.type)).reduce((m, x) => Math.min(m, x.last), Infinity);
  const base = newest(t => t === 1005 || t === 1006), obs = newest(rtcmIsObs);
  if (obs === Infinity) return r.sessionSeconds > 10 ? tr('No satellite observations from the caster.') : '';
  if (obs > 10) return tr('No satellite observations for {n} s.', { n: Math.round(obs) });
  if (base === Infinity) return r.sessionSeconds > 30 ? tr('No base position from the caster. The receiver cannot get RTK without it.') : '';
  if (base > 60) return tr('No base position received for {n} s.', { n: Math.round(base) });
  return '';
}
function renderNtripRtcm(s) {
  const r = s.ntripConnected ? s.ntripRtcm : null;
  const rx = document.getElementById('nio-ntrip-rx'), warn = document.getElementById('nio-ntrip-warn');
  const box = document.getElementById('nio-rtcm');
  box.hidden = !r;
  rx.textContent = r ? tr('Receiver: {fix}, correction age {age} s', { fix: s.fixText || '—', age: Number.isFinite(s.age) ? s.age.toFixed(0) : '—' }) : '';
  rx.classList.toggle('nio-aged', !!r && s.age > 5);
  const w = r ? ntripRtcmWarning(r) : '';
  warn.hidden = !w;
  warn.textContent = w;
  if (!r) return;
  document.getElementById('nio-rtcm-sum').textContent =
    tr('{n} messages, {bad} bad checksums, {r} replaced by newer', { n: r.messages.toLocaleString(), bad: r.checksumFailures, r: r.notSent });
  if (!box.open) return;   // the rows are only built while the table is showing
  const secs = v => Number.isFinite(v) ? (v < 10 ? v.toFixed(1) : Math.round(v)) + ' s' : '—';
  // Ephemerides come in bursts, so a mean spacing says nothing about them. A row is marked
  // late only where lateness matters: observations and the base position.
  const bursty = t => t === 1019 || t === 1020 || (t >= 1041 && t <= 1046);
  const late = x => rtcmIsObs(x.type) ? x.last > 5 : (x.type === 1005 || x.type === 1006) && x.last > 60;
  document.getElementById('nio-rtcm-rows').innerHTML = r.types.map(x =>
    '<tr' + (late(x) ? ' class="stale"' : '') + '><td class="num" translate="no">' + x.type + '</td><td>' + esc(rtcmDescribe(x.type)) +
    '</td><td class="num" translate="no">' + (bursty(x.type) ? '—' : secs(x.every)) + '</td><td class="num" translate="no">' + secs(x.last) + '</td></tr>').join('');
}
document.getElementById('nio-rtcm').addEventListener('toggle', () => { if (statusBar) renderNtripRtcm(statusBar); });

// System Data — chain sub-panel of Network IO, opened from the GPS line's arrow. The AgIO /
// AgOpenGPS "System Data" forms in one card. Position, fix and speed are the values the
// status bar already has; the rest rides Status as systemData. Refreshed per Status frame
// (~2 Hz) while open.
const sdPanel = document.getElementById('systemdata');
const SD = {};
for (const id of ['lat', 'lon', 'e', 'n', 'alt', 'fix', 'sats', 'hdop', 'age', 'hz', 'missed', 'rej', 'joined', 'dropped', 'src', 'incomplete',
  'speed', 'roll', 'pitch', 'yaw', 'hdual', 'himu', 'hf2f', 'hused', 'sentences'])
  SD[id] = document.getElementById('sd-' + id);
document.getElementById('nio-gps-more').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('systemdata', 'ln-network', renderSystemData); });
document.getElementById('sd-back').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('networkio', 'ln-network', renderNetworkIo); });
document.getElementById('sd-x').addEventListener('pointerdown', e => { e.stopPropagation(); lnCloseAll(); });
function renderSystemData() {
  const s = statusBar; if (!s) return;
  const d = s.systemData, t = lastTick;
  const num = (v, dec, suffix) => Number.isFinite(v) ? v.toFixed(dec) + (suffix || '') : '—';
  const deg = v => Number.isFinite(v) ? (((v % 360) + 360) % 360).toFixed(1) + '°' : '—';
  const set = (el, text) => { if (el.textContent !== text) el.textContent = text; };
  set(SD.lat, num(s.lat, 7)); set(SD.lon, num(s.lon, 7));
  set(SD.e, t ? fmtUnit(t.e, 'm', 2) : '—'); set(SD.n, t ? fmtUnit(t.n, 'm', 2) : '—');
  set(SD.alt, Number.isFinite(s.altitude) ? fmtUnit(s.altitude, 'm', 1) : '—');
  set(SD.fix, s.fixText || '—');
  set(SD.sats, s.sats != null ? String(s.sats) : '—');
  set(SD.hdop, num(s.hdop, 2));
  set(SD.age, num(s.age, 1, ' s'));
  SD.age.classList.toggle('sd-bad', s.age > 5);
  set(SD.speed, t ? toDisplayUnit(t.speed * 3.6, 'kmh').toFixed(1) + ' ' + unitLabel('kmh') : '—');
  set(SD.roll, tick && typeof tick.roll === 'number' ? tick.roll.toFixed(1) + '°' : '—');
  set(SD.hused, t ? deg(t.heading * 180 / Math.PI) : '—');
  // A real module is sending when a sentence came in the last few seconds; otherwise the
  // rate and counters describe an old session and read as "—".
  const live = !!d && d.sentences.some(x => x.type !== 'REJECTED' && x.age < 5);
  set(SD.hz, live ? num(d.rateHz, 1, ' Hz') : '—');
  set(SD.missed, d ? String(d.missed) : '—');
  // Why lines were refused: a bad checksum is a corrupted or mis-split line (look at the
  // bridge); an unknown sentence is one this build does not decode (look at the receiver's
  // output set).
  const rejParts = d && d.rejected ? [d.badChecksum ? tr('{n} checksum', { n: d.badChecksum }) : '',
    d.unknownSentence ? tr('{n} unknown', { n: d.unknownSentence }) : ''].filter(Boolean) : [];
  set(SD.rej, d ? String(d.rejected) + (rejParts.length ? ' (' + rejParts.join(', ') + ')' : '') : '—');
  set(SD.joined, d ? String(d.joinedLines) : '—');
  set(SD.dropped, d ? String(d.droppedBytes) : '—');
  set(SD.incomplete, d ? String(d.incompleteEpochs) : '—');
  set(SD.src, d && d.source ? d.source : '—');
  set(SD.pitch, d ? num(d.pitch, 1, '°') : '—');
  set(SD.yaw, d ? num(d.yawRate, 1, ' °/s') : '—');
  set(SD.hdual, d ? deg(d.dualHeading) : '—');
  set(SD.himu, d ? deg(d.imuHeading) : '—');
  set(SD.hf2f, d ? deg(d.fixToFixHeading) : '—');
  SD.hdual.classList.toggle('sd-bad', !!s.dualHeadingMissing);
  const ago = v => tr('{n} s ago', { n: v < 10 ? v.toFixed(1) : Math.round(v) });
  const rows = (d ? d.sentences : []).map(x =>
    '<div class="sd-sent' + (x.age > 2 ? ' stale' : '') + '"><div class="sd-senthead"><span' + (x.type === 'REJECTED' ? '>' + esc(tr('Not accepted', {})) : ' translate="no">' + (x.type === 'INSPVAX' ? '#' : '$') + esc(x.type)) +
    '</span><span>' + esc(ago(x.age)) + '</span></div><div class="sd-senttext" translate="no">' + esc(x.text) + '</div></div>');
  const html = rows.length ? rows.join('')
    : '<div class="sa-hint">' + esc(s.gpsSentence === 'SIM' ? tr('The simulator is supplying the position; no sentence is being received.', {})
      : tr('No sentence has been received from the GPS module.', {})) + '</div>';
  // Leave the block alone while text in it is selected, so a sentence can be copied.
  const sel = window.getSelection && window.getSelection();
  if (!(sel && !sel.isCollapsed && SD.sentences.contains(sel.anchorNode))) SD.sentences.innerHTML = html;
}

// NTRIP Profiles — chain sub-panel of Network IO (mirrors NtripProfilesDialogPanel).
// Native chain model: opening REPLACES the parent (lnOpen closes everything else);
// Back reopens the parent fly-out (Network IO); Close → map.
let ntSelId = null;
function openNtripProfiles() { lnOpen('ntripprofiles', 'ln-network', renderNtripList); }
document.getElementById('nt-back').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('networkio', 'ln-network', renderNetworkIo); });
document.getElementById('nt-x').addEventListener('pointerdown', e => { e.stopPropagation(); lnCloseAll(); });
document.getElementById('nt-add').addEventListener('pointerdown', e => { e.stopPropagation(); openNtripEditor(null); });
document.getElementById('nt-edit').addEventListener('pointerdown', e => { e.stopPropagation(); const p = selectedNtProfile(); if (p) openNtripEditor(p); });
document.getElementById('nt-del').addEventListener('pointerdown', e => {
  e.stopPropagation(); const p = selectedNtProfile();
  if (p) showConfirm(tr('Delete NTRIP Profile'), tr("Delete NTRIP profile '{name}'?", { name: p.name }),
    () => { transport.send('ntrip.delete|' + p.id); ntSelId = null; });
});
document.getElementById('nt-default').addEventListener('pointerdown', e => {
  e.stopPropagation(); const p = selectedNtProfile(); if (p) transport.send('ntrip.setDefault|' + p.id);
});
function selectedNtProfile() { return (ntripProfiles && ntripProfiles.profiles.find(p => p.id === ntSelId)) || null; }
function renderNtripList() {
  const list = document.getElementById('nt-list');
  list.innerHTML = '';
  const profs = ntripProfiles ? ntripProfiles.profiles : [];
  if (!profs.length) { list.innerHTML = '<div style="padding:18px;color:#8294ab;text-align:center">No profiles</div>'; return; }
  for (const p of profs) {
    const row = document.createElement('div');
    row.className = 'nio-ntrow' + (p.id === ntSelId ? ' sel' : '');
    row.innerHTML = '<div><div class="nt-name"></div><div class="nt-mount"></div></div>'
      + '<div class="nt-caster"></div><div class="nt-def">' + (p.isDefault ? '★' : '') + '</div>';
    row.querySelector('.nt-name').textContent = p.name;
    row.querySelector('.nt-mount').textContent = p.mountPoint;
    row.querySelector('.nt-caster').textContent = p.casterHost;
    row.addEventListener('pointerdown', ev => { ev.stopPropagation(); ntSelId = p.id; renderNtripList(); });
    list.appendChild(row);
  }
}

// Edit NTRIP Profile — chain sub-panel of the profiles list (mirrors
// NtripProfileEditorPanel). Opening REPLACES the list; Back reopens the list; Close →
// map; Save returns to the list (native NavigateBack). Client-side buffer.
let nteBuf = null, _nteTestActive = false;
function openNtripEditor(p) {
  nteBuf = p
    ? { id: p.id, associatedFields: (p.associatedFields || []).slice() }
    : { id: '', associatedFields: [] };
  document.getElementById('nte-title').textContent = p ? tr('Edit NTRIP Profile') : tr('New NTRIP Profile');
  document.getElementById('nte-name').value = p ? p.name : 'New Profile';
  document.getElementById('nte-host').value = p ? p.casterHost : '';
  document.getElementById('nte-port').value = p ? p.casterPort : 2101;
  document.getElementById('nte-mount').value = p ? p.mountPoint : '';
  document.getElementById('nte-user').value = p ? p.username : '';
  document.getElementById('nte-pass').value = p ? p.password : '';
  document.getElementById('nte-ver').value = p && p.ntripVersion === 2 ? '2' : '1';
  document.getElementById('nte-auto').checked = p ? !!p.autoConnect : true;
  document.getElementById('nte-default').checked = p ? !!p.isDefault : false;
  document.getElementById('nte-teststatus').textContent = '';
  _nteTestActive = false;
  lnOpen('ntripeditor', 'ln-network', renderNteFields);
}
document.getElementById('nte-back').addEventListener('pointerdown', e => { e.stopPropagation(); openNtripProfiles(); });
document.getElementById('nte-x').addEventListener('pointerdown', e => { e.stopPropagation(); lnCloseAll(); });
function renderNteFields() {
  const box = document.getElementById('nte-fields');
  box.innerHTML = '';
  const fields = ntripProfiles ? ntripProfiles.availableFields : [];
  if (!fields.length) { box.innerHTML = '<div style="color:#8294ab;padding:4px">No fields</div>'; return; }
  for (const f of fields) {
    const lbl = document.createElement('label');
    const cb = document.createElement('input'); cb.type = 'checkbox';
    cb.checked = nteBuf.associatedFields.includes(f);
    cb.addEventListener('change', () => {
      if (cb.checked) { if (!nteBuf.associatedFields.includes(f)) nteBuf.associatedFields.push(f); }
      else nteBuf.associatedFields = nteBuf.associatedFields.filter(x => x !== f);
    });
    lbl.appendChild(cb); lbl.appendChild(document.createTextNode(f));
    box.appendChild(lbl);
  }
}
document.getElementById('nte-test').addEventListener('pointerdown', e => {
  e.stopPropagation();
  const host = document.getElementById('nte-host').value.trim();
  const port = document.getElementById('nte-port').value || '2101';
  const mount = document.getElementById('nte-mount').value.trim();
  const user = document.getElementById('nte-user').value, pass = document.getElementById('nte-pass').value;
  const st = document.getElementById('nte-teststatus');
  if (!host) { st.textContent = tr('Error: Caster host is required'); return; }
  if (!mount) { st.textContent = tr('Error: Mount point is required'); return; }
  _nteTestActive = true;
  st.textContent = tr('Testing connection...');
  const ver = document.getElementById('nte-ver').value;
  // pass is the host's mask for a stored password; the id lets the host use that one (#397); fork: version last
  transport.send('ntrip.test|' + [host, port, mount, user, pass, (nteBuf && nteBuf.id) || '', ver].join('\t'));
});
document.getElementById('nte-save').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (!nteBuf) return;
  const fields = [
    nteBuf.id || '',
    document.getElementById('nte-name').value.trim(),
    document.getElementById('nte-host').value.trim(),
    document.getElementById('nte-port').value || '2101',
    document.getElementById('nte-mount').value.trim(),
    document.getElementById('nte-user').value,
    document.getElementById('nte-pass').value,
    document.getElementById('nte-auto').checked ? '1' : '0',
    document.getElementById('nte-default').checked ? '1' : '0',
    nteBuf.associatedFields.join(','),
    document.getElementById('nte-ver').value,
  ];
  transport.send('ntrip.save|' + fields.join('\t'));
  openNtripProfiles(); // native SaveNtripProfileCommand ends in NavigateBack → list
});

// ---- Field Operations (Phase 9) — field/job lifecycle. Fly-out launches the
// Fields-and-Jobs chain panel (fields table + jobs + new-job form) and New Field.
// Reads ride the FieldOps frame; writes are field.* commands (host-driven via the real
// StartWorkSessionDialogViewModel); deletes confirm client-side.
const JOB_STATUS = [tr('In progress'), tr('Done'), tr('Abandoned')];
let fjSelField = null, fjSelJob = null;

// Field Operations fly-out: status pill + Close gating from the live scene/status.
function renderFieldOps() {
  const has = !!(scene && scene.hasField);
  const pill = document.getElementById('fo-current');
  if (has) {
    const fld = (scene && scene.fieldName) || '—';
    const job = statusBar && statusBar.jobName;
    pill.textContent = tr('Current: {name}', { name: fld + (job ? ' / ' + job : '') });
    pill.style.display = 'block';
  } else pill.style.display = 'none';
  document.getElementById('fo-close').classList.toggle('disabled', !has);
}
document.getElementById('fo-fields').addEventListener('pointerdown', e => { e.stopPropagation(); openFieldsAndJobs(); });
document.getElementById('fo-resumelast').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('field.resumeLast'); lnCloseAll(); });
document.getElementById('fo-resumejob').addEventListener('pointerdown', e => { e.stopPropagation(); openResumeJob(); });
// Drive In (AgOpenGPS FormJob "In Field"): one field within 0.5 km opens directly;
// 2+ come back as a Drive Pick frame (#109). The host broadcasts it, so only the
// browser that just pressed Drive In shows the list.
let driveInPressedAt = -1e9;
document.getElementById('fo-drivein').addEventListener('pointerdown', e => {
  e.stopPropagation(); driveInPressedAt = performance.now(); transport.send('field.driveIn'); lnCloseAll();
});
function showDrivePick(fields) {
  if (performance.now() - driveInPressedAt > 5000) return; // someone else's Drive In
  driveInPressedAt = -1e9;
  const list = document.getElementById('dp-list'); list.innerHTML = '';
  for (const f of fields) {
    const row = document.createElement('div');
    row.className = 'dp-row';
    row.innerHTML = '<span class="dp-name"></span><span class="dp-num"></span><span class="dp-num"></span>';
    row.querySelector('.dp-name').textContent = f.name;
    const nums = row.querySelectorAll('.dp-num');
    nums[0].textContent = fmtUnit(f.distanceKm * 1000, 'm', 0);
    nums[1].textContent = fmtUnit(f.areaHa, 'ha', 1);
    row.addEventListener('pointerdown', ev => {
      ev.preventDefault(); ev.stopPropagation();
      transport.send('field.driveInOpen|' + f.name); closeDialog();
    });
    list.appendChild(row);
  }
  openDialog('dlg-drivepick');
}
document.getElementById('dp-cancel').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); closeDialog(); });
document.getElementById('fo-close').addEventListener('pointerdown', e => { e.stopPropagation(); if (scene && scene.hasField) { transport.send('field.close'); lnCloseAll(); } });

// Fields-and-Jobs chain panel (mirrors StartWorkSessionDialogPanel).
function openFieldsAndJobs() {
  if (fieldOps && !fjSelField)
    fjSelField = fieldOps.activeField || (fieldOps.fields[0] && fieldOps.fields[0].name) || null;
  lnOpen('fieldsandjobs', 'ln-fieldops', renderFieldsAndJobs);
}
document.getElementById('fj-back').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('fieldops', 'ln-fieldops', renderFieldOps); });
function fjJobsArr() { return fieldOps ? fieldOps.jobs.filter(j => j.fieldName === fjSelField) : []; }
function renderFieldsAndJobs() {
  const fl = document.getElementById('fj-fieldlist'); fl.innerHTML = '';
  for (const f of (fieldOps ? fieldOps.fields : [])) {
    const row = document.createElement('div');
    row.className = 'fj-frow' + (f.name === fjSelField ? ' sel' : '');
    row.innerHTML = '<span class="fj-fname"></span><span class="fj-fnum"></span><span class="fj-fnum"></span>';
    row.querySelector('.fj-fname').textContent = f.name;
    const nums = row.querySelectorAll('.fj-fnum');
    nums[0].textContent = f.hasDistance ? toDisplayUnit(f.distanceKm, 'km').toFixed(1) : '—';
    nums[1].textContent = toDisplayUnit(f.areaHa, 'ha').toFixed(1);
    row.addEventListener('pointerdown', ev => { ev.stopPropagation(); fjSelField = f.name; fjSelJob = null; renderFieldsAndJobs(); });
    fl.appendChild(row);
  }
  const sel = !!fjSelField;
  document.getElementById('fj-jobside').style.display = sel ? 'block' : 'none';
  document.getElementById('fj-empty').style.display = sel ? 'none' : 'block';
  if (sel) {
    const jl = document.getElementById('fj-joblist'); jl.innerHTML = '';
    for (const j of fjJobsArr()) {
      const row = document.createElement('div');
      row.className = 'fj-jrow' + (j.taskName === fjSelJob ? ' sel' : '');
      row.innerHTML = '<div class="fj-jtop"><span class="fj-jname"></span><span class="fj-jwt"></span><span class="fj-jst"></span></div><div class="fj-jsub"></div>';
      row.querySelector('.fj-jname').textContent = j.taskName;
      row.querySelector('.fj-jwt').textContent = j.workType;
      row.querySelector('.fj-jst').textContent = JOB_STATUS[j.status] || '';
      row.querySelector('.fj-jsub').textContent = tr('Last opened: {date}', { date: j.lastOpened });
      row.addEventListener('pointerdown', ev => { ev.stopPropagation(); fjSelJob = j.taskName; renderFieldsAndJobs(); });
      jl.appendChild(row);
    }
    const dl = document.getElementById('fj-wtlist'); dl.innerHTML = '';
    for (const w of (fieldOps ? fieldOps.workTypes : [])) { const o = document.createElement('option'); o.value = w; dl.appendChild(o); }
    const tn = document.getElementById('fj-taskname');
    if (!tn.value && document.activeElement !== tn) tn.value = isoDate();
  }
}
function isoDate() { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
function isoTime() { const d = new Date(), p = n => String(n).padStart(2, '0'); return p(d.getHours()) + '-' + p(d.getMinutes()); }
// New-job form helpers
document.getElementById('fj-uselast').addEventListener('pointerdown', e => { e.stopPropagation(); const j = fjJobsArr()[0]; if (j) document.getElementById('fj-notes').value = j.notes; });
document.getElementById('fj-date').addEventListener('pointerdown', e => { e.stopPropagation(); const tn = document.getElementById('fj-taskname'); tn.value = (tn.value ? tn.value + '_' : '') + isoDate(); });
document.getElementById('fj-time').addEventListener('pointerdown', e => { e.stopPropagation(); const tn = document.getElementById('fj-taskname'); tn.value = (tn.value ? tn.value + '_' : '') + isoTime(); });
// Footer actions
document.getElementById('fj-openonly').addEventListener('pointerdown', e => { e.stopPropagation(); if (fjSelField) { transport.send('field.openOnly|' + fjSelField); lnCloseAll(); } });
document.getElementById('fj-deletefield').addEventListener('pointerdown', e => {
  e.stopPropagation(); if (!fjSelField) return;
  showConfirm(tr('Delete Field'), tr("Delete field '{name}' and all its jobs?", { name: fjSelField }), () => { transport.send('field.deleteField|' + fjSelField); fjSelField = null; fjSelJob = null; });
});
document.getElementById('fj-resumejob').addEventListener('pointerdown', e => { e.stopPropagation(); if (fjSelField && fjSelJob) { transport.send('field.resumeJob|' + fjSelField + '\t' + fjSelJob); lnCloseAll(); } });
document.getElementById('fj-startjob').addEventListener('pointerdown', e => {
  e.stopPropagation(); if (!fjSelField) return;
  const wt = document.getElementById('fj-worktype').value.trim();
  const notes = document.getElementById('fj-notes').value;
  const task = document.getElementById('fj-taskname').value.trim();
  transport.send('field.startJob|' + [fjSelField, wt, notes, task].join('\t'));
  lnCloseAll();
});
document.getElementById('fj-deletejob').addEventListener('pointerdown', e => {
  e.stopPropagation(); if (!fjSelField || !fjSelJob) return;
  const job = fjSelJob;
  showConfirm(tr('Delete Job'), tr("Delete job '{job}' from field '{field}'?", { job, field: fjSelField }), () => { transport.send('field.deleteJob|' + fjSelField + '\t' + job); fjSelJob = null; });
});
// New Field chain panel (Creation column)
document.getElementById('fj-newfield').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('newfield', 'ln-fieldops', () => { document.getElementById('nf-name').value = ''; renderNewField(); }); });
document.getElementById('fj-fromexisting').addEventListener('pointerdown', e => { e.stopPropagation(); openFromExisting(); });
document.getElementById('fj-iso').addEventListener('pointerdown', e => { e.stopPropagation(); openImport('isoimport', 'iso-file', 'isoFiles'); });
document.getElementById('fj-kml').addEventListener('pointerdown', e => { e.stopPropagation(); openImport('kmlimport', 'kml-file', 'kmlFiles'); });
// Show the origin the field will be created at — the live GPS, or the host's
// no-fix fallback (40.7128, -74.0060) so the readout matches what gets written.
function renderNewField() {
  const hasFix = statusBar && (statusBar.lat || statusBar.lon);
  const lat = hasFix ? statusBar.lat : 40.7128, lon = hasFix ? statusBar.lon : -74.0060;
  document.getElementById('nf-pos').textContent = lat.toFixed(8) + ', ' + lon.toFixed(8);
  document.getElementById('nf-poshint').textContent = hasFix
    ? tr('The field is created at this position.')
    : tr('No GPS fix — a default origin will be used.');
}
document.getElementById('nf-back').addEventListener('pointerdown', e => { e.stopPropagation(); openFieldsAndJobs(); });
document.getElementById('nf-create').addEventListener('pointerdown', e => {
  e.stopPropagation();
  const name = document.getElementById('nf-name').value.trim();
  if (!name) return;
  transport.send('field.new|' + name);
  fjSelField = name;
  openFieldsAndJobs(); // back to the list; the new field appears once the frame updates
});

// Helper: fill a <select> with options from a string array (preserving the choice).
function fillSelect(sel, items) {
  const prev = sel.value;
  sel.innerHTML = '';
  for (const it of items) { const o = document.createElement('option'); o.value = it; o.textContent = it; sel.appendChild(o); }
  if (items.includes(prev)) sel.value = prev;
}

// From Existing — clone a field (source + new name + copy toggles).
document.getElementById('fe-back').addEventListener('pointerdown', e => { e.stopPropagation(); openFieldsAndJobs(); });
for (const b of document.querySelectorAll('#fromexisting .cfg-tgl'))
  b.addEventListener('pointerdown', e => { e.stopPropagation(); b.classList.toggle('active'); });
function openFromExisting() {
  lnOpen('fromexisting', 'ln-fieldops', () => {
    fillSelect(document.getElementById('fe-source'), (fieldOps ? fieldOps.fields : []).map(f => f.name));
    document.getElementById('fe-name').value = '';
    for (const b of document.querySelectorAll('#fromexisting .cfg-tgl')) b.classList.add('active'); // all copy on by default
  });
}
document.getElementById('fe-create').addEventListener('pointerdown', e => {
  e.stopPropagation();
  const src = document.getElementById('fe-source').value;
  const name = document.getElementById('fe-name').value.trim();
  if (!src || !name) return;
  const on = id => document.getElementById(id).classList.contains('active') ? '1' : '0';
  transport.send('field.fromExisting|' + [src, name, on('fe-flags'), on('fe-mapping'), on('fe-headland'), on('fe-lines')].join('\t'));
  fjSelField = name; openFieldsAndJobs();
});

// From ISO-XML / From KML — import a field from a file in the Import folder.
function openImport(panelId, selId, fileArr) {
  lnOpen(panelId, 'ln-fieldops', () => {
    fillSelect(document.getElementById(selId), fieldOps ? fieldOps[fileArr] : []);
    document.getElementById(panelId === 'isoimport' ? 'iso-name' : 'kml-name').value = '';
  });
}
document.getElementById('iso-back').addEventListener('pointerdown', e => { e.stopPropagation(); openFieldsAndJobs(); });
document.getElementById('kml-back').addEventListener('pointerdown', e => { e.stopPropagation(); openFieldsAndJobs(); });
document.getElementById('iso-create').addEventListener('pointerdown', e => {
  e.stopPropagation();
  const file = document.getElementById('iso-file').value, name = document.getElementById('iso-name').value.trim();
  if (!file || !name) return;
  transport.send('field.fromIsoXml|' + file + '\t' + name); fjSelField = name; openFieldsAndJobs();
});
document.getElementById('kml-create').addEventListener('pointerdown', e => {
  e.stopPropagation();
  const file = document.getElementById('kml-file').value, name = document.getElementById('kml-name').value.trim();
  if (!file || !name) return;
  transport.send('field.fromKml|' + file + '\t' + name); fjSelField = name; openFieldsAndJobs();
});

// Cross-field Resume Job picker (all jobs, recency order from the host).
function openResumeJob() { lnOpen('resumejob', 'ln-fieldops', renderResumeJob); }
document.getElementById('rj-back').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('fieldops', 'ln-fieldops', renderFieldOps); });
function renderResumeJob() {
  const list = document.getElementById('rj-list'); list.innerHTML = '';
  const jobs = fieldOps ? fieldOps.jobs : [];
  if (!jobs.length) { list.innerHTML = '<div class="fj-empty">No jobs yet.</div>'; return; }
  for (const j of jobs) {
    const row = document.createElement('div');
    row.className = 'fj-jrow';
    row.innerHTML = '<div class="fj-jtop"><span class="fj-jname"></span><span class="fj-jwt"></span><span class="fj-jst"></span></div><div class="fj-jsub"></div>';
    row.querySelector('.fj-jname').textContent = j.taskName;
    row.querySelector('.fj-jwt').textContent = j.fieldName;
    row.querySelector('.fj-jst').textContent = JOB_STATUS[j.status] || '';
    row.querySelector('.fj-jsub').textContent = tr('Last opened: {date}', { date: j.lastOpened });
    row.addEventListener('pointerdown', ev => { ev.stopPropagation(); transport.send('field.resumeJob|' + j.fieldName + '\t' + j.taskName); lnCloseAll(); });
    list.appendChild(row);
  }
}

// ---- AgShare cloud sync (Settings / Upload / Download) — chain sub-panels of Field
// Operations. Settings via config.set conn.agShare*; actions via agshare.* with results
// (status / cloud list) riding the AgShare frame. Launched from the fly-out's AgShare row.
document.getElementById('fo-agupload').addEventListener('pointerdown', e => { e.stopPropagation(); openAgUpload(); });
document.getElementById('fo-agdownload').addEventListener('pointerdown', e => { e.stopPropagation(); openAgDownload(); });
document.getElementById('fo-agapi').addEventListener('pointerdown', e => { e.stopPropagation(); openAgSettings(); });

// Settings
function openAgSettings() { lnOpen('agsettings', 'ln-fieldops', renderAgSettings); }
document.getElementById('ag-back').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('fieldops', 'ln-fieldops', renderFieldOps); });
function renderAgSettings() {
  if (!agShare) return;
  const sv = document.getElementById('ag-server'), kv = document.getElementById('ag-key');
  if (document.activeElement !== sv) sv.value = agShare.serverUrl || '';
  if (document.activeElement !== kv) kv.value = agShare.apiKey || '';
  document.getElementById('ag-enabled').classList.toggle('active', !!agShare.enabled);
  document.getElementById('ag-teststatus').textContent = agShare.status || '';
}
document.getElementById('ag-server').addEventListener('change', () => cfgSend('conn.agShareServer', document.getElementById('ag-server').value.trim()));
// The field holds the host's mask while a key is stored; sending the mask back keeps it (#397).
document.getElementById('ag-key').addEventListener('change', () => cfgSend('conn.agShareApiKey', document.getElementById('ag-key').value.trim()));
document.getElementById('ag-enabled').addEventListener('pointerdown', e => { e.stopPropagation(); cfgSend('conn.agShareEnabled', e.currentTarget.classList.contains('active') ? '0' : '1'); });
document.getElementById('ag-test').addEventListener('pointerdown', e => {
  e.stopPropagation();
  cfgSend('conn.agShareServer', document.getElementById('ag-server').value.trim());
  cfgSend('conn.agShareApiKey', document.getElementById('ag-key').value.trim());
  transport.send('agshare.test');
});

// Upload
let aguSel = new Set();
function openAgUpload() { aguSel = new Set(); lnOpen('agupload', 'ln-fieldops', renderAgUpload); }
document.getElementById('agu-back').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('fieldops', 'ln-fieldops', renderFieldOps); });
function renderAgUpload() {
  const list = document.getElementById('agu-list'); list.innerHTML = '';
  for (const f of (agShare ? agShare.localFields : [])) {
    const row = document.createElement('label'); row.className = 'agu-row';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = aguSel.has(f.name);
    cb.addEventListener('change', () => { if (cb.checked) aguSel.add(f.name); else aguSel.delete(f.name); });
    const nm = document.createElement('span'); nm.className = 'agu-name'; nm.textContent = f.name;
    const bd = document.createElement('span'); bd.className = 'agu-bd ' + (f.hasBoundary ? 'ok' : 'no'); bd.textContent = f.hasBoundary ? tr('Has boundary') : tr('No boundary');
    row.appendChild(cb); row.appendChild(nm); row.appendChild(bd); list.appendChild(row);
  }
  document.getElementById('agu-status').textContent = agShare ? (agShare.status || '') : '';
}
document.getElementById('agu-selall').addEventListener('pointerdown', e => { e.stopPropagation(); for (const f of (agShare ? agShare.localFields : [])) aguSel.add(f.name); renderAgUpload(); });
document.getElementById('agu-selnone').addEventListener('pointerdown', e => { e.stopPropagation(); aguSel.clear(); renderAgUpload(); });
document.getElementById('agu-public').addEventListener('pointerdown', e => { e.stopPropagation(); e.currentTarget.classList.toggle('active'); });
document.getElementById('agu-upload').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (!aguSel.size) return;
  const pub = document.getElementById('agu-public').classList.contains('active') ? '1' : '0';
  transport.send('agshare.upload|' + [pub, ...aguSel].join('\t'));
});

// Download
let agdSel = null;
function openAgDownload() { agdSel = null; lnOpen('agdownload', 'ln-fieldops', () => { transport.send('agshare.fetch'); renderAgDownload(); }); }
document.getElementById('agd-back').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('fieldops', 'ln-fieldops', renderFieldOps); });
function renderAgDownload() {
  const list = document.getElementById('agd-list'); list.innerHTML = '';
  const cf = agShare ? agShare.cloudFields : [];
  if (!cf.length) list.innerHTML = '<div class="fj-empty">No cloud fields (Refresh to load).</div>';
  for (const f of cf) {
    const row = document.createElement('div'); row.className = 'fj-jrow' + (f.id === agdSel ? ' sel' : '');
    row.innerHTML = '<div class="fj-jtop"><span class="fj-jname"></span><span class="fj-jwt"></span></div>';
    row.querySelector('.fj-jname').textContent = f.name;
    row.querySelector('.fj-jwt').textContent = fmtUnit(f.areaHa, 'ha');
    row.addEventListener('pointerdown', ev => { ev.stopPropagation(); agdSel = f.id; renderAgDownload(); });
    list.appendChild(row);
  }
  document.getElementById('agd-status').textContent = agShare ? (agShare.status || '') : '';
}
document.getElementById('agd-refresh').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('agshare.fetch'); });
document.getElementById('agd-download').addEventListener('pointerdown', e => { e.stopPropagation(); if (agdSel) transport.send('agshare.download|' + agdSel); });
document.getElementById('agd-force').addEventListener('pointerdown', e => { e.stopPropagation(); e.currentTarget.classList.toggle('active'); });
document.getElementById('agd-downloadall').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('agshare.downloadAll|' + (document.getElementById('agd-force').classList.contains('active') ? '1' : '0')); });

// ---- File / Application Menu (Phase 9) — settings/tools launcher. Reads ride the AppInfo
// frame + config/status; writes are config.set (App Settings) + app.* (language/reset/
// hotkeys/bug-report). Sub-panels are chain panels (replace the menu; Back reopens it).
document.getElementById('ln-filemenu').addEventListener('pointerdown', e => {
  e.stopPropagation();
  const anyOpen = ['filemenu', 'appsettings', 'language', 'viewsettings', 'logviewer', 'hotkeys', 'help', 'about', 'bugreport'].some(id => document.getElementById(id).classList.contains('open'));
  if (anyOpen) lnCloseAll(); else lnOpen('filemenu', 'ln-filemenu');
});
for (const b of document.querySelectorAll('.fm-back'))
  b.addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('filemenu', 'ln-filemenu'); });
document.getElementById('fm-language').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('language', 'ln-filemenu', renderLanguage); });
document.getElementById('fm-reset').addEventListener('pointerdown', e => { e.stopPropagation(); showConfirm(tr('Reset All Settings'), tr('Reset all settings to their defaults? This cannot be undone.'), () => transport.send('app.resetSettings')); });
document.getElementById('fm-appsettings').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('appsettings', 'ln-filemenu', renderAppSettings); });
document.getElementById('fm-viewsettings').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('viewsettings', 'ln-filemenu', renderViewSettings); });
document.getElementById('fm-logviewer').addEventListener('pointerdown', e => { e.stopPropagation(); logViewerParent = 'filemenu'; lnOpen('logviewer', 'ln-filemenu', renderLogViewer); });
document.getElementById('fm-hotkeys').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('hotkeys', 'ln-filemenu', renderHotkeys); });
document.getElementById('fm-simulator').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('sim.togglePanel'); lnCloseAll(); });
document.getElementById('fm-help').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('help', 'ln-filemenu'); });
document.getElementById('fm-about').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('about', 'ln-filemenu', renderAbout); });
document.getElementById('fm-bugreport').addEventListener('pointerdown', e => { e.stopPropagation(); lnOpen('bugreport', 'ln-filemenu', renderBugReport); });

// App Settings: units (status) + device toggles (config.display) + app directories (appInfo).
function renderAppSettings() {
  const metric = isMetric();
  document.getElementById('as-metric').classList.toggle('active', metric);
  document.getElementById('as-imperial').classList.toggle('active', !metric);
  const d = config && config.display;
  if (d) for (const b of document.querySelectorAll('#appsettings .as-tgl')) b.classList.toggle('active', !!d[b.dataset.key.split('.')[1]]);
  const dl = document.getElementById('as-dirs'); dl.innerHTML = '';
  for (const dir of (appInfo ? appInfo.directories : [])) {
    const row = document.createElement('div'); row.className = 'as-dir';
    row.innerHTML = '<div class="as-dirname"></div><div class="as-dirpath"></div>';
    row.querySelector('.as-dirname').textContent = dir.exists ? dir.name : tr('{name} (missing)', { name: dir.name });
    row.querySelector('.as-dirpath').textContent = dir.path;
    dl.appendChild(row);
  }
}
for (const b of document.querySelectorAll('#appsettings .ln-segbtn[data-units]'))
  b.addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('config.set|units:' + b.dataset.units); });
for (const b of document.querySelectorAll('#appsettings .as-tgl'))
  b.addEventListener('pointerdown', e => { e.stopPropagation(); cfgSend(b.dataset.key, b.classList.contains('active') ? '0' : '1'); });

// Language picker
function renderLanguage() {
  const list = document.getElementById('lang-list'); list.innerHTML = '';
  const cur = appInfo ? appInfo.currentLanguage : 'en';
  for (const l of (appInfo ? appInfo.languages : [])) {
    const b = document.createElement('button'); b.className = 'lang-btn' + (l.code === cur ? ' active' : ''); b.textContent = l.name;
    b.addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('app.setLanguage|' + l.code); });
    list.appendChild(b);
  }
}

// View All Settings — read-only tree rendered from the config frame the client already has.
function renderViewSettings() {
  const box = document.getElementById('vs-tree'); box.innerHTML = '';
  if (!config) { box.textContent = tr('Loading…'); return; }
  const groups = { Vehicle: config.vehicle, GPS: config.gps, Roll: config.roll, Tool: config.tool, 'U-Turn': config.uturn, Tram: config.tram, Machine: config.machine, Display: config.display, AutoSteer: config.autosteer };
  for (const name in groups) {
    const obj = groups[name]; if (!obj) continue;
    const sec = document.createElement('div'); sec.className = 'vs-section';
    const h = document.createElement('div'); h.className = 'vs-group'; h.textContent = name; sec.appendChild(h);
    // Nested objects and arrays (sections, pins, …) are flattened into path keys
    // ("sections[0].width"); a list of plain values stays on one row (#112).
    const addRow = (k, v) => {
      const r = document.createElement('div'); r.className = 'vs-row';
      r.innerHTML = '<span class="vs-k"></span><span class="vs-v"></span>';
      r.querySelector('.vs-k').textContent = k; r.querySelector('.vs-v').textContent = String(v);
      sec.appendChild(r);
    };
    const walk = (prefix, v) => {
      if (v === null || typeof v !== 'object') { addRow(prefix, v); return; }
      if (Array.isArray(v)) {
        if (v.every(x => x === null || typeof x !== 'object')) { addRow(prefix, v.join(', ')); return; }
        v.forEach((x, i) => walk(prefix + '[' + i + ']', x));
        return;
      }
      for (const k in v) walk(prefix ? prefix + '.' + k : k, v[k]);
    };
    walk('', obj);
    box.appendChild(sec);
  }
}

// Log Viewer — filter + list (from AppInfo).
let logFilter = 0;
const LOG_LVL = ['Trace', 'Debug', 'Info', 'Warn', 'Error', 'Crit'];
function renderLogViewer() {
  const list = document.getElementById('log-list'); list.innerHTML = '';
  for (const e of (appInfo ? appInfo.logs : [])) {
    if (e.level < logFilter) continue;
    const r = document.createElement('div'); r.className = 'log-row lvl' + e.level;
    r.innerHTML = '<span class="log-t"></span><span class="log-l"></span><span class="log-m"></span>';
    r.querySelector('.log-t').textContent = e.time;
    r.querySelector('.log-l').textContent = LOG_LVL[e.level] || '';
    r.querySelector('.log-m').textContent = e.message;
    list.appendChild(r);
  }
  list.scrollTop = list.scrollHeight;
}
for (const b of document.querySelectorAll('#logviewer .log-filt'))
  b.addEventListener('pointerdown', e => { e.stopPropagation(); logFilter = parseInt(b.dataset.lvl); for (const x of document.querySelectorAll('#logviewer .log-filt')) x.classList.toggle('active', x === b); renderLogViewer(); });

// Hotkeys — list + click-to-capture.
let hkCapture = null;
function renderHotkeys() {
  const list = document.getElementById('hk-list'); list.innerHTML = '';
  for (const hk of (appInfo ? appInfo.hotkeys : [])) {
    const r = document.createElement('div'); r.className = 'hk-row';
    r.innerHTML = '<span class="hk-label"></span><button class="hk-key"></button>';
    r.querySelector('.hk-label').textContent = hk.label;
    const kb = r.querySelector('.hk-key');
    kb.textContent = hkCapture === hk.action ? tr('Press a key…') : (hk.key || '—');
    if (hkCapture === hk.action) kb.classList.add('capturing');
    kb.addEventListener('pointerdown', ev => { ev.stopPropagation(); hkCapture = hk.action; renderHotkeys(); });
    list.appendChild(r);
  }
}
window.addEventListener('keydown', e => {
  if (!hkCapture || !document.getElementById('hotkeys').classList.contains('open')) return;
  e.preventDefault();
  if (e.key === 'Escape') { hkCapture = null; renderHotkeys(); return; } // cancel, don't bind Escape (#111)
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  transport.send('app.setHotkey|' + hkCapture + ':' + key);
  hkCapture = null;
});
document.getElementById('hk-reset').addEventListener('pointerdown', e => { e.stopPropagation(); showConfirm(tr('Reset Hotkeys'), tr('Reset all hotkeys to their defaults?'), () => transport.send('app.resetHotkeys')); });

// Help — external links open in a new tab.
// External links. Inside the desktop launcher (Photino) window.open can't leave the web view,
// so the page asks its host to open the system browser over Photino's message channel.
function openExternal(url) {
  if (window.external && typeof window.external.sendMessage === 'function') window.external.sendMessage('open|' + url);
  else window.open(url, '_blank');
}
for (const b of document.querySelectorAll('#help .help-link'))
  b.addEventListener('pointerdown', e => { e.stopPropagation(); openExternal(b.dataset.url); });

// About
function renderAbout() {
  document.getElementById('ab-version').textContent = appInfo ? tr('Version {version}', { version: appInfo.version }) : '';
  document.getElementById('ab-git').textContent = appInfo ? appInfo.gitHash : '';
}

// Bug Report
// The report is a zip on the host. Download fetches it through the system browser, which saves
// it to this device's Downloads: inside an app shell the web view itself can't save a file.
let brFile = null;
function renderBugReport() {
  const s = appInfo ? (appInfo.bugReportStatus || '') : '';
  document.getElementById('br-status').textContent = s;
  const m = /(bugreport_[^\/\\]+\.zip)$/.exec(s);
  brFile = m ? m[1] : null;
  for (const id of ['br-sendbox', 'br-download'])
    document.getElementById(id).style.display = brFile ? '' : 'none';
  // Send Report state, as BugReportRemote codes it: sending, queued, sent|n|url, accepted, rejected|msg.
  const ss = appInfo ? (appInfo.bugReportSendStatus || '') : '';
  const bar = ss.indexOf('|'), kind = bar < 0 ? ss : ss.slice(0, bar), rest = bar < 0 ? '' : ss.slice(bar + 1);
  const issueUrl = kind === 'sent' ? rest.slice(rest.indexOf('|') + 1) : '';
  document.getElementById('br-sendstatus').textContent =
    kind === 'sending' ? tr('Sending…')
    : kind === 'queued' ? tr('No connection: the report sends by itself when the device is back online.')
    : kind === 'sent' ? tr('Sent as issue #{n}. Thank you!', { n: rest.split('|')[0] })
    : kind === 'accepted' ? tr('Sent. Thank you! The GitHub issue opens shortly.')
    : kind === 'rejected' ? tr('Not sent: {reason}', { reason: rest })
    : '';
  brIssueUrl = issueUrl || null;
  document.getElementById('br-openissue').style.display = brIssueUrl ? '' : 'none';
  brSendBusy = ['sending', 'queued', 'sent', 'accepted'].includes(kind);
  if (brFile !== brFilesFor) { brFiles = []; brFilesFor = brFile; renderBrFiles(); }
  document.getElementById('br-attach').disabled = brSendBusy || brAttaching;
  brUpdateSend();
}
// Screenshots and files: each one is posted to the host as it is picked and goes into the
// dump under attachments/ (BugReportAttachments). Only the screen holding control may add.
let brFiles = [], brFilesFor = null, brAttaching = false;
const brSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
function renderBrFiles() {
  const box = document.getElementById('br-files'); box.innerHTML = '';
  for (const f of brFiles) {
    const row = document.createElement('div'); row.className = 'br-filerow';
    const nm = document.createElement('span'); nm.className = 'br-fname'; nm.textContent = f.name; nm.translate = false;
    const sz = document.createElement('span'); sz.className = 'br-fsize'; sz.textContent = brSize(f.size);
    const x = document.createElement('button'); x.className = 'ln-x'; x.textContent = '✕'; x.title = tr('Remove');
    x.disabled = brSendBusy;
    x.addEventListener('pointerdown', e => { e.stopPropagation(); brChangeFiles('detach', f.name, new Uint8Array(0)); });
    row.append(nm, sz, x); box.appendChild(row);
  }
}
async function brChangeFiles(op, name, body) {
  const st = document.getElementById('br-attachstatus');
  const q = new URLSearchParams({ zip: brFile, name, client: myClientId || '' });
  let res, reply = null;
  try {
    res = await fetch('/bugreports/' + op + '?' + q, { method: 'POST', body });
    if (res.ok) reply = await res.json();
  } catch (_) { st.textContent = tr('Could not add {name}', { name }); return false; }
  if (res.status === 403) { st.textContent = tr('View only: another screen has control'); return false; }
  if (res.status === 413) { st.textContent = tr('{name} is too large (20 MB at most)', { name }); return false; }
  if (!reply) { st.textContent = tr('Could not add {name}', { name }); return false; }
  const why = {
    TooLarge: tr('{name} is too large (20 MB at most)', { name }),
    TotalTooLarge: tr('Attachments are limited to 25 MB in all'),
    TooMany: tr('At most 10 attachments'),
    Empty: tr('{name} is empty', { name }),
    Busy: tr('The report is being sent; try again in a moment'),
  }[reply.refusal];
  if (reply.refusal !== 'Busy') { brFiles = reply.files; renderBrFiles(); }
  st.textContent = why || tr('Like the rest of the report, attachments go only to the maintainers.');
  return !why;
}
document.getElementById('br-attach').addEventListener('click', e => {
  e.stopPropagation();
  if (brFile && !brSendBusy && !brAttaching) document.getElementById('br-file').click();
});
document.getElementById('br-file').addEventListener('change', async e => {
  const picked = [...e.target.files]; e.target.value = '';
  if (!picked.length || !brFile) return;
  brAttaching = true; document.getElementById('br-attach').disabled = true;
  for (const f of picked) {
    document.getElementById('br-attachstatus').textContent = tr('Adding {name}…', { name: f.name });
    if (f.size > 20 * 1048576) { document.getElementById('br-attachstatus').textContent = tr('{name} is too large (20 MB at most)', { name: f.name }); break; }
    if (!await brChangeFiles('attach', f.name, f)) break;
  }
  brAttaching = false; document.getElementById('br-attach').disabled = brSendBusy;
});
let brIssueUrl = null, brSendBusy = false;
// Send needs what the bug report service checks too (Tools/bugreport-worker reports.js):
// a title and description long enough to act on, and a GitHub username or an email to reply
// to. Create needs nothing: it captures the moment.
const BR_MIN_TITLE = 15, BR_MIN_DESC = 40;
const brOne = id => document.getElementById(id).value.replace(/\t/g, ' ').trim();
const brChars = s => [...s].length;
function brMissing() {
  const t = BR_MIN_TITLE - brChars(brOne('br-title'));
  if (t > 0) return tr('Title: {n} more characters', { n: t });
  const d = BR_MIN_DESC - brChars(document.getElementById('br-desc').value.trim());
  if (d > 0) return tr('Description: {n} more characters', { n: d });
  const gh = brOne('br-ghuser').replace(/^@/, ''), em = brOne('br-email');
  if (gh && !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(gh)) return tr('Not a GitHub username');
  if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return tr('Not an email address');
  if (!gh && !em) return tr('Add your GitHub username or email so we can reply');
  return '';
}
function brUpdateSend() {
  const need = brMissing();
  document.getElementById('br-need').textContent = brSendBusy ? '' : need;
  document.getElementById('br-send').disabled = brSendBusy || !!need;
}
for (const id of ['br-title', 'br-desc', 'br-ghuser', 'br-email'])
  document.getElementById(id).addEventListener('input', brUpdateSend);
try {
  document.getElementById('br-ghuser').value = localStorage.getItem('agopenweb.bugReportGitHub') || '';
  document.getElementById('br-email').value = localStorage.getItem('agopenweb.bugReportEmail') || '';
} catch (_) { }
document.getElementById('br-send').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (!brFile || brMissing()) return;
  const gh = brOne('br-ghuser').replace(/^@/, ''), em = brOne('br-email');
  try { localStorage.setItem('agopenweb.bugReportGitHub', gh); localStorage.setItem('agopenweb.bugReportEmail', em); } catch (_) { }
  document.getElementById('br-sendstatus').textContent = tr('Sending…');
  document.getElementById('br-send').disabled = true;
  transport.send('app.bugReport.send|' + [brFile, gh, em, brOne('br-title'), document.getElementById('br-desc').value].join('\t'));
});
document.getElementById('br-docs').addEventListener('pointerdown', e => {
  e.stopPropagation();
  openExternal('https://docs.agopengps.com/');
});
document.getElementById('br-openissue').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (brIssueUrl) openExternal(brIssueUrl);
});
document.getElementById('br-download').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (brFile) openExternal(location.origin + '/bugreports/' + encodeURIComponent(brFile));
});
document.getElementById('br-submit').addEventListener('pointerdown', e => {
  e.stopPropagation();
  // No title needed: the point is to capture the moment. The host names it "untitled".
  const t = document.getElementById('br-title').value.trim();
  document.getElementById('br-status').textContent = tr('Creating bug report…');
  transport.send('app.bugReport|' + t + '\t' + document.getElementById('br-desc').value);
});

// ---- Steer Wizard (Phase 9) — full-screen, host-driven. The host runs the real
// SteerWizardViewModel; we rebuild #wz-content per step from the Wizard frame, edit via
// the existing config.set bridge, and forward nav (wizard.*) + gated calibration
// (wizard.action). Editable values display from the Config frame. ----
const wzOverlay = document.getElementById('wizard-overlay');
const wzContent = document.getElementById('wz-content');
// stepKind|index of the currently-built content (rebuild on change — and on a unit
// flip, which onUnitsChanged forces by clearing this).
let _wzKey = '';
function openSteerWizard() { _wzKey = ''; wizard = null; transport.send('wizard.open'); wzOverlay.classList.add('open'); }
function wzClose(send) { if (send) transport.send('wizard.cancel'); wzOverlay.classList.remove('open'); wizard = null; _wzKey = ''; }
document.getElementById('wz-cancel').addEventListener('pointerdown', e => { e.stopPropagation(); wzClose(true); });
document.getElementById('wz-skip').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('wizard.skip'); });
document.getElementById('wz-back').addEventListener('pointerdown', e => { e.stopPropagation(); transport.send('wizard.back'); });
document.getElementById('wz-next').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (wizard && wizard.isLast) { transport.send('wizard.finish'); wzClose(false); }
  else transport.send('wizard.next');
});
// Delegated content events: data-cfg="key:val" (config.set), data-hw="n" (hardware
// level), data-act="Cmd" (gated wizard.action), data-tgl="key" (toggle), data-cfgnum
// (number input) on change.
wzContent.addEventListener('pointerdown', e => {
  const el = e.target.closest('[data-cfg],[data-hw],[data-act],[data-tgl]'); if (!el) return;
  e.stopPropagation();
  if (el.dataset.cfg) { const i = el.dataset.cfg.indexOf(':'); cfgSend(el.dataset.cfg.slice(0, i), el.dataset.cfg.slice(i + 1)); }
  else if (el.dataset.hw != null) transport.send('wizard.hw|' + el.dataset.hw);
  else if (el.dataset.act) rnSend('wizard.action|' + el.dataset.act);
  else if (el.dataset.tgl) cfgSend(el.dataset.tgl, cfgGet(el.dataset.tgl) ? '0' : '1');
});
wzContent.addEventListener('change', e => {
  const inp = e.target.closest('[data-cfgnum]'); if (!inp) return;
  const v = readUnitInput(inp); if (Number.isFinite(v)) cfgSend(inp.dataset.cfgnum, v);
});
// Per-step content. Editable values read from the Config frame; live values get ids
// (data-live) refreshed each frame. esc() guards interpolated strings.
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function wzVal(key, dflt) { const v = cfgGet(key); return typeof v === 'number' ? v : (dflt || 0); }
// `unit` is the STORED unit key ('m', 'kmh', …) or a plain suffix ('deg', '') that
// carries no conversion. Unit-keyed fields render the display value and tag the input
// so the change handler converts back; applyUnits() re-steps them on a unit flip.
function wzNum(label, sub, key, step, unit) {
  const known = UNIT_DEFS[unit];
  const val = known ? roundDisplay(toDisplayUnit(wzVal(key), unit), unit) : wzVal(key);
  const istep = known && !isMetric() ? known.impStep : (step || '0.01');
  return '<div class="wz-fld"><label>' + esc(label) + '</label><div class="sub">' + esc(sub || '') + '</div>' +
    '<input class="wz-num" data-cfgnum="' + key + '"' + (known ? ' data-unit="' + unit + '" data-mstep="' + (step || '0.01') + '"' : '') +
    ' type="number" step="' + istep + '" value="' + val + '"><span class="wz-unit">' + esc(known ? unitLabel(unit) : (unit || '')) + '</span></div>';
}
function wzSeg(label, sub, key, opts) { // opts: [[text,val],...]
  return '<div class="wz-row"><div class="lbl">' + esc(label) + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div><div class="wz-seg">' +
    opts.map(o => '<button data-cfg="' + key + ':' + o[1] + '" data-activekey="' + key + '" data-activeval="' + o[1] + '">' + esc(o[0]) + '</button>').join('') + '</div></div>';
}
function wzTgl(label, sub, key) {
  return '<div class="wz-row"><div class="lbl">' + esc(label) + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div><button class="wz-tgl" data-tgl="' + key + '" data-tglkey="' + key + '">Off</button></div>';
}
// CPD / Ackermann circle test (#154): Record plus the feedback a wizard owes the operator —
// why Record can't start (or a low-fix warning), live progress, and the outcome.
function wzCircleTest() {
  return '<div class="wz-center wz-circle"><div class="wz-btnrow"><button class="wz-testbtn" data-act="StartRecording" id="wz-recbtn">Record</button></div>' +
    '<div class="wz-hint" data-live="hint"></div><div class="wz-desc wz-phase" data-live="phase"></div><div class="wz-result" data-live="result"></div></div>';
}
function wzLive(lbl, key) { return '<div class="wz-live"><div class="big" data-live="' + key + '">—</div><div class="lbl">' + esc(lbl) + '</div></div>'; }
function buildWizardContent(w) {
  const cfg = config || {}, veh = cfg.vehicle || {}, ast = cfg.autosteer || {}, roll = cfg.roll || {};
  const ty = Math.max(0, Math.min(2, (veh.type | 0)));
  const head = '<div class="wz-h1">' + esc(w.title) + '</div><div class="wz-desc">' + esc(w.description) + '</div>';
  switch (w.stepKind) {
    case 'welcome': return head + '<div class="wz-center"><div class="wz-okcard"><div class="t">AutoSteer</div><div class="s">Configuration Wizard</div></div></div>';
    case 'vehicleType': {
      const c = (i, ic, t) => '<div class="wz-card" data-cfg="vehicle.type:' + i + '" data-activekey="vehicle.type" data-activeval="' + i + '"><img src="/icons/' + ic + '.png"><div class="t">' + t + '</div></div>';
      return head + '<div class="wz-cards">' + c(0, 'WheelbaseTractor', tr('Tractor')) + c(1, 'WheelbaseHarvester', tr('Harvester')) + c(2, 'WheelbaseArticulated', tr('4WD / Articulated')) + '</div>';
    }
    case 'hardware': {
      const c = (i, ic, t, s) => '<div class="wz-card" data-hw="' + i + '" data-activehw="' + i + '"><img src="/icons/' + ic + '.png"><div class="t">' + t + '</div><div class="s">' + s + '</div></div>';
      return head + '<div class="wz-cards">' + c(0, 'NavigationSettings', tr('GPS Only'), tr('Light bar guidance only')) + c(1, 'AutoSteerConf', tr('AutoSteer'), tr('Motor/valve, WAS, IMU')) + c(2, 'Settings48', tr('Full Setup'), tr('Steering + section control')) + '</div>';
    }
    case 'dimensions':
      return head + '<div class="wz-panels"><div class="wz-panel"><img class="dia" src="/icons/' + ['WheelbaseTractor', 'WheelbaseHarvester', 'WheelbaseArticulated'][ty] + '.png">' + wzNum(tr('Wheelbase'), tr('Front to rear axle distance'), 'vehicle.wheelbase', '0.01', 'm') + '</div>' +
        '<div class="wz-panel"><img class="dia" src="/icons/' + ['TrackWidthTractor', 'TrackWidthHarvester', 'TrackWidthArticulated'][ty] + '.png">' + wzNum(tr('Track width'), tr('Left to right wheel center'), 'vehicle.trackWidth', '0.01', 'm') + '</div></div>';
    case 'antenna':
      return head + '<div class="wz-panels"><div class="wz-panel"><img class="dia" src="/icons/' + ['AntennaTractorTop', 'AntennaHarvesterTop', 'AntennaArticulatedTop'][ty] + '.png">' +
        wzNum(tr('Pivot distance'), tr('Antenna to rear axle (+ = ahead)'), 'vehicle.antennaPivot', '0.01', 'm') + wzNum(tr('Antenna height'), tr('Above ground level'), 'vehicle.antennaHeight', '0.01', 'm') + '</div>' +
        '<div class="wz-panel"><img class="dia" src="/icons/' + ['AntennaTractorOffset', 'AntennaHarvesterOffset', 'AntennaArticulatedOffset'][ty] + '.png"><div class="wz-fld"><label>Lateral Offset</label><div class="sub">From centerline (+ = right)</div><div class="wz-seg">' +
        ['left', 'center', 'right'].map(v => '<button data-cfg="vehicle.antennaSide:' + v + '" data-activekey="vehicle.antennaSide" data-activeval="' + v + '">' + v[0].toUpperCase() + v.slice(1) + '</button>').join('') + '</div></div></div></div>';
    case 'hwconfig':
      return head + '<div class="wz-rows">' +
        wzSeg(tr('Steer enable method'), null, 'autosteer.externalEnable', [[tr('None'), 0], [tr('Switch'), 1], [tr('Button'), 2]]) +
        wzSeg(tr('Motor driver'), null, 'autosteer.motorDriver', [['IBT2', 0], ['Cytron', 1]]) +
        wzSeg(tr('A/D converter'), null, 'autosteer.adConverter', [[tr('Differential'), 0], [tr('Single'), 1]]) +
        wzTgl(tr('Invert steer enable relay'), tr('Inverts the relay that enables the motor'), 'autosteer.invertRelays') +
        wzTgl(tr('Danfoss valve'), tr('Enable for Danfoss hydraulic steering'), 'autosteer.danfossEnabled') + '</div>';
    case 'roll':
      // Reuse the map's roll gauge: a green bar that rotates around (100,40) by the
      // live roll, with pink scale marks and the degree readout.
      return head + '<div class="wz-center"><svg width="260" height="104" viewBox="0 0 200 80">' +
        '<path fill="none" stroke="#E91E90" stroke-width="2.5" stroke-linecap="round" d="M 70,12 A 22,28 0 0 0 70,68 M 59,20 L 51,20 M 52,30 L 44,30 M 48,40 L 40,40 M 52,50 L 44,50 M 59,60 L 51,60"/>' +
        '<path fill="none" stroke="#E91E90" stroke-width="2.5" stroke-linecap="round" d="M 130,12 A 22,28 0 0 1 130,68 M 141,20 L 149,20 M 148,30 L 156,30 M 152,40 L 160,40 M 148,50 L 156,50 M 141,60 L 149,60"/>' +
        '<rect id="wz-roll-bar" x="50" y="38" width="100" height="4" rx="2" fill="#2ECC71"/>' +
        '<circle cx="100" cy="40" r="3" fill="#fff"/>' +
        '<text id="wz-roll-deg" x="100" y="32" text-anchor="middle" fill="#fff" font-size="24" font-weight="bold" font-family="system-ui,sans-serif">0.0</text>' +
        '</svg></div>' +
        '<div class="wz-rows">' + wzTgl(tr('Invert roll'), null, 'roll.isRollInvert') +
        '<div class="wz-row"><div class="lbl">Zero Roll</div><button class="wz-testbtn" data-act="ZeroRoll">Zero Roll</button></div>' +
        '<div class="wz-row"><div class="lbl">Roll Zero Offset</div><div class="lbl"><span data-live="rollzero">—</span></div></div></div>';
    case 'was':
      return head + wzLive(tr('Live Steer Angle'), 'angle') +
        '<div class="wz-rows"><div class="wz-row"><div class="lbl">Zero WAS</div><button class="wz-testbtn" data-act="ZeroWas">Zero WAS</button></div>' +
        wzTgl(tr('Invert WAS'), tr('Enable if steering reads backwards'), 'autosteer.invertWas') +
        '<div class="wz-row"><div class="lbl">WAS Offset</div><div class="lbl"><span data-live="wasoffset">—</span> counts</div></div></div>';
    case 'motor':
      return head + wzLive(tr('Live Steer Angle'), 'angle') + '<div class="wz-center"><button class="wz-testbtn" data-act="StartTest">Start Motor Test</button>' +
        '<div class="wz-hint" data-live="hint"></div><div class="wz-desc" data-live="phase"></div><div class="wz-desc" data-live="result"></div></div>';
    case 'maxangle':
      return head + wzLive(tr('Live Steer Angle'), 'angle') + '<div class="wz-center"><button class="wz-testbtn" data-act="StartTest">Start Max Angle Test</button>' +
        '<div class="wz-hint" data-live="hint"></div><div class="wz-desc" data-live="phase"></div><div class="wz-desc" data-live="result"></div></div>';
    case 'cpd':
      return head + '<div class="wz-testtop"><div class="wz-prereq"><div class="ttl">Prerequisites</div><div class="it">GPS: <b data-live="fix">—</b> (RTK Fixed recommended)</div><div class="it">Speed: <b data-live="speed">—</b> ' + esc(tr('(aim for ~{speed})', { speed: fmtUnit(5, 'kmh', 0) })) + '</div></div>' +
        wzLive(tr('Live Steer Angle'), 'angle') + '</div>' + wzCircleTest() +
        '<div class="wz-rows">' + wzNum(tr('Counts Per Degree'), null, 'autosteer.countsPerDegree', '1', '') + '</div>';
    case 'ackermann':
      return head + '<div class="wz-testtop"><div class="wz-prereq"><div class="ttl">Prerequisites</div><div class="it">GPS: <b data-live="fix">—</b> (RTK Fixed recommended)</div><div class="it">Speed: <b data-live="speed">—</b> ' + esc(tr('(aim for ~{speed})', { speed: fmtUnit(5, 'kmh', 0) })) + '</div></div>' +
        wzLive(tr('Live Steer Angle'), 'angle') + '</div>' + wzCircleTest() +
        '<div class="wz-rows">' + wzNum(tr('Ackermann'), tr('100 = neutral'), 'autosteer.ackermann', '1', '') + '</div>';
    case 'gains':
      return head + '<div class="wz-rows">' + wzTgl(tr('Guidance algorithm (Stanley)'), tr('Pure Pursuit default; Stanley more responsive at low speed'), 'autosteer.isStanleyMode') +
        wzNum(tr('Proportional gain (Kp)'), tr('Start at 10, increase for faster correction'), 'autosteer.proportionalGain', '1', '') +
        wzNum(tr('Integral gain (Ki)'), tr('Start at 0, only increase for drift'), 'autosteer.integralGain', '0.01', '') +
        wzNum(tr('Steer response hold'), tr('Look-ahead (higher = smoother)'), 'autosteer.steerResponseHold', '0.1', '') +
        wzNum(tr('Side hill compensation'), tr('Degrees per degree of roll (0-1.0)'), 'autosteer.sideHillCompensation', '0.01', '') + '</div>';
    case 'speed':
      return head + '<div class="wz-rows">' +
        wzNum(tr('Min steer speed'), tr('Engage above this speed'), 'autosteer.minSteerSpeed', '0.1', 'kmh') +
        wzNum(tr('Max steer speed'), tr('Safety cutoff speed'), 'autosteer.maxSteerSpeed', '0.1', 'kmh') +
        wzTgl(tr('Turn Sensor'), tr('Steering wheel encoder'), 'autosteer.turnSensorEnabled') +
        wzTgl(tr('Pressure sensor'), tr('Hydraulic stall detection'), 'autosteer.pressureSensorEnabled') +
        wzTgl(tr('Current sensor'), tr('Motor current obstruction detection'), 'autosteer.currentSensorEnabled') +
        wzTgl(tr('Steer in reverse'), tr('Allow steering while reversing'), 'autosteer.steerInReverse') +
        wzNum(tr('Deadzone heading'), tr('Heading error tolerance'), 'autosteer.deadzoneHeading', '0.01', 'deg') + '</div>';
    case 'finish':
      return head + '<div class="wz-center"><div class="wz-okcard"><div class="ok">OK</div><div class="t">Configuration saved!</div><div class="s">Click Finish to close the wizard</div></div></div>';
    default: return head;
  }
}
function renderWizard() {
  const w = wizard;
  if (!w) return;
  // Chrome (every frame).
  asSetText('wz-step', tr('Step {n} of {total}', { n: w.stepIndex + 1, total: w.totalSteps }));
  document.getElementById('wz-progressbar').style.width = (w.totalSteps ? (w.stepIndex + 1) / w.totalSteps * 100 : 0) + '%';
  asSetText('wz-was', (w.statusWas || 0).toFixed(1) + '°'); asSetText('wz-roll', (w.statusRoll || 0).toFixed(1) + '°');
  asSetText('wz-gps', w.statusGps || '—'); asSetText('wz-speed', fmtUnit(w.statusSpeed || 0, 'kmh', 1)); asSetText('wz-pwm', w.statusPwm | 0);
  const next = document.getElementById('wz-next');
  next.textContent = w.isLast ? tr('Finish') : tr('Next');
  next.classList.toggle('disabled', !(w.isLast || w.canNext));
  document.getElementById('wz-back').classList.toggle('disabled', !w.canBack);
  document.getElementById('wz-skip').style.display = w.canSkip ? '' : 'none';
  // Rebuild content only on step change.
  const key = w.stepKind + '|' + w.stepIndex;
  if (key !== _wzKey) { _wzKey = key; wzContent.innerHTML = buildWizardContent(w); }
  // Active states (selection cards / segments / toggles) + live values, every frame.
  for (const el of wzContent.querySelectorAll('[data-activekey]'))
    el.classList.toggle('active', String(cfgGet(el.dataset.activekey)) === el.dataset.activeval);
  for (const el of wzContent.querySelectorAll('[data-activehw]'))
    el.classList.toggle('active', w.hardwareLevel === +el.dataset.activehw);
  for (const el of wzContent.querySelectorAll('[data-tglkey]')) {
    const on = !!cfgGet(el.dataset.tglkey); el.classList.toggle('on', on); el.textContent = on ? tr('On') : tr('Off');
  }
  for (const el of wzContent.querySelectorAll('[data-act]')) el.classList.toggle('disabled', !iHoldControl);
  const live = (k, v) => { for (const el of wzContent.querySelectorAll('[data-live="' + k + '"]')) el.textContent = v; };
  live('angle', (w.liveAngle || 0).toFixed(1) + '°'); live('roll', (w.liveRoll || 0).toFixed(2) + '°');
  live('error', (w.liveError || 0).toFixed(1)); live('phase', w.testPhase || ''); live('result', w.testResult || '');
  live('fix', w.fixLabel || (w.statusGps || '—')); live('speed', fmtUnit(w.statusSpeed || 0, 'kmh', 1));
  live('rollzero', wzVal('roll.rollZero').toFixed(2)); live('wasoffset', wzVal('autosteer.wasOffset') | 0);
  // Roll gauge (roll-calibration step): rotate the bar by the live roll, like the map.
  const rb = document.getElementById('wz-roll-bar');
  if (rb) { const rv = w.liveRoll || w.statusRoll || 0; rb.setAttribute('transform', 'rotate(' + rv.toFixed(2) + ' 100 40)'); const rd = document.getElementById('wz-roll-deg'); if (rd) rd.textContent = rv.toFixed(1); }
  live('hint', w.recordHint || '');
  const rec = document.getElementById('wz-recbtn');
  if (rec) {
    rec.textContent = w.testActive ? tr('Stop') : tr('Record'); rec.dataset.act = w.testActive ? 'StopRecording' : 'StartRecording';
    // CPD / Ackermann report whether Record can start; the hint says why not.
    if (w.stepKind === 'cpd' || w.stepKind === 'ackermann')
      rec.classList.toggle('disabled', !iHoldControl || (!w.testActive && !w.canRecord));
  }
  // Keep number fields in step with the store (a test result or another client can change
  // it) — except the one being typed in.
  for (const el of wzContent.querySelectorAll('input[data-cfgnum]')) {
    if (el === document.activeElement) continue;
    const u = el.dataset.unit, known = u && UNIT_DEFS[u];
    const v = String(known ? roundDisplay(toDisplayUnit(wzVal(el.dataset.cfgnum), u), u) : wzVal(el.dataset.cfgnum));
    if (el.value !== v) el.value = v;
  }
}

function renderSettings() {
  // Re-read the open config panel(s) when a fresh config frame arrives.
  if (configDirty) {
    configDirty = false;
    if (vcPanel.classList.contains('open')) populateVehicleCfg(false);
    if (tcPanel.classList.contains('open')) populateToolCfg(false);
    if (saPanel.classList.contains('open')) populateScreenAlerts();
    if (asPanel.classList.contains('open')) populateAutoSteer(false);
    if (document.getElementById('viewsettings').classList.contains('open')) renderViewSettings();
  }
  // AutoSteer live telemetry rides every status frame (not just config changes).
  if (asPanel.classList.contains('open')) renderAutoSteerLive();
  // Smart-WAS stats refresh while its modal is open.
  if (swPanel.classList.contains('open')) populateSmartWas();
  // Steer Wizard: re-render while open (host-driven; live every frame).
  wizardDirty = false;
  if (wzOverlay.classList.contains('open')) renderWizard();
  // Re-read the hub when a fresh profiles frame arrives.
  if (profilesDirty) { profilesDirty = false; if (document.getElementById('vehtoolhub').classList.contains('open')) refreshHub(); }
  // Network IO panel: module/NTRIP readouts ride the Status frame → refresh each frame.
  if (nioPanel.classList.contains('open')) renderNetworkIo();
  if (sdPanel.classList.contains('open')) renderSystemData();
  // NTRIP test result rides the Status frame while a test is in flight.
  if (_nteTestActive && document.getElementById('ntripeditor').classList.contains('open') && statusBar)
    document.getElementById('nte-teststatus').textContent = statusBar.ntripTestStatus || '';
  // Re-read the NTRIP list/editor fields when a fresh profiles frame arrives.
  if (ntripDirty) {
    ntripDirty = false;
    if (document.getElementById('ntripprofiles').classList.contains('open')) renderNtripList();
    if (document.getElementById('ntripeditor').classList.contains('open')) renderNteFields();
  }
  // Field Operations: status pill rides scene/status; Fields-and-Jobs lists re-read on a
  // fresh FieldOps frame.
  if (document.getElementById('fieldops').classList.contains('open')) renderFieldOps();
  if (document.getElementById('newfield').classList.contains('open')) renderNewField();
  if (fieldOpsDirty) {
    fieldOpsDirty = false;
    if (document.getElementById('fieldsandjobs').classList.contains('open')) renderFieldsAndJobs();
    if (document.getElementById('resumejob').classList.contains('open')) renderResumeJob();
  }
  if (agShareDirty) {
    agShareDirty = false;
    if (document.getElementById('agsettings').classList.contains('open')) renderAgSettings();
    if (document.getElementById('agupload').classList.contains('open')) renderAgUpload();
    if (document.getElementById('agdownload').classList.contains('open')) renderAgDownload();
  }
  // App Settings units/toggles ride config+status (every frame while open).
  if (document.getElementById('appsettings').classList.contains('open')) renderAppSettings();
  if (appInfoDirty) {
    appInfoDirty = false;
    if (document.getElementById('language').classList.contains('open')) renderLanguage();
    if (document.getElementById('logviewer').classList.contains('open')) renderLogViewer();
    if (document.getElementById('hotkeys').classList.contains('open')) renderHotkeys();
    if (document.getElementById('about').classList.contains('open')) renderAbout();
    if (document.getElementById('bugreport').classList.contains('open')) renderBugReport();
  }
}

// ---- Vehicle & Tool picker hub (Phase 9) — mirrors LoadVehicleToolDialogViewModel ----
const HUB = {
  summary: document.getElementById('vth-summary'),
  curVeh: document.getElementById('vth-curveh'), curTool: document.getElementById('vth-curtool'),
  vehList: document.getElementById('vth-vehlist'), toolList: document.getElementById('vth-toollist'),
  vehPrev: document.getElementById('vth-vehprev'), toolPrev: document.getElementById('vth-toolprev'),
  vehName: document.getElementById('vth-vehname'), toolName: document.getElementById('vth-toolname'),
  status: document.getElementById('vth-status'), load: document.getElementById('vth-load'),
};
function hubSend(cmd, arg) { transport.send(arg == null ? cmd : cmd + '|' + arg); }
function fillHubList(sel, entries, activeName) {
  const prev = sel.value;
  sel.innerHTML = '';
  for (const e of entries) {
    const o = document.createElement('option');
    o.value = e.name; o.textContent = e.name + (e.name === activeName ? '  ●' : '');
    sel.appendChild(o);
  }
  sel.value = entries.some(e => e.name === prev) ? prev : activeName;
}
function hubPreview(entries, name) { const e = entries.find(x => x.name === name); return e ? e.preview : ''; }
function hubUpdatePreviews() {
  if (!profiles) return;
  HUB.vehPrev.textContent = hubPreview(profiles.vehicles, HUB.vehList.value);
  HUB.toolPrev.textContent = hubPreview(profiles.tools, HUB.toolList.value);
  HUB.summary.textContent = tr('Selected: {name}', { name: (HUB.vehList.value || profiles.activeVehicle) +
    ' / ' + (HUB.toolList.value || profiles.activeTool) });
  HUB.load.disabled = (HUB.vehList.value === profiles.activeVehicle && HUB.toolList.value === profiles.activeTool);
}
function refreshHub() {
  if (!profiles) return;
  HUB.curVeh.textContent = 'Current: ' + profiles.activeVehicle;
  HUB.curTool.textContent = 'Current: ' + profiles.activeTool;
  fillHubList(HUB.vehList, profiles.vehicles, profiles.activeVehicle);
  fillHubList(HUB.toolList, profiles.tools, profiles.activeTool);
  hubUpdatePreviews();
}
HUB.vehList.addEventListener('change', () => { HUB.vehName.value = HUB.vehList.value; hubUpdatePreviews(); });
HUB.toolList.addEventListener('change', () => { HUB.toolName.value = HUB.toolList.value; hubUpdatePreviews(); });
for (const b of document.querySelectorAll('#vehtoolhub .hub-cbtn'))
  b.addEventListener('pointerdown', e => {
    e.stopPropagation();
    const kind = b.dataset.kind, act = b.dataset.act;
    const list = kind === 'vehicle' ? HUB.vehList : HUB.toolList;
    const nameInput = kind === 'vehicle' ? HUB.vehName : HUB.toolName;
    if (act === 'new') {
      const nm = (nameInput.value || '').trim();
      if (!nm) { HUB.status.textContent = tr('Type a name, then New'); return; }
      hubSend('profile.new', kind + '\t' + nm); HUB.status.textContent = tr('Creating {name}…', { name: nm });
    } else if (act === 'delete') {
      const nm = list.value;
      if (nm) showConfirm(tr('Delete Profile'), tr("Delete {kind} profile '{name}'?", { kind, name: nm }),
        () => hubSend('profile.delete', kind + '\t' + nm));
    } else if (act === 'rename') {
      const old = list.value, nw = (nameInput.value || '').trim();
      if (!old || !nw) { HUB.status.textContent = tr('Select a profile, type a new name, then Rename'); return; }
      hubSend('profile.rename', kind + '\t' + old + '\t' + nw);
    } else if (act === 'reset') {
      showConfirm(tr('Reset Profile'), tr('Reset Default {kind} profile?', { kind }), () => hubSend('profile.reset', kind));
    }
  });
HUB.load.addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (HUB.load.disabled || !profiles) return;
  hubSend('profile.load', (HUB.vehList.value || profiles.activeVehicle) + '\t' + (HUB.toolList.value || profiles.activeTool));
  lnCloseAll(); // native closes the picker on load
});
document.getElementById('vth-vehconfig').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (HUB.vehList.value) hubSend('profile.configureVehicle', HUB.vehList.value);
  lnOpen('vehiclecfg', 'ln-vehicle', () => populateVehicleCfg(true));
});
document.getElementById('vth-toolconfig').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (HUB.toolList.value) hubSend('profile.configureTool', HUB.toolList.value);
  lnOpen('toolcfg', 'ln-vehicle', () => populateToolCfg(true));
});

// ---- remote actuation control (Phase 2 safety layer) ----
// Take/Release single-holder control + a Tier-2 stub. Only the holder may
// actuate; the holder must heartbeat (presence) or the host revokes it (deadman).
// Control is implicit and by connection order: the first browser to connect is the
// controller (server-assigned); others observe. No take/release UI. A status line
// shows which role this browser has.
// Status-bar role indicator (left of Modules). Reflects both connection state
// (Disconnected when the socket is down) and the implicit control role.
function renderRole() {
  const t = document.getElementById('sb-roletext'), d = document.getElementById('sb-roledot');
  if (!t) return;
  let label, color;
  if (connState !== 'connected') { label = tr('Disconnected'); color = '#ff5a5a'; }
  else if (iHoldControl)         { label = tr('Operator');     color = '#39FF6A'; }
  else if (lastControl.held)     { label = tr('Observer');     color = '#ff7a3d'; }
  else                           { label = tr('No operator');  color = '#9fb3cc'; }
  t.textContent = label; t.style.color = color; d.style.background = color;
}
function updateControlUi() {
  iHoldControl = lastControl.held && lastControl.holderId === myClientId;
  if (iHoldControl) applyMobileQualityCap(); // a host-wide setting: sent once we may (#397)
  if (typeof renderHostPrompt === 'function') renderHostPrompt(); // who may answer
  if (typeof updateAsGated === 'function') updateAsGated(); // re-gate AutoSteer actions
  if (document.getElementById('recpath').classList.contains('open')) renderRecPath(); // re-gate Play
  renderRole();
}
// Reclaim the operator seat when it is free. Control is keyed to the WebSocket
// connection server-side and acquired once, implicitly, at connect. A browser
// REFRESH opens a new connection while the old one is still registered as holder,
// so the new connection's implicit acquire is denied; once the stale holder is
// dropped/deadman-swept the seat goes empty but the new connection never retried —
// leaving the Tier-2 right-nav menu permanently inop until a server restart. Claiming
// the empty seat here (driven by the control-state frame the drop/sweep emits, plus
// connect/hello) makes the operator role survive a refresh. Guarded on !held so it
// never takes the seat from a live operator — only fills a vacant one (deadman model).
function claimSeatIfFree() {
  if (connState === 'connected' && myClientId && !iHoldControl && !lastControl.held)
    transport.send('control.acquire|Browser');
}
// Heartbeat keeps our hold alive while we control; a lapse trips the host deadman
// (disengage autosteer + sections).
setInterval(() => { if (iHoldControl) transport.send('control.presence'); }, 500);
updateControlUi();

// Right-nav toolbar actuation (Phase 3b). Each button sends its Tier-2 command,
// but only while we hold control — the host hub enforces the same gate. No
// per-action confirm: holding control IS the deliberate gate (matches the native
// single-tap), and the deadman + failsafe cover a lost controller.
function rnSend(cmd) { if (iHoldControl) transport.send(cmd); }
// NB: use a direct lookup here, not the RN object — RN is a `const` defined later
// in the render section, so referencing it here would hit the temporal dead zone
// and throw at load (stuck "connecting…").
let rnCycleAt = 0, rnLastTrack = null; // last cycle tap (ms), track name seen then
const rnRoot = document.getElementById('rightnav');
if (rnRoot) {
  rnRoot.addEventListener('pointerdown', e => e.stopPropagation()); // don't pan the map
  // pointerdown, like the rest of the touch UI: the NativeWebView launcher doesn't
  // reliably fire 'click' (#56, #111).
  const wireRn = (id, cmd) => { const el = document.getElementById(id); if (el) el.addEventListener('pointerdown', e => { e.preventDefault(); rnSend(cmd); }); };
  wireRn('rn-contour', 'contour.toggle');
  wireRn('rn-contourlock', 'contour.lock'); // #110
  // Track picking (#336). After a cycle tap, renderRightNav flashes the new track's name.
  wireRn('rn-cycle', 'track.cycle');
  wireRn('rn-cycleback', 'track.cycleBack');
  for (const id of ['rn-cycle', 'rn-cycleback'])
    document.getElementById(id).addEventListener('pointerdown', () => { if (iHoldControl) rnCycleAt = Date.now(); });
  wireRn('rn-autotrack', 'track.autoTrack');
  wireRn('rn-manual', 'section.manual');
  wireRn('rn-auto', 'section.master');
  wireRn('rn-isobus', 'isobus.sectionControl'); // #312
  wireRn('rn-youturn', 'youturn.toggle');
  wireRn('rn-steer', 'autosteer.toggle');
}

// ---- render ----
// ONE projection: the CanvasKit M44 perspective matrix, always — top-down is just
// pitch 0 on the same matrix (distance is chosen so pitch 0 matches the ortho scale
// exactly, see buildScreenMatrix). There is no separate 2D renderer; perspM is non-null
// for the entire Skia render path (it's only null before CanvasKit finishes loading, and
// nothing is drawn then). The render helpers (w2s, drawGridSk, drawImagerySk,
// drawCoverageSk, …) assume perspM and no longer branch on it — that old per-pitch
// branch dropped top-down into an axis-aligned raster path that couldn't rotate, so
// imagery/coverage skewed away under HeadingUp/Map as heading changed.
function active3D() { return !!CK; }
// Build the world→CSS-px screen matrix, mirroring the native camera model
// (SkiaMapControl.BuildPerspectiveScreenMatrix): view = T(0,0,-distance)·Rx(-pitch)
// ·T(-cam), a FOV-PERSP_FOV perspective, then an NDC(-1..1, y-up)→pixel(y-down)
// viewport. distance is derived from pxPerM so pitch=0 matches the ortho scale
// exactly (no jump when tilting in). CanvasKit M44 is column-vector / row-major /
// radians, so multiply right-to-left: T(-cam) acts first.
function buildScreenMatrix() {
  if (!CK) return null;
  const halfW = vw / 2, halfH = vh / 2;
  const tanHalf = Math.tan(PERSP_FOV / 2);
  const distance = vh / (2 * tanHalf * pxPerM); // scale-continuity with ortho at pitch 0
  const near = 1, far = Math.max(5000, distance * 4);
  // Camera-relative: the camera translation is deliberately NOT baked into the matrix.
  // Baking absolute -camE,-camN into the f32 M44 forces it to subtract two field-scale
  // numbers each frame → the result steps in f32 ULPs as the camera moves → the whole
  // world jitters a sub-mm fraction ("floating-origin" jitter, visible on high-frequency
  // imagery). Instead w2s / pw / the raster sites subtract camE,camN in f64 (JS) and feed
  // only small relative coords here. Mirrors native (SkiaMapControl: double relX =
  // _vehicleX - _cameraX before its f32 SKMatrix44).
  const view = CK.M44.multiply(
    CK.M44.translated([0, 0, -distance]),
    CK.M44.rotated([1, 0, 0], -pitch),
    CK.M44.rotated([0, 0, 1], -mapRotation)); // map rotation (HeadingUp etc.)
  // Perspective (column-vector, row-major) — transpose of System.Numerics
  // CreatePerspectiveFieldOfView, so w' = -z.
  const yS = 1 / tanHalf, xS = yS / (vw / vh), nf = 1 / (near - far);
  const proj = [
    xS, 0, 0, 0,
    0, yS, 0, 0,
    0, 0, far * nf, near * far * nf,
    0, 0, -1, 0,
  ];
  const viewport = [
    halfW, 0, 0, halfW,
    0, -halfH, 0, halfH,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  return CK.M44.multiply(viewport, proj, view);
}
function updatePerspective() {
  perspM = active3D() ? buildScreenMatrix() : null;
  // Cache the inverse once per frame (Phase MT s2w foundation). perspM is row-major
  // (CanvasKit M44); the inverse is the screen-px→world-ray map used by s2w.
  perspMInv = perspM ? invertM44(perspM) : null;
}
// Near-plane clip a ground segment for the perspective path. perspM's w (bottom row,
// z=0) is positive in front of the camera; CanvasKit's drawLine doesn't clip the
// behind part (it perspective-divides by a negative w → a mirrored ghost line), so
// we clip in world space first. Returns [e1,n1,e2,n2] fully in front, or null.
function clipNear(e1, n1, e2, n2) {
  const EPS = 1.0; // matches the projection near plane
  const w1 = pw(e1, n1);
  const w2 = pw(e2, n2);
  if (w1 >= EPS && w2 >= EPS) return [e1, n1, e2, n2];
  if (w1 < EPS && w2 < EPS) return null;
  const t = (EPS - w1) / (w2 - w1);
  const ce = e1 + (e2 - e1) * t, cn = n1 + (n2 - n1) * t;
  return w1 < EPS ? [ce, cn, e2, n2] : [e1, n1, ce, cn];
}
// Map-mode auto-pan: keep the vehicle inside a centred safe zone, smoothing the
// camera toward it (snap if it leaves the viewport). Mirrors native ApplyAutoPan
// (rotation 0 in Map mode). World units; rotation 0.
function applyAutoPan(rp) {
  const viewHalfW = (vw / 2) / pxPerM, viewHalfH = (vh / 2) / pxPerM;
  const relE = rp.e - camE, relN = rp.n - camN;
  if (Math.abs(relE) > viewHalfW || Math.abs(relN) > viewHalfH) { camE = rp.e; camN = rp.n; return; }
  const safeW = viewHalfW * AUTO_PAN_SAFE, safeH = viewHalfH * AUTO_PAN_SAFE;
  let panE = 0, panN = 0;
  if (relE > safeW) panE = relE - safeW; else if (relE < -safeW) panE = relE + safeW;
  if (relN > safeH) panN = relN - safeH; else if (relN < -safeH) panN = relN + safeH;
  camE += panE * AUTO_PAN_SMOOTH; camN += panN * AUTO_PAN_SMOOTH;
}
// Per-frame camera update (run once, from skFrame()): apply the follow mode (camera
// position + map rotation), precompute the screen rotation, rebuild perspM.
function updateCamera() {
  const rp = renderPose(); // interpolated pose (position + heading both smooth now)
  let target = mapRotation; // Free (mode 2): hold rotation
  if (rp) {
    if (cameraMode === 0) { camE = rp.e; camN = rp.n; target = 0; }                // NorthUp
    else if (cameraMode === 1) { camE = rp.e; camN = rp.n; target = -rp.heading; } // HeadingUp
    else if (cameraMode === 3) { target = 0; applyAutoPan(rp); }                   // Map
  } else if (cameraMode !== 2) target = 0;
  // Ease toward the target along the shortest angular path — turns the 10 Hz heading
  // steps (HeadingUp) into continuous rotation. Adaptive alpha: heavy damping for small
  // errors (line-holding dither) → no map wobble; responsive for large errors → crisp turns.
  let d = target - mapRotation;
  d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
  // QUADRATIC ramp: stays near MIN for tiny errors (line-holding dither ≈0.005 rad → the
  // map barely follows it) but rises sharply toward MAX as the error approaches a real turn.
  // A linear ramp lifted alpha too much at the dither scale, leaving residual wobble.
  const rotFrac = Math.min(1, Math.abs(d) / ROT_SMOOTH_FULL);
  const rotAlpha = ROT_SMOOTH_MIN + (ROT_SMOOTH_MAX - ROT_SMOOTH_MIN) * rotFrac * rotFrac;
  mapRotation += d * rotAlpha;
  const rR = -mapRotation;
  _cosRR = Math.cos(rR); _sinRR = Math.sin(rR);
  updatePerspective();
  return rp;
}
// Apply perspM (row-major, M·v) to a ground point (e,n,0,1); perspective divide.
function applyM(M, e, n) {
  const x = M[0] * e + M[1] * n + M[3];
  const y = M[4] * e + M[5] * n + M[7];
  const w = M[12] * e + M[13] * n + M[15];
  return [x / w, y / w];
}
// World (e,n) → CSS px through the one perspective matrix (top-down is pitch 0). Only
// ever called from the Skia render path, where perspM is guaranteed set (CanvasKit up).
function w2s(e, n) {
  return applyM(perspM, e - camE, n - camN);
}
// Homogeneous w of a WORLD point through the camera-relative perspM (w < 1 ⇒ behind the
// near plane; used for cull/clip). The camE,camN subtraction happens here in f64 so the
// f32 matrix only ever sees small relative coords (see buildScreenMatrix's note).
function pw(e, n) {
  return perspM[12] * (e - camE) + perspM[13] * (n - camN) + perspM[15];
}
// ---- screen→world unprojection (Phase MT foundation) ----
// w2s only ever does world→screen; map-tap features need the inverse: turn a CSS-px tap
// into a field coordinate (E,N) on the ground plane z=0. perspM bakes the viewport in, so
// a tap (px,py) is already in perspM's output space — no NDC pre-step. We unproject the
// tap at two clip depths (the near/far representatives where the homogeneous w=1), giving
// two world points on the viewing ray, then intersect that ray with z=0.
//
// Full 4×4 row-major Gauss-Jordan inverse (perspM is row-major: a[r][c]=m[r*4+c]).
// Returns null if singular. Robust to any pitch — no special-casing top-down.
function invertM44(m) {
  const a = [];
  for (let r = 0; r < 4; r++) {
    a.push([m[r*4], m[r*4+1], m[r*4+2], m[r*4+3],
            r===0?1:0, r===1?1:0, r===2?1:0, r===3?1:0]);
  }
  for (let col = 0; col < 4; col++) {
    let piv = col, best = Math.abs(a[col][col]);
    for (let r = col + 1; r < 4; r++) {
      const v = Math.abs(a[r][col]); if (v > best) { best = v; piv = r; }
    }
    if (best < 1e-12) return null;
    if (piv !== col) { const t = a[piv]; a[piv] = a[col]; a[col] = t; }
    const pv = a[col][col];
    for (let j = 0; j < 8; j++) a[col][j] /= pv;
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = a[r][col];
      if (f !== 0) for (let j = 0; j < 8; j++) a[r][j] -= f * a[col][j];
    }
  }
  const out = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[r*4+c] = a[r][c+4];
  return out;
}
// Row-major 4×4 · column vector (x,y,z,w) → [4].
function m44vec(M, x, y, z, w) {
  return [
    M[0]*x + M[1]*y + M[2]*z + M[3]*w,
    M[4]*x + M[5]*y + M[6]*z + M[7]*w,
    M[8]*x + M[9]*y + M[10]*z + M[11]*w,
    M[12]*x + M[13]*y + M[14]*z + M[15]*w,
  ];
}
// Screen (CSS px) → world (E,N) on the ground plane z=0. Returns {e,n} or null (no matrix
// yet, or the viewing ray is parallel to the ground — e.g. a tap on/above the horizon under
// extreme tilt). Reuse everywhere a tap must become a field coordinate.
function s2w(px, py) {
  if (!perspMInv) return null;
  const A = m44vec(perspMInv, px, py, 0, 1); // near-plane representative
  const B = m44vec(perspMInv, px, py, 1, 1); // far-plane representative
  if (A[3] === 0 || B[3] === 0) return null;
  const ax = A[0]/A[3], ay = A[1]/A[3], az = A[2]/A[3];
  const bx = B[0]/B[3], by = B[1]/B[3], bz = B[2]/B[3];
  const dz = bz - az;
  if (Math.abs(dz) < 1e-9) return null;       // ray parallel to ground (horizon)
  const t = -az / dz;
  // perspMInv maps screen → camera-relative world; add the camera origin back for world E/N.
  return { e: ax + (bx - ax) * t + camE, n: ay + (by - ay) * t + camN };
}
// Dev round-trip check: project a grid of world points with w2s, unproject with s2w,
// report max error. Call from the console at pitch 0 AND tilted (press 3) — expect
// sub-millimetre error. Skips points behind the camera (w<1), which w2s can't show anyway.
window._s2wTest = function () {
  if (!perspM) { console.log('s2w test: no perspM (CanvasKit not ready)'); return; }
  let maxErr = 0, n = 0;
  for (let de = -200; de <= 200; de += 50) for (let dn = -200; dn <= 200; dn += 50) {
    const e = camE + de, nn = camN + dn;
    if (pw(e, nn) < 1.0) continue; // behind camera
    const s = w2s(e, nn);
    const b = s2w(s[0], s[1]);
    if (!b) continue;
    maxErr = Math.max(maxErr, Math.hypot(b.e - e, b.n - nn));
    n++;
  }
  console.log(`s2w round-trip: pitch=${(pitch*180/Math.PI).toFixed(0)}° samples=${n} maxErr=${maxErr.toExponential(3)} m`);
  return maxErr;
};
// On-screen heading at a ground point: the heading direction projected through the
// current matrix (so the vehicle marker aligns with the tilted ground, not screen
// up). Returns the world heading unchanged when top-down.
function screenHeading(e, n, h) {
  // Project a short step along the heading and read the on-screen angle. Works for
  // 2D (now rotation-aware via w2s) and 3D; returns h when north-up + top-down.
  const a = w2s(e, n), b = w2s(e + Math.sin(h) * 3, n + Math.cos(h) * 3);
  return Math.atan2(b[0] - a[0], -(b[1] - a[1])); // 0 = up, clockwise
}
// Section display palette by ColorCode — matches the native
// SectionColorCodeToBackgroundConverter exactly.
const SECTION_COLORS = [
  'rgba(242,51,51,0.85)',  // 0 off          (red)
  'rgba(247,247,0,0.9)',   // 1 manual on    (yellow)
  'rgba(0,242,0,0.85)',    // 2 auto on      (green)
  'rgba(0,222,222,0.85)',  // 3 turning off  (cyan)
  'rgba(255,165,0,0.9)',   // 4 turning on   (orange)
  'rgba(150,150,150,0.5)', // 5 auto off     (gray)
];
// Tool/section footprint: each section is a bar from its left to right edge,
// perpendicular to the tool heading, green when on / grey when off. Section
// spans come from the Scene (static layout); the tool pose comes from the Tick.
// Transform matches SectionControlService.GetSectionWorldPosition:
//   edge = (toolE,toolN) + (sin,cos)(toolHeading + π/2) * span.
// Dead-reckon the tool pose between ticks (same scheme as renderPose for the
// vehicle), so the footprint glides with the tractor instead of snapping to each
// 10 Hz tick. Extrapolate along the tool heading at the reported speed.
function renderTool() {
  const s = sample();
  if (!s || !s.b.tool) return null;
  const pt = s.a.tool || s.b.tool, qt = s.b.tool, f = s.f;
  return {
    e: pt.e + (qt.e - pt.e) * f,
    n: pt.n + (qt.n - pt.n) * f,
    heading: lerpAngle(pt.heading, qt.heading, f),
  };
}
// Pure Pursuit goal point (#95), interpolated on the same playback timeline as the pose so
// it slides with the vehicle instead of stepping at the Tick rate. Hidden as soon as the
// newest Tick has no goal (track deselected / contour).
function renderGoal() {
  if (!tick || !tick.goal) return null;
  const s = sample();
  if (!s || !s.b.goal) return tick.goal;
  const a = s.a.goal || s.b.goal, b = s.b.goal, f = s.f;
  return { e: a.e + (b.e - a.e) * f, n: a.n + (b.n - a.n) * f };
}
// Shortest-path angular lerp (radians).
function lerpAngle(a, b, f) {
  let d = b - a; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
  return a + d * f;
}
// Pick the two buffered poses bracketing the playback head (RENDER_DELAY in the PAST)
// and the fraction between them. The playhead runs on the HOST timeline (client clock
// − clockOffset), so its position relative to the poses' host build-times is jitter-free —
// WiFi arrival jitter only changes WHICH poses are buffered, never the interp rate (that
// rate-warp was the "wiggle"). A 2-pose buffer judders once RENDER_DELAY > the pose
// interval (playhead falls off the old end → clamps); the multi-pose buffer always has a
// bracketing pair. Returns { a, b, f } or null; holds oldest/newest outside the buffer.
function sample() {
  const m = poseBuf.length;
  if (m === 0) return null;
  if (m === 1) return { a: poseBuf[0], b: poseBuf[0], f: 1 };
  const useHost = clockOffset !== null && typeof poseBuf[m - 1].hostT === 'number';
  const key = useHost ? 'hostT' : 't';
  const playhead = useHost
    ? performance.now() - clockOffset - RENDER_DELAY
    : performance.now() - RENDER_DELAY; // legacy receipt timeline (host sent no timestamp)
  if (playhead <= poseBuf[0][key]) return { a: poseBuf[0], b: poseBuf[0], f: 0 };
  const nw = poseBuf[m - 1];
  if (playhead >= nw[key]) {
    // Buffer underrun (WiFi spike / late pose): EXTRAPOLATE the last segment's velocity
    // forward (f>1 → renderPose/renderTool extend prev→nw linearly) instead of HOLDING,
    // which would freeze a frame → stutter. Capped at EXTRAP_CAP_MS so a real dropout
    // settles to a hold rather than flying off.
    const prev = poseBuf[m - 2];
    const span = nw[key] - prev[key];
    if (span <= 0) return { a: nw, b: nw, f: 1 };
    const over = Math.min(playhead - nw[key], EXTRAP_CAP_MS);
    return { a: prev, b: nw, f: 1 + over / span };
  }
  for (let i = 0; i < m - 1; i++) {
    const a = poseBuf[i], b = poseBuf[i + 1];
    if (playhead >= a[key] && playhead < b[key]) {
      const span = b[key] - a[key];
      return { a, b, f: span > 0 ? (playhead - a[key]) / span : 1 };
    }
  }
  return { a: nw, b: nw, f: 1 };
}
function renderPose() {
  const s = sample();
  if (!s) return null;
  return {
    e: s.a.e + (s.b.e - s.a.e) * s.f,
    n: s.a.n + (s.b.n - s.a.n) * s.f,
    heading: lerpAngle(s.a.heading, s.b.heading, s.f),
    speed: s.b.speed,
  };
}
// Cross-track error as "12 cm R" / "5 in R" (R = right of line, +xte). Centimetres
// (inches in imperial) so the magnitude reads at a glance; the lightbar carries the
// live feel.
function xteText(xte) {
  if (xte == null) return '—';
  const side = xte > 0.005 ? 'R' : xte < -0.005 ? 'L' : '·';
  return `${fmtUnit(Math.abs(xte) * 100, 'cm', 0)} ${side}`;
}

// Lightbar readout text → DOM overlay (the LED strip itself is drawn by lightbarSk).
// Updated every frame from the latest tick; hidden when guidance is off.
const lbEl = document.getElementById('lb');
// Arrow + text as two spans, so the arrow can take the colour of the lit cells; the
// pass number goes on its own line below.
const lbArrow = lbEl.appendChild(document.createElement('span'));
const lbText = lbEl.appendChild(document.createElement('span'));
const lbPass = lbEl.appendChild(document.createElement('div'));
const LB_LEFT = '#ff7a3d', LB_RIGHT = '#39FF6A'; // as lightbarSk: steer left / steer right, on line
function updateLightbarText() {
  const cfg = config && config.autosteer;
  if (!tick || !tick.guidanceActive || !cfg || !cfg.guidanceBarOn) { lbEl.style.display = 'none'; return; }
  // AgOpenGPS: "Light bar" is on/off, "Steer bar" picks the style. In light-bar style the
  // distance text shows even with the bar off; in steer-bar style it all goes (#111).
  if (cfg.steerBarEnabled && !cfg.lightbarEnabled) { lbEl.style.display = 'none'; return; }
  if (cfg.steerBarEnabled) {
    // Steer bar: steer-angle error (deg) with dead-zone.
    let err = tick.steerAngleError || 0;
    const dz = (tick.op && tick.op.autoSteer) ? 0.5 : 0.2;
    if (Math.abs(err) < dz) err = 0;
    lbArrow.textContent = err === 0 ? '' : err > 0 ? '◀ ' : '▶ ';
    lbArrow.style.color = err > 0 ? LB_LEFT : LB_RIGHT;
    lbText.textContent = err === 0 ? '> 0 <' : `${Math.abs(err).toFixed(1)}°`;
    lbPass.textContent = '';
  } else {
    // Light bar: cross-track distance.
    const xte = tick.crossTrackError || 0;
    const onLine = Math.abs(xte) < 0.05;
    lbArrow.textContent = (onLine ? '●' : xte > 0 ? '◀' : '▶') + ' '; // arrow = steer direction
    lbArrow.style.color = !onLine && xte > 0 ? LB_LEFT : LB_RIGHT;
    // 1-based pass label (human counting): the reference AB line is "Pass 1", one over is
    // "Pass 2", etc. — magnitude only (the arrow already shows which way to steer).
    const pass = (tick.op ? tick.op.passNumber : 0) | 0;
    lbText.textContent = fmtUnit(Math.abs(xte) * 100, 'cm', 0);
    lbPass.textContent = tick.op && tick.op.contour ? '' : tr('Pass {n}', { n: Math.abs(pass) + 1 }); // no passes on a contour (#110)
  }
  lbEl.style.display = 'block';
}

// Headland-distance HUD → DOM overlay (mirrors the native SkiaMapControl HUD).
// Shown only when Display.HeadlandDistanceVisible is on and a live distance ≥ 0
// (−1 = no headland / not driving). Metric/imperial follows the status bar.
const hlHud = document.getElementById('headland-hud');
function updateHeadlandHud() {
  const on = config && config.display && config.display.headlandDistanceVisible;
  const d = tick ? tick.headlandDist : -1;
  // Hide the HUD while a map-tap creation flow is active (Quick AB / boundary curve / draw / …):
  // the boundary distance isn't needed while placing points, and it would clutter the top-centre
  // instruction pill + toolbar. body.maptap is set by startMapTap for the duration of the flow.
  const creating = document.body.classList.contains('maptap');
  if (!on || creating || d == null || d < 0) { hlHud.style.display = 'none'; return; }
  hlHud.textContent = isMetric() ? fmtUnit(d, 'm', 1) : fmtUnit(d, 'm', 0);
  hlHud.classList.toggle('warn', !!(tick && tick.headlandWarn));
  hlHud.style.display = 'block';
}

// Top status bar — DOM overlay mirroring the native StatusBarPanel: a two-line
// left stack (Fix dot + text + Age on top, a rotating Field/Stats/AB-line below
// with a pause toggle), and a right cluster (aggregate Modules dot + per-module
// popup, then big Speed + unit). Updated each frame from the latest StatusDto plus
// the live tick. Element refs cached once.
const SB = {
  bar: document.getElementById('statusbar'),
  pause: document.getElementById('sb-pause'),
  fixDot: document.getElementById('sb-fixdot'), fix: document.getElementById('sb-fix'),
  age: document.getElementById('sb-age'), rot: document.getElementById('sb-rot'),
  speed: document.getElementById('sb-speed'), unit: document.getElementById('sb-unit'),
  hdg: document.getElementById('sb-hdg'),
  modAgg: document.getElementById('sb-modagg'), modBtn: document.getElementById('sb-modbtn'),
  modPop: document.getElementById('sb-modpop'),
  mGps: document.getElementById('sb-gps'), mImu: document.getElementById('sb-imu'),
  mAs: document.getElementById('sb-as'), mMa: document.getElementById('sb-ma'),
  dGps: document.getElementById('sb-gps-d'), dImu: document.getElementById('sb-imu-d'),
  dAs: document.getElementById('sb-as-d'), dMa: document.getElementById('sb-ma-d'),
  // GPS-detail card (Phase 5).
  fixBtn: document.getElementById('sb-fixbtn'), gpsCard: document.getElementById('sb-gpscard'),
  gcLat: document.getElementById('gc-lat'), gcLon: document.getElementById('gc-lon'),
  gcElev: document.getElementById('gc-elev'), gcSats: document.getElementById('gc-sats'),
  gcHdop: document.getElementById('gc-hdop'), gcFix: document.getElementById('gc-fix'),
  gcAge: document.getElementById('gc-age'), gcHdg: document.getElementById('gc-hdg'),
  gcRoll: document.getElementById('gc-roll'), gcFps: document.getElementById('gc-fps'),
  gcSentence: document.getElementById('gc-sentence'),
  // Dev diagnostics line (marker-gated by .show_dev_overlay).
  diagRow: document.getElementById('sb-diag'),
  sbdFps: document.getElementById('sbd-fps'), sbdLink: document.getElementById('sbd-link'),
  sbdCtrl: document.getElementById('sbd-ctrl'),
};
// GPS fix-quality → dot colour (matches the native FixQualityToColor intent).
function fixColor(q) {
  switch (q) {
    case 4: return '#22c55e';  // RTK fixed — green
    case 5: return '#f59e0b';  // RTK float — amber
    case 2: return '#38bdf8';  // DGPS — blue
    case 1: return '#eab308';  // GPS — yellow
    default: return '#ef4444'; // no/invalid fix — red
  }
}
// Aggregate module colour — green only when every CONFIGURED module is present,
// amber if some, red if none (mirrors MainViewModel.ModuleStatusKind).
function moduleAggColor(s) {
  let conf = 0, pres = 0;
  const tally = (c, ok) => { if (c) { conf++; if (ok) pres++; } };
  tally(s.gpsConf, s.gpsOk); tally(s.imuConf, s.imuOk);
  tally(s.autoSteerConf, s.autoSteerOk); tally(s.machineConf, s.machineOk);
  if (conf === 0 || pres === 0) return '#ef4444';
  return pres === conf ? '#22c55e' : '#f59e0b';
}
// Area/rate formatting — matches MainViewModel.FormatArea / WorkRateDisplay.
function fmtArea(m2) { return fmtUnit(m2 * 0.0001, 'ha'); }
function fmtRate(haPerHr) { return haPerHr == null ? '—' : fmtUnit(haPerHr, 'ha', 1) + '/hr'; }
// Work rate from speed (m/s) × tool width; null without a tool width (#398).
function workRateHa(speedMs) { const tw = toolWidthM(); return tw > 0 ? speedMs * 3600 * tw / 10000 : null; }
// Workable area (m²) from the Scene the client already has: headland polygon if
// present, else the outer boundary (shoelace) — matches WorkableAreaSqM.
function shoelace(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i].e * pts[j].n - pts[j].e * pts[i].n; }
  return Math.abs(a / 2);
}
function workableAreaSqM() {
  if (scene && scene.headland && scene.headland.length >= 3) return shoelace(scene.headland);
  if (scene && scene.boundaries && scene.boundaries.length && scene.boundaries[0].length >= 3)
    return shoelace(scene.boundaries[0]);
  return 0;
}
// Active track heading (deg, 0 = north) from its first two Scene points.
function activeTrackHeadingDeg() {
  if (!scene || !tick || !tick.activeTrackName) return null;
  const tr = scene.tracks.find(t => t.name === tick.activeTrackName);
  if (!tr || tr.points.length < 2) return null;
  const a = tr.points[0], b = tr.points[1];
  return Math.atan2(b.e - a.e, b.n - a.n) * 180 / Math.PI;
}
// Rotating bottom line — the three native pages (Field / Stats / AB-line).
let sbPage = 0, sbPaused = false;
function rotatingLineText() {
  const s = statusBar; if (!s) return '';
  if (sbPage === 0) { // Field
    if (!scene || !scene.hasField) return tr('No field');
    return tr('Field: {name}', { name: scene.fieldName || '—' }) + (s.jobName ? '  ' + tr('Job: {name}', { name: s.jobName }) : '');
  }
  if (sbPage === 1) { // Stats
    if (!scene || !scene.hasField) return '—';
    const workable = workableAreaSqM(), worked = s.workedAreaSqM || 0;
    const leftPct = workable > 0 ? ((workable - worked) * 100 / workable) : 100;
    const tw = sectionsWidthM(); // fork: no rate without a real working width
    const haPerHr = (lastTick ? lastTick.speed : 0) * 3600 * tw / 10000;
    return tr('Done {area}  Left {pct}%  Rate {rate}', { area: fmtArea(worked), pct: leftPct.toFixed(0), rate: tw > 0 ? fmtRate(haPerHr) : '—' });
  }
  const name = tick && tick.activeTrackName; // AB-line page
  if (!name) return tr('No AB Line');
  const h = activeTrackHeadingDeg();
  if (h == null) return tr('AB Line: {name}', { name });
  const primary = ((h % 360) + 360) % 360, recip = (primary + 180) % 360;
  return tr('AB Line: {name}', { name }) + '  ' + primary.toFixed(1) + '°, ' + recip.toFixed(1) + '°';
}
setInterval(() => { if (!sbPaused) sbPage = (sbPage + 1) % 3; }, 5000); // native 5 s cycle
SB.pause.addEventListener('click', () => { sbPaused = !sbPaused; SB.pause.textContent = sbPaused ? '▶' : '❚❚'; });
// Bar interaction must not pan the map (the camera listens on window pointerdown).
SB.bar.addEventListener('pointerdown', e => e.stopPropagation());
// Fullscreen toggle — hides the browser tabs/URL bar on tablets. Works on a user
// gesture over plain HTTP (no PWA install needed). Prefixed fallback for older Android.
// Start Fullscreen (#110): browsers only allow fullscreen from a user gesture, so in a
// plain browser go fullscreen on the first tap after the page loads. The desktop
// launcher window opens fullscreen itself.
document.addEventListener('click', function startFs() {
  document.removeEventListener('click', startFs, true);
  if (!(config && config.display && config.display.startFullscreen)) return;
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) { try { const p = req.call(el); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
}, true);
const fsBtn = document.getElementById('sb-fs');
if (fsBtn) {
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  // Use 'click' (not pointerdown): requestFullscreen needs a durable user activation
  // that pointerdown doesn't reliably grant on Android Chrome (entering took 2–3 taps).
  // exitFullscreen needs no activation, so that always worked first tap.
  // fork (feature/bedienung-1): in the desktop launcher (Photino) the Fullscreen API only fills the
  // web view; the launcher switches the window itself on a "fullscreen|1/0" message.
  const photino = () => !!(window.external && typeof window.external.sendMessage === 'function');
  let winFs = null; // the launcher's state as last asked; starts as App Settings › Start Fullscreen
  fsBtn.addEventListener('click', () => {
    if (photino()) {
      if (winFs === null) winFs = !!(config && config.display && config.display.startFullscreen);
      winFs = !winFs;
      window.external.sendMessage('fullscreen|' + (winFs ? '1' : '0'));
      fsBtn.textContent = winFs ? '🗗' : '⛶';
      return;
    }
    if (fsEl()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) { try { const p = req.call(el); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
  });
  fsBtn.addEventListener('pointerdown', e => e.stopPropagation()); // don't also pan the map
  const sync = () => {
    const fs = !!fsEl();
    fsBtn.textContent = fs ? '🗗' : '⛶';
    // In fullscreen the OS draws an exit "✕" pill at the top-left (e.g. iPad Safari's
    // Fullscreen-API control) that sits over the RTK fix + rotating info fields. We can't
    // hide OS chrome, so nudge that left stack clear of it — only while fullscreen.
    document.body.classList.toggle('fs-on', fs);
  };
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
}
SB.modBtn.addEventListener('pointerdown', e => {
  e.stopPropagation();
  SB.modPop.style.display = SB.modPop.style.display === 'block' ? 'none' : 'block';
});
// Fix dot toggles the GPS-detail card (mutually exclusive with the modules popup).
SB.fixBtn.addEventListener('pointerdown', e => {
  e.stopPropagation();
  const show = SB.gpsCard.style.display !== 'block';
  SB.gpsCard.style.display = show ? 'block' : 'none';
  if (show) document.getElementById('sb-fieldcard').style.display = 'none'; // one card at a time
  if (show) SB.modPop.style.display = 'none';
});
addEventListener('pointerdown', () => {
  if (SB.modPop) SB.modPop.style.display = 'none';
  if (SB.gpsCard) SB.gpsCard.style.display = 'none';
  document.getElementById('sb-fieldcard').style.display = 'none';
  // Close bottom-nav flyouts on any outside click (clicks inside #bottomnav
  // stopPropagation, so they don't reach here).
  const ff = document.getElementById('bn-flyout-flags'), af = document.getElementById('bn-flyout-ab');
  if (ff) ff.classList.remove('open');
  if (af) af.classList.remove('open');
  document.getElementById('bn-flags')?.classList.remove('menuopen');
  document.getElementById('bn-abmenu')?.classList.remove('menuopen');
  // Left-nav panels now close via the transparent #ln-scrim (which consumes the tap),
  // not this global handler — so a panel dismiss no longer also pans the map.
});

// Field data card (#321), after AgOpenGPS FormFieldData: tap the rotating field line under
// the fix readout. Total / Remaining / Time left / Actual remaining need a boundary.
// Worked counts every pass (overlap included); Actual is the ground covered at least once.
const FC = {
  card: document.getElementById('sb-fieldcard'), reset: document.getElementById('fc-reset'),
  name: document.getElementById('fc-name'), total: document.getElementById('fc-total'),
  worked: document.getElementById('fc-worked'), remain: document.getElementById('fc-remain'),
  time: document.getElementById('fc-time'), overlap: document.getElementById('fc-overlap'),
  actual: document.getElementById('fc-actual'), actRemain: document.getElementById('fc-actremain'),
  rate: document.getElementById('fc-rate'), tripArea: document.getElementById('fc-triparea'),
  tripDist: document.getElementById('fc-tripdist'),
};
SB.rot.addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (!scene || !scene.hasField) return;
  const show = FC.card.style.display !== 'block';
  FC.card.style.display = show ? 'block' : 'none';
  if (show) { SB.gpsCard.style.display = 'none'; renderFieldCard(); }
});
FC.card.addEventListener('pointerdown', e => e.stopPropagation());
FC.reset.addEventListener('pointerdown', e => { e.preventDefault(); transport.send('fielddata.resetTrip'); });
function renderFieldCard() {
  if (FC.card.style.display !== 'block') return;
  const s = statusBar, fd = s && s.fieldData;
  if (!fd || !scene || !scene.hasField) { FC.card.style.display = 'none'; return; }
  const total = fd.boundaryAreaSqM, worked = s.workedAreaSqM || 0;
  // A cell on the tool's edge can count as covered a little before the strip area
  // catches up, so keep Actual within Worked.
  const actual = Math.min(fd.actualAreaSqM, worked);
  const speedKmh = (lastTick ? lastTick.speed : 0) * 3.6;
  const haPerHr = workRateHa(lastTick ? lastTick.speed : 0);
  for (const r of FC.card.querySelectorAll('.fc-bnd')) r.classList.toggle('fc-hide', !(total > 0));
  FC.name.textContent = scene.fieldName + (s.jobName ? '  ·  ' + s.jobName : '');
  FC.worked.textContent = fmtArea(worked);
  FC.overlap.textContent = (worked > 0 ? (1 - actual / worked) * 100 : 0).toFixed(1) + '%';
  FC.actual.textContent = fmtArea(actual);
  FC.rate.textContent = fmtRate(haPerHr);
  FC.tripArea.textContent = fmtArea(fd.tripAreaSqM);
  FC.tripDist.textContent = fmtUnit(fd.tripDistanceM, 'm', 0);
  if (total > 0) {
    const left = Math.max(0, total - worked);
    FC.total.textContent = fmtArea(total);
    FC.remain.textContent = fmtArea(left) + '  (' + (left * 100 / total).toFixed(1) + '%)';
    FC.actRemain.textContent = fmtArea(Math.max(0, total - actual));
    // AgOpenGPS: no estimate below 2 km/h.
    if (speedKmh > 2 && haPerHr > 0) {
      const mins = Math.round(left / 10000 / haPerHr * 60);
      FC.time.textContent = Math.floor(mins / 60) + ':' + String(mins % 60).padStart(2, '0');
    } else FC.time.textContent = '∞';
  }
}

function renderStatusBar() {
  const s = statusBar;
  if (!s) { SB.bar.style.display = 'none'; if (SB.diagRow) SB.diagRow.style.display = 'none'; return; }
  SB.bar.style.display = 'flex';
  // GPS data lost: the host already reports No Fix; grey the dot so it reads as "nothing",
  // not as a live red "no fix" from a receiver that is still talking.
  SB.fixDot.style.background = s.gpsLost ? '#6b7280' : fixColor(s.fixQuality);
  SB.fix.textContent = s.fixText || '—';
  SB.age.textContent = tr('Age {age}', { age: Number.isFinite(s.age) ? s.age.toFixed(1) : '—' }); // NaN: the sentence has no age ($KSXT)
  SB.rot.textContent = rotatingLineText();
  renderFieldCard();
  // Speed from the live tick (m/s), formatted per the host's unit preference.
  const mps = lastTick ? lastTick.speed : 0;
  SB.speed.textContent = toDisplayUnit(mps * 3.6, 'kmh').toFixed(1);
  SB.unit.textContent = unitLabel('kmh');
  // Modules: aggregate dot + per-module popup rows.
  // All configured modules present = steady green; anything short of that flashes
  // (amber: some missing, red: none), so trouble catches the eye from across the cab.
  const aggColor = moduleAggColor(s);
  SB.modAgg.style.background = aggColor;
  SB.modAgg.classList.toggle('flash', aggColor !== '#22c55e');
  const dot = (el, ok) => { el.style.background = ok ? '#22c55e' : '#6b7280'; };
  dot(SB.mGps, s.gpsOk); dot(SB.mImu, s.imuOk); dot(SB.mAs, s.autoSteerOk); dot(SB.mMa, s.machineOk);
  SB.dGps.textContent = (s.fixText || '—') + (s.sats ? ' ' + tr('({n} sats)', { n: s.sats }) : '');
  SB.dImu.textContent = s.imuIp || tr('Not detected');
  SB.dAs.textContent = s.autoSteerIp || tr('Not detected');
  SB.dMa.textContent = s.machineIp || tr('Not detected');
  // Heading readout (right of speed) — Tick heading is radians (0 = N, CW).
  const hdgDeg = lastTick ? (lastTick.heading * 180 / Math.PI) : null;
  SB.hdg.textContent = hdgDeg != null ? fmtHdg(hdgDeg) : '—';
  // GPS-detail card — populated only while open (the fix dot toggles it).
  if (SB.gpsCard.style.display === 'block') {
    SB.gcLat.textContent = s.lat != null ? s.lat.toFixed(7) : '—';
    SB.gcLon.textContent = s.lon != null ? s.lon.toFixed(7) : '—';
    SB.gcElev.textContent = s.altitude != null ? fmtUnit(s.altitude, 'm', 1) : '—'; // m / ft (#112)
    SB.gcSats.textContent = s.sats != null ? s.sats : '—';
    SB.gcHdop.textContent = Number.isFinite(s.hdop) ? s.hdop.toFixed(2) : '—';
    SB.gcFix.textContent = s.fixText || '—';
    SB.gcAge.textContent = Number.isFinite(s.age) ? s.age.toFixed(1) : '—';
    // Incoming sentence (#157); flagged when Dual GPS is on but there's no dual heading.
    SB.gcSentence.textContent = (s.gpsSentence ? '$' + s.gpsSentence : '—')
      + (s.dualHeadingMissing ? ' ' + tr('(no dual heading)', {}) : '');
    SB.gcSentence.style.color = s.dualHeadingMissing ? 'salmon' : '';
    SB.gcHdg.textContent = hdgDeg != null ? (((hdgDeg % 360) + 360) % 360).toFixed(1) + '°' : '—';
    SB.gcRoll.textContent = (tick && typeof tick.roll === 'number') ? tick.roll.toFixed(1) + '°' : '—';
    SB.gcFps.textContent = fps.toFixed(0);
  }
  // Dev diagnostics line (marker-gated). DOM text only — no canvas overlay — so reading FPS
  // doesn't perturb the frame loop (an overlay/dialog did, hence the status-line approach).
  // Throttled to ~4 Hz; that tick also fires the link probe. FPS = client render rate; LINK =
  // server↔client round-trip (ms, from diag.ping/PONG); CTRL = backend→AiO control-loop
  // latency (GPS receive → PGN send, ms).
  if (s.devOverlay) {
    if (SB.diagRow.style.display !== 'flex') SB.diagRow.style.display = 'flex';
    const nowMs = performance.now();
    if (nowMs - _diagT0 >= 250) {
      _diagT0 = nowMs;
      transport.send('diag.ping|' + nowMs); // link probe; the PONG reply updates linkRttMs
      SB.sbdFps.textContent = fps.toFixed(0);
      SB.sbdLink.textContent = linkRttMs != null ? linkRttMs.toFixed(1) + ' ms' : '—';
      SB.sbdCtrl.textContent = (s.gpsToPgnLatencyMs || 0).toFixed(1) + ' ms';
    }
  } else if (SB.diagRow.style.display !== 'none') {
    SB.diagRow.style.display = 'none';
  }
}
// Heading in AgOpen 000.0° form (constant width). Input degrees, any sign.
function fmtHdg(deg) {
  const d = ((deg % 360) + 360) % 360;
  return d.toFixed(1).padStart(5, '0') + '°';
}
// Simulator bar (Phase 6) — reflect host sim state onto the bar each frame.
function renderSimBar() {
  const s = statusBar;
  if (!s || s.simPanelVisible === false) return;
  SIM.enable.classList.toggle('on', !!s.simEnabled);
  SIM.tenx.classList.toggle('on', !!s.sim10x);
  // Steer: reflect the host value unless the user is mid-drag (don't fight them).
  if (!_steerDragging) {
    const deg = s.simSteerAngle || 0;
    SIM.steer.value = deg;
    SIM.steerVal.textContent = deg.toFixed(1) + '°';
  }
  // Speed readout: apply 10× then format per units (mirrors SimulatorSpeedDisplay).
  const eff = (s.simSpeedKph || 0) * (s.sim10x ? 10 : 1);
  SIM.speedVal.textContent = fmtUnit(eff, 'kmh', 1);
  // GPS (teleport) only while sim disabled — matches the native IsEnabled binding.
  SIM.gps.disabled = !!s.simEnabled;
  SIM.gps.style.opacity = s.simEnabled ? '0.4' : '1';
}
// Section bar (Phase 7). Rebuild rows when the count changes; split rows like the
// native RebuildSectionRows: ceil(n/16) rows, top rows get the extra when uneven.
let _secCount = -1;
function buildSectionRows(n) {
  sectionBar.innerHTML = '';
  const rows = Math.ceil(n / 16);             // 1..4
  const base = Math.floor(n / rows), rem = n % rows; // first `rem` rows get +1
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const count = base + (r < rem ? 1 : 0);
    const row = document.createElement('div');
    row.className = 'sec-row';
    for (let k = 0; k < count; k++, idx++) {
      const b = document.createElement('button');
      b.className = 'sec-btn';
      b.dataset.idx = idx;
      b.textContent = idx + 1;                // 1-based section number
      row.appendChild(b);
    }
    sectionBar.appendChild(row);
  }
}
// Zone mode (Tool config → Zones): one button per zone instead of per section, like
// AgOpenGPS's zone buttons (#111). Zone z = sections zoneRanges[z-1]..zoneRanges[z]-1.
function zoneLayout() {
  const t = config && config.tool;
  if (!t || t.isSectionsNotZones !== false || !t.zoneRanges) return null;
  const n = Math.max(1, Math.min(8, t.zones | 0));
  const zones = [];
  for (let z = 1; z <= n; z++) zones.push({ z, start: z === 1 ? 0 : t.zoneRanges[z - 1], end: t.zoneRanges[z] });
  return zones;
}
function buildZoneRow(zones) {
  sectionBar.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'sec-row';
  for (const zn of zones) {
    const b = document.createElement('button');
    b.className = 'sec-btn';
    b.dataset.zone = zn.z; b.dataset.last = Math.max(0, zn.end - 1);
    b.textContent = 'Z' + zn.z;
    row.appendChild(b);
  }
  sectionBar.appendChild(row);
}
function renderSectionBar() {
  // Native gate: field open AND a master (auto or manual) engaged.
  const secs = tick && tick.sections;
  const visible = !!(scene && scene.hasField && tick && tick.op
    && (tick.op.sectionManual || tick.op.sectionAuto) && secs && secs.length);
  sectionBar.classList.toggle('open', visible);
  if (!visible) { _secCount = -1; return; } // force a rebuild when it reappears
  const zones = zoneLayout();
  const key = zones ? 'z' + JSON.stringify(zones) : secs.length;
  if (key !== _secCount) { if (zones) buildZoneRow(zones); else buildSectionRows(secs.length); _secCount = key; }
  for (const b of sectionBar.querySelectorAll('button[data-idx]'))
    b.style.background = SECTION_COLORS[secs[+b.dataset.idx]] || SECTION_COLORS[0];
  for (const b of sectionBar.querySelectorAll('button[data-zone]')) // zone colour = its last section
    b.style.background = SECTION_COLORS[secs[+b.dataset.last]] || SECTION_COLORS[0];
  sectionBar.classList.toggle('locked', !iHoldControl); // dim when we can't actuate
  renderIsobusSections();
}
// Under the section buttons: what the ISOBUS implement reports for its own sections
// (PGN 240), so a section that didn't follow its command shows (#312). One cell per
// implement section, which need not be the app's section count.
function renderIsobusSections() {
  const iso = statusBar && statusBar.isobus;
  let row = sectionBar.querySelector('.sec-iso');
  if (!iso || !iso.sections) { if (row) row.remove(); return; }
  if (!row || +row.dataset.n !== iso.reported.length) {
    if (row) row.remove();
    row = document.createElement('div');
    row.className = 'sec-iso'; row.dataset.n = iso.reported.length;
    const label = document.createElement('span');
    label.className = 'sec-iso-label'; label.textContent = 'ISOBUS';
    const cells = document.createElement('div');
    cells.className = 'sec-iso-cells';
    for (let i = 0; i < iso.reported.length; i++) {
      const c = document.createElement('div'); c.className = 'sec-iso-cell'; cells.appendChild(c);
    }
    row.appendChild(label); row.appendChild(cells);
    sectionBar.appendChild(row);
  }
  const cells = row.querySelectorAll('.sec-iso-cell');
  for (let i = 0; i < cells.length; i++) cells[i].classList.toggle('on', !!iso.reported[i]);
}
// Bottom nav (Phase 8). Swap icons only on change; reflect Tick toggle state.
function bnIcon(img, name) { const p = '/icons/' + name; if (img && !img.src.endsWith(p)) img.src = p; }
const TRAM_ICONS = ['TramOff.png', 'TramAll.png', 'TramLines.png', 'TramOuter.png'];
function renderBottomNav() {
  applyOnScreenButtons(); // U-Turn / Lateral glyphs follow field-open + display toggles
  const visible = !!(scene && scene.hasField); // native gate: IsFieldOpen
  bottomNav.classList.toggle('open', visible);
  if (!visible) { bnFlags.classList.remove('open'); bnAb.classList.remove('open'); return; }
  // AB-line-dependent buttons appear only with an active track.
  const hasTrack = !!(tick && tick.activeTrackName);
  for (const el of bottomNav.querySelectorAll('.bn-abdep')) el.classList.toggle('hide', !hasTrack);
  const t = (tick && tick.tools) || {};
  document.getElementById('bn-skipnum').textContent = t.skipRows || 0;
  // Nudge readout (#93): driver-relative offset, cm (metric) / in (imperial), L/R side.
  const nudgeM = (tick && tick.op && tick.op.nudgeOffset) || 0;
  const nudgeAmt = Math.round(Math.abs(nudgeM) * (isMetric() ? 100 : 39.3701));
  document.getElementById('bn-nudgeval').textContent =
    nudgeAmt === 0 ? '0' : nudgeAmt + (nudgeM < 0 ? ' L' : ' R');
  // AgOpenGPS skip-button icons: normal / alternative / ignore worked tracks (#111).
  bnIcon(document.getElementById('bn-skip-ic'), ['YouSkipOff.png', 'YouSkipOn.png', 'YouSkipWorkedTracks.png'][t.skipMode | 0] || 'YouSkipOff.png');
  // Icon shows the PAINTING state, not the raw flag: sectionInHeadland (=Tool.
  // IsHeadlandSectionControl) true means sections AUTO-OFF in the headland (NOT
  // painted) → the "Off" icon; false means sections paint the headland → "On".
  bnIcon(document.getElementById('bn-secheadland-ic'), t.sectionInHeadland ? 'HeadlandSectionOff.png' : 'HeadlandSectionOn.png');
  bnIcon(document.getElementById('bn-headland-ic'), t.headlandOn ? 'HeadlandOn.png' : 'HeadlandOff.png');
  bnIcon(document.getElementById('bn-tram-ic'), TRAM_ICONS[t.tramMode || 0]);
  bottomNav.classList.toggle('locked', !iHoldControl);
}

// Right-nav operational toolbar (Phase 3a: read-only live indicators; 3b wires the
// Tier-2 commands). Colour-coded from the Tick's operational state.
const RN = {
  root: document.getElementById('rightnav'),
  contourI: document.getElementById('rn-contour-i'), manualI: document.getElementById('rn-manual-i'),
  contourLock: document.getElementById('rn-contourlock'), contourLockI: document.getElementById('rn-contourlock-i'),
  autoI: document.getElementById('rn-auto-i'), youturnI: document.getElementById('rn-youturn-i'),
  isobus: document.getElementById('rn-isobus'), isobusI: document.getElementById('rn-isobus-i'),
  cycle: document.getElementById('rn-cycle'), cycleBack: document.getElementById('rn-cycleback'),
  autoTrack: document.getElementById('rn-autotrack'), autoTrackI: document.getElementById('rn-autotrack-i'),
  steerI: document.getElementById('rn-steer-i'), readonly: document.getElementById('rn-readonly'),
};
// Swap an icon only when it actually changes (no per-frame churn).
function rnIcon(img, name) { if (img && !img.src.endsWith(name)) img.src = '/icons/' + name; }
function renderRightNav() {
  if (!RN.root) return;
  const op = tick && tick.op;
  if (!op || !scene || !scene.hasField) { RN.root.style.display = 'none'; return; }
  RN.root.style.display = 'flex';
  // Dim + hint when we don't hold control (buttons are no-ops then; the host also gates).
  RN.root.classList.toggle('locked', !iHoldControl);
  if (RN.readonly) RN.readonly.textContent = iHoldControl ? '' : tr('observing');
  // State carried by the icon image (native uses the same On/Off/Gray PNGs).
  rnIcon(RN.contourI, op.contour ? 'ContourOn.png' : 'ContourOff.png');
  // Contour lock shows only in contour mode, and U-turn hides then (AgOpenGPS) (#110).
  RN.contourLock.style.display = op.contour ? '' : 'none';
  rnIcon(RN.contourLockI, scene.contourLocked ? 'ColorLocked.png' : 'ColorUnlocked.png');
  RN.youturnI.parentElement.style.display = op.contour ? 'none' : '';
  // Track picking (#336), AgOpenGPS's rule: two or more visible tracks, one active, no contour.
  const tl = scene.trackList || [];
  const visible = tl.filter(t => t.visible);
  const activeName = tick.activeTrackName || '';
  const showPick = visible.length > 1 && !!activeName && !op.contour;
  for (const b of [RN.cycle, RN.cycleBack, RN.autoTrack]) b.style.display = showPick ? '' : 'none';
  rnIcon(RN.autoTrackI, tick.tools && tick.tools.autoTrack ? 'AutoTrack.png' : 'AutoTrackOff.png');
  // Name and "n/total" after a cycle tap, like AgOpenGPS's guidance-line label.
  if (activeName !== rnLastTrack) {
    if (rnLastTrack !== null && Date.now() - rnCycleAt < 2000) {
      const n = visible.findIndex(t => t.name === activeName) + 1;
      flashHint(n > 0 ? activeName + '  ' + n + '/' + visible.length : activeName);
    }
    rnLastTrack = activeName;
  }
  rnIcon(RN.manualI, op.sectionManual ? 'ManualOn.png' : 'ManualOff.png');
  rnIcon(RN.autoI, op.sectionAuto ? 'SectionMasterOn.png' : 'SectionMasterOff.png');
  rnIcon(RN.youturnI, op.youturn ? 'YouTurnYes.png' : 'YouTurnNo.png');
  // ISOBUS task controller (#312): the button is there while its heartbeat is heard, like
  // AgOpenGPS. Idle = no implement with sections; otherwise section control on / off.
  const iso = statusBar && statusBar.isobus;
  RN.isobus.style.display = iso ? '' : 'none';
  if (iso) {
    rnIcon(RN.isobusI, !iso.sections ? 'IsobusSectionControlIdle.png'
      : iso.sectionControl ? 'IsobusSectionControlOn.png' : 'IsobusSectionControlOff.png');
    const tip = !iso.sections ? tr('ISOBUS: no implement')
      : iso.sectionControl ? tr('ISOBUS section control on ({n} sections)', { n: iso.sections })
      : tr('ISOBUS section control off ({n} sections)', { n: iso.sections });
    if (RN.isobus.title !== tip) RN.isobus.title = tip;
  }
  // U-turn direction + distance-to-trigger now render on-screen (see renderUTurnIndicator).
  // AutoSteer 3-state icon: grey (no track) / off-ready / on-engaged.
  rnIcon(RN.steerI, !op.autoSteerAvail ? 'AutoSteerGray.png' : op.autoSteer ? 'AutoSteerOn.png' : 'AutoSteerOff.png');
  // Engaged but the module isn't steering (kickout / switch / button): red, like
  // AgOpenGPS's steer circle (#126).
  RN.steerI.parentElement.classList.toggle('not-steering', !!(op.autoSteer && op.moduleNotSteering));
}

// Auto-U-turn approach indicator (upper-right): green direction arrow + distance to
// trigger + turn-type glyph. Mirrors native's on-map readout; shown while auto U-turn is
// armed with a pending turn. Turn type comes from config (Omega / Sagitta); distance honours
// the metric/imperial unit like the headland HUD.
const UTI = {
  root: document.getElementById('uturn-indicator'),
  arrow: document.getElementById('uti-arrow'),
  dist: document.getElementById('uti-distval'),
  typePath: document.getElementById('uti-typepath'),
};
// A tap on the arrow swaps the planned turn's direction, as in AgOpenGPS (SwapDirection, #411).
// The host replans the turn and the arrow follows the new path's side.
if (UTI.arrow) UTI.arrow.parentElement.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation(); rnSend('youturn.direction');
});
const UTURN_GLYPH = {
  0: 'M7 34 Q7 20 20 20 Q33 20 33 34',         // Sagitta (default) — flatter rounded arch
  1: 'M9 34 L9 22 A11 11 0 0 1 31 22 L31 34',  // K-turn — squared/tighter inverted-U
  2: 'M15 34 A9 9 0 1 1 25 34',                 // Keyhole — loop centred over a narrow neck
};
function renderUTurnIndicator() {
  if (!UTI.root) return;
  const op = tick && tick.op;
  const show = !!(scene && scene.hasField && op && op.youturn && op.distToTrigger > 0);
  UTI.root.hidden = !show;
  if (!show) return;
  UTI.dist.textContent = fmtUnit(op.distToTrigger, 'm', 0);
  UTI.arrow.classList.toggle('left', !!op.turnLeft);
  const style = (config && config.uturn && config.uturn.style) || 0;
  UTI.typePath.setAttribute('d', UTURN_GLYPH[style] || UTURN_GLYPH[0]);
}
// ---- Lower-right cluster (Phase 4): roll gauge + camera/mode pad + clock ----
const rollBar = document.getElementById('roll-bar');
const rollDeg = document.getElementById('roll-deg');
function renderRoll() {
  const r = (tick && typeof tick.roll === 'number') ? tick.roll : 0;
  if (rollBar) rollBar.setAttribute('transform', 'rotate(' + r.toFixed(2) + ' 100 40)');
  if (rollDeg) rollDeg.textContent = r.toFixed(1);
}
const cpMode = document.getElementById('cp-mode');
function camModeLabel() { return cameraMode === 1 ? 'H' : cameraMode === 0 ? 'N' : cameraMode === 3 ? 'M' : 'C'; }
function renderCampad() {
  if (!cpMode) return;
  cpMode.textContent = camModeLabel();          // H / N / M / C (native labels)
  cpMode.classList.toggle('free', cameraMode === 2);
}
// Camera pad drives the client-owned camera (pitch / zoom / follow) — no host commands.
(function wireCampad() {
  const pad = document.getElementById('campad');
  if (!pad) return;
  pad.addEventListener('pointerdown', e => e.stopPropagation()); // don't pan the map
  // Bind on POINTERDOWN, not click: the NativeWebView launcher (touch) doesn't reliably fire
  // `click`, so these camera buttons — notably the mode/heading cycle — did nothing when tapped
  // on the launcher build (issue #56). pointerdown is the same event the rest of the touch UI
  // uses; the pad's stopPropagation above already keeps it from panning the map.
  document.getElementById('cp-tiltup').addEventListener('pointerdown', () => { pitch = Math.max(0, pitch - PITCH_STEP); });
  document.getElementById('cp-tiltdown').addEventListener('pointerdown', () => {
    pitch = Math.min(MAX_PITCH, pitch + PITCH_STEP);
  });
  document.getElementById('cp-zoomin').addEventListener('pointerdown', () => { pxPerM = Math.min(200, pxPerM * 1.2); });
  document.getElementById('cp-zoomout').addEventListener('pointerdown', () => { pxPerM = Math.max(0.2, pxPerM * 0.83); });
  // Center: cycle the four native modes H → N → M → C → H; recenter on follow modes.
  document.getElementById('cp-mode').addEventListener('pointerdown', () => {
    cameraMode = cameraMode === 1 ? 0 : cameraMode === 0 ? 3 : cameraMode === 3 ? 2 : 1;
    if (cameraMode !== 2) { const rp = renderPose(); if (rp) { camE = rp.e; camN = rp.n; } }
  });
})();
// ── Diagnostic charts (Tools panel) ─────────────────────────────────────────
// Thin-client port of the native ChartControl: the host streams the scalar
// series sources on each Tick (see TickDto chart fields); we keep a rolling
// display buffer per series and redraw the open chart cards each frame to a 2D
// canvas. Configs mirror the native *ChartPanel.ConfigureChart() calls 1:1.
const CHART_WINDOW = 20; // seconds (IChartDataService.TimeWindowSeconds default)
const CHARTS = {
  steer: {
    title: tr('Steer'), yLabel: 'deg', minY: -40, maxY: 40, step: 10, auto: false,
    series: [
      // AgOpenGPS FormGraphSteer: set vs actual angle. PWM (0–255) doesn't belong on a
      // ±40° scale (#111).
      { name: tr('Set Angle'), color: '#E05020', pts: [] },
      { name: tr('Actual Angle'), color: '#2080E0', pts: [] },
    ],
  },
  heading: {
    title: tr('Heading'), yLabel: 'deg', minY: 0, maxY: 360, step: 45, auto: true,
    series: [
      // AgOpenGPS FormGraphHeading: GPS fix-to-fix vs IMU-corrected heading (#111).
      { name: tr('GPS Heading'), color: '#0088AA', pts: [] },
      { name: tr('IMU Heading'), color: '#D07020', pts: [] },
    ],
  },
  xte: {
    title: tr('XTE'), yLabel: 'm', minY: -2, maxY: 2, step: 0.5, auto: true,
    series: [{ name: tr('XTE'), color: '#C020C0', pts: [] }],
  },
};
const chartOpen = { steer: false, heading: false, xte: false };

// Buffer the latest Tick into every series (always, even while a card is closed,
// so opening mid-session shows recent history — matches ChartDataService.Start()).
function pushChartData(t) {
  const now = performance.now() / 1000;
  const vals = {
    steer: [t.chartSetSteer, t.chartActualSteer],
    heading: [t.chartGpsHeading, t.chartImuHeading],
    xte: [toDisplayUnit(t.crossTrackError, 'm')],   // plot in the active length unit
  };
  const trim = now - CHART_WINDOW - 2;
  for (const key in CHARTS) {
    const arr = vals[key];
    const series = CHARTS[key].series;
    for (let i = 0; i < series.length; i++) {
      const pts = series[i].pts;
      if (Number.isFinite(arr[i])) pts.push({ t: now, v: arr[i] }); // no IMU → no IMU line
      let cut = 0; while (cut < pts.length && pts[cut].t < trim) cut++;
      if (cut) pts.splice(0, cut);
    }
  }
}

function setChartOpen(key, open) {
  chartOpen[key] = open;
  document.getElementById('chart-' + key).style.display = open ? 'block' : 'none';
  const btn = document.querySelector('.tl-chartbtn[data-chart="' + key + '"]');
  if (btn) btn.classList.toggle('active', open);
}
function toggleChart(key) { setChartOpen(key, !chartOpen[key]); }
// Reflect open/closed state on the Tools fly-out chart buttons when it opens.
function renderToolsPanel() {
  for (const key in chartOpen) {
    const btn = document.querySelector('.tl-chartbtn[data-chart="' + key + '"]');
    if (btn) btn.classList.toggle('active', chartOpen[key]);
  }
}

function chartNiceStep(range, targetLines) {
  const raw = range / targetLines;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm <= 1.5 ? 1 : norm <= 3.5 ? 2 : norm <= 7.5 ? 5 : 10;
  return nice * mag;
}

function drawChart(cv, c) {
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = 400, H = 150;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = '10px system-ui,sans-serif';
  ctx.textBaseline = 'alphabetic';

  // Background + frame.
  ctx.fillStyle = '#10141d';
  ctx.fillRect(0, 0, W, H);

  const L = 50, R = 10, T = 8, B = 20;
  const cl = L, cr = W - R, ctop = T, cbot = H - B;
  const cw = cr - cl, ch = cbot - ctop;
  if (cw <= 0 || ch <= 0) return;

  // Y range (auto-scale mirrors native ComputeAutoScale: 10% pad + nice step).
  let minY = c.minY, maxY = c.maxY, step = c.step;
  if (c.auto) {
    let dmin = Infinity, dmax = -Infinity;
    for (const s of c.series) for (const p of s.pts) { if (p.v < dmin) dmin = p.v; if (p.v > dmax) dmax = p.v; }
    if (dmin !== Infinity) {
      let range = dmax - dmin; if (range < 1) range = 1;
      const pad = range * 0.1;
      minY = dmin - pad; maxY = dmax + pad;
      step = chartNiceStep(maxY - minY, 5);
    }
  }
  let yRange = maxY - minY; if (yRange <= 0) yRange = 1;

  const now = performance.now() / 1000;
  const timeStart = now - CHART_WINDOW;

  // Horizontal grid + Y labels.
  ctx.strokeStyle = 'rgba(140,155,180,0.25)'; ctx.lineWidth = 0.5;
  ctx.fillStyle = '#aeb8c8'; ctx.textAlign = 'right';
  const fmt = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const firstY = Math.ceil(minY / step) * step;
  for (let val = firstY; val <= maxY + 1e-9; val += step) {
    const y = cbot - ((val - minY) / yRange * ch);
    ctx.beginPath(); ctx.moveTo(cl, y); ctx.lineTo(cr, y); ctx.stroke();
    ctx.fillText(val.toFixed(fmt), cl - 4, y + 3);
  }

  // Zero line.
  if (minY < 0 && maxY > 0) {
    const zy = cbot - ((-minY) / yRange * ch);
    ctx.strokeStyle = 'rgba(206,214,230,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cl, zy); ctx.lineTo(cr, zy); ctx.stroke();
  }

  // Series polylines (clipped to chart area).
  ctx.save();
  ctx.beginPath(); ctx.rect(cl, ctop, cw, ch); ctx.clip();
  ctx.lineWidth = 1.5;
  for (const s of c.series) {
    if (s.pts.length < 2) continue;
    ctx.strokeStyle = s.color;
    ctx.beginPath();
    let started = false;
    for (const p of s.pts) {
      if (p.t < timeStart) continue;
      const x = cl + ((p.t - timeStart) / CHART_WINDOW * cw);
      const y = cbot - ((p.v - minY) / yRange * ch);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    if (started) ctx.stroke();
  }
  ctx.restore();

  // Border.
  ctx.strokeStyle = 'rgba(140,155,180,0.4)'; ctx.lineWidth = 1;
  ctx.strokeRect(cl, ctop, cw, ch);

  // Title (top-left of chart area).
  ctx.fillStyle = '#aeb8c8'; ctx.textAlign = 'left';
  ctx.font = '11px system-ui,sans-serif';
  ctx.fillText(I18n.text(c.title), cl + 4, ctop + 11);

  // Legend (top-right, right-to-left).
  ctx.font = '9px system-ui,sans-serif';
  let lx = cr - 8;
  for (let i = c.series.length - 1; i >= 0; i--) {
    const s = c.series[i];
    const name = I18n.text(s.name); // drawn on the canvas, so translated here
    const tw = ctx.measureText(name).width;
    lx -= tw;
    ctx.fillStyle = s.color;
    ctx.textAlign = 'left';
    ctx.fillText(name, lx, ctop + 9);
    ctx.strokeStyle = s.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(lx - 14, ctop + 6); ctx.lineTo(lx - 4, ctop + 6); ctx.stroke();
    lx -= 22;
  }

  // Time labels (relative seconds, −window … 0).
  ctx.fillStyle = '#aeb8c8'; ctx.textAlign = 'center'; ctx.font = '9px system-ui,sans-serif';
  const labelCount = 5;
  for (let i = 0; i <= labelCount; i++) {
    const frac = i / labelCount;
    const x = cl + frac * cw;
    const rel = Math.round(-CHART_WINDOW + frac * CHART_WINDOW);
    ctx.fillText(rel + 's', x, cbot + 13);
    ctx.strokeStyle = 'rgba(140,155,180,0.25)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x, ctop); ctx.lineTo(x, cbot); ctx.stroke();
  }
}

function renderCharts() {
  for (const key in chartOpen) {
    if (!chartOpen[key]) continue;
    const cv = document.getElementById('chart-' + key).querySelector('.chart-cv');
    drawChart(cv, CHARTS[key]);
  }
}

// Roll Correction panel: live gauge + offset/invert readouts (only when open).
// Mirrors the wizard roll-cal step; the bar rotates by the live (post-calibration)
// roll the same way the map roll gauge does.
function renderRollCorr() {
  const panel = document.getElementById('rollcorr');
  if (!panel.classList.contains('open')) return;
  const rv = (tick && typeof tick.roll === 'number') ? tick.roll : 0;
  const bar = document.getElementById('rc-roll-bar');
  if (bar) bar.setAttribute('transform', 'rotate(' + rv.toFixed(2) + ' 100 40)');
  const deg = document.getElementById('rc-roll-deg');
  if (deg) deg.textContent = rv.toFixed(1);
  const roll = (config && config.roll) || {};
  const off = document.getElementById('rc-offset');
  if (off) off.textContent = (typeof roll.rollZero === 'number' ? roll.rollZero : 0).toFixed(2) + '°';
  const inv = document.getElementById('rc-invert');
  if (inv) { const on = !!roll.isRollInvert; inv.classList.toggle('on', on); inv.textContent = on ? tr('On') : tr('Off'); }
}

// Offset Fix: reflect the live drift offset into the manual inputs (unless the user is
// editing that field). Drift rides the Status frame.
function renderOffsetFix() {
  if (!document.getElementById('offsetfix').classList.contains('open')) return;
  if (!statusBar) return;
  const ns = document.getElementById('of-ns-in'), ew = document.getElementById('of-ew-in');
  if (document.activeElement !== ns) writeUnitInput(ns, statusBar.driftNorthing || 0);
  if (document.activeElement !== ew) writeUnitInput(ew, statusBar.driftEasting || 0);
}

// Import Tracks: list the other fields that have saved tracks; tap one to copy its
// tracks into the open field (host ImportTracksFromFieldCommand transforms origins).
function renderImportTracks() {
  const list = document.getElementById('it-list'); list.innerHTML = '';
  const fields = fieldTools ? fieldTools.importFields : [];
  if (!fields || !fields.length) {
    list.innerHTML = '<div class="fj-empty">No other fields with tracks found.</div>';
    return;
  }
  for (const name of fields) {
    const row = document.createElement('div');
    row.className = 'fj-jrow';
    row.innerHTML = '<div class="fj-jtop"><span class="fj-jname"></span></div>';
    row.querySelector('.fj-jname').textContent = name;
    row.addEventListener('pointerdown', ev => {
      ev.stopPropagation();
      transport.send('field.importTracks|' + name);
      lnCloseAll();
    });
    list.appendChild(row);
  }
}

// Recorded Path: GPS-driven record + playback. All state
// comes from the host-driven RecordedPath frame; the name field is local input.
function renderRecPath() {
  const r = recPath || { recFiles: [], isRecording: false, isPlaying: false, hasUnsaved: false, recordedPathInfo: '', resumeModeLabel: 'Start' };
  document.getElementById('rp-tab-rec').classList.toggle('active', recPathTab === 0);
  document.getElementById('rp-tab-play').classList.toggle('active', recPathTab === 1);
  document.getElementById('rp-record').classList.toggle('active', recPathTab === 0);
  document.getElementById('rp-play').classList.toggle('active', recPathTab === 1);
  // Record tab.
  document.getElementById('rp-start').style.display = r.isRecording ? 'none' : '';
  document.getElementById('rp-stop').style.display = r.isRecording ? '' : 'none';
  document.getElementById('rp-recind').style.display = r.isRecording ? 'block' : 'none';
  document.getElementById('rp-saverow').style.display = r.hasUnsaved ? 'flex' : 'none';
  // Auto-fill the Save-as name from the host's generated default (native parity), but
  // don't clobber the user mid-edit.
  const nameIn = document.getElementById('rp-name');
  if (document.activeElement !== nameIn && r.recordedPathName) nameIn.value = r.recordedPathName;
  // Playback tab.
  document.getElementById('rp-playimg').src = r.isPlaying ? '/icons/RecPathStop.png' : '/icons/RecPathPlay.png';
  document.getElementById('rp-playlbl').textContent = r.isPlaying ? tr('Stop') : tr('Play');
  document.getElementById('rp-playbtn').classList.toggle('disabled', !iHoldControl);
  document.getElementById('rp-resumelbl').textContent = r.resumeModeLabel || tr('Start');
  const list = document.getElementById('rp-list'); list.innerHTML = '';
  if (!r.recFiles || !r.recFiles.length) {
    list.innerHTML = '<div class="fj-empty">No saved paths.</div>';
  } else {
    for (const name of r.recFiles) {
      const row = document.createElement('div');
      row.className = 'fj-jrow rp-frow' + (name === recSelFile ? ' sel' : '');
      row.innerHTML = '<span class="fj-jname"></span><button class="rp-del" title="Delete">🗑</button>';
      row.querySelector('.fj-jname').textContent = name;
      row.querySelector('.fj-jname').addEventListener('pointerdown', ev => {
        ev.stopPropagation(); recSelFile = name; transport.send('recpath.selectFile|' + name); renderRecPath();
      });
      row.querySelector('.rp-del').addEventListener('pointerdown', ev => {
        ev.stopPropagation();
        showConfirm(tr('Delete Recorded Path'), tr('Delete "{name}"? This cannot be undone.', { name }), () => {
          if (recSelFile === name) recSelFile = null;
          transport.send('recpath.delete|' + name);
        });
      });
      list.appendChild(row);
    }
  }
  document.getElementById('rp-info').textContent = r.recordedPathInfo || '';
}

// Boundary recording menu: the field's boundaries (Outer / Inner N) with area + the
// Drive-Thru / Hard flags. Tap a row to select; tap a flag cell to select + toggle it.
function renderBoundaryMenu() {
  const b = boundary;
  const list = document.getElementById('bm-list'); list.innerHTML = '';
  const items = b ? b.items : [];
  if (!items.length) { list.innerHTML = '<div class="fj-empty">No boundaries yet — drive around the field to record one.</div>'; return; }
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'bm-row' + (b && it.index === b.selectedIndex ? ' sel' : '');
    row.innerHTML = '<span class="bm-name"></span><span class="bm-area"></span>'
      + '<span class="bm-flag ' + (it.driveThru ? 'on' : 'off') + '" data-flag="driveThru"></span>'
      + '<span class="bm-flag ' + (it.hard ? 'on' : 'off') + '" data-flag="hard"></span>';
    row.querySelector('.bm-name').textContent = it.boundaryType;
    row.querySelector('.bm-area').textContent = fmtUnit(it.areaHa, 'ha');
    row.querySelector('[data-flag="driveThru"]').textContent = it.driveThru ? tr('Yes') : '--';
    row.querySelector('[data-flag="hard"]').textContent = it.hard ? tr('Hard') : tr('Soft');
    row.addEventListener('pointerdown', ev => { ev.stopPropagation(); transport.send('boundary.select|' + it.index); });
    row.querySelector('[data-flag="driveThru"]').addEventListener('pointerdown', ev => {
      ev.stopPropagation(); transport.send('boundary.select|' + it.index); transport.send('boundary.driveThru');
    });
    row.querySelector('[data-flag="hard"]').addEventListener('pointerdown', ev => {
      ev.stopPropagation(); transport.send('boundary.select|' + it.index); transport.send('boundary.hard');
    });
    list.appendChild(row);
  }
}

// Boundary player: live drive-around recording controls + point count / area.
function renderBoundaryPlayer() {
  const b = boundary; if (!b) return;
  const off = document.getElementById('bp-offset');
  if (document.activeElement !== off) writeUnitInput(off, b.offsetCm || 0);
  document.getElementById('bp-section').classList.toggle('on', b.sectionControlOn);
  document.getElementById('bp-lrimg').src = b.drawRightSide ? '/icons/BoundaryRight.png' : '/icons/BoundaryLeft.png';
  document.getElementById('bp-atimg').src = b.drawAtPivot ? '/icons/BoundaryRecordPivot.png' : '/icons/BoundaryRecordTool.png';
  document.getElementById('bp-points').textContent = b.pointCount;
  document.getElementById('bp-area').textContent = fmtUnit(b.areaHa || 0, 'ha');
  document.getElementById('bp-recimg').src = b.isRecording ? '/icons/boundaryPause.png' : '/icons/BoundaryRecord.png';
}

// Drag chart cards by the header (web docks ln-panels, but charts are free overlays
// like the native FloatingPanel so the operator can move them out of the way). The VT cards,
// made later, use wireCardDrag too.
// The card touched last is on top of the other cards (29, the cards' layer; the others one
// below it, still above the map's overlays at 20 and under the panels from 30 up).
function raiseCard(card) {
  // Every card each time: one added since (a VT card) starts at the stylesheet's 29 too.
  for (const c of document.querySelectorAll('.chart-card')) c.style.zIndex = c === card ? '29' : '28';
}
function wireCardDrag(card) {
  const hdr = card.querySelector('.chart-hdr');
  let drag = false, sx = 0, sy = 0, ox = 0, oy = 0;
  card.addEventListener('pointerdown', e => { e.stopPropagation(); raiseCard(card); }); // don't pan the map
  hdr.addEventListener('pointerdown', e => {
    raiseCard(card); // the card's own handler doesn't hear it
    if (e.target.closest('button, select')) return;
    e.stopPropagation();
    const r = zoomRect(card);
    // zoomRect and clientX are screen pixels; left/top are in the card's own (zoomed)
    // pixels.
    drag = true; sx = e.clientX; sy = e.clientY; ox = r.left / uiZoom; oy = r.top / uiZoom;
    card.style.left = ox + 'px'; card.style.top = oy + 'px'; card.style.right = 'auto';
    try { hdr.setPointerCapture(e.pointerId); } catch (_) {}
  });
  hdr.addEventListener('pointermove', e => {
    if (!drag) return;
    card.style.left = (ox + (e.clientX - sx) / uiZoom) + 'px';
    card.style.top = (oy + (e.clientY - sy) / uiZoom) + 'px';
  });
  const end = e => { drag = false; try { hdr.releasePointerCapture(e.pointerId); } catch (_) {} };
  hdr.addEventListener('pointerup', end);
  hdr.addEventListener('pointercancel', end);
}
for (const id of ['chart-steer', 'chart-heading', 'chart-xte']) wireCardDrag(document.getElementById(id));

// ---- VT painter ----
// The virtual terminal's draw list (screens, soft keys, list options) painted in Canvas 2D: no
// ISOBUS knowledge, the items in order. From SharpIsoTerm's reference painter
// (painter/vtpaint.js, bc508cf, MIT); keep the two in step when the draw list changes.
//   images.add(id, w, h, rgba) · vtPaintMask(ctx, screen, images) · vtPaintKey(ctx, keys, i, images)
//   vtPaintItems(ctx, items, images) · vtHit(items, x, y)

class VtImages {
  constructor() { this.byId = new Map(); }
  add(id, w, h, rgba) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
    this.byId.set(id, c);
  }
  get(id) { return this.byId.get(id); }
}

// The 16 pixel line art pattern as dash lengths, most significant bit first.
function vtDash(pattern) {
  const runs = [];
  let bit = (pattern >> 15) & 1, run = 0;
  if (!bit) runs.push(0); // a dash list starts with a drawn run
  for (let i = 15; i >= 0; i--) {
    const b = (pattern >> i) & 1;
    if (b === bit) run++;
    else { runs.push(run); bit = b; run = 1; }
  }
  runs.push(run);
  return runs;
}

function vtStroke(ctx, it) {
  if (!it.line || !it.lw) return false;
  ctx.strokeStyle = it.line;
  ctx.lineWidth = it.lw;
  ctx.setLineDash(it.dash !== undefined ? vtDash(it.dash) : []);
  return true;
}

function vtFill(ctx, it, images) {
  if (it.pat) {
    const img = images.get(it.pat);
    if (!img) return false;
    ctx.fillStyle = ctx.createPattern(img, "repeat");
    return true;
  }
  if (!it.fill) return false;
  ctx.fillStyle = it.fill;
  return true;
}

// Text in a box of fixed font cells: a monospace face stretched to the cell.
function vtText(ctx, it) {
  const style = it.style || 0;
  let c = it.c || "#000000", bg = it.bg;
  if (style & 16 && bg) [c, bg] = [bg, c]; // inverted
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(it.x, it.y, it.w, it.h); }
  const fw = it.fw || 8, fh = it.fh || 8;
  const perLine = Math.max(1, Math.floor(it.w / fw));
  let lines = [];
  for (const para of it.s.split(/\r\n|\n|\r/)) {
    if (!it.wrap || para.length <= perLine) { lines.push(para); continue; }
    let rest = para;
    while (rest.length > perLine) {
      let cut = rest.lastIndexOf(" ", perLine);
      if (cut <= 0) cut = perLine;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^ /, "");
    }
    lines.push(rest);
  }
  lines = lines.slice(0, Math.max(1, Math.floor(it.h / fh)));
  const total = lines.length * fh;
  let y = it.vj === 1 ? it.y + (it.h - total) / 2 : it.vj === 2 ? it.y + it.h - total : it.y;
  ctx.save();
  ctx.beginPath();
  ctx.rect(it.x, it.y, it.w, it.h);
  ctx.clip();
  ctx.font = `${style & 8 ? "italic " : ""}${style & 1 ? "bold " : ""}${fh}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = "alphabetic";
  const advance = ctx.measureText("M").width || fh / 2;
  const sx = fw / advance;
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  ctx.lineWidth = Math.max(1, fh / 12);
  for (const line of lines) {
    const width = line.length * fw;
    const x = it.hj === 1 ? it.x + (it.w - width) / 2 : it.hj === 2 ? it.x + it.w - width : it.x;
    ctx.save();
    ctx.translate(x, y + fh * 0.8);
    ctx.scale(sx, 1);
    ctx.fillText(line, 0, 0);
    ctx.restore();
    if (style & 4) { ctx.beginPath(); ctx.moveTo(x, y + fh - 1); ctx.lineTo(x + width, y + fh - 1); ctx.stroke(); }
    if (style & 2) { ctx.beginPath(); ctx.moveTo(x, y + fh / 2); ctx.lineTo(x + width, y + fh / 2); ctx.stroke(); }
    y += fh;
  }
  ctx.restore();
}

function vtItem(ctx, it, images) {
  switch (it.t) {
    case "clip":
      ctx.save();
      ctx.beginPath();
      ctx.rect(it.x, it.y, it.w, it.h);
      ctx.clip();
      break;
    case "unclip":
      ctx.restore();
      break;
    case "rect": {
      if (vtFill(ctx, it, images)) ctx.fillRect(it.x, it.y, it.w, it.h);
      if (!vtStroke(ctx, it)) break;
      // The line lies inside the rectangle.
      const h = it.lw / 2, x0 = it.x + h, y0 = it.y + h, x1 = it.x + it.w - h, y1 = it.y + it.h - h;
      const sides = it.sides === undefined ? 15 : it.sides;
      if (sides === 15) { ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); break; }
      ctx.beginPath();
      if (sides & 1) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); }
      if (sides & 2) { ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); }
      if (sides & 4) { ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); }
      if (sides & 8) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); }
      ctx.stroke();
      break;
    }
    case "line":
      if (!vtStroke(ctx, it)) break;
      ctx.beginPath();
      ctx.moveTo(it.x1, it.y1);
      ctx.lineTo(it.x2, it.y2);
      ctx.stroke();
      break;
    case "ellipse": {
      // Angles count anticlockwise from 3 o'clock; the canvas's y axis points down.
      const rx = it.w / 2, ry = it.h / 2, cx = it.x + rx, cy = it.y + ry;
      const kind = it.kind || 0;
      const full = !kind || it.a0 === it.a1;
      const a0 = full ? 0 : (-it.a0 * Math.PI) / 180, a1 = full ? 2 * Math.PI : (-it.a1 * Math.PI) / 180;
      ctx.beginPath();
      if (kind === 3 && !full) ctx.moveTo(cx, cy);
      ctx.ellipse(cx, cy, Math.max(0, rx - (it.lw || 0) / 2), Math.max(0, ry - (it.lw || 0) / 2), 0, a0, a1, !full);
      if (kind !== 1) ctx.closePath();
      if (kind !== 1 && vtFill(ctx, it, images)) ctx.fill();
      if (vtStroke(ctx, it)) ctx.stroke();
      break;
    }
    case "poly": {
      const p = it.pts;
      if (p.length < 4) break;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      if (it.closed) ctx.closePath();
      if (it.closed && vtFill(ctx, it, images)) ctx.fill("evenodd");
      if (vtStroke(ctx, it)) ctx.stroke();
      break;
    }
    case "text":
      vtText(ctx, it);
      break;
    case "image": {
      const img = images.get(it.img);
      if (img) { ctx.imageSmoothingEnabled = false; ctx.drawImage(img, it.x, it.y, it.w, it.h); }
      break;
    }
    case "hit":
      if (!it.on) { ctx.fillStyle = "rgba(128,128,128,0.5)"; ctx.fillRect(it.x, it.y, it.w, it.h); }
      if (it.sel) {
        // The focus: a frame around the field, solid while it is open for input.
        ctx.setLineDash(it.open ? [] : [4, 3]);
        ctx.strokeStyle = "#ff8c00";
        ctx.lineWidth = 2;
        ctx.strokeRect(it.x + 1, it.y + 1, it.w - 2, it.h - 2);
        ctx.setLineDash([]);
      }
      break;
    case "box":
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "#ff00ff";
      ctx.lineWidth = 1;
      ctx.strokeRect(it.x + 0.5, it.y + 0.5, it.w - 1, it.h - 1);
      ctx.setLineDash([]);
      ctx.fillStyle = "#ff00ff";
      ctx.font = "10px sans-serif";
      ctx.fillText(it.label, it.x + 3, it.y + 12);
      break;
  }
}

function vtPaintItems(ctx, items, images) {
  ctx.save();
  for (const it of items) vtItem(ctx, it, images);
  ctx.restore();
}

function vtPaintMask(ctx, screen, images) {
  ctx.fillStyle = screen.bg || "#000000";
  ctx.fillRect(0, 0, screen.w, screen.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, screen.w, screen.h);
  ctx.clip();
  vtPaintItems(ctx, screen.items, images);
  ctx.restore();
}

// Soft key i of the screen's key mask; an empty place (null) shows the mask's background.
function vtPaintKey(ctx, keys, i, images) {
  const key = keys.keys[i];
  ctx.fillStyle = key ? key.bg : keys.bg;
  ctx.fillRect(0, 0, keys.w, keys.h);
  if (!key) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, keys.w, keys.h);
  ctx.clip();
  vtPaintItems(ctx, key.items, images);
  ctx.restore();
}

// The topmost touchable item at x, y (mask pixels), or null.
function vtHit(items, x, y) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.t === "hit" && x >= it.x && x < it.x + it.w && y >= it.y && y < it.y + it.h) return it;
  }
  return null;
}

// Virtual terminal cards: ISOBUS implements' own screens, one card per terminal (the host runs
// one to four, as displays in one cab; each implement chooses its terminal in its own menu). A
// terminal flattens its implement's object pool into draw lists (screen, soft keys, input
// editors) that the VT painter above paints; its card shows them and sends the operator's
// touches back (vt.* commands naming the terminal, which need control). The host repeats a held
// key and ends it if control goes. Hidden unless the host has terminals (its first link message
// says so, with how many).
const Vt = (() => {
  const navBtn = document.getElementById('ln-vt'), tpl = document.getElementById('vt-card-tpl');
  const SIZES = [320, 400, 480, 600];
  const PAGE = 12; // soft keys shown at once (the terminal's PhysicalKeys): two columns of six, 1-6 beside the mask
  let link = null, session = -1, images = new VtImages(); // picture ids are unique across terminals
  let audioCtx = null;
  const terms = []; // one per terminal: its card and what it shows

  // The cards to show: the link's count (one while there is no link, for the gateway editor).
  // The cards added after this browser's Connect open with the card it was pressed on.
  let openAdded = false;
  function setCount(n) {
    while (terms.length < n) {
      const term = makeTerminal(terms.length);
      terms.push(term);
      if (openAdded) term.setOpen(true);
    }
    while (terms.length > n) terms.pop().remove();
  }

  function message(m, t) {
    if (t < 0) { // the link: for every terminal
      if (m.type !== 'link') return;
      if (m.session !== session) { // new terminals: their pictures and screens start over
        session = m.session; images = new VtImages();
        for (const term of terms) term.reset();
      }
      link = m;
      navBtn.style.display = '';
      setCount(m.state === 'off' ? 1 : Math.max(1, Math.min(4, m.count || 1)));
      if (m.state !== 'off') openAdded = false;
      render();
      return;
    }
    if (terms[t]) terms[t].message(m);
  }

  function image(id, w, h, rgba) { images.add(id, w, h, rgba); }

  function render() {
    navBtn.classList.toggle('active', terms.some(term => term.open()));
    for (const term of terms) term.render();
  }

  // The nav button: closes every card when any is open, else opens them all.
  navBtn.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    const any = terms.some(term => term.open());
    for (const term of terms) term.setOpen(!any);
  });

  // Control Audio Signal: the implement's beeps, as tones (activations 0 stops them).
  function playAudio(m, term) {
    clearTimeout(term.audioTimer);
    if (!m.activations) return;
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return; }
    let n = Math.min(m.activations, 20);
    const beep = () => {
      const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
      osc.frequency.value = Math.max(200, Math.min(m.frequency || 1000, 8000));
      g.gain.value = 0.2;
      osc.connect(g); g.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + Math.max(20, m.on || 200) / 1000);
      if (--n > 0) term.audioTimer = setTimeout(beep, Math.max(20, m.on || 200) + Math.max(20, m.off || 100));
    };
    beep();
  }

  function makeTerminal(index) {
    const card = tpl.content.firstElementChild.cloneNode(true);
    card.id = 'vt-card-' + index;
    // Each card a little below and right of the one before, so every header can be reached.
    card.style.top = 'calc(' + (70 + index * 36) + 'px + var(--sat))';
    card.style.left = 'calc(' + (80 + index * 36) + 'px + var(--sal))';
    tpl.parentNode.insertBefore(card, tpl); // beside the chart cards
    wireCardDrag(card);
    const q = sel => card.querySelector(sel);
    const maskCv = q('.vt-mask'), mctx = maskCv.getContext('2d');
    const keysEl = q('.vt-keys'), msgEl = q('.vt-msg'), editEl = q('.vt-edit'), wsSel = q('.vt-ws');
    const dot = q('.vt-dot'), nameEl = q('.vt-name'), identEl = q('.vt-ident');
    const alarmEl = q('.vt-alarm'), alarmText = q('.vt-alarm-text');
    const sizeKey = 'vt.size' + (index ? '.' + index : '');
    let screen = null, edit = null, workingSets = null, alarms = [];
    let keyPage = 0, showGateway = false, selecting = null, sizeIx = 1, identTimer = null;
    try { sizeIx = SIZES.indexOf(+localStorage.getItem(sizeKey)); if (sizeIx < 0) sizeIx = 1; } catch (_) {}
    card.style.setProperty('--vt', SIZES[sizeIx] + 'px');
    const send = (cmd, arg) => transport.send('vt.' + cmd + '|' + index + (arg !== undefined ? ',' + arg : ''));

    const term = {
      audioTimer: null,
      open: () => card.style.display !== 'none',
      setOpen(on) {
        card.style.display = on ? '' : 'none';
        navBtn.classList.toggle('active', terms.some(x => x.open()));
        if (on) this.render();
      },
      reset() { screen = null; edit = null; workingSets = null; alarms = []; },
      remove() { clearTimeout(term.audioTimer); clearTimeout(identTimer); card.remove(); },
      message(m) {
        switch (m.type) {
          case 'screen': screen = m; break;
          case 'edit': onEdit(m); break;
          case 'workingSets': workingSets = m; break;
          case 'alarms': onAlarms(m.list || []); break;
          case 'audio': playAudio(m, term); return;
          case 'identify': identify(); break;
          default: return; // volume and later additions: nothing to show yet
        }
        if (term.open()) term.render();
        else navBtn.classList.toggle('active', terms.some(x => x.open()));
      },
      render,
    };

    // A new alarm reaches the operator with the card closed: the card opens, and an alarm
    // from an implement that isn't shown offers to show it.
    function onAlarms(list) {
      const before = new Set(alarms.map(a => a.ws + ':' + a.mask));
      alarms = list;
      if (list.some(a => !before.has(a.ws + ':' + a.mask)) && !term.open()) term.setOpen(true);
    }

    // Identify VT: an implement asks every terminal to show its number while the operator picks
    // one in its menu. The card opens and shows its number for 3 s.
    function identify() {
      identEl.textContent = tr('VT {n}', { n: index + 1 });
      identEl.classList.add('show');
      clearTimeout(identTimer);
      identTimer = setTimeout(() => identEl.classList.remove('show'), 3000);
      if (!term.open()) term.setOpen(true);
    }

    function onEdit(m) {
      edit = m.o === null ? null : m;
      // A boolean toggles without an editor, when this browser asked for it.
      if (edit && edit.kind === 'bool' && selecting === edit.o && iHoldControl) {
        send('number', edit.o + ',' + (edit.value ? 0 : 1));
        edit = null;
      }
      selecting = null;
    }

    function wsLabel(ws) { return tr('Implement') + ' ' + ws.address + (ws.state === 'transferring' ? ' (' + ws.progress + '%)' : ''); }

    function renderHeader() {
      nameEl.textContent = tr('VT {n}', { n: index + 1 }); // the same with one terminal or four
      const st = link ? link.state : 'off';
      dot.className = 'vt-dot ' + (st === 'connected' ? 'ok' : st === 'connecting' || st === 'busy' ? 'wait' : st === 'failed' ? 'bad' : '');
      dot.title = st === 'connected' ? (link.name || link.gateway) + (link.rtt != null ? ' · ' + link.rtt + ' ms' : '') + (link.bus ? ' · ' + link.bus : '')
        : st === 'busy' ? tr('In use by {who}', { who: link.why })
        : st === 'connecting' ? (link.adapter ? tr('Waiting for the CAN adapter on {port}', { port: link.adapter }) : tr('Connecting to {gw}', { gw: link.gatewayName || link.gateway })) + (link.why ? ' (' + link.why + ')' : '') : '';
    }

    function render() {
      renderHeader();
      if (!term.open()) return;
      // Implement picker: shown with two or more implements on this terminal.
      const list = (workingSets && workingSets.list || []).filter(w => w.selectable !== false);
      wsSel.style.display = list.length > 1 ? '' : 'none';
      if (list.length > 1) {
        wsSel.innerHTML = '';
        for (const w of list) {
          const o = document.createElement('option');
          o.value = w.name; o.textContent = wsLabel(w); o.title = w.name;
          o.selected = workingSets.active === w.name;
          wsSel.appendChild(o);
        }
      }
      // Alarm from an implement that isn't shown.
      const away = alarms.find(a => !screen || a.ws !== screen.ws);
      alarmEl.classList.toggle('show', !!away);
      if (away) { alarmText.textContent = tr('Alarm') + ': ' + tr('Implement') + ' ' + away.address; alarmEl.dataset.ws = away.ws; }

      const msg = statusMessage();
      msgEl.style.display = msg ? '' : 'none';
      if (msg) { if (msgEl.dataset.msg !== msg.key) { msgEl.dataset.msg = msg.key; msgEl.innerHTML = ''; msg.build(msgEl); } }
      else msgEl.dataset.msg = '';
      paint();
      renderEdit();
    }

    // What covers the mask instead of a screen, or null when there's a screen to show. The
    // gateway editor is on the first card only: one connection serves every terminal.
    function statusMessage() {
      const text = (t, sub) => el => {
        const d = document.createElement('div'); d.textContent = t; el.appendChild(d);
        if (sub) { const s = document.createElement('div'); s.className = 'vt-sub'; s.textContent = sub; el.appendChild(s); }
      };
      if (index === 0 && (showGateway || !link || link.state === 'off')) return { key: 'gw:' + (link ? [link.session, link.state, link.gateway, link.gatewayName, link.adapter, link.count].concat(link.ports || [], (link.gateways || []).map(g => g.name + '@' + g.address)).join('|') : ''), build: buildGateway }; // rebuilt when what it shows changes
      if (!link || link.state === 'off') return { key: 'off', build: text(tr('No gateway')) };
      if (link.state === 'failed') return { key: 'failed' + link.why, build: text(tr('The terminal could not start.'), link.why) };
      if (link.state === 'busy')
        return { key: 'busy' + link.why, build: text(tr('{gw} is in use by {who}', { gw: link.gatewayName || link.gateway, who: link.why }),
          tr('This card connects when the other terminal lets it go.')) };
      if (link.state !== 'connected')
        return { key: 'conn' + link.why, build: link.adapter
          ? text(tr('Waiting for the CAN adapter on {port}', { port: link.adapter }), link.why)
          : text(tr('Connecting to {gw}', { gw: link.gatewayName || link.gateway }), link.why) };
      if (!screen || !screen.ws || !screen.kind) {
        const ws = workingSets && workingSets.list && workingSets.list[0];
        if (ws && ws.state === 'transferring') return { key: 'up' + ws.progress, build: text(tr('Loading the implement\'s screens: {p}%', { p: ws.progress })) };
        if (ws && ws.state === 'parsing') return { key: 'parse', build: text(tr('Loading the implement\'s screens')) };
        if (ws && ws.state === 'failed') return { key: 'bad', build: text(tr('The implement\'s screens were refused.')) };
        return { key: 'none', build: text(tr('No implement'), terms.length > 1 ? tr('Choose this VT in the implement\'s own settings.') : link.name || link.gateway) };
      }
      return null;
    }

    // The gear: how the terminals reach the bus (a gateway on the network, or an slcan adapter
    // plugged into this device) and how many there are.
    function buildGateway(el) {
      const d = document.createElement('div'); d.textContent = tr('ISOBUS connection'); el.appendChild(d);
      const kind = document.createElement('select'); kind.className = 'vt-ws';
      for (const [v, label] of [['gateway', tr('Gateway on the network')], ['adapter', tr('CAN adapter on this device')]]) {
        const o = document.createElement('option'); o.value = v; o.textContent = label; kind.appendChild(o);
      }
      kind.value = link && link.adapter ? 'adapter' : 'gateway';
      if (link && link.adapters === false && !link.adapter) kind.style.display = 'none'; // no USB adapters here (iOS)
      el.appendChild(kind);
      // Gateway: one of those announcing themselves on the network, by name, or an address typed.
      const found = (link && link.gateways || []).slice();
      const gwRow = document.createElement('div'); gwRow.className = 'vt-row';
      const pick = document.createElement('select'); pick.className = 'vt-ws';
      for (const g of found) {
        const o = document.createElement('option'); o.value = g.address; o.textContent = g.name; o.dataset.name = g.name;
        pick.appendChild(o);
      }
      const other = document.createElement('option'); other.value = ''; other.textContent = tr('Other address…');
      pick.appendChild(other);
      const mine = link && link.gateway ? found.find(g => (link.gatewayName && g.name === link.gatewayName) || g.address === link.gateway) : found[0];
      pick.value = mine ? mine.address : '';
      const gwAgain = document.createElement('button'); gwAgain.className = 'fo-btn'; gwAgain.textContent = tr('Refresh');
      gwAgain.addEventListener('pointerdown', e => { e.preventDefault(); transport.send('vt.ports'); });
      gwRow.append(pick, gwAgain);
      const inp = document.createElement('input');
      inp.placeholder = '192.168.1.10'; inp.value = link && link.gateway && !mine ? link.gateway : '';
      inp.autocapitalize = 'off'; inp.spellcheck = false;
      // Adapter: its serial port, from the host's list (refreshed when the gear opens).
      const portRow = document.createElement('div'); portRow.className = 'vt-row';
      const port = document.createElement('select'); port.className = 'vt-ws';
      const ports = (link && link.ports || []).slice();
      if (link && link.adapter && !ports.includes(link.adapter)) ports.unshift(link.adapter);
      for (const p of ports) {
        const o = document.createElement('option'); o.value = p; o.textContent = p; o.selected = link && p === link.adapter;
        port.appendChild(o);
      }
      const again = document.createElement('button'); again.className = 'fo-btn'; again.textContent = tr('Refresh');
      again.addEventListener('pointerdown', e => { e.preventDefault(); transport.send('vt.ports'); });
      portRow.append(port, again);
      const sub = document.createElement('div'); sub.className = 'vt-sub';
      const show = () => {
        const adapter = kind.value === 'adapter', typed = !pick.value;
        gwRow.style.display = adapter ? 'none' : '';
        inp.style.display = adapter || !typed ? 'none' : '';
        portRow.style.display = adapter ? '' : 'none';
        sub.textContent = adapter
          ? (ports.length ? tr('An slcan adapter (CANable) on the implement bus, 250 kbit/s.') : tr('No adapter found: plug it in, then Refresh.'))
          : !typed ? tr('A gateway on this network, on the implement bus.')
          : found.length ? tr('Address of the AOW link gateway on the implement bus (port 2323).')
          : tr('No gateway found on this network. Type its address (port 2323), or Refresh.');
      };
      kind.addEventListener('change', show);
      pick.addEventListener('change', show);
      el.append(gwRow, inp, portRow, sub);
      show();
      // How many terminals: one card each, as displays in one cab.
      const countRow = document.createElement('div'); countRow.className = 'vt-row';
      const countLabel = document.createElement('span'); countLabel.textContent = tr('Terminals');
      const count = document.createElement('select'); count.className = 'vt-ws';
      const have = link && link.count || 1;
      for (let n = 1; n <= 4; n++) {
        const o = document.createElement('option'); o.value = n; o.textContent = n; o.selected = n === have;
        count.appendChild(o);
      }
      countRow.append(countLabel, count);
      el.appendChild(countRow);
      const row = document.createElement('div'); row.className = 'vt-row';
      const ok = document.createElement('button'); ok.className = 'fo-btn'; ok.textContent = tr('Connect');
      ok.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (+count.value > 1) openAdded = true;
        if (+count.value !== have) transport.send('vt.count|' + count.value);
        const picked = pick.value ? pick.selectedOptions[0].dataset.name : '';
        const address = pick.value || inp.value.trim();
        if (kind.value === 'adapter') { if (port.value) transport.send('vt.adapter|' + port.value); }
        else if (+count.value === have || address !== (link && link.gateway || '') || picked !== (link && link.gatewayName || '') || (link && link.adapter))
          transport.send('vt.gateway|' + address + (picked ? '\t' + picked : ''));
        showGateway = false; msgEl.dataset.msg = ''; render();
      });
      row.appendChild(ok);
      if (link && link.state !== 'off') {
        // Disconnect: every terminal off, until Connect.
        const off = document.createElement('button'); off.className = 'fo-btn'; off.textContent = tr('Disconnect');
        off.addEventListener('pointerdown', e => { e.preventDefault(); transport.send('vt.gateway|'); showGateway = false; msgEl.dataset.msg = ''; render(); });
        row.appendChild(off);
        const cancel = document.createElement('button'); cancel.className = 'fo-btn'; cancel.textContent = tr('Cancel');
        cancel.addEventListener('pointerdown', e => { e.preventDefault(); showGateway = false; render(); });
        row.appendChild(cancel);
      }
      el.appendChild(row);
    }

    function paint() {
      if (!screen || !screen.kind) { keysEl.innerHTML = ''; return; }
      maskCv.width = screen.w; maskCv.height = screen.h;
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      vtPaintMask(mctx, screen, images);
      // Soft keys: a page of PAGE at a time, with a pager when the mask holds more.
      const keys = screen.keys ? screen.keys.keys : [];
      const pages = Math.max(1, Math.ceil(keys.length / PAGE));
      if (keyPage >= pages) keyPage = 0;
      const want = PAGE + (pages > 1 ? 1 : 0);
      if (keysEl.childElementCount !== want || keysEl.dataset.pages !== String(pages)) {
        keysEl.innerHTML = ''; keysEl.dataset.pages = pages;
        for (let i = 0; i < PAGE; i++) { const c = document.createElement('canvas'); c.dataset.slot = i; keysEl.appendChild(c); wireKey(c); }
        if (pages > 1) {
          const b = document.createElement('button'); b.textContent = '⇣';
          b.addEventListener('pointerdown', e => { e.preventDefault(); keyPage = (keyPage + 1) % pages; paint(); });
          keysEl.appendChild(b);
        }
      }
      for (let i = 0; i < PAGE; i++) {
        const c = keysEl.children[i], k = keyPage * PAGE + i;
        const kw = screen.keys ? screen.keys.w : 80, kh = screen.keys ? screen.keys.h : 80;
        c.width = kw; c.height = kh;
        const kc = c.getContext('2d');
        kc.setTransform(1, 0, 0, 1, 0, 0);
        if (screen.keys && k < keys.length) vtPaintKey(kc, screen.keys, k, images);
        else { kc.fillStyle = screen.keys ? screen.keys.bg : '#808080'; kc.fillRect(0, 0, kw, kh); }
      }
    }

    // Press, then release or abort: pointer up over the same thing releases; leaving it or a
    // cancelled touch aborts. A press must always end, so a lost pointer aborts too.
    function trackPress(el, kind, o, still) {
      send('key', kind + ',' + o + ',p');
      let done = false;
      const end = state => {
        if (done) return; done = true;
        send('key', kind + ',' + o + ',' + state);
        el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel);
        el.removeEventListener('pointermove', move); el.removeEventListener('lostpointercapture', cancel);
      };
      const up = e => end(still(e) ? 'r' : 'a');
      const cancel = () => end('a');
      const move = e => { if (!still(e)) end('a'); };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', cancel);
      el.addEventListener('pointermove', move); el.addEventListener('lostpointercapture', cancel);
    }

    function wireKey(c) {
      c.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (!iHoldControl || !screen || !screen.keys) return;
        const key = screen.keys.keys[keyPage * PAGE + (+c.dataset.slot)];
        if (!key) return;
        try { c.setPointerCapture(e.pointerId); } catch (_) {}
        const r = c.getBoundingClientRect();
        trackPress(c, 's', key.o, ev => ev.clientX >= r.left && ev.clientX < r.right && ev.clientY >= r.top && ev.clientY < r.bottom);
      });
    }

    function maskPoint(e) {
      const r = maskCv.getBoundingClientRect();
      return { x: (e.clientX - r.left) * screen.w / r.width, y: (e.clientY - r.top) * screen.h / r.height };
    }

    maskCv.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (!iHoldControl || !screen || !screen.kind) return;
      const p = maskPoint(e);
      const hit = vtHit(screen.items, p.x, p.y);
      if (!hit || !hit.on) return;
      if (hit.kind === 'input') { selecting = hit.o; send('select', hit.o); return; }
      if (hit.kind !== 'button') return;
      try { maskCv.setPointerCapture(e.pointerId); } catch (_) {}
      trackPress(maskCv, 'b', hit.o, ev => {
        const q = maskPoint(ev);
        return q.x >= hit.x && q.x < hit.x + hit.w && q.y >= hit.y && q.y < hit.y + hit.h;
      });
    });

    // The editor for an open input field (only for the browser holding control).
    function renderEdit() {
      const show = !!edit && iHoldControl && term.open() && !(msgEl.style.display !== 'none');
      editEl.classList.toggle('show', show);
      if (!show) { editEl.dataset.o = ''; editEl.innerHTML = ''; return; }
      const key = edit.ws + ':' + edit.o + ':' + edit.kind + ':' + edit.value;
      if (editEl.dataset.o === key) return;
      editEl.dataset.o = key; editEl.innerHTML = '';
      const row = document.createElement('div'); row.className = 'vt-row';
      const btn = (label, fn) => {
        const b = document.createElement('button'); b.className = 'fo-btn'; b.textContent = label;
        b.addEventListener('pointerdown', ev => { ev.preventDefault(); fn(); }); row.appendChild(b);
      };
      const esc = () => send('escape');
      if (edit.kind === 'number') {
        const inp = document.createElement('input');
        inp.inputMode = 'decimal'; inp.value = edit.text;
        const lo = (edit.min + edit.offset) * edit.scale, hi = (edit.max + edit.offset) * edit.scale;
        const sub = document.createElement('div'); sub.className = 'vt-sub';
        sub.textContent = Math.min(lo, hi).toFixed(edit.decimals) + ' … ' + Math.max(lo, hi).toFixed(edit.decimals);
        const enter = () => {
          const shown = parseFloat(inp.value.replace(',', '.'));
          if (!isFinite(shown) || !edit.scale) return;
          const raw = Math.round(shown / edit.scale) - edit.offset;
          if (raw < edit.min || raw > edit.max) { sub.textContent = tr('Out of range') + ': ' + sub.textContent; return; }
          send('number', edit.o + ',' + raw);
        };
        inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') enter(); else if (ev.key === 'Escape') esc(); });
        editEl.append(inp, sub);
        btn(tr('OK'), enter); btn(tr('Cancel'), esc);
        editEl.appendChild(row);
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
      } else if (edit.kind === 'string') {
        const inp = document.createElement('input');
        inp.value = edit.value; inp.maxLength = edit.length; inp.autocapitalize = 'off'; inp.spellcheck = false;
        const enter = () => send('string', edit.o + ',' + inp.value);
        inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') enter(); else if (ev.key === 'Escape') esc(); });
        editEl.appendChild(inp);
        btn(tr('OK'), enter); btn(tr('Cancel'), esc);
        editEl.appendChild(row);
        setTimeout(() => inp.focus(), 0);
      } else if (edit.kind === 'list') {
        const opts = document.createElement('div'); opts.className = 'vt-opts';
        edit.options.forEach((items, i) => {
          if (!items) return;
          const c = document.createElement('canvas');
          c.width = edit.w; c.height = edit.h;
          if (i === edit.value) c.classList.add('sel');
          const cx = c.getContext('2d');
          cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, edit.w, edit.h);
          vtPaintItems(cx, items, images);
          c.addEventListener('pointerdown', ev => { ev.preventDefault(); send('number', edit.o + ',' + i); });
          opts.appendChild(c);
        });
        editEl.appendChild(opts);
        btn(tr('Cancel'), esc);
        editEl.appendChild(row);
      } else { // bool opened by the implement or another browser
        btn(edit.value ? tr('Off') : tr('On'), () => send('number', edit.o + ',' + (edit.value ? 0 : 1)));
        btn(tr('Cancel'), esc);
        editEl.appendChild(row);
      }
    }

    if (index) q('.vt-gear').style.display = 'none'; // the connection is set on VT 1
    q('.vt-x').addEventListener('pointerdown', e => { e.preventDefault(); term.setOpen(false); });
    q('.vt-gear').addEventListener('pointerdown', e => {
      e.preventDefault();
      if (!iHoldControl) return;
      showGateway = !showGateway; msgEl.dataset.msg = ''; render();
      if (showGateway) transport.send('vt.ports');
    });
    q('.vt-size').addEventListener('pointerdown', e => {
      e.preventDefault();
      sizeIx = (sizeIx + 1) % SIZES.length;
      card.style.setProperty('--vt', SIZES[sizeIx] + 'px');
      try { localStorage.setItem(sizeKey, SIZES[sizeIx]); } catch (_) {}
    });
    wsSel.addEventListener('change', () => { if (iHoldControl) send('activate', wsSel.value); });
    q('.vt-alarm-show').addEventListener('pointerdown', e => {
      e.preventDefault();
      if (iHoldControl && alarmEl.dataset.ws) send('activate', alarmEl.dataset.ws);
    });

    return term;
  }

  return { message, image, render };
})();

// Clock — browser-local 24h HH:MM:SS.
const clockEl = document.getElementById('clock');
function tickClock() {
  if (!clockEl) return;
  const d = new Date(), p = n => String(n).padStart(2, '0');
  clockEl.textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
setInterval(tickClock, 1000); tickClock();

// Reference grid + origin axes (procedural, client-side — no wire). Spacing is a
// tool-width multiple on a 1-2-5 series keyed to zoom, matching the native grid
// (#417). Axes through the field origin (local 0,0): X (N=0) red, Y (E=0) green.
// Matches native NiceStep125 exactly: ≤1 → 1, then 2, 5, 10, 20 … (no 1.5 step).
function niceStep125(x) {
  if (x <= 1) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / pow;
  return (f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}
// fork: the width the sections span, 0 when there are none (toolWidthM() then says 6 m).
function sectionsWidthM() {
  const ts = scene && scene.toolSections;
  if (!ts || !ts.length) return 0;
  let lo = Infinity, hi = -Infinity;
  for (const s of ts) { if (s.left < lo) lo = s.left; if (s.right > hi) hi = s.right; }
  return hi > lo ? hi - lo : 0;
}
function toolWidthM() {
  const ts = scene && scene.toolSections;
  if (ts && ts.length) {
    let lo = Infinity, hi = -Infinity;
    for (const s of ts) { if (s.left < lo) lo = s.left; if (s.right > hi) hi = s.right; }
    if (hi > lo) return hi - lo;
  }
  // No sections: the host's tool width (#398); 0 when that isn't set either, never a guess.
  const w = config && config.tool && config.tool.totalWidth;
  return w > 0 ? w : 0;
}
// HUD text (DOM). Built each frame from the latest tick/scene.
// ---- Skia (CanvasKit) render — Phase A: vector layers at parity. Works in CSS
//      px (canvas.scale(dpr)), reusing w2s. Coverage/imagery/tool/lightbar TODO. ----
// CanvasKit 0.41: Path is immutable (no moveTo/reset) — build via MakeFromCmds
// (flat [VERB,x,y,...]) for polylines; drawLine for single segments.
// True when line `a` lies on polyline `b`: its middle point is within 5 cm of it.
function onPolyline(a, b) {
  if (!a || a.length < 2 || !b || b.length < 2) return false;
  const m = a.length === 2
    ? { e: (a[0].e + a[1].e) / 2, n: (a[0].n + a[1].n) / 2 } : a[a.length >> 1];
  for (let i = 0; i + 1 < b.length; i++) {
    const p = b[i], q = b[i + 1], de = q.e - p.e, dn = q.n - p.n, l2 = de * de + dn * dn;
    const u = l2 ? Math.max(0, Math.min(1, ((m.e - p.e) * de + (m.n - p.n) * dn) / l2)) : 0;
    if (Math.hypot(m.e - p.e - u * de, m.n - p.n - u * dn) < 0.05) return true;
  }
  return false;
}
function strokePtsSk(canvas, pts, close, paint) {
  if (!pts || pts.length < 2) return;
  strokePtsSk3D(canvas, pts, close, paint);
}
// Extend a 2-point AB line far past both ends so the reference line spans the field instead of
// being a short stub (issue #37). Curves (>2 points) pass through unchanged. The viewport clip
// in strokePtsSk3D bounds the draw cost of the now-long line. AB_EXTEND covers any field.
const AB_EXTEND = 3000; // metres added beyond each endpoint
function extendAbLine(pts) {
  if (!pts || pts.length !== 2) return pts;
  const a = pts[0], b = pts[1];
  let dx = b.e - a.e, dy = b.n - a.n;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return pts;
  dx /= len; dy /= len;
  return [
    { e: a.e - dx * AB_EXTEND, n: a.n - dy * AB_EXTEND },
    { e: b.e + dx * AB_EXTEND, n: b.n + dy * AB_EXTEND },
  ];
}
// Perspective path for strokePtsSk: a vertex behind the tilted camera (w < EPS)
// projects through w2s with a negative w → a mirrored ghost segment (the same bug
// clipNear() fixes for single grid segments). So walk the polyline in WORLD space,
// split it at every near-plane crossing, and stroke each continuous front-facing run
// in screen space — only ever feeding w2s points that are in front of the camera.
// Clip a screen-space polyline to the viewport (+margin) into connected sub-polylines. Under
// tilt a line recedes to the horizon vanishing point, so its PROJECTED length — and a dashed
// stroke's dash count — is effectively unbounded, which collapsed FPS. Clipping bounds the work
// to on-screen length. Cohen–Sutherland per segment, re-joining contiguous pieces. [x,y] arrays.
function clipScreenPolyline(pts, margin) {
  const x0 = -margin, y0 = -margin, x1 = vw + margin, y1 = vh + margin;
  const code = (x, y) => (x < x0 ? 1 : x > x1 ? 2 : 0) | (y < y0 ? 4 : y > y1 ? 8 : 0);
  const out = [];
  let cur = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    let ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1];
    let ca = code(ax, ay), cb = code(bx, by), accept = false;
    for (let g = 0; g < 8; g++) {
      if (!(ca | cb)) { accept = true; break; }   // both inside
      if (ca & cb) break;                          // both outside the same edge → reject
      const c = ca || cb; let nx, ny;
      if (c & 8) { nx = ax + (bx - ax) * (y1 - ay) / (by - ay); ny = y1; }
      else if (c & 4) { nx = ax + (bx - ax) * (y0 - ay) / (by - ay); ny = y0; }
      else if (c & 2) { ny = ay + (by - ay) * (x1 - ax) / (bx - ax); nx = x1; }
      else { ny = ay + (by - ay) * (x0 - ax) / (bx - ax); nx = x0; }
      if (c === ca) { ax = nx; ay = ny; ca = code(ax, ay); }
      else { bx = nx; by = ny; cb = code(bx, by); }
    }
    if (!accept) { if (cur) { out.push(cur); cur = null; } continue; }
    if (cur && Math.abs(cur[cur.length - 1][0] - ax) < 0.5 && Math.abs(cur[cur.length - 1][1] - ay) < 0.5)
      cur.push([bx, by]);
    else { if (cur) out.push(cur); cur = [[ax, ay], [bx, by]]; }
  }
  if (cur) out.push(cur);
  return out;
}
function strokePtsSk3D(canvas, pts, close, paint) {
  const EPS = 1.0;
  const n = pts.length;
  const wOf = (p) => pw(p.e, p.n);
  // World point where segment a→b crosses the near plane (a, b straddle it).
  const cross = (a, b, wa, wb) => {
    const t = (EPS - wa) / (wb - wa);
    return [a.e + (b.e - a.e) * t, a.n + (b.n - a.n) * t];
  };
  let run = [];
  const flush = () => {
    // Clip the front-facing screen run to the viewport before stroking — bounds a dashed
    // line's dash flattening (and stroke fill) to on-screen length, the tilt FPS fix.
    if (run.length >= 2) {
      for (const sub of clipScreenPolyline(run, 48)) {
        if (sub.length < 2) continue;
        const cmds = [];
        for (let i = 0; i < sub.length; i++)
          cmds.push(i === 0 ? CK.MOVE_VERB : CK.LINE_VERB, sub[i][0], sub[i][1]);
        const path = CK.Path.MakeFromCmds(cmds);
        if (path) { canvas.drawPath(path, paint); path.delete(); }
      }
    }
    run = [];
  };
  const segCount = close ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const wa = wOf(a), wb = wOf(b);
    const aFront = wa >= EPS, bFront = wb >= EPS;
    if (aFront && bFront) {                       // whole segment in front
      if (run.length === 0) run.push(w2s(a.e, a.n));
      run.push(w2s(b.e, b.n));
    } else if (aFront && !bFront) {               // exits behind: clip end, break run
      if (run.length === 0) run.push(w2s(a.e, a.n));
      const c = cross(a, b, wa, wb);
      run.push(w2s(c[0], c[1]));
      flush();
    } else if (!aFront && bFront) {               // enters from behind: start at clip
      flush();
      const c = cross(a, b, wa, wb);
      run.push(w2s(c[0], c[1]));
      run.push(w2s(b.e, b.n));
    } else {                                      // wholly behind: nothing to draw
      flush();
    }
  }
  flush();
}
// Field flags — filled dot (0.8 m radius like native, min 4 px) + dark outline,
// coloured by the flag's hex. Skips flags behind the tilted camera (near-plane).
// Live recorded-path markers (Recorded Path → Record). The host streams the points
// captured so far on the RecordedPath frame; draw each as a dot so the path is visible
// as it's driven, like native's growing "Recording…" track.
function drawRecordingMarkersSk(canvas) {
  const r = recPath;
  if (!r || !r.recordingPoints || r.recordingPoints.length < 2) return;
  const pts = r.recordingPoints;
  const rad = Math.max(3, 0.4 * pxPerM);
  SKP.flagFill.setColor(ckColor('#FFD040')); // recorded-path yellow
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const e = pts[i], n = pts[i + 1];
    if (pw(e, n) < 1.0) continue; // behind camera
    const xy = w2s(e, n);
    canvas.drawCircle(xy[0], xy[1], rad, SKP.flagFill);
  }
}
// Contour mode: the strip being followed, as points — green, yellow when locked
// (AgOpenGPS CContour.DrawContourLine) (#110).
function drawContourRefSk(canvas) {
  const pts = scene && scene.contourRef;
  if (!pts || !pts.length) return;
  SKP.flagFill.setColor(ckColor(scene.contourLocked ? 'rgb(251,235,107)' : 'rgb(77,250,0)'));
  const rad = scene.contourLocked ? 2.5 : 2;
  for (const p of pts) {
    if (pw(p.e, p.n) < 1.0) continue; // behind camera
    const xy = w2s(p.e, p.n);
    canvas.drawCircle(xy[0], xy[1], rad, SKP.flagFill);
  }
}
// Live drive-around boundary (Boundary → Drive Around): the points captured so far,
// streamed on the Boundary frame. Draw a connecting line + dots so it's visible as it's
// driven, like native's growing recording.
function drawBoundaryRecordingSk(canvas) {
  const b = boundary;
  if (!b || !b.recordingPoints || b.recordingPoints.length < 2) return;
  const flat = b.recordingPoints;
  const pts = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push({ e: flat[i], n: flat[i + 1] });
  if (pts.length >= 2) strokePtsSk(canvas, pts, false, SKP.boundary);
  const rad = Math.max(3, 0.35 * pxPerM);
  SKP.flagFill.setColor(ckColor('#E05220'));
  for (const p of pts) {
    if ((pw(p.e, p.n)) < 1.0) continue;
    const xy = w2s(p.e, p.n);
    canvas.drawCircle(xy[0], xy[1], rad, SKP.flagFill);
  }
}
// Live boundary draw-on-map preview (Phase MT) — the polygon vertices tapped on the
// satellite imagery so far. Closed white outline + outlined dots; client-side only.
// Extra guidelines (Phase MT parity) — the adjacent passes ±tool-width × i from the
// followed line, when Display.ExtraGuidelines is on. Mirrors native DrawExtraGuidelinesSk:
// offset the active/display line by ±toolW·i and stroke faint green (over a shadow), with
// a zoom gate so the lines don't collapse into a band.
function offsetLine(pts, offset) {
  const out = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.e - a.e, dy = b.n - a.n, len = Math.hypot(dx, dy);
    if (len < 1e-6) { out[i] = pts[i]; continue; }
    out[i] = { e: pts[i].e + (-dy / len) * offset, n: pts[i].n + (dx / len) * offset };
  }
  return out;
}
function drawExtraGuidelinesSk(canvas) {
  const d = config && config.display;
  if (!d || !d.extraGuidelines) return;
  const count = d.extraGuidelinesCount || 0;
  if (count < 1) return;
  const line = scene && scene.guidanceLine; // the followed pass (native offsets ActiveTrack)
  if (!line || line.length < 2) return;
  const toolW = toolWidthM();
  if (toolW < 0.1 || toolW * pxPerM < 3) return; // zoom gate: skip when passes < ~3 px apart
  const baseLine = extendAbLine(line);
  for (let i = 1; i <= count; i++) {
    for (const off of [toolW * i, -toolW * i]) {
      const ol = offsetLine(baseLine, off);
      strokePtsSk(canvas, ol, false, SKP.extraGuideShadow);
      strokePtsSk(canvas, ol, false, SKP.extraGuide);
    }
  }
}
function drawSatBoundarySk(canvas) {
  if (!satBnd || !satPts.length) return;
  if (satPts.length >= 2) strokePtsSk(canvas, satPts, satPts.length >= 3, SKP.boundary);
  const rad = Math.max(4, 0.5 * pxPerM);
  SKP.flagFill.setColor(ckColor('#FFFFFF'));
  for (const p of satPts) {
    if ((pw(p.e, p.n)) < 1.0) continue;
    const xy = w2s(p.e, p.n);
    canvas.drawCircle(xy[0], xy[1], rad, SKP.flagFill);
    canvas.drawCircle(xy[0], xy[1], rad, SKP.flagOutline);
  }
}
// #40: preview the AB/curve points being drawn as native-style dots — orange A (first),
// blue B (last), white interior — so the placed A point is visible before B is set. The
// host holds the real point list; drawPts is the client's tap echo (preview only).
function drawAbDrawPreviewSk(canvas) {
  if (!drawPts.length) return; // renders for map-tap AND Drive-AB markers (drawMode may be null)
  const rad = Math.max(5, 0.6 * pxPerM);
  for (let i = 0; i < drawPts.length; i++) {
    const p = drawPts[i];
    if (pw(p.e, p.n) < 1.0) continue; // behind the near plane
    const xy = w2s(p.e, p.n);
    SKP.flagFill.setColor(ckColor(abLabelColor(i))); // A orange, B blue, rest white — matches labels
    canvas.drawCircle(xy[0], xy[1], rad, SKP.flagFill);
    canvas.drawCircle(xy[0], xy[1], rad, SKP.flagOutline);
  }
}
// Tram lines (wheel tracks) generated from the tram systems. Drawn when the tram display is
// on (bottom-nav tram mode > 0) or while the Field Builder Tram tab is open (so you see the
// effect of edits). Orange polylines; the host owns the geometry.
function drawTramLinesSk(canvas) {
  if (!scene || !scene.tramLines || !scene.tramLines.length) return;
  const fbTramOpen = document.getElementById('fieldbuilder').classList.contains('open') && fbTab === 'tram';
  const tramOn = tick && tick.tools && tick.tools.tramMode > 0;
  if (!fbTramOpen && !tramOn) return;
  SKP.tram.setStrokeWidth(Math.max(2, 0.3 * pxPerM));
  for (const line of scene.tramLines) if (line.length >= 2) strokePtsSk(canvas, line, false, SKP.tram);
}
// Field Builder Headland editor — draw each segment's offset line + overshoot extensions
// (yellow = contributes to the closed headland, red = doesn't yet) ONLY while the Headland
// tab is open, so the operator can watch the lines cross and enclose the area, mirroring
// native's "Create and Edit Headland" view. The built headland polygon draws separately.
function drawHeadlandSegEditLinesSk(canvas) {
  if (!scene || !scene.headlandSegs || !scene.headlandSegs.length) return;
  const fb = document.getElementById('fieldbuilder');
  if (!fb.classList.contains('open') || fbTab !== 'headland') return;
  const w = Math.max(2, 0.4 * pxPerM);
  for (const s of scene.headlandSegs) {
    if (!s.editLine || s.editLine.length < 2) continue;
    const paint = s.effective ? SKP.hlEdit : SKP.hlEditOff;
    paint.setStrokeWidth(w);
    strokePtsSk(canvas, s.editLine, false, paint);
  }
}
// Live headland draw preview (Field Builder stage 2) — the boundary points tapped so far,
// snapped to the nearest boundary vertex. Green (headland colour) dots + connecting line;
// the host builds the real inward-offset segment + headland on finish.
function drawHeadlandDrawSk(canvas) {
  if (!hlFlow || !hlPts.length) return;
  if (hlPts.length >= 2) strokePtsSk(canvas, hlPts, false, SKP.headland);
  const rad = Math.max(4, 0.6 * pxPerM);
  SKP.flagFill.setColor(ckColor('#6BFF6B'));
  for (const p of hlPts) {
    if ((pw(p.e, p.n)) < 1.0) continue;
    const xy = w2s(p.e, p.n);
    canvas.drawCircle(xy[0], xy[1], rad, SKP.flagFill);
    canvas.drawCircle(xy[0], xy[1], rad, SKP.flagOutline);
  }
}
// Live draw-track preview (Phase MT) — the points tapped so far while drawing an AB/curve
// on the map. Client-side only (the host holds the authoritative list); cleared on
// finish/cancel. Cyan line through the points + an outlined dot at each.
function drawDrawingSk(canvas) {
  if (!drawMode || !drawPts.length) return;
  if (drawPts.length >= 2) strokePtsSk(canvas, drawPts, false, SKP.track);
  const rad = Math.max(4, 0.5 * pxPerM);
  SKP.flagFill.setColor(ckColor('#40E0FF'));
  for (const p of drawPts) {
    if ((pw(p.e, p.n)) < 1.0) continue; // behind camera
    const xy = w2s(p.e, p.n);
    canvas.drawCircle(xy[0], xy[1], rad, SKP.flagFill);
    canvas.drawCircle(xy[0], xy[1], rad, SKP.flagOutline);
  }
}
function drawFlagsSk(canvas, flags) {
  if (!flags || !flags.length) return;
  const r = Math.max(4, 0.8 * pxPerM);
  for (const fl of flags) {
    if (pw(fl.e, fl.n) < 1.0) continue; // behind camera
    const xy = w2s(fl.e, fl.n);
    SKP.flagFill.setColor(ckColor(fl.color || '#FF0000'));
    canvas.drawCircle(xy[0], xy[1], r, SKP.flagFill);
    canvas.drawCircle(xy[0], xy[1], r, SKP.flagOutline);
  }
}
function drawGridSk(canvas) {
  const disp = config && config.display;
  if (!disp || !disp.gridVisible) return; // honour Display.GridVisible (mirrors native)
  const G = 2000;
  let halfW = (vw / 2) / pxPerM, halfH = (vh / 2) / pxPerM;
  halfW = Math.max(halfW, 180); halfH = Math.max(halfH, 180); // see far enough under tilt
  if (mapRotation !== 0) { const d = Math.hypot(halfW, halfH); halfW = d; halfH = d; } // cover rotated corners
  const minE = Math.max(camE - halfW, -G), maxE = Math.min(camE + halfW, G);
  const minN = Math.max(camN - halfH, -G), maxN = Math.min(camN + halfH, G);
  if (minE >= maxE || minN >= maxN) return;
  const toolW = toolWidthM() || 1; // no tool width: plain metres
  // Spacing = tool-width × NiceStep125(viewSpan / (toolW·30)) — same as native.
  const spacing = toolW * niceStep125(Math.max(vw, vh) / pxPerM / (toolW * 30));
  const major = k => k % 10 === 0 ? SKP.gridMajor : SKP.gridMinor;
  const gm = 6; // gridMult = BaseStrokeMult 3 × GridExtraStrokeMult 2

  // Draw in WORLD coords under the perspective matrix so Skia GPU-clips at the near
  // plane. (Per-vertex screen projection garbles any line crossing behind a tilted
  // camera.) Stroke widths in world metres (native: 0.3 px floor + 0.05 m floor).
  const wpp = 1 / pxPerM;
  SKP.gridMinor.setStrokeWidth(Math.max(0.3 * wpp, 0.05) * gm);
  SKP.gridMajor.setStrokeWidth(Math.max(0.6 * wpp, 0.1) * gm);
  SKP.axisX.setStrokeWidth(Math.max(0.9 * wpp, 0.15) * gm);
  SKP.axisY.setStrokeWidth(Math.max(0.9 * wpp, 0.15) * gm);
  canvas.save();
  canvas.concat(perspM);
  const line = (e1, n1, e2, n2, paint) => {
    const c = clipNear(e1, n1, e2, n2); // returns WORLD coords
    if (c) canvas.drawLine(c[0] - camE, c[1] - camN, c[2] - camE, c[3] - camN, paint); // camera-relative
  };
  for (let k = Math.ceil(minE / spacing); k * spacing <= maxE; k++)
    line(k * spacing, minN, k * spacing, maxN, major(k));
  for (let k = Math.ceil(minN / spacing); k * spacing <= maxN; k++)
    line(minE, k * spacing, maxE, k * spacing, major(k));
  if (0 >= minE && 0 <= maxE) line(0, minN, 0, maxN, SKP.axisY);
  if (0 >= minN && 0 <= maxN) line(minE, 0, maxE, 0, SKP.axisX);
  canvas.restore();
}
// Implement hitch line: yellow line from the vehicle hitch pivot to the tool, drawn
// under the perspective path so it clips/tilts like the other vectors. Mirrors native
// DrawToolSk's hitch segment (hitch → tool).
function drawHitchSk(canvas) {
  const tool = renderTool(), p = renderPose();
  if (!tool || !p || (!tool.e && !tool.n)) return;
  const veh = config && config.vehicle, tl = config && config.tool;
  if (!veh || !tl) return;
  if (!SKP.hitch) {
    SKP.hitch = new CK.Paint();
    SKP.hitch.setStyle(CK.PaintStyle.Stroke);
    SKP.hitch.setColor(ckColor('#FFFF00'));
    SKP.hitch.setStrokeWidth(3);
    SKP.hitch.setAntiAlias(true);
    SKP.hitch.setStrokeCap(CK.StrokeCap.Round);
  }
  const type = tl.type | 0; // 0 front, 1 rear, 2 TBT, 3 trailing (ToolConfigDto)
  if (type === 3 || type === 2) {
    // Trailing / TBT: a single tongue line from the vehicle hitch pivot to the tool.
    if (tick && tick.hitchE != null && (tick.hitchE || tick.hitchN))
      strokePtsSk(canvas, [{ e: tick.hitchE, n: tick.hitchN }, { e: tool.e, n: tool.n }], false, SKP.hitch);
    return;
  }
  // Mounted (front/rear 3-point): two arms from the tractor mount (rear axle, or
  // wheelbase ahead for front-mount) ± a lateral spread, converging on the tool.
  // Mirrors native: spread = trackWidth*0.3; base = pivot (+wheelbase ahead if front).
  const spread = veh.trackWidth * 0.3;
  const front = type === 0;
  const baseE = p.e + (front ? Math.sin(p.heading) * veh.wheelbase : 0);
  const baseN = p.n + (front ? Math.cos(p.heading) * veh.wheelbase : 0);
  const ps = Math.cos(p.heading), pc = -Math.sin(p.heading); // perpendicular (= native cosV,sinV)
  strokePtsSk(canvas, [{ e: baseE - ps * spread, n: baseN - pc * spread }, { e: tool.e, n: tool.n }], false, SKP.hitch);
  strokePtsSk(canvas, [{ e: baseE + ps * spread, n: baseN + pc * spread }, { e: tool.e, n: tool.n }], false, SKP.hitch);
}
// Pure Pursuit goal marker (#95): where the steering aims — the engaged target, or before
// engaging the point it would chase — as AgOpenGPS's yellow goal square. A lazy (long)
// look-ahead shows as the marker sitting further out. Fixed screen size, drawn over the
// vehicle so a short hold look-ahead under the sprite is still visible.
function drawGoalSk(canvas) {
  const g = renderGoal();
  if (!g || pw(g.e, g.n) < 1.0) return; // none / behind the near plane
  if (!SKP.goalFill) {
    SKP.goalFill = new CK.Paint();
    SKP.goalFill.setStyle(CK.PaintStyle.Fill);
    SKP.goalFill.setColor(ckColor('#FFD400'));
    SKP.goalFill.setAntiAlias(true);
    SKP.goalOutline = new CK.Paint();
    SKP.goalOutline.setStyle(CK.PaintStyle.Stroke);
    SKP.goalOutline.setColor(ckColor('#000000'));
    SKP.goalOutline.setStrokeWidth(2);
    SKP.goalOutline.setAntiAlias(true);
  }
  const xy = w2s(g.e, g.n), h = 6;
  const r = CK.LTRBRect(xy[0] - h, xy[1] - h, xy[0] + h, xy[1] + h);
  canvas.drawRect(r, SKP.goalFill);
  canvas.drawRect(r, SKP.goalOutline);
}
// Vehicle: the TractorAoG sprite drawn world-sized on the ground (scales with zoom,
// foreshortens under tilt), sized from track-width/wheelbase via the same normalized
// sprite proportions as native (BitmapTractorSize). Falls back to the screen-space
// triangle until the image/config is ready. Native sequence: translate→rotate(-heading)
// →flip Y→draw bitmap into the rear-axle-anchored rect.
const SPR_REAR = 0.245, SPR_FRONT = 0.75, SPR_HALFX = 0.245; // bitmap norm anchors (native)
// Vector line weights: native uses world-metre stroke widths × strokeMult (3) drawn in
// world space, so they scale with zoom (no per-pixel factor — that's only the grid). We
// stroke in screen space, so set px = worldMetres × pxPerM each frame (min 1 px so lines
// don't vanish when zoomed far out). Values = native SkiaMapControl widths × 3.
function updateLineWidths() {
  // World-metre widths scaled by zoom, but CAPPED at MAXW px so a line can't balloon when
  // zoomed in and swallow the implement/vehicle (issue #38: a 3 m boundary line covered a
  // 4 m tool). Min 1 px so it stays visible zoomed out.
  // AutoSteer › Line width (AgOpenGPS ABLine.lineWidth, px, default 2) scales the guidance
  // lines, headland/U-turn and saved tracks (#110).
  const k = Math.max(1, (config && config.autosteer && config.autosteer.lineWidth) || 2) / 2;
  const z = pxPerM, MAXW = 3.5 * k, w = (m) => Math.min(Math.max(m * z * k, k), MAXW);
  applyLineSmoothing();
  // Boundaries keep a fixed width, as in AgOpenGPS CFence (not scaled by Line width).
  const wb = (m) => Math.min(Math.max(m * z, 1), 3.5);
  SKP.boundary.setStrokeWidth(wb(3.0));   // boundaryOuter 1 × 3
  SKP.boundaryInner.setStrokeWidth(wb(3.0)); // boundaryInner 1 × 3
  SKP.headland.setStrokeWidth(w(3.0));   // headland 1 × 3
  SKP.guidance.setStrokeWidth(w(1.5));   // trackActive 0.5 × 3
  SKP.reference.setStrokeWidth(w(0.9));  // trackBaseDash 0.3 × 3
  SKP.next.setStrokeWidth(w(1.2));       // trackNext 0.4 × 3
  SKP.uturn.setStrokeWidth(w(3.0));      // youTurn 1 × 3
  SKP.track.setStrokeWidth(w(1.5));      // saved tracks ~ active weight
  SKP.extraGuide.setStrokeWidth(w(0.9)); // extra guide 0.3 × 3
  SKP.extraGuideShadow.setStrokeWidth(w(1.2));
  SKP.recPath.setStrokeWidth(2 * k); SKP.contourStrip.setStrokeWidth(2 * k);
}
// Screen & Alerts › Smoothing (AgOpenGPS isLineSmooth → GL LineSmooth): anti-aliased
// map lines, or crisp ones when off (#110).
let lineSmoothApplied = null;
function applyLineSmoothing() {
  const on = !(config && config.display && config.display.lineSmoothEnabled === false);
  if (on === lineSmoothApplied || !SKP) return;
  lineSmoothApplied = on;
  for (const key of Object.keys(SKP)) {
    const p = SKP[key];
    if (p && typeof p.setAntiAlias === 'function' && key !== 'lbFill' && key !== 'ground') p.setAntiAlias(on);
  }
}
// Draw a sprite in the vehicle frame (+Y forward) centred on (cx, cy) with half-extents
// (hx, hy), bitmap top row toward +Y — AgOpenGPS Texture2D.DrawCentered with its V flip.
function drawVehSprite(canvas, sk, cx, cy, hx, hy, rotDeg, paint) {
  canvas.save();
  canvas.translate(cx, cy);
  if (rotDeg) canvas.rotate(rotDeg, 0, 0);
  canvas.scale(1, -1);
  canvas.drawImageRectOptions(sk, CK.LTRBRect(0, 0, sk.width(), sk.height()),
    CK.LTRBRect(-hx, -hy, hx, hy), CK.FilterMode.Linear, CK.MipmapMode.None, paint || null);
  canvas.restore();
}
// Harvester / articulated bodies (issue #88), laid out as AgOpenGPS CVehicle.DrawVehicle:
//  harvester  — body 2·tw × 3·wb centred on the pivot; steerable wheels at the REAR axle
//               (−wb), turned the opposite way to a tractor, tinted HarvesterWheelColor.
//  articulated — front/rear halves 2·tw × 1.3·wb centred ±wb/2 about the hinge, each
//               turned by half the steer angle in opposite directions.
// Returns false until the sprites are loaded so the caller falls back to the triangle.
function vehicleBodySk(canvas, p, veh, type) {
  const tw = veh.trackWidth, wb = veh.wheelbase;
  const steer = tick ? tick.vehicleSteerAngle : 0; // degrees, +right
  if (type === 1) {
    const body = skSprite(harvesterSpr);
    if (!body) return false;
    beginVehicleFrame(canvas, p);
    const wheel = frontWheelReady && (skFrontWheel || (skFrontWheel = CK.MakeImageFromCanvasImageSource(frontWheelImg)));
    if (wheel) {
      if (!SKP.harvesterWheel) {
        SKP.harvesterWheel = new CK.Paint();
        SKP.harvesterWheel.setColorFilter(CK.ColorFilter.MakeBlend(CK.Color(20, 20, 20, 1), CK.BlendMode.Modulate));
      }
      for (const sx of [1, -1]) drawVehSprite(canvas, wheel, sx * tw / 2, -wb, 0.25 * tw, 0.5 * wb, steer, SKP.harvesterWheel);
    }
    drawVehSprite(canvas, body, 0, 0, tw, 1.5 * wb, 0);
  } else {
    const front = skSprite(artFrontSpr), rear = skSprite(artRearSpr);
    if (!front || !rear) return false;
    beginVehicleFrame(canvas, p);
    drawVehSprite(canvas, rear, 0, -wb / 2, tw, 0.65 * wb, steer / 2);
    drawVehSprite(canvas, front, 0, wb / 2, tw, 0.65 * wb, -steer / 2);
  }
  canvas.restore();
  return true;
}
function beginVehicleFrame(canvas, p) {
  canvas.save();
  canvas.concat(perspM);
  canvas.translate(p.e - camE, p.n - camN); // camera-relative (f64) — see buildScreenMatrix
  canvas.rotate(-p.heading * 180 / Math.PI, 0, 0); // vehicle frame: +Y forward, +X right (matches native)
}
// Svenn arrow (AgOpenGPS CVehicle): a yellow chevron ahead of the front axle that keeps
// its size on screen, so the heading reads at any zoom (#110).
function svennArrowSk(canvas, p) {
  const veh = config && config.vehicle, disp = config && config.display;
  if (!veh || !disp || !disp.svennArrowVisible) return;
  const camDist = vh / pxPerM;                // ~ AgOpenGPS camSetDistance (m)
  const dist = camDist * 0.07, width = dist * 0.22, wb = veh.wheelbase || 3;
  if (!SKP.svenn) { SKP.svenn = new CK.Paint(); SKP.svenn.setStyle(CK.PaintStyle.Stroke); SKP.svenn.setColor(ckColor('rgb(242,242,26)')); SKP.svenn.setStrokeJoin(CK.StrokeJoin.Round); SKP.svenn.setStrokeCap(CK.StrokeCap.Round); lineSmoothApplied = null; }
  const lw = Math.max(1, (config.autosteer && config.autosteer.lineWidth) || 2);
  SKP.svenn.setStrokeWidth(lw / pxPerM);      // px → metres (drawn in the vehicle frame)
  const path = CK.Path.MakeFromCmds([
    CK.MOVE_VERB, width, wb + dist,
    CK.LINE_VERB, 0, wb + width + 0.5 + dist,
    CK.LINE_VERB, -width, wb + dist,
  ]);
  if (!path) return;
  beginVehicleFrame(canvas, p);
  canvas.drawPath(path, SKP.svenn);
  canvas.restore();
  path.delete();
}
function vehicleSk(canvas, p) {
  const veh = config && config.vehicle;
  const type = veh ? Math.max(0, Math.min(2, veh.type | 0)) : 0; // 0 Tractor / 1 Harvester / 2 Articulated
  if (type !== 0 && veh.trackWidth > 0.01 && veh.wheelbase > 0.01 && vehicleBodySk(canvas, p, veh, type)) return;
  if (type === 0 && tractorReady && veh && veh.trackWidth > 0.01 && veh.wheelbase > 0.01) {
    if (!skTractor) skTractor = CK.MakeImageFromCanvasImageSource(tractorImg);
    if (skTractor) {
      const bW = veh.trackWidth / (2 * SPR_HALFX);
      const bH = veh.wheelbase / (SPR_FRONT - SPR_REAR);
      const half = bW / 2, top = (1 - SPR_REAR) * bH, bot = -SPR_REAR * bH;
      beginVehicleFrame(canvas, p);
      // Body sprite (scale 1,-1 = bitmap rows top-down → world N up).
      canvas.save();
      canvas.scale(1, -1);
      canvas.drawImageRectOptions(skTractor,
        CK.LTRBRect(0, 0, skTractor.width(), skTractor.height()),
        CK.LTRBRect(-half, -top, half, -bot),
        CK.FilterMode.Linear, CK.MipmapMode.None, null);
      canvas.restore();
      // Steerable front wheels: one sprite drawn at both front-axle ends, rotated by the
      // live wheel angle. Mirrors native DrawVehicleSk (translate ±trackWidth/2, wheelbase
      // −0.05; rotate −steer; scale 1,-1; centred dst). Tire sizing = native constants.
      if (frontWheelReady && (skFrontWheel || (skFrontWheel = CK.MakeImageFromCanvasImageSource(frontWheelImg)))) {
        const steerDeg = -(tick ? tick.vehicleSteerAngle : 0); // tick angle already in degrees, +right
        const woX = veh.trackWidth / 2, woY = veh.wheelbase - 0.05;
        const ww = 0.378 / 0.27, wh = 0.85 / 0.29; // FrontTireWidth/ContentW, Diameter/ContentH
        const wsrc = CK.LTRBRect(0, 0, skFrontWheel.width(), skFrontWheel.height());
        const wdst = CK.LTRBRect(-ww / 2, -wh / 2, ww / 2, wh / 2);
        for (const sx of [1, -1]) {
          canvas.save();
          canvas.translate(sx * woX, woY);
          canvas.rotate(steerDeg, 0, 0);
          canvas.scale(1, -1);
          canvas.drawImageRectOptions(skFrontWheel, wsrc, wdst, CK.FilterMode.Linear, CK.MipmapMode.None, null);
          canvas.restore();
        }
      }
      canvas.restore();
      return;
    }
  }
  const xy = w2s(p.e, p.n);
  canvas.save();
  canvas.translate(xy[0], xy[1]);
  canvas.rotate(screenHeading(p.e, p.n, p.heading) * 180 / Math.PI, 0, 0); // degrees; ground-aligned under tilt
  if (skTri) canvas.drawPath(skTri, SKP.vehicle);
  canvas.restore();
}
// Background imagery as an SkImage — decoded once from the loaded <img> and
// cached, re-decoded only when the imagery version changes (same trigger as the
// 2D path's <img> swap). drawImageRectOptions with Linear filtering = the 2D
// path's imageSmoothingEnabled=true.
// Tiled ground texture: a repeating shader over a camera-centred world rect, drawn under
// the perspective matrix so it foreshortens with tilt. One tile = 50 m, matching native
// SkiaMapControl.DrawGroundTextureSk. CanvasKit's makeShaderOptions localMatrix maps
// texel→local(world) (the inverse of native SkShader.CreateBitmap), so W texels span 50 m
// when the scale is 50/W. Shader + paint are built once (world-anchored — no per-frame
// rebuild; the tiles stay fixed in the world and scroll under the vehicle).
function drawGroundTextureSk(canvas) {
  const disp = config && config.display;
  if (!disp || !disp.fieldTextureVisible) return;
  if (mapIsDay ? !groundReadyDay : !groundReadyNight) return;
  let skGround = mapIsDay ? skGroundDay : skGroundNight;
  if (!skGround) {
    skGround = CK.MakeImageFromCanvasImageSource(mapIsDay ? groundImgDay : groundImgNight);
    if (!skGround) return;
    if (mapIsDay) skGroundDay = skGround; else skGroundNight = skGround;
    if (!SKP.ground) { SKP.ground = new CK.Paint(); SKP.ground.setAntiAlias(false); }
  }
  const W = skGround.width(), H = skGround.height();
  // We render camera-relative, but the tiles must stay anchored to WORLD. The pattern
  // repeats every 50 m, so only camE,camN MOD 50 affects alignment — using the remainder
  // keeps the shader's local-matrix translation small (f32-safe → no shimmer). texel =
  // (W/50)(P + off) ⇒ texel→local matrix is scale(50/W) then translate(-off).
  // Texture Moves off: the tiles stay fixed to the camera instead of the world (#110).
  const moves = disp.fieldTextureMoveable !== false;
  const offE = moves ? camE - Math.floor(camE / 50) * 50 : 0;
  const offN = moves ? camN - Math.floor(camN / 50) * 50 : 0;
  const lm = [50 / W, 0, -offE, 0, 50 / H, -offN, 0, 0, 1];
  if (SKP.groundShader) SKP.groundShader.delete(); // free last frame's shader (already flushed)
  SKP.groundShader = skGround.makeShaderOptions(
    CK.TileMode.Repeat, CK.TileMode.Repeat, CK.FilterMode.Linear, CK.MipmapMode.Linear, lm);
  SKP.ground.setShader(SKP.groundShader);
  const half = Math.max(Math.max(vw, vh) / pxPerM, 300); // cover the view; see far under tilt
  canvas.save();
  canvas.concat(perspM);
  canvas.drawRect(CK.LTRBRect(-half, -half, half, half), SKP.ground); // camera-relative
  canvas.restore();
}
let skImagery = null, skImageryVer = null, skImageryMult = -1;
function drawImagerySk(canvas) {
  if (!imageryImg || !imageryRect) return;
  // Quality button: scale the imagery LOD by DisplayResolutionMultiplier so the background
  // degrades with quality like native's Apple composite path (which bakes imagery into the
  // multiplier-sized coverage bitmap). Ultra = full res; lower quality = downsampled (also a
  // real GPU/memory win on the tablet). Downsample via a 2D canvas (reliable browser scaling).
  const mult = (config && config.display && config.display.resolutionMultiplier) || 1;
  if (skImageryVer !== imageryVer || skImageryMult !== mult || !skImagery) {
    if (skImagery) skImagery.delete();
    let src = imageryImg;
    if (mult > 1.01 && imageryImg.naturalWidth > 0) {
      const w = Math.max(1, Math.round(imageryImg.naturalWidth / mult));
      const h = Math.max(1, Math.round(imageryImg.naturalHeight / mult));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(imageryImg, 0, 0, w, h);
      src = cv;
    }
    skImagery = CK.MakeImageFromCanvasImageSource(src);
    skImageryVer = imageryVer;
    skImageryMult = mult;
  }
  if (!skImagery) return;
  const r = imageryRect;
  drawImageWorldSk(canvas, skImagery, r.minE, r.minN, r.maxE, r.maxN, CK.FilterMode.Linear);
}
// Draw a north-up image over a world rect under the perspective matrix. The image
// (top row = high northing) is placed via a px→world affine, then perspM warps it
// — Skia does perspective-correct sampling AND near-plane clipping on the GPU, so
// it stays correct even when part of the rect falls behind the tilted camera.
function drawImageWorldSk(canvas, img, minE, minN, maxE, maxN, filter, mipMode) {
  const w = img.width(), h = img.height();
  // Map image px → CAMERA-RELATIVE world (minE-camE …): the world−camera offset is done
  // here in f64 so only small coords reach the f32 matrix — no floating-origin jitter on
  // imagery/coverage. See buildScreenMatrix.
  const imgToWorld = [(maxE - minE) / w, 0, minE - camE, 0, -(maxN - minN) / h, maxN - camN, 0, 0, 1];
  // Photo layers (imagery / satellite tiles, Linear filter) recede to the horizon
  // under perspective → heavy minification → shimmer/crawl under motion without a
  // mip chain. Trilinear mipmaps fix it (matches native's mipmapped imagery). Callers
  // may override the mip mode: coverage uses Linear sampling but mip-free, so its edges
  // smooth (bilinear) without paying the per-update mip-regen on a multi-MP texture.
  const mip = (mipMode !== undefined) ? mipMode
    : ((filter === CK.FilterMode.Linear) ? CK.MipmapMode.Linear : CK.MipmapMode.None);
  canvas.save();
  canvas.concat(perspM);
  canvas.concat(imgToWorld);
  canvas.drawImageOptions(img, 0, 0, filter, mip, null);
  canvas.restore();
}
// ---- satellite tile underlay (Phase MT — Draw boundary on map) ----
// A slippy-map of keyless Bing aerial tiles drawn world-positioned under the field, so
// the existing pan/zoom frames it and the s2w tap primitive draws the boundary on it.
// Tiles are proxied through the host (/sattile/<quadkey>) to avoid CORS taint. Flat-earth
// E/N↔lat/lon around the field origin is sub-metre accurate at field scale (the saved
// imagery uses the host's precise LocalPlane); good enough to draw against.
const MPD_LAT = 111320; // metres per degree latitude (flat-earth)
function mpdLon() { return MPD_LAT * Math.cos(originLat * Math.PI / 180); }
function enToLon(e) { return originLon + e / mpdLon(); }
function enToLat(n) { return originLat + n / MPD_LAT; }
function lonToE(lon) { return (lon - originLon) * mpdLon(); }
function latToN(lat) { return (lat - originLat) * MPD_LAT; }
function lonToTileX(lon, z) { return Math.floor((lon + 180) / 360 * (1 << z)); }
function latToTileY(lat, z) {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (1 << z));
}
function tileXToLon(x, z) { return x / (1 << z) * 360 - 180; }
function tileYToLat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / (1 << z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
function tileQuadkey(x, y, z) {
  let qk = '';
  for (let i = z; i > 0; i--) {
    let d = 0; const m = 1 << (i - 1);
    if (x & m) d += 1;
    if (y & m) d += 2;
    qk += d;
  }
  return qk;
}
// Pick the Bing zoom whose ground resolution ≈ the screen resolution (1 tile px ≈ 1 css px).
function satZoom() {
  const z = Math.log2(156543.03392 * Math.cos(originLat * Math.PI / 180) * pxPerM);
  return Math.max(2, Math.min(20, Math.round(z)));
}
// Bing has no tiles past its coverage (rural areas often stop at z19 or below); the host
// answers 404 for those and the tile is drawn from its nearest ancestor instead. A failed
// fetch (502, no network) is asked again after SAT_RETRY_MS.
const SAT_FILL_LEVELS = 6, SAT_RETRY_MS = 15000;
const satTiles = new Map(); // "z/x/y" → { img, url, skImg, none, retryAt }
function loadSatTile(t, x, y, z) {
  const retry = () => { t.retryAt = performance.now() + SAT_RETRY_MS; };
  t.retryAt = 0;
  fetch('/sattile/' + tileQuadkey(x, y, z))
    .then(r => {
      if (r.status === 404) { t.none = true; return null; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    })
    .then(b => {
      if (!b) return;
      const im = new Image();
      im.onload = () => { t.img = im; };
      im.onerror = () => { URL.revokeObjectURL(im.src); retry(); };
      im.src = t.url = URL.createObjectURL(b);
    })
    .catch(retry);
}
function getSatTile(x, y, z) {
  const key = z + '/' + x + '/' + y;
  let t = satTiles.get(key);
  if (!t) {
    t = { img: null, url: null, skImg: null, none: false, retryAt: 0 };
    satTiles.set(key, t);
    loadSatTile(t, x, y, z);
    if (satTiles.size > 500) {
      const k = satTiles.keys().next().value, ev = satTiles.get(k);
      if (ev.skImg) ev.skImg.delete();
      if (ev.url) URL.revokeObjectURL(ev.url);
      satTiles.delete(k);
    }
  } else if (t.retryAt && performance.now() >= t.retryAt) loadSatTile(t, x, y, z);
  if (t.img && !t.skImg) {
    t.skImg = CK.MakeImageFromCanvasImageSource(t.img);
    URL.revokeObjectURL(t.url); t.url = null; t.img = null;
  }
  return t;
}
function drawSatTileSk(canvas, img, tx, ty, z) {
  const eW = lonToE(tileXToLon(tx, z)), eE = lonToE(tileXToLon(tx + 1, z));
  const nN = latToN(tileYToLat(ty, z)), nS = latToN(tileYToLat(ty + 1, z));
  drawImageWorldSk(canvas, img, eW, nS, eE, nN, CK.FilterMode.Linear);
}
function drawSatelliteSk(canvas) {
  if (!satEnabled || (!originLat && !originLon)) return;
  const z = satZoom();
  let halfW = (vw / 2) / pxPerM, halfH = (vh / 2) / pxPerM;
  halfW = Math.max(halfW, 50); halfH = Math.max(halfH, 50);
  if (mapRotation !== 0) { const d = Math.hypot(halfW, halfH); halfW = d; halfH = d; }
  // Visible E/N → lat/lon corners → tile range.
  const lonW = enToLon(camE - halfW), lonE = enToLon(camE + halfW);
  const latN = enToLat(camN + halfH), latS = enToLat(camN - halfH);
  const xMin = lonToTileX(lonW, z), xMax = lonToTileX(lonE, z);
  const yMin = latToTileY(latN, z), yMax = latToTileY(latS, z); // y grows southward
  if ((xMax - xMin) > 40 || (yMax - yMin) > 40 || xMax < xMin || yMax < yMin) return; // sanity
  // A tile not drawn yet shows its nearest loaded ancestor, each drawn once and under
  // the loaded tiles. Ancestors are only fetched for a tile Bing has none of; while a
  // tile loads, whatever is already cached stands in.
  const fill = new Map(), ready = [];
  for (let tx = xMin; tx <= xMax; tx++) for (let ty = yMin; ty <= yMax; ty++) {
    const t = getSatTile(tx, ty, z);
    if (t.skImg) { ready.push([t.skImg, tx, ty]); continue; }
    for (let up = 1; up <= SAT_FILL_LEVELS && z - up >= 1; up++) {
      const px = tx >> up, py = ty >> up, pz = z - up, key = pz + '/' + px + '/' + py;
      const p = t.none ? getSatTile(px, py, pz) : satTiles.get(key);
      if (p && p.skImg) { fill.set(key, [p.skImg, px, py, pz]); break; }
      if (t.none && !p.none) break; // still loading
    }
  }
  [...fill.values()].sort((a, b) => a[3] - b[3])
    .forEach(([img, px, py, pz]) => drawSatTileSk(canvas, img, px, py, pz));
  for (const [img, tx, ty] of ready) drawSatTileSk(canvas, img, tx, ty, z);
}
// Coverage offscreen → SkImage, re-snapshotted only when the cell grid changed
// (cov.dirty). The world blit uses Linear (bilinear) sampling so the cell-grid edge
// reads smooth instead of stair-stepped; see the blit call below for the mip-free
// rationale. The snapshot lives on the cov object so a new coverage-init naturally
// starts with a fresh (null) image.
// Fallback-path throttle (2D canvas → full re-upload): cap the expensive whole-texture
// rebuild at ~4 Hz. The GPU render-target path below has no such cost.
const COV_REBUILD_MS = 250;
// Build a fresh coverage grid for a CoverageInit. Primary: a persistent GPU render target (new
// cells drawn straight onto it, snapshotted via texture copy-on-write — no whole-texture
// re-upload). Fallback: an offscreen 2D canvas + throttled re-upload if the target can't be made.
function makeCovGrid(init) {
  const w = init.width, h = init.height;
  let surface = null;
  if (CK && grCtx) { try { surface = CK.MakeRenderTarget(grCtx, w, h); } catch (e) { surface = null; } }
  let canvas = null, cctx = null, covPaint = null;
  if (surface) {
    surface.getCanvas().clear(CK.TRANSPARENT);
    covPaint = new CK.Paint(); covPaint.setStyle(CK.PaintStyle.Fill); covPaint.setAntiAlias(false);
    // Src (replace), not SrcOver: cells carry a coverage-fraction alpha (edge cells < 1), and a
    // cell is re-emitted with rising alpha as it fills — replace sets the exact value each time;
    // SrcOver would blend re-draws and creep edges toward opaque.
    covPaint.setBlendMode(CK.BlendMode.Src);
  } else {
    canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; cctx = canvas.getContext('2d');
  }
  return {
    cellSize: init.cellSize, originE: init.originE, originN: init.originN,
    width: w, height: h, surface, covPaint, pending: [],
    canvas, cctx, dirty: true, skImg: null, lastBuild: 0,
  };
}

// Re-anchor existing coverage into a grown grid (bounds expansion, SAME cell size). The old
// painted surface is copied into the new, larger surface at the integer cell offset between the
// grids — exact, because the host shifts the grid by a whole number of cells — accounting for the
// render y-flip (surface row 0 = highest northing). Not-yet-rasterized delta batches are shifted
// into the new coords too. Nothing is re-sent by the host; the newly-added ground is empty.
function reanchorCoverage(init) {
  const cs = init.cellSize;
  const oldCov = cov;
  const offX = Math.round((oldCov.originE - init.originE) / cs);
  const offY = Math.round((oldCov.originN - init.originN) / cs);
  const nc = makeCovGrid(init);
  const destX = offX;
  const destY = (nc.height - oldCov.height) - offY; // y-flip: old image sits (maxN growth) below the top

  if (oldCov.surface && nc.surface) {
    oldCov.surface.flush();
    const img = oldCov.surface.makeImageSnapshot();
    // Nearest + integer offset = exact pixel copy (no resample).
    nc.surface.getCanvas().drawImageOptions(img, destX, destY, CK.FilterMode.Nearest, CK.MipmapMode.None, null);
    img.delete();
    nc.surface.flush();
  } else if (oldCov.canvas && nc.canvas) {
    nc.cctx.drawImage(oldCov.canvas, destX, destY);
  }
  // else: render-target mode changed across the grow (rare) — old coverage isn't carried; deltas
  // repaint going forward and the next full reload/reconnect reseeds. No crash, no misplacement.
  nc.dirty = true;

  // Carry queued (not-yet-drained) delta batches, shifted into the new grid coords.
  for (const b of oldCov.pending) {
    const c = b.cells;
    for (let i = 0; i + 2 < c.length; i += 3) { c[i] += offX; c[i + 1] += offY; }
    nc.pending.push(b);
  }

  if (oldCov.skImg) oldCov.skImg.delete();
  if (oldCov.surface) oldCov.surface.delete();
  if (oldCov.covPaint) oldCov.covPaint.delete();
  cov = nc;
}

function drawCoverageSk(canvas) {
  if (!cov) return;
  // Only rasterize batches that have aged past RENDER_DELAY, so coverage lands on the same
  // playback timeline as the render-delayed tool (see onCoverageCells). pending is FIFO in
  // arrival time, so the first not-yet-aged batch ends the drain.
  const cutoff = performance.now() - RENDER_DELAY;
  if (cov.surface) {
    // GPU render target: draw only the aged pending NEW cells onto it, then snapshot (a GPU
    // texture COW — cheap). No whole-texture upload, so no regular per-rebuild stutter.
    if (cov.pending.length && cov.pending[0].t <= cutoff) {
      const sk = cov.surface.getCanvas(), paint = cov.covPaint, H = cov.height;
      let lastRgb = -1, drained = 0, budget = COV_DRAIN_BUDGET;
      for (const batch of cov.pending) {
        if (batch.t > cutoff) break;
        const c = batch.cells;
        let i = batch.off || 0; // resume a batch we ran out of budget on last frame
        for (; i + 2 < c.length && budget > 0; i += 3) {
          const x = c[i], y = c[i + 1], v = c[i + 2] >>> 0; // (a<<24)|(r<<16)|(g<<8)|b
          if (v !== lastRgb) { paint.setColor(CK.Color((v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF, ((v >>> 24) & 0xFF) / 255)); lastRgb = v; covEdgeRgb = v & 0xFFFFFF; }
          sk.drawRect(CK.XYWHRect(x, H - 1 - y, 1, 1), paint); // flip: high northing at top
          covCells++; budget--;
        }
        if (i + 2 < c.length) { batch.off = i; break; } // budget hit mid-batch; finish next frame
        drained++;
      }
      cov.pending.splice(0, drained);
      cov.surface.flush();
      cov.dirty = true;
    }
    if (cov.dirty || !cov.skImg) {
      if (cov.skImg) cov.skImg.delete();
      cov.skImg = cov.surface.makeImageSnapshot();
      cov.dirty = false;
    }
  } else {
    const nowMs = performance.now();
    // 2D fallback: drain aged batches into the offscreen canvas (same RENDER_DELAY gate).
    if (cov.pending.length && cov.pending[0].t <= cutoff) {
      const H = cov.height, cctx = cov.cctx;
      let lastRgb = -1, drained = 0, budget = COV_DRAIN_BUDGET;
      for (const batch of cov.pending) {
        if (batch.t > cutoff) break;
        const c = batch.cells;
        let i = batch.off || 0; // resume a batch we ran out of budget on last frame
        for (; i + 2 < c.length && budget > 0; i += 3) {
          const x = c[i], y = c[i + 1], v = c[i + 2] >>> 0; // (a<<24)|(r<<16)|(g<<8)|b
          if (v !== lastRgb) {
            cctx.fillStyle = 'rgba(' + ((v >> 16) & 0xFF) + ',' + ((v >> 8) & 0xFF) + ',' + (v & 0xFF) + ',' + (((v >>> 24) & 0xFF) / 255) + ')';
            lastRgb = v;
          }
          // clear+fill = replace (the 2D analogue of BlendMode.Src) so re-emitted edge
          // cells set their exact alpha instead of blending toward opaque.
          cctx.clearRect(x, H - 1 - y, 1, 1);
          cctx.fillRect(x, H - 1 - y, 1, 1); // flip: high northing at offscreen top
          covCells++; budget--;
        }
        if (i + 2 < c.length) { batch.off = i; break; } // budget hit mid-batch; finish next frame
        drained++;
      }
      cov.pending.splice(0, drained);
      cov.dirty = true;
    }
    if (!cov.skImg || (cov.dirty && nowMs - (cov.lastBuild || 0) >= COV_REBUILD_MS)) {
      if (cov.skImg) cov.skImg.delete();
      cov.skImg = CK.MakeImageFromCanvasImageSource(cov.canvas);
      cov.dirty = false;
      cov.lastBuild = nowMs;
    }
  }
  if (!cov.skImg) return;
  const cs = cov.cellSize;
  const minE = cov.originE, minN = cov.originN;
  const maxE = cov.originE + cov.width * cs, maxN = cov.originN + cov.height * cs;
  // Bilinear (Linear), mip-free: smooths the cell-grid stair-step at the worked-area edge
  // without the per-update mip-regen cost. The surface is cleared to premultiplied
  // TRANSPARENT, so the boundary fades cleanly to transparent (no dark fringe).
  drawImageWorldSk(canvas, cov.skImg, minE, minN, maxE, maxN, CK.FilterMode.Linear, CK.MipmapMode.None);
}
// Crisp worked-area edge — the server-fed vector perimeter (only segments that don't adjoin
// another pass), stroked in the coverage colour over the raster so the soft alpha-AA feather
// is replaced by a sharp boundary. Bounded by perimeter length, so cost is ~flat regardless
// of field size. Stroke width 0.6 m (covers the feather): the host sends the line 0.3 m inside
// the swept edge (EDGE_STROKE_WIDTH in CoverageMapService), so the stroke ends at the edge of the
// tool, and the caps are butt so it doesn't run past the ends of a pass either (#325). Polylines
// are broken at the near plane per vertex (see below). Reloaded fields have no perimeter
// (graceful fall back to feather).
function drawCoverageEdgeSk(canvas) {
  if (EDGE_OFF || !coverageEdges || !coverageEdges.length) return;
  const p = SKP.covEdge || (SKP.covEdge = (() => {
    const q = new CK.Paint(); q.setStyle(CK.PaintStyle.Stroke); q.setAntiAlias(true);
    q.setStrokeCap(CK.StrokeCap.Butt); q.setStrokeJoin(CK.StrokeJoin.Round); return q;
  })());
  const c = covEdgeRgb;
  p.setColor(CK.Color((c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF, 1));
  p.setStrokeWidth(Math.max(1, 0.6 * pxPerM));
  // Per-vertex near-plane gate: a vertex at/behind the near plane (homogeneous w ≤ NEAR)
  // projects through w2s to a huge/flipped coord, so a polyline crossing behind the camera
  // would shoot a stroke to infinity (seen on zoom/tilt). Break the polyline at those
  // vertices and draw each in-front run separately — no clipping math, no infinity lines.
  const NEAR = 0.02;
  const flush = (cmds) => {
    if (cmds && cmds.length >= 6) { const path = CK.Path.MakeFromCmds(cmds); if (path) { canvas.drawPath(path, p); path.delete(); } }
  };
  for (const pl of coverageEdges) {
    if (pl.length < 2) continue;
    let cmds = null;
    for (let i = 0; i < pl.length; i++) {
      if (pw(pl[i].e, pl[i].n) < NEAR) { flush(cmds); cmds = null; continue; } // behind near plane → break
      const xy = w2s(pl[i].e, pl[i].n);
      if (!cmds) cmds = [CK.MOVE_VERB, xy[0], xy[1]];
      else cmds.push(CK.LINE_VERB, xy[0], xy[1]);
    }
    flush(cmds);
  }
}
// Tool/section footprint — section bars perpendicular to the (dead-reckoned) tool
// heading, coloured by ColorCode. Same geometry as the 2D toolFootprint().
// Tool footprint: each section a filled 2 m-deep rect (coloured by ColorCode) with a
// thin black outline + a 0.05 m inter-section gap, matching native DrawToolSk. The four
// world corners come from the perpendicular (left/right) and forward (depth) directions;
// all four are projected via w2s (the tool is always near the camera, so no near-plane
// clipping is needed) and filled/stroked as a quad.
function toolFootprintSk(canvas) {
  const t = renderTool();
  if (!t || !scene || !scene.toolSections || !scene.toolSections.length) return;
  if (!t.e && !t.n) return;
  const perp = t.heading + Math.PI / 2;
  const ps = Math.sin(perp), pc = Math.cos(perp);        // perpendicular (right) dir
  const hs = Math.sin(t.heading), hc = Math.cos(t.heading); // forward (depth) dir
  const depth = 1.0, halfGap = 0.025;                    // toolDepth 2 m; 0.05 m gap
  const secs = (tick && tick.sections) || [];
  const quad = (L, R) => {
    const cmds = [];
    const corners = [[L, -depth], [R, -depth], [R, depth], [L, depth]];
    for (let k = 0; k < 4; k++) {
      const off = corners[k][0], d = corners[k][1];
      const xy = w2s(t.e + ps * off + hs * d, t.n + pc * off + hc * d);
      cmds.push(k === 0 ? CK.MOVE_VERB : CK.LINE_VERB, xy[0], xy[1]);
    }
    cmds.push(CK.CLOSE_VERB);
    return CK.Path.MakeFromCmds(cmds);
  };
  for (let i = 0; i < scene.toolSections.length; i++) {
    const span = scene.toolSections[i];
    const L = span.left + halfGap, R = span.right - halfGap;
    if (R - L < 0.01) continue;
    const path = quad(L, R);
    if (!path) continue;
    canvas.drawPath(path, SKP.sectionFill[secs[i]] || SKP.sectionFill[5]);
    canvas.drawPath(path, SKP.sectionOutline);
    path.delete();
  }
}
// Lightbar — screen-space LED strip, identical logic/geometry to the 2D
// lightbar(). The arrow + cm/label text lives in the HUD div (no CanvasKit font
// bundled), so here we draw only the LEDs. Drawn in CSS px
// (under renderSkia's scale(dpr)), so it must run before canvas.restore().
function lightbarSk(canvas) {
  // GuidanceBarOn is the master; SteerBarEnabled picks the mode (steer-angle error vs
  // cross-track). Mirrors the native LightBarPanel.
  const cfg = config && config.autosteer;
  if (!tick || !tick.guidanceActive || !cfg || !cfg.guidanceBarOn) return;
  if (!cfg.lightbarEnabled) return; // the Light bar toggle (AgOpenGPS isLightbarOn, #111)
  const SEG = 15, W = 18, H = 16, GAP = 4;
  const mid = (SEG - 1) / 2;
  const steerMode = !!cfg.steerBarEnabled;
  let val, PER, onThresh;
  if (steerMode) {
    val = tick.steerAngleError || 0;                          // actual − commanded (deg)
    const dz = (tick.op && tick.op.autoSteer) ? 0.5 : 0.2;    // AgOpen dead-zone
    if (Math.abs(val) < dz) val = 0;
    PER = 12 / mid; onThresh = dz;                            // ±12° full deflection
  } else {
    // AutoSteer › cm per pixel (AgOpenGPS lightbarCmPerPixel): cm of XTE per lit cell (#110).
    const cpp = Math.max(1, (cfg.cmPerPixel | 0) || 5);
    val = tick.crossTrackError || 0; PER = cpp / 100; onThresh = 0.05; // + = right of line
  }
  const totalW = SEG * (W + GAP) - GAP;
  const x0 = (vw - totalW) / 2, top = 54; // below the top status bar
  const lit = Math.min(Math.round(Math.abs(val) / PER), mid);
  const onLine = Math.abs(val) < onThresh;
  const steerLeft = val > 0; // lights point the way to STEER (native convention)
  const litCol = steerLeft ? '#ff7a3d' : '#39FF6A';
  const p = SKP.lbFill;
  for (let i = 0; i < SEG; i++) {
    const idx = i - mid;
    const x = x0 + i * (W + GAP);
    let on = false, col = '#1c2230';
    if (idx === 0) { on = onLine; col = on ? '#39FF6A' : '#2a3550'; }
    else if (steerLeft ? (idx < 0 && -idx <= lit) : (idx > 0 && idx <= lit)) { on = true; col = litCol; }
    p.setColor(ckColor(on ? col : '#1c2230'));
    canvas.drawRect(CK.XYWHRect(x, top, W, H), p);
  }
  // No arrow here: the readout under the strip (updateLightbarText) carries it, and one
  // drawn here sat on top of that text (#219).
}
function renderSkia(canvas, rp) {
  canvas.clear(ckColor(mapIsDay ? MAP_CLEAR.day : MAP_CLEAR.night));
  canvas.save();
  canvas.scale(dpr, dpr); // work in CSS px so w2s + stroke widths match
  updateLineWidths(); // world-metre line weights × current zoom (matches native)
  drawGroundTextureSk(canvas); // ground backdrop (under everything)
  drawSatelliteSk(canvas); // Bing aerial underlay while drawing a boundary on map
  drawImagerySk(canvas); // imagery overlays the ground where present
  drawCoverageSk(canvas);
  drawCoverageEdgeSk(canvas); // crisp vector perimeter over the raster (server-fed)
  drawGridSk(canvas);
  if (scene) {
    for (let bi = 0; bi < scene.boundaries.length; bi++)
      strokePtsSk(canvas, scene.boundaries[bi], true,
        (scene.boundaryInner && scene.boundaryInner[bi]) ? SKP.boundaryInner : SKP.boundary);
    // Headland line shows only when the headland is ON — mirrors the native
    // SetHeadlandVisible gate (IsHeadlandOn). The bottom-nav headland button drives it.
    if (scene.headland && tick && tick.tools && tick.tools.headlandOn)
      strokePtsSk(canvas, scene.headland, true, SKP.headland);
    drawExtraGuidelinesSk(canvas); // faint adjacent passes (under the bold lines)
    for (const l of scene.recordedPaths || []) strokePtsSk(canvas, l, false, SKP.recPath);   // #110
    for (const l of scene.contourStrips || []) strokePtsSk(canvas, l, false, SKP.contourStrip);
    drawContourRefSk(canvas);
    if (scene.nextTrack) strokePtsSk(canvas, scene.nextTrack, false, SKP.next);
    if (scene.uTurnPath) strokePtsSk(canvas, scene.uTurnPath, false, SKP.uturn);
    // Purple reference (extended across the field). The reference is the edge between passes
    // (PassGeometry), so pass 0 lies half a width from it; only a track driven on the line
    // itself (boundary-follow) puts the magenta guidance on top of it, and then just the one
    // line shows. Matches the host's baseTrack = (display track is the reference) ? null : track.
    const _onRef = scene.guidanceLine && scene.tracks.some(t => onPolyline(scene.guidanceLine, t.points));
    if (!_onRef) for (const tr of scene.tracks)
      strokePtsSk(canvas, extendAbLine(tr.points), false, SKP.reference);
    // Magenta current pass, extended across the field. The host's DisplayLine is only ~track
    // length (a 2-point offset AB); extendAbLine spans it full-field, so an offset pass isn't a
    // short stub. Curves are >2 points and already host-extended, so they pass through unchanged.
    if (scene.guidanceLine) strokePtsSk(canvas, extendAbLine(scene.guidanceLine), false, SKP.guidance);
    drawFlagsSk(canvas, scene.flags);
  }
  drawRecordingMarkersSk(canvas); // live recorded-path dots (independent of the Scene)
  drawBoundaryRecordingSk(canvas); // live drive-around boundary line + dots
  drawSatBoundarySk(canvas); // live boundary-on-satellite polygon being drawn
  drawAbDrawPreviewSk(canvas); // #40 — A/B (orange/blue) dots for the AB/curve being drawn
  drawCurveMarksSk(canvas); // record-curve path dots (Set Point A → B)
  drawDrawingSk(canvas); // live draw-on-map AB/curve preview (Phase MT)
  drawHeadlandDrawSk(canvas); // live headland draw preview (Field Builder stage 2)
  drawHeadlandSegEditLinesSk(canvas); // headland-editor offset lines (yellow/red) while editing
  drawTramLinesSk(canvas); // generated tram lines (orange) when tram display on / editing
  drawEditHandlesSk(canvas); // stage-4 on-map edit handles (drag points to reshape)
  drawHitchSk(canvas); // implement hitch line (under the tool footprint)
  toolFootprintSk(canvas);
  if (rp) { vehicleSk(canvas, rp); svennArrowSk(canvas, rp); }
  drawGoalSk(canvas); // #95 — Pure Pursuit target (over the vehicle)
  lightbarSk(canvas); // screen-space overlay, still inside the dpr scale
  canvas.restore();
}
// The single render loop. Window rAF (not surface.requestAnimationFrame) so it
// survives surface recreation on resize and runs even before CanvasKit finishes
// loading (DOM overlays update regardless; the GL map draws once skSurface exists).
function skFrame() {
  // Client render rate over a ~500 ms window (shown on the GPS-detail card).
  const _now = performance.now();
  if (_fpsT0 === 0) _fpsT0 = _now;
  else { _fpsFrames++; const dt = _now - _fpsT0; if (dt >= 500) { fps = _fpsFrames * 1000 / dt; _fpsFrames = 0; _fpsT0 = _now; } }
  const rp = updateCamera(); // follow mode + rotation + perspM, once per frame
  maybeSaveView();           // persist tilt/zoom changes (debounced) — issue #35
  sampleCurveMark();         // drop record-curve path dots as the vehicle drives
  if (skSurface) {
    try { renderSkia(skSurface.getCanvas(), rp); skSurface.flush(); }
    catch (e) { ckStatus = 'render err: ' + (e && e.message || e); }
  }
  // DOM overlays (independent of the GL surface).
  updateLightbarText();
  updateHeadlandHud();
  renderStatusBar();
  renderSimBar();
  renderSectionBar();
  renderBottomNav();
  renderSettings();
  renderRightNav();
  renderUTurnIndicator();
  renderAbDotLabels(); // #40 — letters beside the dropped AB/curve points
  renderRoll();
  renderCampad();
  renderCharts();
  renderRollCorr();
  renderOffsetFix();
  requestAnimationFrame(skFrame);
}
skFrame();

// ===== Tablet UI (Phase 1) ====================================================
// Cab-tablet additions, kept in this one section (CSS: <style id="tablet-ui"> in index.html)
// so the fork rebases cleanly. Per-device settings in localStorage:
//   aow.ui.scale = normal | large | glove   — touch-target size
//   aow.ui.sun   = 1                        — sun theme (high contrast; day theme only)
// Display only: no new commands, nothing sent to the host changes. The upstream render
// functions wrapped below keep their behaviour; the wrappers only recolour/restyle the map
// in the sun theme and shift the canvas light bar under a taller status bar.
let tuiBarDy = null; // canvas light bar offset, set by the Phase 2 layout (null = Phase 1 offset)
const TabletUi = (() => {
  const SCALES = ['normal', 'large', 'glove'];
  const DY = { normal: 0, large: 10, glove: 18 }; // = --tui-dy in index.html
  const lsGet = (k, d) => { try { const v = window.localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch (_) { /* private / blocked */ } };
  let scale = SCALES.includes(lsGet('aow.ui.scale', 'normal')) ? lsGet('aow.ui.scale', 'normal') : 'normal';
  let sun = lsGet('aow.ui.sun', '0') === '1';
  const root = document.documentElement;

  function apply() {
    root.setAttribute('data-tui-scale', scale);
    if (sun) root.setAttribute('data-tui-sun', ''); else root.removeAttribute('data-tui-sun');
    syncSettingsUi();
  }

  // --- Settings rows in Screen & Alerts (own classes: the panel's .sa-tgl handlers send config.set)
  const sa = document.getElementById('screenalerts');
  const box = document.createElement('div');
  box.innerHTML =
    '<div class="cfg-label">' + tr('Touch & Contrast (this device)') + '</div>' +
    '<div class="tui-seg">' +
    '<button class="tui-opt" data-tui-scale="normal">' + tr('Normal') + '</button>' +
    '<button class="tui-opt" data-tui-scale="large">' + tr('Large') + '</button>' +
    '<button class="tui-opt" data-tui-scale="glove">' + tr('Glove') + '</button>' +
    '<button class="tui-opt" data-tui-sun="1">' + tr('Sun') + '</button>' +
    '</div>' +
    '<div class="tui-hint">' + tr('Glove: every button at least 64 px. Sun: black on white for bright daylight; works with the day theme.') + '</div>';
  if (sa) sa.insertBefore(box, sa.querySelector('.cfg-label'));
  for (const b of box.querySelectorAll('.tui-opt')) {
    b.addEventListener('pointerdown', e => {
      e.stopPropagation();
      if (b.dataset.tuiScale) { scale = b.dataset.tuiScale; lsSet('aow.ui.scale', scale); }
      else { sun = !sun; lsSet('aow.ui.sun', sun ? '1' : '0'); }
      apply();
    });
  }
  function syncSettingsUi() {
    for (const b of box.querySelectorAll('.tui-opt[data-tui-scale], .tui-opt[data-tui-sun]'))
      b.classList.toggle('active', b.dataset.tuiScale ? b.dataset.tuiScale === scale : sun);
  }

  // --- Right nav: name + state under each icon -------------------------------------
  const RN_LABELS = [
    ['rn-contour', tr('Contour')], ['rn-contourlock', tr('Lock')], ['rn-manual', tr('Manual')],
    ['rn-auto', tr('Auto')], ['rn-youturn', tr('U-Turn')], ['rn-steer', tr('Steer')],
    ['rn-autotrack', tr('Auto track')], ['rn-cycle', tr('Next track')], ['rn-cycleback', tr('Previous track')], ['rn-isobus', 'ISOBUS'],
  ];
  const rnState = {};
  for (const [id, label] of RN_LABELS) {
    const b = document.getElementById(id);
    if (!b) continue;
    const l = document.createElement('span'); l.className = 'tui-rn-lbl'; l.textContent = label;
    const s = document.createElement('span'); s.className = 'tui-rn-st';
    b.append(l, s);
    rnState[id] = { b, s, last: null };
  }
  function rnSet(id, on, text) {
    const r = rnState[id];
    if (!r || r.last === text) return;
    r.last = text; r.s.textContent = text; r.b.classList.toggle('tui-on', on);
  }
  function renderRightNavLabels() {
    const op = tick && tick.op;
    if (!op || !scene || !scene.hasField) return;
    const onOff = v => (v ? tr('On') : tr('Off'));
    rnSet('rn-contour', !!op.contour, onOff(op.contour));
    rnSet('rn-contourlock', !!scene.contourLocked, onOff(scene.contourLocked));
    rnSet('rn-manual', !!op.sectionManual, onOff(op.sectionManual));
    rnSet('rn-auto', !!op.sectionAuto, onOff(op.sectionAuto));
    rnSet('rn-youturn', !!op.youturn, onOff(op.youturn));
    const at = !!(tick.tools && tick.tools.autoTrack);
    rnSet('rn-autotrack', at, onOff(at));
    const iso = statusBar && statusBar.isobus;
    if (iso) rnSet('rn-isobus', !!iso.sectionControl, !iso.sections ? '—' : onOff(iso.sectionControl));
    rnSet('rn-steer', !!op.autoSteer && !op.moduleNotSteering,
      !op.autoSteerAvail ? tr('No line') : !op.autoSteer ? tr('Off') : op.moduleNotSteering ? tr('Not steering') : tr('On'));
  }

  // --- Section buttons carry their state code, so the sun theme can recolour them ---
  function tagSections() {
    const secs = tick && tick.sections;
    if (!secs || !sectionBar.classList.contains('open')) return;
    for (const b of sectionBar.querySelectorAll('button[data-idx], button[data-zone]')) {
      const st = String(secs[+(b.dataset.idx !== undefined ? b.dataset.idx : b.dataset.last)] | 0);
      if (b.dataset.st !== st) b.dataset.st = st;
    }
  }

  // --- Lower-right cluster (roll gauge + camera pad) never under the right nav or bottom stack
  // Positions are worked out from the unshifted layout every time, so moving the cluster
  // never feeds back into the decision.
  const lr = document.getElementById('lowerright');
  const rnRoot = document.getElementById('rightnav');
  const stack = document.getElementById('bottomstack');
  let lrKey = '';
  function placeLowerRight() {
    if (!lr) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const lrW = lr.offsetWidth, lrH = lr.offsetHeight;
    let right = 14, bottom = 72;
    const rn = rnRoot && getComputedStyle(rnRoot).display !== 'none' ? rnRoot.getBoundingClientRect() : null;
    if (rn && rn.height > 0 && rn.bottom + 8 > vh - bottom - lrH) right = vw - rn.left + 36; // the roll gauge sticks out 32 px to the right
    const bn = stack ? stack.getBoundingClientRect() : null; // sim bar + sections + bottom nav
    if (bn && bn.width > 0 && bn.height > 0) {
      const x1 = vw - right - lrW, x2 = vw - right;
      if (x1 < bn.right && x2 > bn.left && vh - bottom > bn.top - 8) bottom = vh - bn.top + 8;
    }
    const key = right + ',' + bottom;
    if (key === lrKey) return;
    lrKey = key;
    lr.style.setProperty('--tui-lr-right', right + 'px');
    lr.style.setProperty('--tui-lr-bottom', bottom + 'px');
  }

  // --- Keya hint next to the motor driver choice (AutoSteer panel + wizard) ----------
  const KEYA_HTML = '<b translate="no">Keya (CAN)</b>: ' + tr('The AiO board drives a Keya motor over CAN and detects it by itself; the IBT2 / Cytron choice does not change that. For a kickout when the wheel is turned by hand, turn on Current Turn.');
  function addKeyaHints() {
    const sel = document.querySelector('select[data-key="autosteer.motorDriver"]');
    const card = sel && sel.closest('.as-card');
    if (card && !card.querySelector('.tui-keya')) {
      const d = document.createElement('div'); d.className = 'tui-keya'; d.innerHTML = KEYA_HTML; card.appendChild(d);
    }
    for (const b of document.querySelectorAll('[data-activekey="autosteer.motorDriver"]')) {
      const row = b.closest('.wz-row');
      if (row && !(row.nextElementSibling && row.nextElementSibling.classList.contains('tui-keya'))) {
        const d = document.createElement('div'); d.className = 'tui-keya'; d.innerHTML = KEYA_HTML;
        row.after(d);
      }
    }
  }

  // --- Map in the sun theme: light plain ground, dark wide lines ---------------------
  const SUN_LINES = {
    guidance: 'rgb(130,0,85)', boundary: 'rgb(160,20,10)', boundaryInner: 'rgb(120,90,0)',
    headland: 'rgb(150,95,0)', track: 'rgb(110,80,0)', reference: 'rgb(80,30,150)',
    next: 'rgb(0,95,110)', uturn: 'rgb(0,110,40)', extraGuide: 'rgba(0,100,30,0.75)',
  };
  const SUN_WIDE = ['guidance', 'next', 'uturn', 'reference', 'headland', 'boundary', 'boundaryInner', 'track'];
  const SUN_GROUND = '#f3f3ef';
  const dayClear = MAP_CLEAR.day;
  let paintsFor = null, paintsSun = null, origColors = null;
  const sunActive = () => sun && mapIsDay;
  function applySunPaints() {
    if (typeof SKP === 'undefined' || !SKP) return;
    const s = sunActive();
    if (paintsFor === SKP && paintsSun === s) return;
    if (paintsFor !== SKP) { // paints (re)built: remember upstream colours
      origColors = {};
      for (const k of Object.keys(SUN_LINES)) if (SKP[k]) origColors[k] = SKP[k].getColor();
    }
    for (const k of Object.keys(SUN_LINES)) if (SKP[k]) SKP[k].setColor(s ? ckColor(SUN_LINES[k]) : origColors[k]);
    MAP_CLEAR.day = s ? SUN_GROUND : dayClear;
    paintsFor = SKP; paintsSun = s;
  }
  updateLineWidths = (orig => function () {
    orig();
    if (!sunActive()) return;
    for (const k of SUN_WIDE) if (SKP[k]) SKP[k].setStrokeWidth(Math.max(SKP[k].getStrokeWidth() * 2, 4));
  })(updateLineWidths);
  drawGroundTextureSk = (orig => function (canvas) { if (!sunActive()) orig(canvas); })(drawGroundTextureSk);
  // The canvas light bar sits at a fixed y under the status bar; follow its new height.
  lightbarSk = (orig => function (canvas) {
    if (root.hasAttribute('data-tui-nomap')) return; // work page without the map
    const dy = tuiBarDy !== null ? tuiBarDy : DY[scale] || 0;
    if (!dy) { orig(canvas); return; }
    canvas.save(); canvas.translate(0, dy); orig(canvas); canvas.restore();
  })(lightbarSk);

  function frame() {
    renderRightNavLabels();
    tagSections();
    applySunPaints();
    requestAnimationFrame(frame);
  }
  apply();
  frame();
  addKeyaHints();
  placeLowerRight();
  setInterval(() => { placeLowerRight(); addKeyaHints(); }, 400);
  window.addEventListener('resize', placeLowerRight);
  return { get scale() { return scale; }, get sun() { return sun; } };
})();
// ===== Tablet UI (Phase 2): terminal layout =====================================
// html[data-tui-layout="terminal"] (default) or "classic" (Screen & Alerts), per device:
//   aow.ui.layout = terminal | classic
//   aow.ui.pages  = [["map","xte","speed","steer"], …]   work pages (modules per page)
//   aow.ui.page   = index of the shown page
//   aow.ui.quick  = ["contour","manual",…]               quick bar slots (steer is always last)
// Drive mode shows the work page; the menu (tile grid) opens field panels directly and
// setup panels in setup mode (html[data-tui-mode="setup"], left nav back, striped band).
// Display only: the menu tiles, quick bar slots and setup mode open the existing panels and
// press the existing buttons (same handlers, same commands); nothing new goes to the host.
const TabletTerminal = (() => {
  const root = document.documentElement;
  const lsGet = (k, d) => { try { const v = window.localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch (_) { /* private / blocked */ } };
  const lsJson = (k, d) => { try { const v = JSON.parse(lsGet(k, 'null')); return v == null ? d : v; } catch (_) { return d; } };
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); fn(e); });

  // --- Own icons (24×24, stroke) -----------------------------------------------------
  const svg = (body, extra = '') => '<svg viewBox="0 0 24 24" aria-hidden="true" ' + extra + '>' + body + '</svg>';
  const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const IC = {
    menu: svg('<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>', 'fill="currentColor"'),
    drive: svg('<path d="M8 21 L10.5 3 M16 21 L13.5 3"/><path d="M12 7v2M12 12v2M12 17v2"/>', STROKE),
    field: svg('<path d="M3 18 L6 7 L15 5 L21 14 L13 20 Z"/><path d="M11 15V8l4 1.5-4 1.5"/>', STROKE),
    fieldtools: svg('<path d="M4 20 L4 6 L18 20 Z"/><path d="M8 16h2M4 10h2M4 14h2"/><path d="M15 4l5 5-2 2-5-5z"/>', STROKE),
    pages: svg('<rect x="7" y="3" width="13" height="15" rx="2"/><path d="M4 7v12a2 2 0 0 0 2 2h10"/><path d="M10 8h7M10 12h7"/>', STROKE),
    quick: svg('<rect x="15" y="2.5" width="6" height="19" rx="2"/><circle cx="18" cy="7" r="1"/><circle cx="18" cy="12" r="1"/><circle cx="18" cy="17" r="1"/><path d="M3 12h8M8 8.5 11.5 12 8 15.5"/>', STROKE),
    vehicle: svg('<circle cx="7.5" cy="16" r="4.5"/><circle cx="18" cy="17.5" r="3"/><path d="M5 11.5V5h6l2 6.5h6l1 3"/><path d="M12 16h3"/>', STROKE),
    steer: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M3.5 10.5 9.6 11.2M14.4 11.2l6.1-.7M12 14.5V21"/>', STROKE),
    network: svg('<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M12 7.5v5M12 12.5 6.6 16.2M12 12.5l5.4 3.7"/>', STROKE),
    tools: svg('<path d="M14.5 6.5a4 4 0 0 1 5-5l-2.6 2.6.4 2.6 2.6.4 2.6-2.6a4 4 0 0 1-5 5L8 21a2.1 2.1 0 0 1-3-3z"/>', STROKE),
    display: svg('<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><circle cx="12" cy="10.5" r="2.5"/><path d="M12 5.8v1M12 14.2v1M7.3 10.5h1M15.7 10.5h1"/>', STROKE),
    file: svg('<path d="M6 2.5h8l5 5V21.5H6z"/><path d="M14 2.5v5h5M9 13h7M9 17h7"/>', STROKE),
    speed: svg('<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/><path d="M6.5 11.5l1 .8M12 8.5V10M17.5 11.5l-1 .8"/>', STROKE),
    sections: svg('<path d="M3 9h18M3 9v8M7.5 9v8M12 9v8M16.5 9v8M21 9v8"/><path d="M3 6h18"/>', STROKE),
    xte: svg('<path d="M12 3v18"/><path d="M5 12h5M7.5 9.5 10 12l-2.5 2.5"/>', STROKE),
    map: svg('<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>', STROKE),
    language: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>', STROKE),
    left: svg('<path d="M15.5 4 6.5 12l9 8z"/>', 'fill="currentColor"'),
    right: svg('<path d="M8.5 4l9 8-9 8z"/>', 'fill="currentColor"'),
    width: svg('<path d="M3 7v10M21 7v10"/><path d="M6.5 12h11M9 9l-3 3 3 3M15 9l3 3-3 3"/>', STROKE),
    arrowL: '<svg viewBox="0 0 30 24" aria-hidden="true"><path d="M1 12 13 1v6.5h16v9H13V23z"/></svg>',
    arrowR: '<svg viewBox="0 0 30 24" aria-hidden="true"><path d="M29 12 17 1v6.5H1v9h16V23z"/></svg>',
  };

  // --- State ---------------------------------------------------------------------------
  // Steering shows once, in the status bar (plus the Steer button on the right): the module
  // column carries the working width instead (Phase 2b). Stored pages with 'steer' get 'width'.
  const MODS = ['map', 'xte', 'speed', 'width', 'sections'];
  const MOD_NAME = { map: tr('Map'), xte: tr('Cross-track'), speed: tr('Speed'), width: tr('Working width'), sections: tr('Sections') };
  const DEFAULT_PAGES = [['map', 'xte', 'speed', 'width'], ['map', 'xte', 'sections', 'speed'], ['xte', 'speed', 'width', 'sections']];
  const MAX_PAGES = 5;
  // A page without the map keeps the cross-track module: its card is where the headland and
  // U-turn distances go when the map's HUDs are hidden.
  const withXte = p => p.includes('map') || p.includes('xte') ? p : MODS.filter(x => x === 'xte' || p.includes(x));
  const cleanPages = v => {
    if (!Array.isArray(v)) return null;
    const out = v.filter(Array.isArray).slice(0, MAX_PAGES)
      .map(p => MODS.filter(m => p.includes(m) || (m === 'width' && p.includes('steer')))).filter(p => p.length).map(withXte);
    return out.length ? out : null;
  };
  let layout = lsGet('aow.ui.layout', 'terminal') === 'classic' ? 'classic' : 'terminal';
  let mode = 'drive'; // not stored: a restart always comes up in drive mode
  let pages = cleanPages(lsJson('aow.ui.pages', null)) || DEFAULT_PAGES.map(p => p.slice());
  let pageIdx = Math.min(Math.max(parseInt(lsGet('aow.ui.page', '0'), 10) || 0, 0), pages.length - 1);
  const savePages = () => { lsSet('aow.ui.pages', JSON.stringify(pages)); lsSet('aow.ui.page', String(pageIdx)); };
  const page = () => pages[pageIdx] || pages[0];
  const terminal = () => layout === 'terminal';
  const noMap = () => terminal() && mode === 'drive' && !page().includes('map');

  // --- Status bar: menu / setup band, steering, clock ----------------------------------
  const sb = $('statusbar');
  const menuBtn = el('button', '', IC.menu + '<span></span>'); menuBtn.id = 'tui-menu-btn';
  const modeBand = el('div', '', ''); modeBand.id = 'tui-sb-mode';
  const steerChip = el('div', '', IC.steer + '<span class="st-t"><span class="st-k"></span><span class="st-v"></span></span>'); steerChip.id = 'tui-sb-steer';
  steerChip.querySelector('.st-k').textContent = tr('Steering');
  const clockSb = el('div', '', '--:--'); clockSb.id = 'tui-sb-clock'; clockSb.setAttribute('translate', 'no');
  if (sb) {
    sb.insertBefore(modeBand, sb.firstChild);
    sb.insertBefore(menuBtn, sb.firstChild);
    const fs = $('sb-fs');
    sb.insertBefore(steerChip, fs);
    sb.insertBefore(clockSb, fs);
  }
  onTap(menuBtn, () => { if (mode === 'setup') setMode('drive'); else if (menuSheet.classList.contains('open')) closeSheets(); else openMenu(); });
  function syncMenuBtn() {
    const drive = mode === 'setup';
    menuBtn.innerHTML = (drive ? IC.drive : IC.menu) + '<span>' + esc(drive ? tr('Drive') : tr('Menu')) + '</span>';
    menuBtn.title = drive ? tr('Back to drive mode') : tr('Menu');
    modeBand.textContent = tr('Setup');
  }
  function tickClock() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const t = p(d.getHours()) + ':' + p(d.getMinutes());
    if (clockSb.textContent !== t) clockSb.textContent = t;
  }

  // Live data: the socket is up and a tick came in the last 2 s. Otherwise the steer chip
  // says so and the readouts show "—", instead of freezing on the last values (the host's
  // deadman may already have released steering and sections).
  function tuiLive() { return connState === 'connected' && !!lastTick && performance.now() - lastTick.t < 2000; }
  function steerState() {
    if (connState !== 'connected') return ['fault', tr('Disconnected')];
    if (!tuiLive()) return ['fault', tr('No data')];
    const op = tick && tick.op;
    if (!op || !scene || !scene.hasField || !op.autoSteerAvail) return ['none', tr('No line')];
    if (op.autoSteer && op.moduleNotSteering) return ['fault', tr('Not steering')];
    if (op.autoSteer) return ['on', tr('On')];
    return ['off', tr('Off')];
  }

  // --- U3: cross-track readout -----------------------------------------------------------
  const xteBox = el('div', '', '<div class="x-side x-l">' + IC.arrowL + '<span class="x-let"><span>L</span></span></div>' +
    '<div class="x-mid"><div><span class="x-val">0</span><span class="x-unit"></span></div><div class="x-cap"></div></div>' +
    '<div class="x-side x-r"><span class="x-let"><span>R</span></span>' + IC.arrowR + '</div>');
  xteBox.id = 'tui-xte'; xteBox.setAttribute('translate', 'no');
  document.body.appendChild(xteBox);
  const X = { l: xteBox.querySelector('.x-l'), r: xteBox.querySelector('.x-r'), v: xteBox.querySelector('.x-val'),
    u: xteBox.querySelector('.x-unit'), c: xteBox.querySelector('.x-cap') };
  // Cross-track error → { val, unit, dir: -1 steer left · 0 on line · 1 steer right, cap }.
  // Sign as the light bar: + = right of the line, so the way to steer is left.
  const steerBar = () => !!(config && config.autosteer && config.autosteer.steerBarEnabled);
  function xteInfo() {
    const xte = tick.crossTrackError || 0, a = Math.abs(xte);
    let raw, unit;
    if (a >= 10) { raw = toDisplayUnit(a, 'm').toFixed(1); unit = unitLabel('m'); }
    else { raw = toDisplayUnit(a * 100, 'cm').toFixed(isMetric() ? 0 : 1); unit = unitLabel('cm'); }
    // "On line" within 5 cm, as the light bar's centre LED and #lb (upstream onLine).
    const dir = a < 0.05 ? 0 : xte > 0 ? -1 : 1;
    const val = tuiDec(raw);
    const pass = tick.op && !tick.op.contour ? tr('Pass {n}', { n: Math.abs((tick.op.passNumber | 0)) + 1 }) : '';
    // Steer-bar style: the light bar and #lb show the steer-angle error, which can point the
    // other way; the readout then only gives the distance, without a steering direction.
    if (steerBar()) {
      const w = I18n.text(tr('Cross-track'));
      return { val, unit, dir: null, cap: pass ? w + ' · ' + pass : w };
    }
    // Translated here: the caption is joined from two strings, so the page translator can't match it.
    const word = I18n.text(dir < 0 ? tr('Steer left') : dir > 0 ? tr('Steer right') : tr('On line'));
    return { val, unit, dir, cap: pass ? word + ' · ' + pass : word };
  }
  let xteLast = '';
  function renderXte() {
    const want = !!(tick && tick.guidanceActive && scene && scene.hasField && !document.body.classList.contains('maptap')
      && !noMap() && (!terminal() || page().includes('xte')));
    if (want !== xteBox.classList.contains('show')) {
      xteBox.classList.toggle('show', want);
      if (want) root.setAttribute('data-tui-xte', ''); else root.removeAttribute('data-tui-xte');
      stackNow = true; // re-stack the light bar and HUDs this frame
    }
    if (steerBar() !== root.hasAttribute('data-tui-steerbar')) {
      if (steerBar()) root.setAttribute('data-tui-steerbar', ''); else root.removeAttribute('data-tui-steerbar');
      stackNow = true;
    }
    if (!want) { xteLast = ''; return; }
    const i = tuiLive() ? xteInfo() : { val: '—', unit: '', dir: null, cap: I18n.text(tr('No data')) };
    const key = i.val + i.unit + i.dir + i.cap;
    if (key === xteLast) return;
    xteLast = key;
    X.v.textContent = i.val; X.u.textContent = i.unit; X.c.textContent = i.cap;
    X.l.classList.toggle('on', i.dir < 0); X.r.classList.toggle('on', i.dir > 0);
    xteBox.classList.toggle('online', i.dir === 0);
  }

  // Everything under the status bar stacks top-down: readout, canvas light bar, #lb text,
  // headland HUD / reverse badge. Positions as CSS variables (and the bar's offset for the
  // lightbarSk wrapper in Phase 1), so they follow the status bar and readout heights.
  let yKey = '', stackNow = true;
  function stackTop() {
    stackNow = false;
    const r = sb && sb.style.display !== 'none' ? sb.getBoundingClientRect() : null;
    let y = (r ? r.bottom : 0) + 8, xb = 0, xr = 0, xt = 0;
    if (xteBox.classList.contains('show')) {
      const xr0 = xteBox.getBoundingClientRect();
      xb = xr0.bottom + 10; y = xb - 2; xr = xr0.right + 12; xt = xr0.top;
    }
    const cfg = config && config.autosteer;
    const bar = !!(tick && tick.guidanceActive && cfg && cfg.guidanceBarOn && cfg.lightbarEnabled);
    tuiBarDy = y - 54; // lightbarSk draws at y = 54
    if (bar) y += 16 + 6;
    const lbY = y;
    if (lbEl && lbEl.style.display !== 'none' && (!root.hasAttribute('data-tui-xte') || root.hasAttribute('data-tui-steerbar'))) y += lbEl.offsetHeight + 4;
    const key = lbY + ',' + y + ',' + xb + ',' + xr;
    if (key === yKey) return;
    yKey = key;
    root.style.setProperty('--tui-xte-b', xb + 'px');
    root.style.setProperty('--tui-xte-r', xr + 'px');
    root.style.setProperty('--tui-xte-t', xt + 'px');
    root.style.setProperty('--tui-y-lb', lbY + 'px');
    root.style.setProperty('--tui-y-hud', (y + 2) + 'px');
  }

  // --- Work pages: modules ---------------------------------------------------------------
  const col = el('div'); col.id = 'tui-col';
  const dash = el('div'); dash.id = 'tui-dash';
  document.body.append(col, dash);
  function pagerHtml() {
    return '<div class="tui-pager"><button class="pg-prev" title="' + esc(tr('Previous page')) + '">' + IC.left + '</button>' +
      '<div class="pg-t"><div class="pg-n"></div><div class="pg-dots"></div></div>' +
      '<button class="pg-next" title="' + esc(tr('Next page')) + '">' + IC.right + '</button></div>';
  }
  const CARD = {
    speed: () => '<div class="tui-card" data-m="speed"><div class="c-k">' + IC.speed + esc(MOD_NAME.speed) + '</div><div class="c-v"><span class="c-n">—</span><span class="c-u"></span></div></div>',
    width: () => '<div class="tui-card" data-m="width"><div class="c-k">' + IC.width + esc(MOD_NAME.width) + '</div><div class="c-v"><span class="c-n">—</span><span class="c-u"></span></div></div>',
    sections: () => '<div class="tui-card" data-m="sections"><div class="c-k">' + IC.sections + esc(MOD_NAME.sections) + '</div><div class="c-v"><span class="c-n">—</span></div><div class="tui-secs"></div></div>',
    xte: () => '<div class="tui-card d-xte" data-m="xte"><div class="c-k">' + IC.xte + esc(MOD_NAME.xte) + '</div>' +
      '<div class="c-v"><span class="x-dir x-l">' + IC.arrowL + '<span class="x-let"><span>L</span></span></span>' +
      '<span><span class="c-n">—</span><span class="c-u"></span></span>' +
      '<span class="x-dir x-r"><span class="x-let"><span>R</span></span>' + IC.arrowR + '</span></div><div class="c-cap"></div><div class="c-extra"></div></div>',
  };
  let built = '', cards = {};
  function buildPage() {
    const p = page(), nm = noMap();
    const key = layout + mode + pageIdx + p.join() + pages.length;
    if (key === built) return;
    built = key;
    if (nm) root.setAttribute('data-tui-nomap', ''); else root.removeAttribute('data-tui-nomap');
    if (terminal() && p.includes('speed')) root.setAttribute('data-tui-speed', ''); else root.removeAttribute('data-tui-speed');
    col.innerHTML = ''; dash.innerHTML = '';
    if (!terminal()) return;
    const host = nm ? dash : col;
    const order = nm ? ['xte', 'speed', 'width', 'sections'] : ['speed', 'width', 'sections'];
    host.innerHTML = pagerHtml() + order.filter(m => p.includes(m)).map(m => CARD[m]()).join('');
    const others = order.filter(m => m !== 'xte' && p.includes(m)).length;
    dash.style.setProperty('--tui-dash-cols', String(Math.max(1, others)));
    dash.classList.toggle('solo', others === 0);
    dash.classList.toggle('noxte', !p.includes('xte'));
    cards = {};
    for (const c of host.querySelectorAll('.tui-card')) cards[c.dataset.m] = { el: c, last: '' };
    const pg = host.querySelector('.tui-pager');
    // "1 / 3" on the pager (the sentence ran under the next button at 1024×600); the sentence and
    // the cards of the page are in the tooltip.
    pg.querySelector('.pg-n').textContent = (pageIdx + 1) + ' / ' + pages.length;
    pg.querySelector('.pg-dots').innerHTML = pages.map((_, i) => '<i class="' + (i === pageIdx ? 'on' : '') + '"></i>').join('');
    pg.querySelector('.pg-t').title = tr('Page {n} of {count}', { n: pageIdx + 1, count: pages.length }) + ': ' + p.map(m => MOD_NAME[m]).join(', ');
    pg.querySelector('.pg-prev').disabled = pageIdx === 0;
    pg.querySelector('.pg-next').disabled = pageIdx >= pages.length - 1;
    onTap(pg.querySelector('.pg-prev'), () => goPage(pageIdx - 1));
    onTap(pg.querySelector('.pg-next'), () => goPage(pageIdx + 1));
    xteLast = ''; yKey = '';
  }
  function goPage(i) {
    if (i < 0 || i >= pages.length || i === pageIdx) return;
    pageIdx = i; savePages(); buildPage(); placeWorkArea();
  }
  // Swipe left/right on the module column or the dashboard turns the page. The map itself
  // keeps its pan gesture; these overlays stop the pointer before it reaches the map.
  for (const host of [col, dash]) {
    let sx = null, sy = 0;
    host.addEventListener('pointerdown', e => { e.stopPropagation(); sx = e.clientX; sy = e.clientY; });
    host.addEventListener('pointerup', e => {
      if (sx === null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) goPage(pageIdx + (dx < 0 ? 1 : -1));
    });
    host.addEventListener('pointercancel', () => { sx = null; });
  }
  function setCard(m, key, fn) {
    const c = cards[m];
    if (!c || c.last === key) return;
    c.last = key; fn(c.el);
  }
  function renderCards() {
    if (!terminal() || mode !== 'drive') return;
    const live = tuiLive();
    const spd = live ? tuiNum(toDisplayUnit(Math.abs(lastTick.speed) * 3.6, 'kmh'), 1) : '—', su = live ? unitLabel('kmh') : '';
    setCard('speed', spd + su, c => { c.querySelector('.c-n').textContent = spd; c.querySelector('.c-u').textContent = su; });
    // The configured total width, as Tool Configuration shows it ("Total width", 2 decimals).
    // Not toolWidthM(): that falls back to a made-up 6 m when the scene has no sections.
    const wm = config && config.tool ? +config.tool.totalWidth || 0 : 0;
    const wv = wm > 0 ? tuiNum(toDisplayUnit(wm, 'm'), 2) : '—', wu = wm > 0 ? unitLabel('m') : '';
    setCard('width', wv + wu, c => { c.querySelector('.c-n').textContent = wv; c.querySelector('.c-u').textContent = wu; });
    const secs = live && tick && scene && scene.hasField ? tick.sections : null;
    const sk = secs ? secs.join('') : live ? '-' : 'x';
    setCard('sections', sk, c => {
      const on = secs ? secs.filter(s => s === 1 || s === 2 || s === 3).length : 0; // 3 = turning off: still applying
      c.querySelector('.c-n').textContent = secs && secs.length ? on + ' / ' + secs.length : '—';
      c.querySelector('.tui-secs').innerHTML = secs ? secs.map(s => '<i data-st="' + (s | 0) + '"></i>').join('') : '';
      c.title = secs ? tr('{on} of {count} sections on', { on, count: secs.length }) : '';
    });
    if (cards.xte) {
      const ok = !!(live && tick && tick.guidanceActive && scene && scene.hasField);
      const i = ok ? xteInfo() : null;
      setCard('xte', i ? i.val + i.unit + i.dir + i.cap : live ? '-' : 'x', c => {
        c.querySelector('.c-n').textContent = i ? i.val : '—';
        c.querySelector('.c-u').textContent = i ? i.unit : '';
        c.querySelector('.c-cap').textContent = i ? i.cap : live ? tr('No line') : tr('No data');
        c.querySelector('.x-l').classList.toggle('on', !!i && i.dir < 0);
        c.querySelector('.x-r').classList.toggle('on', !!i && i.dir > 0);
        c.dataset.st = i ? (i.dir === 0 ? 'on' : '') : 'none';
      });
      // The map's headland-distance HUD and U-turn indicator are hidden on this page; their values go here.
      const parts = [], hd = tuiHeadlandText(), ud = tuiUTurnText();
      if (hd) parts.push(hd);
      if (ud) parts.push(ud);
      const ex = cards.xte.el.querySelector('.c-extra'), et = parts.join(' · ');
      if (ex.textContent !== et) { ex.textContent = et; cards.xte.el.classList.toggle('has-extra', !!et); }
    }
  }
  // Column / dashboard end above the bottom stack (sim bar, sections, bottom nav) and left
  // of the quick bar, whatever their size at this scale and screen.
  let waKey = '';
  function placeWorkArea() {
    const vh = window.innerHeight, vw = window.innerWidth;
    // Bottom limit: the top of every bottom-stack row that reaches across the column's / the
    // dashboard's width (the narrow SIM launcher in the middle does not cut the column short).
    const colL = 8, colR = 8 + (col.offsetWidth || 0);
    let colB = 16, dashB = 16;
    const stack = $('bottomstack');
    if (stack) {
      for (const c of stack.children) {
        if (getComputedStyle(c).display === 'none') continue;
        const r = c.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        dashB = Math.max(dashB, vh - r.top + 8);
        if (r.left < colR && r.right > colL) colB = Math.max(colB, vh - r.top + 8);
      }
    }
    const rn = $('rightnav');
    const rr = rn && getComputedStyle(rn).display !== 'none' ? rn.getBoundingClientRect() : null;
    const right = rr && rr.width > 0 ? vw - rr.left + 8 : 16;
    const key = colB + ',' + dashB + ',' + right + ',' + colR;
    if (key === waKey) return;
    waKey = key;
    root.style.setProperty('--tui-col-bottom', colB + 'px');
    root.style.setProperty('--tui-dash-bottom', dashB + 'px');
    root.style.setProperty('--tui-dash-right', right + 'px');
    root.style.setProperty('--tui-col-w', (colR - 8) + 'px');
  }

  // The bottom stack (sim bar, sections, bottom nav) is centred in the free band between the
  // left nav (when shown) and the quick bar, so it never runs under either; the bottom-nav
  // buttons share that band (Phase 1 sized them from the whole width).
  let bandKey = '';
  function placeBand() {
    const vw = window.innerWidth;
    const ln = $('leftnav'), rn = $('rightnav');
    const lr = ln && getComputedStyle(ln).display !== 'none' ? ln.getBoundingClientRect() : null;
    const rr = rn && getComputedStyle(rn).display !== 'none' ? rn.getBoundingClientRect() : null;
    const L = Math.round(lr && lr.width > 0 ? lr.right + 8 : 8);
    const R = Math.round(rr && rr.width > 0 ? rr.left - 8 : vw - 8);
    const n = document.querySelectorAll('#bottomnav .bn-bar > .bn-btn:not(.hide)' + (terminal() ? ':not(.tui-bnmove)' : '')).length || 12;
    const key = L + ',' + R + ',' + n;
    if (key === bandKey) return;
    bandKey = key;
    root.style.setProperty('--tui-stack-l', L + 'px');
    root.style.setProperty('--tui-stack-w', Math.max(R - L, 200) + 'px');
    root.style.setProperty('--tui-bn-n', String(n));
    root.setAttribute('data-tui-band', '');
  }

  // --- Quick bar (right nav): which buttons, in which order --------------------------------
  const QPOOL = [
    { id: 'contour', rn: 'rn-contour' }, { id: 'manual', rn: 'rn-manual' }, { id: 'auto', rn: 'rn-auto' },
    { id: 'youturn', rn: 'rn-youturn' },
    { id: 'headland', src: '#bn-headland', label: tr('Headland'), on: t => t.tools && t.tools.headlandOn },
    { id: 'hlsections', src: '#bn-secheadland', label: tr('Sections in headland'), on: t => t.tools && !t.tools.sectionInHeadland },
    { id: 'tram', src: '#bn-tram', label: tr('Tram lines'), on: t => t.tools && t.tools.tramMode > 0 },
    // Upstream's own track picking (#339): shown by upstream only with two or more visible tracks.
    { id: 'autotrack', rn: 'rn-autotrack' }, { id: 'cycle', rn: 'rn-cycle' }, { id: 'cycleback', rn: 'rn-cycleback' },
    { id: 'uturnL', src: '#osb-uturn [data-cmd="youturn.manualLeft"]', label: tr('U-turn left') },
    { id: 'uturnR', src: '#osb-uturn [data-cmd="youturn.manualRight"]', label: tr('U-turn right') },
    { id: 'shiftL', src: '#osb-lateral [data-cmd="track.snapLeft"]', label: tr('Shift left') },
    { id: 'shiftR', src: '#osb-lateral [data-cmd="track.snapRight"]', label: tr('Shift right') },
    // ISOBUS section control (#318): always in the bar while upstream shows it (a task
    // controller heartbeat is heard), so it is never out of reach; outside the slot budget.
    { id: 'isobus', rn: 'rn-isobus', auto: true },
    { id: 'steer', rn: 'rn-steer', fixed: true },
  ];
  const QBY = Object.fromEntries(QPOOL.map(q => [q.id, q]));
  const RN_LABEL = { contour: tr('Contour'), manual: tr('Manual'), auto: tr('Auto'), youturn: tr('U-Turn'), steer: tr('Steer'),
    autotrack: tr('Auto track'), cycle: tr('Next track'), cycleback: tr('Previous track'), isobus: 'ISOBUS' };
  const qLabel = q => q.label || RN_LABEL[q.id] || q.id;
  const DEFAULT_QUICK = ['contour', 'manual', 'auto', 'youturn'];
  const MAX_SLOTS = 6; // with steer; contour counts twice (its lock button). Keeps glove ≥ 64 px at 600 px height.
  const slotCost = ids => ids.reduce((n, id) => n + (id === 'contour' ? 2 : 1), 1);
  const cleanQuick = v => {
    if (!Array.isArray(v)) return null;
    const out = [];
    for (const id of v) if (QBY[id] && !QBY[id].fixed && !QBY[id].auto && !out.includes(id) && slotCost(out.concat(id)) <= MAX_SLOTS) out.push(id);
    return out;
  };
  let quick = cleanQuick(lsJson('aow.ui.quick', null)) || DEFAULT_QUICK.slice();
  const rnRoot = $('rightnav');
  const proxies = {};
  for (const q of QPOOL) {
    if (!q.src || !rnRoot) continue;
    const b = el('button', 'rn-btn tui-qp', '<span class="rn-ic"></span><span class="tui-rn-lbl"></span><span class="tui-rn-st"></span>');
    b.dataset.q = q.id;
    b.querySelector('.tui-rn-lbl').textContent = q.label;
    rnRoot.insertBefore(b, $('rn-readonly'));
    const p = { b, ic: b.querySelector('.rn-ic'), st: b.querySelector('.tui-rn-st'), icKey: '', last: '' };
    proxies[q.id] = p;
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      const src = document.querySelector(q.src);
      if (!src || b.classList.contains('disabled')) return;
      // Press the original button: its own handler sends its own command, with its own gates.
      src.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    });
  }
  function srcAvailable(q, src) {
    if (!src) return false;
    if (src.closest('#bottomnav')) return $('bottomnav').classList.contains('open') && !src.classList.contains('hide');
    const row = src.closest('.osb-row');
    return !!row && !row.hidden && !(tick && tick.op && tick.op.executing);
  }
  function renderProxies() {
    if (!terminal()) return;
    for (const id of quick) {
      const p = proxies[id];
      if (!p) continue;
      const q = QBY[id], src = document.querySelector(q.src);
      const avail = srcAvailable(q, src);
      p.b.classList.toggle('disabled', !avail);
      // Icon: the original's image (it changes with the state) or its drawn glyph.
      const img = src && src.querySelector('img'), sv = src && src.querySelector('svg');
      const icKey = img ? img.getAttribute('src') || '' : sv ? 'svg' : '';
      if (icKey !== p.icKey) {
        p.icKey = icKey;
        const n = img ? Object.assign(document.createElement('img'), { src: icKey, alt: '' }) : sv ? sv.cloneNode(true) : document.createElement('span');
        n.classList.add('rn-ic');
        p.ic.replaceWith(n); p.ic = n;
      }
      const on = q.on && tick ? !!q.on(tick) : null;
      const text = on === null ? '' : on ? tr('On') : tr('Off');
      if (text !== p.last) { p.last = text; p.st.textContent = text; p.b.classList.toggle('tui-on', !!on); }
    }
  }
  function applyQuick() {
    const t = terminal();
    let n = 0;
    for (const q of QPOOL) {
      const node = q.rn ? $(q.rn) : proxies[q.id] && proxies[q.id].b;
      if (!node) continue;
      const i = quick.indexOf(q.id);
      const shown = q.fixed || q.auto || i >= 0;
      node.classList.toggle('tui-qhide', t && !shown);
      node.style.order = t ? String(q.fixed ? 90 : q.auto ? 80 : i * 2) : '';
      if (q.id === 'contour') {
        const lock = $('rn-contourlock');
        if (lock) { lock.classList.toggle('tui-qhide', t && !shown); lock.style.order = t ? String(i * 2 + 1) : ''; }
      }
      if (shown) n++;
    }
    if (rnRoot) for (const b of rnRoot.querySelectorAll('.tui-qp')) if (!t) b.classList.add('tui-qhide');
    countSlots();
    return n;
  }
  function countSlots() {
    if (!rnRoot) return;
    const n = [...rnRoot.querySelectorAll('.rn-btn')].filter(b => getComputedStyle(b).display !== 'none').length;
    root.style.setProperty('--tui-q-n', String(Math.max(n, 1)));
  }
  const saveQuick = () => lsSet('aow.ui.quick', JSON.stringify(quick));

  // --- Menu (tile grid) and editor sheets ------------------------------------------------
  const scrim = el('div'); scrim.id = 'tui-scrim';
  document.body.appendChild(scrim);
  onTap(scrim, () => closeSheets());
  function sheet(id, title, narrow) {
    const s = el('div', 'tui-sheet' + (narrow ? ' narrow' : ''),
      '<div class="tui-sh-hdr"><span class="t"></span><button class="x" title="' + esc(tr('Close')) + '">✕</button></div><div class="tui-sh-body"></div>');
    s.id = id; s.querySelector('.t').textContent = title;
    s.addEventListener('pointerdown', e => e.stopPropagation()); // no map pan through the sheet
    onTap(s.querySelector('.x'), () => closeSheets());
    document.body.appendChild(s);
    return { s, body: s.querySelector('.tui-sh-body') };
  }
  const { s: menuSheet, body: menuBody } = sheet('tui-menu', tr('Menu'));
  const { s: pagesSheet, body: pagesBody } = sheet('tui-pages-ed', tr('Work pages'), true);
  const { s: quickSheet, body: quickBody } = sheet('tui-quick-ed', tr('Quick bar'), true);
  function closeSheets() {
    for (const s of [menuSheet, pagesSheet, quickSheet]) s.classList.remove('open');
    scrim.classList.remove('open');
  }
  function openSheet(s) {
    if (typeof lnCloseAll === 'function') lnCloseAll();
    closeSheets();
    s.classList.add('open'); scrim.classList.add('open');
  }
  const pressNav = id => { const b = $(id); if (b) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); };
  const TILES_FIELD = [ // [icon, label, key (data-tile), action]
    ['field', tr('Fields and Jobs'), 'ln-fieldops', () => pressNav('ln-fieldops')],
    ['fieldtools', tr('Field Tools'), 'ln-fieldtools', () => pressNav('ln-fieldtools')],
    ['pages', tr('Work pages'), 'pages', () => { renderPagesEditor(); openSheet(pagesSheet); }],
    ['quick', tr('Quick bar'), 'quick', () => { renderQuickEditor(); openSheet(quickSheet); }],
  ];
  const TILES_SETUP = [
    ['vehicle', tr('Vehicle & Tool'), 'ln-vehicle'],
    ['steer', tr('AutoSteer'), 'ln-autosteer'],
    ['network', tr('Network & GPS'), 'ln-network'],
    ['tools', tr('Tools & Wizards'), 'ln-tools'],
    ['display', tr('Screen & Alerts'), 'ln-screenalerts'],
    ['file', tr('App & Files'), 'ln-filemenu'],
    ['language', tr('Language'), 'language'],
  ];
  // Phase 2b: bottom-bar buttons used now and then live here; each tile presses the original
  // (hidden) button, so its own handler, command and control gate apply. The menu stays open,
  // so a cycling button can be tapped again; the tile shows the original's current state.
  const TILES_MORE = [ // [source selector, label, state (text) from the original]
    ['#bn-skipcycle', tr('Skip rows'), () => ($('bn-skipnum') || {}).textContent || ''],
    ['#bn-skiptoggle', tr('Skip mode'), null],
    ['#bn-tram', tr('Tram lines'), null],
    ['#bottomnav .bn-bar [data-cmd="map.cycleColor"]', tr('Coverage colour'), null],
    ['#bottomnav .bn-bar [data-cmd="tool.resetHeading"]', tr('Reset tool heading'), null],
  ];
  let moreTiles = [];
  function renderMoreTiles() {
    for (const m of moreTiles) {
      const src = document.querySelector(m.sel);
      const ok = !!src && $('bottomnav').classList.contains('open') && !src.classList.contains('hide');
      m.t.classList.toggle('disabled', !ok);
      const img = src && src.querySelector('img'), icon = img ? img.getAttribute('src') || '' : '';
      if (icon !== m.icon) { m.icon = icon; m.ic.innerHTML = icon ? '<img src="' + esc(icon) + '" alt="">' : ''; }
      const st = m.state ? m.state() : '';
      if (m.st.textContent !== st) m.st.textContent = st;
    }
  }
  function renderMenu() {
    menuBody.innerHTML =
      '<div class="tui-sh-sec">' + esc(tr('In the field')) + '</div><div class="tui-tiles tui-f"></div>' +
      '<div class="tui-sh-sec">' + esc(tr('Setup')) + '<small>' + esc(tr('opens setup mode; the left bar comes back')) + '</small></div>' +
      '<div class="tui-tiles setup-band tui-s"></div>';
    const fBox = menuBody.querySelector('.tui-f'), sBox = menuBody.querySelector('.tui-s');
    const mBox = el('div', 'tui-tiles tui-m');
    fBox.after(Object.assign(el('div', 'tui-sh-sec'), { textContent: tr('More field tools') }), mBox);
    moreTiles = TILES_MORE.map(([sel, label, state]) => {
      const t = el('button', 'tui-tile field more', '<span class="m-ic"></span><span class="m-l"></span><span class="m-st" translate="no"></span>');
      t.querySelector('.m-l').textContent = label;
      t.dataset.tile = sel;
      onTap(t, () => {
        const src = document.querySelector(sel);
        if (!src || t.classList.contains('disabled')) return;
        src.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        setTimeout(renderMoreTiles, 150);
      });
      mBox.appendChild(t);
      return { t, sel, state, ic: t.querySelector('.m-ic'), st: t.querySelector('.m-st'), icon: null };
    });
    renderMoreTiles();
    for (const [ic, label, key, fn] of TILES_FIELD) {
      const t = el('button', 'tui-tile field', IC[ic] + '<span></span>'); t.querySelector('span').textContent = label;
      t.dataset.tile = key;
      onTap(t, () => { closeSheets(); fn(); });
      fBox.appendChild(t);
    }
    for (const [ic, label, nav] of TILES_SETUP) {
      const t = el('button', 'tui-tile setup', IC[ic] + '<span></span>'); t.querySelector('span').textContent = label;
      t.dataset.tile = nav;
      if (nav === 'language') { // the language panel lives in the App menu; findable in any language
        const sp = t.querySelector('span'); sp.setAttribute('translate', 'no');
        sp.textContent = I18n.text('Language') === 'Language' ? 'Language' : I18n.text('Language') + ' · Language';
        onTap(t, () => { closeSheets(); setMode('setup'); if (typeof lnOpen === 'function') lnOpen('language', 'ln-filemenu', renderLanguage); });
        sBox.appendChild(t);
        continue;
      }
      onTap(t, () => { closeSheets(); setMode('setup'); pressNav(nav); });
      sBox.appendChild(t);
    }
  }
  function openMenu() { renderMenu(); openSheet(menuSheet); }

  function renderPagesEditor() {
    pagesBody.innerHTML = '<div class="tui-hint">' + esc(tr('Each page shows the chosen modules. Without the map, the page is a full-screen display. Swipe the module column to change pages. Saved on this device.')) + '</div>';
    pages.forEach((p, i) => {
      const row = el('div', 'tui-erow');
      row.appendChild(Object.assign(el('span', 'e-n'), { textContent: tr('Page {n}', { n: i + 1 }) }));
      for (const m of MODS) {
        const c = el('button', 'tui-chip' + (p.includes(m) ? ' on' : ''));
        c.textContent = MOD_NAME[m];
        const fixed = m === 'xte' && !p.includes('map'); // see withXte
        if (fixed) c.classList.add('lock');
        onTap(c, () => {
          if (fixed) return;
          const has = p.includes(m);
          if (has && p.length === 1) return; // a page keeps at least one module
          pages[i] = withXte(has ? p.filter(x => x !== m) : MODS.filter(x => x === m || p.includes(x)));
          savePages(); built = ''; buildPage(); renderPagesEditor();
        });
        row.appendChild(c);
      }
      row.appendChild(el('span', 'e-grow'));
      const up = el('button', 'tui-ibtn', '▲'), dn = el('button', 'tui-ibtn', '▼'), del = el('button', 'tui-ibtn', '✕');
      up.title = tr('Move up'); dn.title = tr('Move down'); del.title = tr('Delete page');
      up.disabled = i === 0; dn.disabled = i === pages.length - 1; del.disabled = pages.length === 1;
      const move = d => { const j = i + d; [pages[i], pages[j]] = [pages[j], pages[i]]; if (pageIdx === i) pageIdx = j; else if (pageIdx === j) pageIdx = i; savePages(); built = ''; buildPage(); renderPagesEditor(); };
      onTap(up, () => { if (!up.disabled) move(-1); });
      onTap(dn, () => { if (!dn.disabled) move(1); });
      onTap(del, () => {
        if (del.disabled) return;
        pages.splice(i, 1); pageIdx = Math.min(pageIdx, pages.length - 1); savePages(); built = ''; buildPage(); renderPagesEditor();
      });
      row.append(up, dn, del);
      pagesBody.appendChild(row);
    });
    const bar = el('div', 'tui-ebar');
    const add = el('button', '', esc(tr('Add page'))), reset = el('button', '', esc(tr('Restore defaults'))), done = el('button', 'pri', esc(tr('Done')));
    add.disabled = pages.length >= MAX_PAGES;
    onTap(add, () => { if (pages.length < MAX_PAGES) { pages.push(['map', 'xte']); savePages(); renderPagesEditor(); built = ''; buildPage(); } });
    onTap(reset, () => { pages = DEFAULT_PAGES.map(p => p.slice()); pageIdx = 0; savePages(); built = ''; buildPage(); renderPagesEditor(); });
    onTap(done, () => closeSheets());
    bar.append(add, reset, done);
    pagesBody.appendChild(bar);
  }

  function qIcon(q) {
    const src = q.rn ? $(q.rn) : document.querySelector(q.src);
    const img = src && src.querySelector('img'), sv = src && src.querySelector('svg');
    if (img && img.getAttribute('src')) return '<img src="' + esc(img.getAttribute('src')) + '" alt="">';
    if (sv) return sv.outerHTML;
    return '<span style="width:36px"></span>';
  }
  function renderQuickEditor() {
    quickBody.innerHTML = '<div class="tui-hint">' + esc(tr('Pick the buttons for the bar on the right edge and their order. Steer always stays at the bottom. Up to {n} buttons (Contour brings its lock button). Saved on this device.', { n: MAX_SLOTS })) + '</div>';
    const ordered = quick.map(id => QBY[id]).concat(QPOOL.filter(q => !q.fixed && !q.auto && !quick.includes(q.id)))
      .concat(QPOOL.filter(q => q.auto), [QBY.steer]);
    for (const q of ordered) {
      const row = el('div', 'tui-qitem', qIcon(q) + '<span class="e-grow"></span>');
      row.querySelector('.e-grow').textContent = qLabel(q);
      const i = quick.indexOf(q.id);
      if (q.fixed || q.auto) {
        row.appendChild(Object.assign(el('span', 'tui-chip lock on'), { textContent: q.fixed ? tr('Always') : tr('When connected') }));
      } else {
        const chip = el('button', 'tui-chip' + (i >= 0 ? ' on' : ''));
        chip.textContent = i >= 0 ? tr('In the bar') : tr('Add');
        const full = i < 0 && slotCost(quick.concat(q.id)) > MAX_SLOTS;
        if (full) { chip.disabled = true; chip.title = tr('The bar is full'); }
        onTap(chip, () => {
          if (i >= 0) quick.splice(i, 1);
          else if (!full) quick.push(q.id);
          saveQuick(); applyQuick(); renderQuickEditor();
        });
        row.appendChild(chip);
        const up = el('button', 'tui-ibtn', '▲'), dn = el('button', 'tui-ibtn', '▼');
        up.title = tr('Move up'); dn.title = tr('Move down');
        up.disabled = i <= 0; dn.disabled = i < 0 || i >= quick.length - 1;
        const move = d => { const j = i + d; [quick[i], quick[j]] = [quick[j], quick[i]]; saveQuick(); applyQuick(); renderQuickEditor(); };
        onTap(up, () => { if (!up.disabled) move(-1); });
        onTap(dn, () => { if (!dn.disabled) move(1); });
        row.append(up, dn);
      }
      quickBody.appendChild(row);
    }
    const bar = el('div', 'tui-ebar');
    const reset = el('button', '', esc(tr('Restore defaults'))), done = el('button', 'pri', esc(tr('Done')));
    onTap(reset, () => { quick = DEFAULT_QUICK.slice(); saveQuick(); applyQuick(); renderQuickEditor(); });
    onTap(done, () => closeSheets());
    bar.append(reset, done);
    quickBody.appendChild(bar);
  }

  // --- Modes and layout --------------------------------------------------------------------
  function setMode(m) {
    if (m === mode) return;
    mode = m;
    if (m === 'drive' && typeof lnCloseAll === 'function') lnCloseAll();
    closeSheets();
    apply();
  }
  function apply() {
    root.setAttribute('data-tui-layout', layout);
    root.setAttribute('data-tui-mode', mode);
    syncMenuBtn();
    built = ''; buildPage(); applyQuick(); syncLayoutOpts();
    waKey = ''; yKey = ''; bandKey = ''; stackNow = true;
  }
  // Layout choice next to the Phase 1 size / sun buttons in Screen & Alerts.
  const sa = $('screenalerts');
  const hint = sa && sa.querySelector('.tui-hint');
  const lay = el('div', 'tui-seg tui-seg2',
    '<button class="tui-opt" data-tui-layout="terminal"></button><button class="tui-opt" data-tui-layout="classic"></button>');
  lay.children[0].textContent = tr('Terminal layout'); lay.children[1].textContent = tr('Classic layout');
  if (hint) hint.after(lay);
  for (const b of lay.children) onTap(b, () => { layout = b.dataset.tuiLayout; lsSet('aow.ui.layout', layout); if (layout === 'classic') mode = 'drive'; apply(); });
  function syncLayoutOpts() { for (const b of lay.children) b.classList.toggle('active', b.dataset.tuiLayout === layout); }

  // --- Frame loop ----------------------------------------------------------------------------
  // Point 12: with the host gone or silent, upstream displays keep their last state (fix chip,
  // light bar, roll gauge, right nav states). Mark the page stale; CSS and the light bar wrapper
  // below hide or grey them until data flows again.
  let staleNow = null;
  lightbarSk = (orig => function (canvas) { if (staleNow) return; return orig(canvas); })(lightbarSk);
  function frame() {
    const stale = !tuiLive();
    if (stale !== staleNow) {
      staleNow = stale;
      if (stale) root.setAttribute('data-tui-stale', ''); else root.removeAttribute('data-tui-stale');
      const fb = $('sb-fixbtn'); if (fb) fb.dataset.stale = I18n.text(tr('No data'));
    }
    if (sb && statusBar) {
      const q = statusBar.gpsLost ? 0 : statusBar.fixQuality | 0;
      const fb = $('sb-fixbtn');
      if (fb && fb.dataset.q !== String(q)) fb.dataset.q = String(q);
    }
    const [st, word] = steerState();
    if (steerChip.dataset.st !== st || steerChip.dataset.w !== word) {
      steerChip.dataset.st = st; steerChip.dataset.w = word;
      steerChip.querySelector('.st-v').textContent = word;
    }
    buildPage();
    renderXte();
    if (stackNow) stackTop(); // otherwise every 300 ms (layout reads stay out of the frame loop)
    renderCards();
    renderProxies();
    if (menuSheet.classList.contains('open')) renderMoreTiles();
    requestAnimationFrame(frame);
  }
  apply();
  tickClock();
  setInterval(tickClock, 1000);
  // Roll gauge: hidden while it would sit on the cross-track readout or the module column.
  function gaugeFit() {
    const lrEl = $('lowerright'), g = $('rollgauge');
    if (!lrEl || !g) return;
    lrEl.classList.remove('tui-nogauge');
    const r = g.getBoundingClientRect();
    if (!r.width) return;
    const hit = [xteBox, col, $('uturn-indicator')].some(b => {
      if (!b || b.hidden) return false;
      if (!b.offsetParent && getComputedStyle(b).position !== 'fixed') return false;
      const o = b.getBoundingClientRect();
      return o.width > 0 && r.left < o.right && r.right > o.left && r.top < o.bottom + 6 && r.bottom > o.top;
    });
    if (hit) lrEl.classList.add('tui-nogauge');
  }
  // Module column: a card that does not fit whole above the bottom stack is hidden, not cut.
  // On-screen U-turn / shift rows that would sit under the bottom stack (open sim bar) give way.
  function fitOverlays() {
    const cb = col.getBoundingClientRect().bottom;
    for (const c of col.querySelectorAll('.tui-card')) {
      c.style.visibility = '';
      if (c.getBoundingClientRect().bottom > cb + 1) c.style.visibility = 'hidden';
    }
    const rows = document.querySelectorAll('#onscreenbtns .osb-row');
    const stackRects = [...($('bottomstack') ? $('bottomstack').children : [])]
      .filter(c => getComputedStyle(c).display !== 'none').map(c => c.getBoundingClientRect()).filter(r => r.width > 0);
    for (const row of rows) {
      row.classList.remove('tui-osb-off');
      if (row.hidden) continue;
      const r = row.getBoundingClientRect();
      if (stackRects.some(o => r.left < o.right && r.right > o.left && r.bottom > o.top - 4 && r.top < o.bottom)) row.classList.add('tui-osb-off');
    }
  }
  // Point 31: on a narrow screen (7 inch, glove) the on-screen buttons (turn / track left-right)
  // sat over the headland distance. When the two overlap sideways, the buttons move below it.
  let osbKey = '';
  function placeOsb() {
    const osb = $('onscreenbtns'), hud = $('headland-hud');
    let y = 0;
    if (osb && hud && hud.offsetWidth && getComputedStyle(hud).display !== 'none') {
      const a = osb.getBoundingClientRect(), b = hud.getBoundingClientRect();
      if (a.width && a.left < b.right && a.right > b.left) y = Math.round(b.bottom + 8);
    }
    const k = String(y);
    if (k !== osbKey) { osbKey = k; root.style.setProperty('--tui-osb-y', y + 'px'); }
  }
  setInterval(() => { stackTop(); placeBand(); placeWorkArea(); countSlots(); gaugeFit(); placeOsb(); fitOverlays(); }, 300);
  window.addEventListener('resize', () => { waKey = ''; yKey = ''; bandKey = ''; stackNow = true; placeBand(); placeWorkArea(); });
  frame();
  return { get layout() { return layout; }, get mode() { return mode; }, setMode, openMenu, goPage,
    get page() { return pageIdx; }, get pages() { return pages.map(p => p.slice()); } };
})();
// ===== Tablet UI (Phase 2b): polish and German ===================================
// Display only, like Phases 1 and 2: the labels, the moved buttons and the camera pad change
// what is shown; every press still goes to the original button and its handler.
//   aow.ui.langChosen = auto | user   — German was set once as the default / a language was picked
// Numbers and units follow the language: German gets the decimal comma, km/h and ha/h. The
// formatters below are global so the Phase 2 renderers (called during their first frame) find them.
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
// ===== Tablet UI (Phase 2c): vehicle and tool profiles ===========================
// Cards to pick the active vehicle and tool, and an assistant (step by step, a sketch per
// measurement) to make a new one or change the active one. Only existing commands:
// profile.load / new / configureVehicle / configureTool / rename / delete / save and config.set
// with the keys of the setup dialogs; values go through the same unit helpers as there
// (writeUnitInput / readUnitInput), and only the values that were changed are sent.
// The assistant sends nothing while it is open: every value stays here and goes out in one go
// on "Save", so Cancel leaves the active profile exactly as it was. Changing or editing a
// profile needs the vehicle standing and steering off. Unusual values get a yellow warning,
// never a correction.
//   aow.ui.toolIcon.<name> = cultivator | sprayer | …   — symbol picked for a tool (this device only)
const TabletProfiles = (() => {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const lsGet = (k, d) => { try { const v = window.localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { if (v == null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch (_) { /* private / blocked */ } };
  const T = k => I18n.text(k);

  // --- Symbols (own line drawings) -----------------------------------------------------------
  const svg = body => '<svg class="tp-ic" viewBox="0 0 88 58" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">' + body + '</g></svg>';
  const ICON = {
    tractor: svg('<circle cx="22" cy="40" r="14"/><circle cx="22" cy="40" r="4"/><circle cx="70" cy="45" r="9"/><path d="M36 40h25M14 26V10h22l6 16h28l6 10v6h-6"/><path d="M40 10l-4 16"/>'),
    harvester: svg('<circle cx="26" cy="44" r="10"/><circle cx="66" cy="47" r="7"/><path d="M14 36V12h30v24M44 20h22l6 16M2 48h10M8 48l6-12"/>'),
    articulated: svg('<circle cx="20" cy="42" r="11"/><circle cx="66" cy="42" r="11"/><path d="M6 31h30V12H18l-4 10H6zM50 31h32V19H50z"/><path d="M36 26h14"/><circle cx="43" cy="26" r="3"/>'),
    cultivator: svg('<path d="M6 16h76M12 16v20l-5 8M28 16v20l-5 8M44 16v20l-5 8M60 16v20l-5 8M76 16v20l-5 8"/><path d="M44 16V6"/>'),
    sprayer: svg('<rect x="30" y="8" width="28" height="20" rx="8"/><path d="M4 34h80M14 34v6M30 34v6M44 34v6M58 34v6M74 34v6"/><path d="M12 46l2-6 2 6M28 46l2-6 2 6M42 46l2-6 2 6M56 46l2-6 2 6M72 46l2-6 2 6"/>'),
    seeder: svg('<path d="M14 8h60l-8 18H22z"/><path d="M8 32h72M16 32v12M32 32v12M48 32v12M64 32v12"/><circle cx="16" cy="48" r="3"/><circle cx="32" cy="48" r="3"/><circle cx="48" cy="48" r="3"/><circle cx="64" cy="48" r="3"/>'),
    plough: svg('<path d="M4 12h76"/><path d="M16 12l8 24c3 6 11 7 16 3M40 12l8 24c3 6 11 7 16 3"/><path d="M68 12v10"/>'),
    spreader: svg('<path d="M20 6h48L56 28H32z"/><path d="M44 28v6"/><circle cx="30" cy="42" r="8"/><circle cx="58" cy="42" r="8"/><path d="M30 34v16M22 42h16M58 34v16M50 42h16"/>'),
    mower: svg('<path d="M6 36h76M10 36l8-14h52l8 14"/><circle cx="22" cy="44" r="5"/><circle cx="44" cy="44" r="5"/><circle cx="66" cy="44" r="5"/>'),
    other: svg('<rect x="8" y="20" width="72" height="16" rx="3"/><path d="M44 20V8M20 36v10M44 36v10M68 36v10"/>'),
  };
  const VEH_TYPES = [[0, 'tractor', tr('Tractor')], [1, 'harvester', tr('Harvester')], [2, 'articulated', tr('Articulated')]];
  const VEH_TYPE_BY_TEXT = { Tractor: 0, Harvester: 1, FourWD: 2 }; // the host preview's "Type:" (VehicleType enum)
  const TOOL_TYPES = [['front', 0, tr('Front Fixed'), 'ToolChkFront'], ['rear', 1, tr('Rear Fixed'), 'ToolChkRear'],
    ['tbt', 2, tr('TBT'), 'ToolChkTBT'], ['trailing', 3, tr('Trailing'), 'ToolChkTrailing']];
  const ATTACH_TEXT = [tr('Front fixed'), tr('Rear fixed'), tr('Trailing')]; // the host preview's "Attach:"
  const SYMBOLS = [['', tr('From the name')], ['cultivator', tr('Cultivator')], ['sprayer', tr('Sprayer')], ['seeder', tr('Seed drill')],
    ['plough', tr('Plough')], ['spreader', tr('Spreader')], ['mower', tr('Mower')], ['other', tr('Other')]];
  const GUESS = [['sprayer', /spritz|spray/i], ['seeder', /s[äa]e?masch|drill|seed|plant|einzelkorn|legeger/i],
    ['plough', /pflug|plough|plow/i], ['spreader', /streuer|spread|dünger/i], ['mower', /m[äa]h|mower|schwad|wender|mulch/i],
    ['cultivator', /grubber|cultivat|egge|harrow|scheibe|disc|striegel|hacke|fr[äa]se|tiller/i]];
  const iconKey = name => 'aow.ui.toolIcon.' + name;
  function toolSymbol(name, pick) {
    const s = pick != null ? pick : lsGet(iconKey(name), '');
    if (s && ICON[s]) return s;
    for (const [k, re] of GUESS) if (re.test(name)) return k;
    return 'other';
  }
  // Text the host formats ("2.50 m"): shown as it comes, only the decimal comma in German.
  const hostVal = v => (v == null || v === '' ? '—' : tuiDec(v));
  function prevMap(txt) {
    const m = {};
    for (const line of String(txt || '').split('\n')) { const i = line.indexOf(': '); if (i > 0) m[line.slice(0, i)] = line.slice(i + 2); }
    return m;
  }
  const activeName = kind => profiles ? (kind === 'vehicle' ? profiles.activeVehicle : profiles.activeTool) : '';
  // The host lists the profiles saved on disk; a fresh install's "Default" is active before it
  // is saved, so the active one is always added.
  const listOf = kind => {
    if (!profiles) return [];
    const l = kind === 'vehicle' ? profiles.vehicles : profiles.tools, a = activeName(kind);
    return a && !l.some(p => p.name === a) ? [{ name: a, preview: '' }].concat(l) : l;
  };
  const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  // Working width = sum of the sections, as the host computes it (ActualToolWidth); for the
  // active tool from the config, same format as the width card on the work pages.
  function activeWidth() {
    const wm = config && config.tool ? +config.tool.totalWidth || 0 : 0;
    return wm > 0 ? tuiNum(toDisplayUnit(wm, 'm'), 2) + ' ' + unitLabel('m') : '—';
  }

  // --- Lock: profiles change only standing, steering off, connected ---------------------------
  const STILL_MPS = 0.15; // ≈ 0.5 km/h: GPS jitter at a standstill stays below this
  function lockReason() {
    if (connState !== 'connected') return tr('No connection to the guidance computer.');
    // Stale ticks: steering and speed below would be the last known values.
    if (!lastTick || performance.now() - lastTick.t > 2000) return tr('No current data from the guidance computer.');
    // Observers: the operator may switch steering back on at any moment with these values.
    if (!iHoldControl && lastControl && lastControl.held) return tr('Another device has control. Profiles can only be changed there.');
    if (tick && tick.op && tick.op.autoSteer) return tr('Steering is on. Switch steering off to change profiles.');
    if (lastTick && Math.abs(lastTick.speed || 0) > STILL_MPS) return tr('The vehicle is moving. Stop to change profiles.');
    return '';
  }

  // --- Sheet ---------------------------------------------------------------------------------
  const scrim = el('div', 'tp-scrim');
  const sheet = el('div', 'tui-sheet tp-sheet',
    '<div class="tui-sh-hdr"><span class="t"></span><button class="x">✕</button></div><div class="tui-sh-body tp-body"></div><div class="tp-foot"></div><div class="tp-ask" hidden></div>');
  sheet.id = 'tui-prof';
  sheet.querySelector('.x').title = tr('Close');
  document.body.append(scrim, sheet);
  for (const n of [sheet, scrim]) n.addEventListener('pointerdown', e => e.stopPropagation()); // no map pan through it
  const hdrT = sheet.querySelector('.t'), body = sheet.querySelector('.tp-body'), foot = sheet.querySelector('.tp-foot'), ask = sheet.querySelector('.tp-ask');
  let view = 'pick', W = null, sel = { vehicle: '', tool: '' }, msg = '', pickKey = '';
  const isOpen = () => sheet.classList.contains('open');
  onTap(sheet.querySelector('.x'), () => tryClose());
  onTap(scrim, () => tryClose());

  function open() {
    if (lnCloseAllOrig) lnCloseAllOrig();
    view = 'pick'; W = null; msg = ''; pickKey = '';
    sel = { vehicle: activeName('vehicle'), tool: activeName('tool') };
    sheet.classList.add('open'); scrim.classList.add('open');
    render();
  }
  function close() { sheet.classList.remove('open'); scrim.classList.remove('open'); hideAsk(); view = 'pick'; W = null; }
  function tryClose() {
    if (view !== 'wiz' || !W) { close(); return; }
    const wj = wjob();
    if (wj && wj.state === 'sending') return; // wait for the result
    if (wj && (wj.state === 'done' || wj.state === 'reverted')) { close(); return; }
    confirmAsk(tr('Leave the assistant?'), wj ? tr('The saving was not confirmed. Check the values in the profile.') :
      tr('Nothing has been sent; the profile stays as it was.'), tr('Leave'), () => { close(); });
  }

  // Small question box inside the sheet (name entry, confirmations).
  function hideAsk() { ask.hidden = true; ask.innerHTML = ''; }
  function confirmAsk(title, text, okLabel, onOk, danger) {
    ask.innerHTML = '<div class="tp-ask-box"><div class="tp-ask-t"></div><div class="tp-ask-m"></div><div class="tp-ask-b"><button class="tp-btn c"></button><button class="tp-btn pri o"></button></div></div>';
    ask.querySelector('.tp-ask-t').textContent = title; ask.querySelector('.tp-ask-m').textContent = text;
    ask.querySelector('.c').textContent = tr('Cancel');
    const ok = ask.querySelector('.o'); ok.textContent = okLabel; if (danger) ok.classList.add('dan');
    onTap(ask.querySelector('.c'), hideAsk);
    onTap(ok, () => { hideAsk(); onOk(); });
    ask.hidden = false;
  }
  // Name check: not empty, no characters a file name can't hold, not taken (case-insensitive).
  function nameProblem(kind, name, except) {
    if (!name) return tr('Please enter a name.');
    if (name.length > 60) return tr('The name is too long.');
    if (/[\t\\/:*?"<>|]/.test(name)) return tr('Please do not use these characters: \\ / : * ? " < > |');
    // Point 23: names Windows can't use as a file name (the profile is saved as <name>.json).
    if (/[. ]$/.test(name)) return tr('The name must not end with a dot or a space.');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) return tr('This name is reserved on Windows. Please choose another one.');
    if (listOf(kind).some(p => sameName(p.name, name) && !(except && sameName(except, name)))) return tr('A profile with this name already exists.');
    return '';
  }
  function nameAsk(kind, title, start, except, onOk) {
    ask.innerHTML = '<div class="tp-ask-box"><div class="tp-ask-t"></div><input class="tp-name" type="text" maxlength="60" autocomplete="off" translate="no"><div class="tp-ask-e"></div><div class="tp-ask-b"><button class="tp-btn c"></button><button class="tp-btn pri o"></button></div></div>';
    ask.querySelector('.tp-ask-t').textContent = title;
    const inp = ask.querySelector('.tp-name'), err = ask.querySelector('.tp-ask-e');
    inp.value = start || '';
    ask.querySelector('.c').textContent = tr('Cancel'); ask.querySelector('.o').textContent = tr('OK');
    onTap(ask.querySelector('.c'), hideAsk);
    const go = () => { const n = inp.value.trim(), p = nameProblem(kind, n, except); if (p) { err.textContent = p; return; } hideAsk(); onOk(n); };
    onTap(ask.querySelector('.o'), go);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    ask.hidden = false;
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  }

  // --- Pick view: cards ----------------------------------------------------------------------
  // The active profile's values as the host's preview writes them (same fields, 2 decimals).
  function activePreview(kind) {
    if (!config || !config.vehicle || !config.tool) return {};
    const f = v => Number.isFinite(v) ? fmtUnit(v, 'm', 2) : '—'; // point 25: no "NaN m"
    if (kind === 'vehicle') return { Wheelbase: f(config.vehicle.wheelbase), 'Antenna height': f(config.vehicle.antennaHeight), 'Antenna pivot': f(config.vehicle.antennaPivot) };
    return { Sections: String(config.tool.numSections) };
  }
  function cardHtml(kind, p, active) {
    const m = p.preview ? prevMap(p.preview) : active ? activePreview(kind) : {};
    // Active tool: the attach type from the config (the preview writes "—" for TBT).
    if (kind === 'tool' && active && config && config.tool) { const tt = TOOL_TYPES.find(t => t[1] === config.tool.type); if (tt) m['Attach'] = tt[2]; }
    let ic, rows;
    if (kind === 'vehicle') {
      const ty = active && config && config.vehicle ? config.vehicle.type : VEH_TYPE_BY_TEXT[m.Type];
      ic = ICON[(VEH_TYPES.find(v => v[0] === ty) || VEH_TYPES[0])[1]];
      rows = [[tr('Wheelbase'), hostVal(m['Wheelbase'])], [tr('Antenna height'), hostVal(m['Antenna height'])], [tr('Antenna to rear axle'), hostVal(m['Antenna pivot'])]];
    } else {
      ic = ICON[toolSymbol(p.name)];
      rows = [];
      // Inactive: the preview's "Width", which is the sum of the sections since upstream #350.
      rows.push([tr('Working width'), active ? activeWidth() : hostVal(m['Width'])]);
      rows.push([tr('Sections'), hostVal(m['Sections'])], [tr('Attach'), m['Attach'] && m['Attach'] !== '—' ? T(m['Attach']) : '—']);
    }
    return '<span class="tp-c-top"><span class="tp-c-ic">' + ic + '</span><span class="tp-c-n" translate="no"></span>' +
      (active ? '<span class="tp-badge">● ' + esc(T(tr('Active'))) + '</span>' : '') + '</span><span class="tp-c-k">' +
      rows.map(([k, v]) => '<span>' + esc(T(k)) + '</span><b translate="no">' + esc(v) + '</b>').join('') + '</span>';
  }
  function section(kind) {
    const isV = kind === 'vehicle', act = activeName(kind), list = listOf(kind);
    if (!list.some(p => p.name === sel[kind])) sel[kind] = act;
    const s = el('div', 'tp-sec');
    s.appendChild(Object.assign(el('div', 'tui-sh-sec'), { textContent: isV ? T(tr('Vehicle')) : T(tr('Tool')) }));
    const cards = el('div', 'tp-cards');
    for (const p of list) {
      const c = el('button', 'tp-card' + (p.name === sel[kind] ? ' sel' : '') + (p.name === act ? ' on' : ''), cardHtml(kind, p, p.name === act));
      c.querySelector('.tp-c-n').textContent = p.name;
      onTap(c, () => { sel[kind] = p.name; msg = ''; render(); });
      cards.appendChild(c);
    }
    const add = el('button', 'tp-card add', '<span class="tp-plus">＋</span><span></span>');
    add.querySelector('span:last-child').textContent = isV ? T(tr('New vehicle')) : T(tr('New tool'));
    add.disabled = !!lockReason();
    onTap(add, () => startWizard(kind, 'new'));
    cards.appendChild(add);
    s.appendChild(cards);
    const lock = lockReason(), isAct = sel[kind] === act;
    const acts = el('div', 'tp-acts');
    const btn = (label, fn, on, cls) => { const b = el('button', 'tp-btn' + (cls ? ' ' + cls : '')); b.textContent = label; b.disabled = !on; onTap(b, fn); acts.appendChild(b); return b; };
    btn(T(tr('Edit')), () => startWizard(kind, 'edit'), !lock && isAct);
    btn(T(tr('Duplicate')), () => duplicate(kind), !lock && isAct);
    const onDisk = (isV ? profiles.vehicles : profiles.tools).some(p => p.name === sel[kind]); // rename needs the file
    btn(T(tr('Rename')), () => rename(kind), !lock && onDisk);
    btn(T(tr('Delete')), () => remove(kind), !lock && !!sel[kind] && !isAct, 'dan');
    btn(T(tr('All settings')), () => allSettings(kind), !lock && isAct, 'quiet');
    s.appendChild(acts);
    if (!isAct && sel[kind]) s.appendChild(Object.assign(el('div', 'tp-note'),
      { textContent: T(isV ? tr('Edit and duplicate work on the active vehicle. Load it first.') : tr('Edit and duplicate work on the active tool. Load it first.')) }));
    return s;
  }
  function renderPick() {
    hdrT.textContent = T(tr('Vehicle & Tool'));
    body.innerHTML = '';
    const lock = lockReason();
    if (!profiles) { body.textContent = T(tr('Waiting for the profiles…')); foot.innerHTML = ''; return; }
    if (lock) body.appendChild(Object.assign(el('div', 'tp-lock'), { textContent: T(lock) }));
    if (pending) {
      const pb = el('button', 'tp-pend inline', '<span class="tp-pend-t"></span><span class="tp-pend-s"></span>');
      pb.querySelector('.tp-pend-t').textContent = T(tr('Profile not completely saved – check the values'));
      pb.querySelector('.tp-pend-s').textContent = pending.kind === 'vehicle' ? tr('Vehicle "{name}"', { name: pending.name }) : tr('Tool "{name}"', { name: pending.name });
      onTap(pb, () => openRecover());
      body.appendChild(pb);
    }
    body.append(section('vehicle'), section('tool'));
    if (msg) body.appendChild(Object.assign(el('div', 'tp-msg'), { textContent: msg }));
    foot.innerHTML = '';
    const classic = el('button', 'tp-btn quiet'); classic.textContent = T(tr('Classic view'));
    classic.disabled = !!lock;
    onTap(classic, () => {
      if (pending) { openRecover(); return; } // its Load would save the half-applied values too
      close(); lnOpenOrig('vehtoolhub', 'ln-vehicle', refreshHub);
    });
    const changed = sel.vehicle !== profiles.activeVehicle || sel.tool !== profiles.activeTool;
    const load = el('button', 'tp-btn pri big');
    load.innerHTML = '✓ <span></span>';
    load.querySelector('span').textContent = changed ? tr('Load: {vehicle} + {tool}', { vehicle: sel.vehicle, tool: sel.tool }) : T(tr('Loaded'));
    load.setAttribute('translate', 'no');
    load.disabled = !!lock || !changed;
    onTap(load, () => {
      if (lockReason()) return;
      if (pending) { openRecover(); return; } // the host would save the half-applied values first
      transport.send('profile.load|' + sel.vehicle + '\t' + sel.tool); // saves the outgoing pair first (host)
      // Point 23: "Loaded" only once the host's profile list names this pair as active.
      loadWait = { vehicle: sel.vehicle, tool: sel.tool, t: Date.now() };
      msg = tr('Loading: {vehicle} + {tool} …', { vehicle: sel.vehicle, tool: sel.tool });
    });
    foot.append(classic, el('span', 'tp-grow'), load);
  }
  // While a save is unfinished, the active pair holds half-applied values only in memory.
  // Load, duplicate and rename make the host save it (profile.load / profile.new save the
  // active pair first, rename leaves the record pointing at a name that is gone), so the
  // recovery view comes first, as for the assistant.
  function duplicate(kind) {
    if (pending) { openRecover(); return; }
    const src = activeName(kind);
    nameAsk(kind, T(kind === 'vehicle' ? tr('Duplicate vehicle') : tr('Duplicate tool')), tr('{name} copy', { name: src }), null, n => {
      if (lockReason()) return;
      transport.send('profile.new|' + kind + '\t' + n); // copy of the active profile under a new name
      if (kind === 'tool') { const s = lsGet(iconKey(src), ''); if (s) lsSet(iconKey(n), s); }
      sel[kind] = n; msg = tr('Copy made: {name}', { name: n }); render();
    });
  }
  function rename(kind) {
    if (pending) { openRecover(); return; }
    const old = sel[kind];
    nameAsk(kind, T(tr('Rename')), old, old, n => {
      if (lockReason() || n === old) return;
      transport.send('profile.rename|' + kind + '\t' + old + '\t' + n);
      if (kind === 'tool') { const s = lsGet(iconKey(old), ''); if (s) { lsSet(iconKey(n), s); lsSet(iconKey(old), null); } }
      sel[kind] = n; msg = ''; render();
    });
  }
  function remove(kind) {
    const n = sel[kind];
    if (!n || n === activeName(kind)) return;
    confirmAsk(T(tr('Delete Profile')), tr('Delete the profile "{name}"? This cannot be undone.', { name: n }), T(tr('Delete')), () => {
      if (lockReason()) return;
      transport.send('profile.delete|' + kind + '\t' + n);
      if (kind === 'tool') lsSet(iconKey(n), null);
      sel[kind] = activeName(kind); msg = ''; render();
    }, true);
  }
  // The full setup dialogs (every field, each change takes effect at once as before).
  function allSettings(kind) {
    close();
    if (typeof TabletTerminal !== 'undefined' && TabletTerminal.layout === 'terminal') TabletTerminal.setMode('setup');
    if (kind === 'vehicle') lnOpenOrig('vehiclecfg', 'ln-vehicle', () => populateVehicleCfg(true));
    else lnOpenOrig('toolcfg', 'ln-vehicle', () => populateToolCfg(true));
  }

  // --- Assistant -----------------------------------------------------------------------------
  // A field: key (config.set), unit ('m' | 'cm' | ''), the step of the matching setup-dialog input,
  // label, help, sketch. Signed fields show the amount plus a side choice; the value sent is
  // -amount / 0 / +amount, as the dialog's side buttons would leave it.
  const V_FIELDS = {
    wheelbase: { key: 'vehicle.wheelbase', unit: 'm', label: tr('Wheelbase'), help: tr('Centre of the rear axle to centre of the front axle, measured at the side.'), sk: 'wheelbase', warn: [1, 6] },
    trackWidth: { key: 'vehicle.trackWidth', unit: 'm', label: tr('Track width'), help: tr('Centre of the left tyre to centre of the right tyre.'), sk: 'trackWidth' },
    hitchLength: { key: 'vehicle.hitchLength', unit: 'm', label: tr('Hitch length'), help: tr('Rear axle to the hitch point.'), sk: 'hitchLength' },
    antennaPivot: { key: 'vehicle.antennaPivot', unit: 'm', label: tr('Antenna to rear axle'), help: tr('From the middle of the rear axle to the antenna, along the vehicle.'), sk: 'antennaPivot', warnAbs: 4 },
    antennaHeight: { key: 'vehicle.antennaHeight', unit: 'm', label: tr('Antenna height'), help: tr('From the ground to the antenna.'), sk: 'antennaHeight', warn: [1, 5] },
    antennaOffset: { key: 'vehicle.antennaOffset', unit: 'm', label: tr('Antenna to the side'), help: tr('From the middle of the vehicle to the antenna, sideways.'), sk: 'antennaOffset', warnAbs: 0.5,
      sides: [['left', -1, tr('Left')], ['center', 0, tr('Center')], ['right', 1, tr('Right')]] },
  };
  const T_FIELDS = {
    hitchLength: { key: 'tool.hitchLength', unit: 'm', label: tr('Working center'), help: tr('Middle of the rear axle to the working point of the tool, along the vehicle.'), sk: 'tool:hitchLength' },
    trailingHitchLength: { key: 'tool.trailingHitchLength', unit: 'm', label: tr('Trailing hitch'), help: tr('Hitch pin of the tractor to the axle of the tool.'), sk: 'tool:trailingHitchLength' },
    tankTrailingHitchLength: { key: 'tool.tankTrailingHitchLength', unit: 'm', label: tr('Tank trailing hitch'), help: tr('Hitch pin of the tractor to the axle of the tank.'), sk: 'tool:tankTrailingHitchLength' },
    length: { key: 'tool.length', unit: 'm', label: tr('Implement length'), help: tr('Working point to the rear end of the tool.'), sk: 'tool:length' },
    offset: { key: 'tool.offset', unit: 'm', label: tr('Tool offset'), help: tr('Tool shifted sideways from the middle of the vehicle.'), img: 'ToolOffsetPositiveRight',
      sides: [['left', -1, tr('Left')], ['zero', 0, tr('Zero')], ['right', 1, tr('Right')]] },
    overlap: { key: 'tool.overlap', unit: 'm', label: tr('Overlap / gap'), help: tr('Overlap between two passes, or a gap.'), img: 'ToolOverlap',
      sides: [['gap', -1, tr('Gap')], ['zero', 0, tr('Zero')], ['overlap', 1, tr('Overlap')]] },
    defaultSectionWidth: { key: 'tool.defaultSectionWidth', unit: 'cm', label: tr('Default width'), help: tr('Width given to sections that are added.'), sk: 'sections' },
  };
  // The matching input of the setup dialogs: its step decides rounding and display (as there).
  const dlgInput = key => document.querySelector('#vehiclecfg .cfg-num[data-key="' + key + '"], #toolcfg .cfg-num[data-key="' + key + '"]');
  const stepOf = key => { const d = dlgInput(key); return d ? (d.dataset.mstep || d.getAttribute('step') || '0.01') : '0.01'; };
  const metricOf = inp => readUnitInput(inp);
  const fmtM = (v, u) => Number.isFinite(v) ? fmtUnit(v, u) : '—';

  function makeNum(key, unit, metricVal, step) {
    const inp = el('input', 'tp-in');
    inp.type = 'number'; inp.inputMode = 'decimal'; inp.setAttribute('step', step || stepOf(key));
    if (unit) inp.dataset.unit = unit;
    inp.dataset.key = key;
    applyUnitsTo(inp);
    if (Number.isFinite(metricVal)) writeUnitInput(inp, metricVal);
    inp.dataset.init = inp.value;
    inp.addEventListener('input', () => onEdit());
    inp.addEventListener('focus', () => { if (W) { W.focus = inp.dataset.sk || W.focus; drawSketch(); } });
    return inp;
  }
  // applyUnits() for one new input (the global one walks the page).
  function applyUnitsTo(inp) {
    if (inp.dataset.mstep == null) inp.dataset.mstep = inp.getAttribute('step') || '';
    const d = UNIT_DEFS[inp.dataset.unit];
    if (d && !isMetric()) inp.step = String(d.impStep);
  }
  function fieldRow(f, inp, extra) {
    const r = el('div', 'tp-fld');
    r.innerHTML = '<div class="tp-f-l"></div><div class="tp-f-h"></div><div class="tp-f-in"></div><div class="tp-f-w" hidden></div>';
    r.querySelector('.tp-f-l').textContent = T(f.label);
    r.querySelector('.tp-f-h').textContent = T(f.help || '');
    const box = r.querySelector('.tp-f-in');
    box.appendChild(inp);
    const u = el('span', 'tp-f-u'); u.textContent = f.unit ? unitLabel(f.unit) : ''; box.appendChild(u);
    if (extra) r.appendChild(extra);
    inp.dataset.sk = f.sk || f.img || '';
    r.addEventListener('pointerdown', e => { if (e.target === r || !e.target.closest('input,button,select')) inp.focus(); });
    return r;
  }
  // Signed field: amount + side.
  function signedField(f, metricVal) {
    const zeroSide = f.sides.find(s => s[1] === 0)[0];
    const side0 = !Number.isFinite(metricVal) ? zeroSide : metricVal < -0.005 ? f.sides.find(s => s[1] < 0)[0] : metricVal > 0.005 ? f.sides.find(s => s[1] > 0)[0] : zeroSide;
    const inp = makeNum(f.key, f.unit, Number.isFinite(metricVal) ? Math.abs(metricVal) : NaN);
    const seg = el('div', 'tp-seg');
    const st = { f, inp, side: side0, side0, base: metricVal };
    for (const [id, , label] of f.sides) {
      const b = el('button', 'tp-segb'); b.textContent = T(label); b.dataset.side = id;
      onTap(b, () => { st.side = id; syncSeg(); onEdit(); });
      seg.appendChild(b);
    }
    const syncSeg = () => {
      for (const b of seg.children) b.classList.toggle('on', b.dataset.side === st.side);
      const zero = f.sides.find(s => s[0] === st.side)[1] === 0;
      inp.disabled = zero;
    };
    st.syncSeg = syncSeg; syncSeg();
    st.row = fieldRow(f, inp, seg);
    st.changed = () => st.side !== st.side0 || (f.sides.find(s => s[0] === st.side)[1] !== 0 && inp.value !== inp.dataset.init);
    st.value = () => { const sg = f.sides.find(s => s[0] === st.side)[1]; if (sg === 0) return 0;
      // Magnitude untouched (only the side changed): the host's exact value, not the rounded text.
      const a = inp.value === inp.dataset.init && Number.isFinite(st.base) && Math.abs(st.base) > 0.005 ? Math.abs(st.base) : metricOf(inp); return Number.isFinite(a) ? sg * Math.abs(a) : NaN; };
    return st;
  }
  function plainField(f, metricVal) {
    const inp = makeNum(f.key, f.unit, metricVal);
    const st = { f, inp, base: metricVal, row: fieldRow(f, inp) };
    st.changed = () => inp.value !== inp.dataset.init;
    st.value = () => metricOf(inp);
    return st;
  }
  function selectField(key, label, opts, cur) {
    const s = el('select', 'tp-sel');
    opts.forEach((lab, i) => { const o = el('option'); o.value = String(i - 1); o.textContent = T(lab); s.appendChild(o); });
    s.value = String(cur);
    s.addEventListener('change', () => onEdit());
    const r = el('div', 'tp-fld');
    r.innerHTML = '<div class="tp-f-l"></div><div class="tp-f-h"></div><div class="tp-f-in"></div>';
    r.querySelector('.tp-f-l').textContent = T(label);
    r.querySelector('.tp-f-in').appendChild(s);
    return { key, sel: s, base: cur, row: r, changed: () => s.value !== String(cur), value: () => s.value, label, opts };
  }
  // Coupling type (ISO 11783 code, Vehicle/Tool.HitchType) as tiles with everyday names, the norm
  // small below. The host only writes it into the ISO-XML export (connector type, DDI 157); it
  // does not change guidance, steering or the tool position. Same value as the select had.
  function hitchTiles(key, cur) {
    const r = el('div', 'tp-fld wide');
    r.innerHTML = '<div class="tp-f-l"></div><div class="tp-f-h"></div><div class="tp-hitch"></div>';
    r.querySelector('.tp-f-l').textContent = T(tr('Coupling type'));
    r.querySelector('.tp-f-h').textContent = T(tr('Only a description (ISO-XML export); it does not change guidance or steering.'));
    const g = r.querySelector('.tp-hitch');
    const st = { key, base: cur, cur: String(cur), row: r, label: tr('Coupling type'), opts: HITCH_OPTS };
    for (const h of TUI_HITCH) {
      const b = el('button', 'tp-ht', tuiHitchPicto(h.code) + '<b></b><small></small>');
      b.dataset.code = String(h.code);
      b.querySelector('b').textContent = T(h.name);
      b.querySelector('small').textContent = HITCH_NORM[h.code + 1] || '';
      onTap(b, () => { st.cur = String(h.code); sync(); onEdit(); });
      g.appendChild(b);
    }
    const sync = () => { for (const b of g.children) b.classList.toggle('on', b.dataset.code === st.cur); };
    sync();
    st.changed = () => st.cur !== String(cur);
    st.value = () => st.cur;
    return st;
  }
  function warnFor(f, v) {
    if (!Number.isFinite(v)) return '';
    if (f.warn && (v < f.warn[0] || v > f.warn[1]))
      return tr('Unusual value (expected {min} to {max}). Please measure again; it is saved as entered.', { min: fmtUnit(f.warn[0], f.unit), max: fmtUnit(f.warn[1], f.unit) });
    if (f.warnAbs && Math.abs(v) > f.warnAbs)
      return tr('Unusual value (usually not more than {max}). Please measure again; it is saved as entered.', { max: fmtUnit(f.warnAbs, f.unit) });
    return '';
  }

  // The host's values for the profile kind (a tool also depends on the vehicle type).
  const snapOf = kind => JSON.stringify(config[kind]) + (kind === 'tool' ? '|' + (config.vehicle.type | 0) : '');
  function startWizard(kind, mode) {
    if (lockReason() || !config || !config.vehicle || !config.tool || !profiles) return;
    if (pending) { openRecover(); return; } // an unfinished save comes first
    const src = activeName(kind);
    const v = config.vehicle, t = config.tool;
    W = { kind, mode, src, name: mode === 'edit' ? src : '', step: 0, focus: '', save: null, sym: null,
      harvester: (v.type | 0) === 1, baseToolType: t.type, snap: snapOf(kind), metric: isMetric() };
    if (kind === 'vehicle') {
      W.type = { key: 'vehicle.type', base: v.type | 0, cur: v.type | 0 };
      W.f = {
        wheelbase: plainField(V_FIELDS.wheelbase, v.wheelbase),
        trackWidth: plainField(V_FIELDS.trackWidth, v.trackWidth),
        hitchLength: plainField(V_FIELDS.hitchLength, v.hitchLength),
        antennaPivot: plainField(V_FIELDS.antennaPivot, v.antennaPivot),
        antennaHeight: plainField(V_FIELDS.antennaHeight, v.antennaHeight),
        antennaOffset: signedField(V_FIELDS.antennaOffset, v.antennaOffset),
      };
      W.hitch = hitchTiles('vehicle.hitchType', v.hitchType);
      W.steps = mode === 'new' ? ['type', 'name', 'size', 'antenna', 'check'] : ['type', 'size', 'antenna', 'check'];
    } else {
      const ty = TOOL_TYPES.find(x => x[1] === t.type) || TOOL_TYPES[1];
      W.type = { key: 'tool.type', base: ty[0], cur: ty[0] };
      W.sym = lsGet(iconKey(src), '');
      W.symBase = W.sym;
      W.f = {};
      for (const k of ['hitchLength', 'trailingHitchLength', 'tankTrailingHitchLength', 'length', 'defaultSectionWidth']) W.f[k] = plainField(T_FIELDS[k], t[k]);
      W.f.offset = signedField(T_FIELDS.offset, t.offset);
      W.f.overlap = signedField(T_FIELDS.overlap, t.overlap);
      W.hitch = hitchTiles('tool.hitchType', t.hitchType);
      W.nSec = { base: t.numSections | 0 };
      W.nSec.inp = makeNum('tool.numSections', '', t.numSections | 0, '1');
      W.nSec.inp.min = '1'; W.nSec.inp.max = '64';
      W.widths = []; // { inp, init, edited }
      W.baseWidths = (t.sectionWidths || []).slice();
      W.steps = mode === 'new' ? ['type', 'name', 'sections', 'hitch', 'check'] : ['type', 'sections', 'hitch', 'check'];
      // A new tool on a harvester: the header is offered straight away (front fixed, one section).
      if (mode === 'new' && W.harvester) setHeader(true);
    }
    view = 'wiz';
    renderWizard();
  }
  // Section width boxes follow the count. Sections that exist keep their width; added ones start
  // with the default width, as the host gives them (ConfigurationStore.NumSections).
  function syncWidths() {
    const n = Math.max(1, Math.min(64, Math.round(parseFloat(W.nSec.inp.value)) || 0));
    const def = W.f.defaultSectionWidth.inp.value;
    for (let i = 0; i < Math.max(n, W.widths.length); i++) {
      if (i >= n) { if (W.widths[i]) W.widths[i].wrap.hidden = true; continue; }
      if (!W.widths[i]) {
        const exists = i < W.nSec.base;
        const inp = makeNum('tool.sectionWidth', 'cm', exists ? W.baseWidths[i] : NaN, '0.1'); // as the dialog's section boxes
        if (!exists) { inp.value = def; inp.dataset.init = def; }
        inp.dataset.sk = 'sections';
        const wrap = el('label', 'tp-sw'); wrap.innerHTML = '<span></span>'; wrap.firstChild.textContent = 'S' + (i + 1); wrap.appendChild(inp);
        const w = { inp, wrap, exists, edited: false };
        inp.addEventListener('input', () => { w.edited = true; });
        W.widths[i] = w;
        W.swBox.appendChild(wrap);
      }
      const w = W.widths[i];
      w.wrap.hidden = false;
      // Not yet typed in: an added section follows the default width.
      if (!w.exists && !w.edited) { w.inp.value = def; w.inp.dataset.init = def; }
    }
  }
  function sumWidthM() {
    const n = Math.max(1, Math.min(64, Math.round(parseFloat(W.nSec.inp.value)) || 0));
    let s = 0;
    for (let i = 0; i < n; i++) { const v = W.widths[i] ? metricOf(W.widths[i].inp) : NaN; if (!Number.isFinite(v)) return NaN; s += v; }
    return s / 100; // cm → m, as ActualToolWidth
  }

  // Sketches: own drawings for the vehicle measurements and the sections; the hitch, offset and
  // overlap pictures are the ones of the tool setup dialog (they show what each length means).
  function dim(x1, y1, x2, y2, label, lx, ly, anchor) {
    const a = Math.atan2(y2 - y1, x2 - x1), h = 12, w = 6;
    const head = (x, y, d) => { const c = Math.cos(a) * d, s = Math.sin(a) * d;
      return 'M' + x + ' ' + y + 'L' + (x - c * h - s * w) + ' ' + (y - s * h + c * w) + 'L' + (x - c * h + s * w) + ' ' + (y - s * h - c * w) + 'Z'; };
    return '<g class="sk-d"><line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/><path d="' + head(x2, y2, 1) + head(x1, y1, -1) + '"/></g>' +
      '<text class="sk-dl" x="' + lx + '" y="' + ly + '" text-anchor="' + (anchor || 'middle') + '">' + esc(T(label)) + '</text>';
  }
  const dash = (x1, y1, x2, y2) => '<line class="sk-x" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>';

  // --- Coupling types: everyday names and own pictograms (side view, tractor rear on the left) ---
  // code = ISO 11783 connector code (Vehicle/Tool.HitchType); the norm comes from HITCH_NORM.
  const TUI_HITCH = [
    { code: 5, name: tr('Clevis (jaw)') }, { code: 8, name: tr('Ball hitch K80') }, { code: 6, name: tr('Piton-fix') },
    { code: 4, name: tr('Hitch hook') }, { code: 1, name: tr('Swinging drawbar') }, { code: 3, name: tr('Three-point linkage') },
    { code: 2, name: tr('Three-point, semi-mounted') }, { code: 7, name: tr('CUNA hitch') }, { code: 10, name: tr('Drawbar eye (wagon)') },
    { code: 9, name: tr('Self-propelled (on the chassis)') }, { code: 0, name: tr('Unknown') }, { code: -1, name: tr('Not specified') },
  ];
  const HITCH_NORM = ['', '', 'ISO 6489-3', 'ISO 730', 'ISO 730', 'ISO 6489-1', 'ISO 6489-2 (40 mm)', 'ISO 6489-4', 'ISO 6489-5', 'ISO 24347', '', 'ISO 5692-2'];
  function tuiHitchPicto(code) {
    // Tractor rear: wheel, fender, body; the coupling sits right of x = 58.
    const base = '<circle cx="34" cy="46" r="20"/><circle cx="34" cy="46" r="5"/><path d="M6 22h44l8 18v10"/><path d="M14 30a22 22 0 0 1 40 6"/>';
    const c = {
      1: '<path d="M58 54h34"/><circle cx="88" cy="54" r="3"/>',
      2: '<path d="M58 52l26 6"/><path d="M84 40v22h22"/><circle cx="100" cy="62" r="6"/>',
      3: '<path d="M58 52l24 4"/><path d="M58 32l24 4"/><path d="M82 30v32h18v-32z"/>',
      4: '<path d="M58 54h26q8 0 8-8v-4"/>',
      5: '<path d="M58 44h28M58 56h28"/><path d="M80 38v24"/>',
      6: '<path d="M58 58h30"/><path d="M82 58v-14q0-4 4-4"/>',
      7: '<path d="M58 42h24M58 58h24"/><path d="M82 42q10 8 0 16"/><path d="M76 36v28"/>',
      8: '<path d="M58 56h26v-8"/><circle cx="84" cy="42" r="6"/>',
      9: '<path d="M58 30h44v24h-44z"/><path d="M66 54v8M94 54v8"/>',
      10: '<path d="M58 54h22"/><circle cx="88" cy="54" r="7"/>',
    }[code];
    const q = '<text x="84" y="56" text-anchor="middle" class="ht-q">?</text>';
    return '<svg class="tp-htp" viewBox="0 0 120 72"><line class="ht-g" x1="2" y1="67" x2="118" y2="67"/><g class="ht-b">' + base + (c || '') + '</g>' + (c ? '' : q) + '</svg>';
  }

  // --- Tool measurements: side view per tool type, each length with arrows from point to point.
  // The focused field's length is highlighted; the vehicle's hitch length (rear axle → hitch pin)
  // is shown for trailing/TBT tools, where the host adds it (ToolPositionService.Update).
  function tuiToolSketch(type, focus, veh) {
    const on = k => !focus || focus === k;
    const D = (k, x1, x2, y, label, ly) => '<g class="' + (on(k) ? 'sk-on' : 'sk-off') + '">' + dash(x1, y - 30, x1, y + 8) + dash(x2, y - 30, x2, y + 8) +
      dim(Math.min(x1, x2), y, Math.max(x1, x2), y, label, (x1 + x2) / 2, ly != null ? ly : y + 26) + '</g>';
    const tractor = (dx, flip) => '<g class="sk-b" transform="translate(' + dx + ' 0) scale(0.82)' + (flip ? '' : '') + '">' +
      '<circle cx="170" cy="262" r="68"/><circle cx="170" cy="262" r="14"/><circle cx="410" cy="284" r="46"/><circle cx="410" cy="284" r="9"/>' +
      '<path d="M100 200V70h120l26 90h164l42 54v24"/><path d="M226 70l-20 90"/></g>';
    const wheel = (x, r) => '<g class="sk-b"><circle cx="' + x + '" cy="' + (270 - r) + '" r="' + r + '"/><circle cx="' + x + '" cy="' + (270 - r) + '" r="4"/></g>';
    const mark = x => '<path class="sk-wp" d="M' + x + ' 270l-9 -16h18z"/>'; // working point on the ground
    let g = '<line class="sk-g" x1="10" y1="270" x2="890" y2="270"/>';
    const vh = veh && Number.isFinite(veh.hitchLength) ? veh.hitchLength : NaN;
    if (type === 0) { // front fixed: tractor left (rear axle x 180), tool ahead on the right
      g += tractor(40) + '<g class="sk-b"><path d="M412 238h46"/><path d="M412 214l46 6"/><rect x="470" y="150" width="150" height="90" rx="8"/></g>' + mark(560);
      g += D('hitchLength', 180, 560, 300, tr('Working center')) + D('length', 560, 620, 120, tr('Implement length'), 104);
    } else if (type === 1) { // rear fixed: tractor right (rear axle x 640), tool behind on the left
      g += tractor(500) + '<g class="sk-b"><path d="M584 236h-60"/><path d="M584 214l-60 6"/><rect x="400" y="150" width="124" height="90" rx="8"/></g>' + mark(450);
      g += D('hitchLength', 450, 640, 300, tr('Working center')) + D('length', 400, 450, 120, tr('Implement length'), 104);
    } else if (type === 3) { // trailing
      g += tractor(500) + '<g class="sk-b"><circle cx="555" cy="225" r="6"/><path d="M549 225H330"/><rect x="180" y="170" width="150" height="60" rx="8"/></g>' + wheel(300, 26);
      g += '<g class="sk-off">' + dash(555, 195, 555, 278) + dash(640, 195, 640, 278) + dim(555, 288, 640, 288, '', 0, 0) + '</g>';
      g += D('trailingHitchLength', 300, 555, 300, tr('Trailing hitch')) + D('length', 180, 300, 140, tr('Implement length'), 124);
    } else { // TBT: tank on the hitch, tool behind the tank
      g += tractor(500) + '<g class="sk-b"><circle cx="555" cy="225" r="6"/><path d="M549 225H480"/><rect x="360" y="120" width="120" height="110" rx="10"/><path d="M360 220H230"/>' +
        '<rect x="70" y="175" width="160" height="55" rx="8"/></g>' + wheel(420, 30) + wheel(170, 24);
      g += '<g class="sk-off">' + dash(555, 195, 555, 278) + dash(640, 195, 640, 278) + dim(555, 288, 640, 288, '', 0, 0) + '</g>';
      g += D('tankTrailingHitchLength', 420, 555, 300, tr('Tank trailing hitch')) + D('trailingHitchLength', 170, 420, 300, tr('Trailing hitch'))
        + D('length', 70, 170, 140, tr('Implement length'), 124);
    }
    if (type === 2 || type === 3)
      g += '<text class="sk-dl sk-small" x="598" y="328" text-anchor="start">' + esc(T(tr('Hitch length (vehicle)'))) + ' ' + esc(fmtM(vh, 'm')) + '</text>';
    return '<svg class="tp-sk tp-sk-tool" viewBox="0 0 900 340">' + g + '</svg>';
  }
  function sideView(extra) {
    return '<svg class="tp-sk" viewBox="0 0 560 380"><line class="sk-g" x1="20" y1="330" x2="540" y2="330"/>' +
      '<g class="sk-b"><circle cx="170" cy="262" r="68"/><circle cx="170" cy="262" r="14"/><circle cx="410" cy="284" r="46"/><circle cx="410" cy="284" r="9"/>' +
      '<path d="M100 200V70h120l26 90h164l42 54v24"/><path d="M226 70l-20 90"/><path d="M102 250H72"/><circle cx="66" cy="250" r="6"/></g>' +
      '<rect class="sk-a" x="194" y="50" width="40" height="14" rx="5"/>' + extra + '</svg>';
  }
  function rearView(extra) {
    return '<svg class="tp-sk" viewBox="0 0 560 380"><line class="sk-g" x1="20" y1="330" x2="540" y2="330"/>' +
      '<g class="sk-b"><rect x="104" y="196" width="72" height="134" rx="16"/><rect x="384" y="196" width="72" height="134" rx="16"/>' +
      '<path d="M176 250h208"/><rect x="204" y="70" width="152" height="170" rx="12"/></g>' +
      dash(280, 30, 280, 345) + '<rect class="sk-a" x="306" y="48" width="40" height="14" rx="5"/>' + extra + '</svg>';
  }
  function sectionsView() {
    const n = Math.max(1, Math.min(64, Math.round(parseFloat(W.nSec.inp.value)) || 1)), shown = Math.min(n, 16);
    const ws = []; for (let i = 0; i < shown; i++) { const v = W.widths[i] ? metricOf(W.widths[i].inp) : NaN; ws.push(Number.isFinite(v) && v > 0 ? v : 1); }
    const tot = ws.reduce((a, b) => a + b, 0), x0 = 40, x1 = 520;
    let x = x0, segs = '';
    ws.forEach((w, i) => { const nx = x + (x1 - x0) * w / tot; segs += '<rect class="sk-sec' + (i % 2 ? ' alt' : '') + '" x="' + x + '" y="190" width="' + (nx - x) + '" height="34"/>'; x = nx; });
    const s1 = x0 + (x1 - x0) * ws[0] / tot;
    return '<svg class="tp-sk" viewBox="0 0 560 380"><g class="sk-b"><rect x="252" y="30" width="56" height="96" rx="10"/><path d="M240 46v24M320 46v24M240 92v26M320 92v26M280 126v64"/></g>' +
      segs + (n > shown ? '<text class="sk-dl" x="280" y="182" text-anchor="middle">' + esc(tr('({n} sections)', { n })) + '</text>' : '') +
      dim(x0, 262, x1, 262, tr('Working width'), 280, 296) + dim(x0, 160, s1, 160, tr('Section'), x0, 146, 'start') + '</svg>';
  }
  function hitchImg() {
    const ty = (TOOL_TYPES.find(x => x[0] === W.type.cur) || TOOL_TYPES[1])[1];
    return '/icons/' + (['ToolHitchPageFront', 'ToolHitchPageRear', 'ToolHitchPageTBT', 'ToolHitchPageTrailing'][ty] || 'ToolHitchPageRear') + '.png';
  }
  function sketchSvg(id) {
    switch (id) {
      case 'wheelbase': return sideView(dash(170, 262, 170, 362) + dash(410, 284, 410, 362) + dim(170, 350, 410, 350, tr('Wheelbase'), 290, 374));
      case 'hitchLength': return sideView(dash(66, 250, 66, 362) + dash(170, 262, 170, 362) + dim(66, 350, 170, 350, tr('Hitch length'), 118, 374));
      case 'antennaPivot': return sideView(dash(170, 262, 170, 20) + dash(214, 50, 214, 20) + dim(170, 28, 214, 28, tr('Antenna to rear axle'), 230, 33, 'start'));
      case 'antennaHeight': return sideView(dash(234, 57, 512, 57) + dim(500, 330, 500, 57, tr('Antenna height'), 488, 120, 'end'));
      case 'trackWidth': return rearView(dash(140, 330, 140, 362) + dash(420, 330, 420, 362) + dim(140, 352, 420, 352, tr('Track width'), 280, 376));
      case 'antennaOffset': return rearView(dim(280, 22, 326, 22, tr('Antenna to the side'), 340, 27, 'start'));
      case 'sections': return sectionsView();
      case 'hitch': return '<img class="tp-skimg" src="' + hitchImg() + '" alt="">';
      default: if (id.startsWith('tool:')) return tuiToolSketch(toolTypeNo(), id.slice(5), config && config.vehicle); return '';
      case 'ToolOffsetPositiveRight': case 'ToolOverlap': return '<img class="tp-skimg" src="/icons/' + id + '.png" alt="">';
    }
  }
  function drawSketch() {
    const box = W && W.skBox;
    if (!box) return;
    const id = W.focus || W.skDefault || '';
    const k = id + '|' + (id === 'sections' ? W.nSec.inp.value + W.widths.map(w => w.inp.value).join(',') : id === 'hitch' || id.startsWith('tool:') ? W.type.cur : '') + '|' + I18n.language;
    if (box.dataset.k === k) return;
    box.dataset.k = k;
    box.innerHTML = sketchSvg(id);
  }

  const STEP_LABEL = { type: tr('Type'), attach: tr('Attach'), name: tr('Name'), size: tr('Dimensions'), antenna: tr('Antenna'),
    sections: tr('Sections'), hitch: tr('Hitch'), header: tr('Header'), check: tr('Check and save') };
  const stepTitle = s => T(STEP_LABEL[s === 'type' && W.kind === 'tool' ? 'attach' : s]);
  function renderWizard() {
    const isV = W.kind === 'vehicle';
    hdrT.textContent = W.mode === 'new' ? T(isV ? tr('New vehicle') : tr('New tool')) : tr('Edit: {name}', { name: W.src });
    hdrT.setAttribute('translate', 'no');
    body.innerHTML = '';
    const steps = el('div', 'tp-steps');
    W.steps.forEach((s, i) => {
      const b = el('button', 'tp-st' + (i < W.step ? ' done' : i === W.step ? ' cur' : ''));
      b.textContent = (i + 1) + ' ' + stepTitle(s) + (i < W.step ? ' ✓' : '');
      b.disabled = i > W.step || !!wjob();
      onTap(b, () => { W.step = i; renderWizard(); });
      steps.appendChild(b);
    });
    body.appendChild(steps);
    const s = W.steps[W.step];
    W.skBox = null; W.focus = '';
    const page = el('div', 'tp-page');
    if (s === 'type') pageType(page);
    else if (s === 'name') pageName(page);
    else if (s === 'size') pageFields(page, [W.f.wheelbase, W.f.trackWidth], [W.hitch, W.f.hitchLength], 'wheelbase');
    else if (s === 'antenna') pageFields(page, [W.f.antennaPivot, W.f.antennaHeight, W.f.antennaOffset], null, 'antennaPivot');
    else if (s === 'sections') pageSections(page);
    else if (s === 'hitch') pageHitch(page);
    else if (s === 'header') pageHeader(page);
    else pageCheck(page);
    body.appendChild(page);
    if (s === 'check') renderResult();
    renderWizFoot();
    onEdit();
  }
  function renderWizFoot() {
    foot.innerHTML = '';
    const s = W.steps[W.step], wj = wjob();
    const back = el('button', 'tp-btn'); back.textContent = '← ' + T(W.step === 0 ? tr('Cancel') : tr('Back'));
    back.disabled = !!wj;
    onTap(back, () => { if (W.step === 0) tryClose(); else { W.step--; renderWizard(); } });
    foot.append(back, el('span', 'tp-grow'));
    if (s !== 'check') {
      const next = el('button', 'tp-btn pri big'); next.textContent = T(tr('Next')) + ' →';
      next.dataset.role = 'next';
      onTap(next, () => { if (stepOk()) { W.step++; renderWizard(); } });
      foot.appendChild(next);
    } else if (wj && wj.state !== 'done' && wj.state !== 'reverted') {
      // the result box offers "send again" / "put the old values back"
    } else if (!wj) {
      const save = el('button', 'tp-btn pri big'); save.dataset.role = 'save';
      save.textContent = '✓ ' + T(tr('Save'));
      onTap(save, () => doSave());
      foot.appendChild(save);
    } else {
      const done = el('button', 'tp-btn pri big'); done.textContent = T(tr('Done'));
      onTap(done, () => { sel[W.kind] = activeName(W.kind); view = 'pick'; W = null; render(); });
      foot.appendChild(done);
    }
    syncSaveBtn();
  }
  function stepOk() {
    const s = W.steps[W.step];
    if (s === 'header') {
      const m = metricOf(W.cutW);
      if (!(Number.isFinite(m) && m > 0)) { showToast(T(tr('Please enter the cutting width.'))); W.cutW.focus(); return false; }
      const d = metricOf(W.f.hitchLength.inp);
      if (!(Number.isFinite(d) && d > 0)) { showToast(T(tr('Measure the distance from the rear axle to the cutter bar.'))); W.f.hitchLength.inp.focus(); return false; }
      applyHeader();
    }
    if (s === 'name') {
      const p = nameProblem(W.kind, W.nameInp.value.trim());
      W.nameErr.textContent = p;
      if (p) return false;
      W.name = W.nameInp.value.trim();
    }
    return true;
  }
  function pageType(page) {
    const isV = W.kind === 'vehicle';
    page.appendChild(Object.assign(el('div', 'tp-lead'), { textContent: T(isV ? tr('What kind of vehicle?') : tr('How is the tool attached?')) }));
    const g = el('div', 'tp-choice');
    if (isV) {
      for (const [val, ic, label] of VEH_TYPES) {
        const b = el('button', 'tp-ch' + (W.type.cur === val ? ' on' : ''), ICON[ic] + '<span></span>');
        b.querySelector('span').textContent = T(label);
        onTap(b, () => { W.type.cur = val; renderWizard(); });
        g.appendChild(b);
      }
    } else {
      if (W.harvester && W.mode === 'new') {
        const b = el('button', 'tp-ch img' + (W.header ? ' on' : ''), '<img src="/icons/ToolChkFront.png" alt=""><span></span>');
        b.querySelector('span').textContent = T(tr('Header (front)'));
        onTap(b, () => { setHeader(true); renderWizard(); });
        g.appendChild(b);
      }
      for (const [val, , label, img] of TOOL_TYPES) {
        if (W.harvester && val !== 'front') continue; // a harvester takes a front tool only (host, #111)
        const b = el('button', 'tp-ch img' + (W.type.cur === val && !W.header ? ' on' : ''), '<img src="/icons/' + img + '.png" alt=""><span></span>');
        b.querySelector('span').textContent = T(label);
        onTap(b, () => { setHeader(false); W.type.cur = val; renderWizard(); });
        g.appendChild(b);
      }
    }
    page.appendChild(g);
    if (isV && W.type.cur === 1 && W.type.base !== 1)
      page.appendChild(Object.assign(el('div', 'tp-note warn'), { textContent: T(tr('With a harvester the tool is always front fixed (as in the setup dialog).')) }));
    if (!isV && W.harvester) page.appendChild(Object.assign(el('div', 'tp-note'), { textContent: T(tr('The vehicle is a harvester: front fixed only.')) }));
    if (!isV) {
      page.appendChild(Object.assign(el('div', 'tp-lead'), { textContent: T(tr('Symbol on this tablet')) }));
      const sg = el('div', 'tp-syms');
      const nm = () => (W.mode === 'new' ? (W.name || '') : W.src);
      for (const [k, label] of SYMBOLS) {
        const shown = k || toolSymbol(nm(), '');
        const b = el('button', 'tp-sym' + ((W.sym || '') === k ? ' on' : ''), ICON[shown] + '<span></span>');
        b.querySelector('span').textContent = T(label);
        onTap(b, () => { W.sym = k; renderWizard(); });
        sg.appendChild(b);
      }
      page.appendChild(sg);
      page.appendChild(Object.assign(el('div', 'tp-note'), { textContent: T(tr('The symbol is only kept on this device; the profile does not change.')) }));
    }
  }
  function pageName(page) {
    page.appendChild(Object.assign(el('div', 'tp-lead'), { textContent: T(W.kind === 'vehicle' ? tr('Name of the new vehicle') : tr('Name of the new tool')) }));
    const inp = el('input', 'tp-name big'); inp.type = 'text'; inp.maxLength = 60; inp.autocomplete = 'off'; inp.setAttribute('translate', 'no');
    inp.value = W.name;
    W.nameInp = inp;
    W.nameErr = el('div', 'tp-ask-e');
    inp.addEventListener('input', () => { W.name = inp.value.trim(); W.nameTouched = true; W.nameErr.textContent = ''; });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && stepOk()) { W.step++; renderWizard(); } });
    page.append(inp, W.nameErr);
    page.appendChild(Object.assign(el('div', 'tp-note'), { textContent: tr('It starts as a copy of "{name}"; the next steps change the values that differ.', { name: W.src }) }));
    setTimeout(() => inp.focus(), 50);
  }
  function pageFields(page, main, adv, skDefault) {
    const wrap = el('div', 'tp-meas');
    const sk = el('div', 'tp-skbox'); W.skBox = sk; W.skDefault = skDefault;
    const col = el('div', 'tp-fields');
    for (const st of main) col.appendChild(st.row);
    if (adv) {
      const d = el('details', 'tp-adv');
      d.appendChild(Object.assign(el('summary'), { textContent: T(tr('Advanced (rarely needed)')) }));
      for (const st of adv) d.appendChild(st.row);
      col.appendChild(d);
    }
    wrap.append(sk, col);
    page.appendChild(wrap);
    drawSketch();
  }
  function pageSections(page) {
    const wrap = el('div', 'tp-meas');
    const sk = el('div', 'tp-skbox'); W.skBox = sk; W.skDefault = 'sections';
    const col = el('div', 'tp-fields');
    const nRow = fieldRow({ label: tr('Number of sections'), help: tr('How many sections the tool switches.'), sk: 'sections' }, W.nSec.inp);
    W.nSec.inp.removeEventListener('input', syncWidthsEv); W.nSec.inp.addEventListener('input', syncWidthsEv);
    col.appendChild(nRow);
    const box = el('div', 'tp-fld wide');
    box.innerHTML = '<div class="tp-f-l"></div><div class="tp-f-h"></div><div class="tp-sws"></div><div class="tp-same"></div><div class="tp-sum"></div><div class="tp-f-w" hidden></div>';
    box.querySelector('.tp-f-l').textContent = T(tr('Section widths')) + ' (' + unitLabel('cm') + ')';
    box.querySelector('.tp-f-h').textContent = T(tr('Width of each section (S1, S2, …).'));
    if (!W.swBox) { W.swBox = el('div', 'tp-swgrid'); W.swBox.addEventListener('input', () => { onEdit(); drawSketch(); }); }
    box.querySelector('.tp-sws').appendChild(W.swBox);
    // "All the same": copies the typed text into every box (no conversion).
    const same = box.querySelector('.tp-same');
    const sIn = el('input', 'tp-in sm'); sIn.type = 'number'; sIn.inputMode = 'decimal'; sIn.step = '0.1'; sIn.placeholder = unitLabel('cm');
    const sBtn = el('button', 'tp-btn'); sBtn.textContent = T(tr('Same width for all'));
    onTap(sBtn, () => { if (sIn.value === '') return; for (const w of W.widths) { if (!w.wrap.hidden) { w.inp.value = sIn.value; w.edited = true; } } onEdit(); drawSketch(); });
    same.append(sIn, el('span', 'tp-f-u', esc(unitLabel('cm'))), sBtn);
    W.sumEl = box.querySelector('.tp-sum');
    W.sumWarn = box.querySelector('.tp-f-w');
    col.appendChild(box);
    const d = el('details', 'tp-adv');
    d.appendChild(Object.assign(el('summary'), { textContent: T(tr('Advanced (rarely needed)')) }));
    d.appendChild(W.f.defaultSectionWidth.row);
    W.f.defaultSectionWidth.inp.removeEventListener('input', syncWidthsEv); W.f.defaultSectionWidth.inp.addEventListener('input', syncWidthsEv);
    col.appendChild(d);
    wrap.append(sk, col);
    page.appendChild(wrap);
    syncWidths();
    drawSketch();
  }
  function syncWidthsEv() { syncWidths(); drawSketch(); }
  // Header preset (harvester): front fixed, one section as wide as the cut. Asked: the cutting
  // width, and the distance rear axle → cutter bar (empty: to be measured). Same commands as the normal steps: tool.type,
  // tool.numSections, tool.sectionWidth, tool.hitchLength.
  function setHeader(on) {
    W.header = on;
    if (on) {
      W.type.cur = 'front';
      W.steps = ['type', 'header', 'name', 'check'];
      if (!W.cutW) {
        W.cutW = makeNum('tool.cutWidth', 'm', NaN, '0.01');
        W.cutW.addEventListener('input', () => applyHeader());
        // No made-up or copied value: the distance starts empty and has to be measured (an
        // empty box can't be saved). On a harvester the copied tool is always front fixed (host).
        W.f.hitchLength.inp.value = '';
      }
    } else {
      W.steps = W.mode === 'new' ? ['type', 'name', 'sections', 'hitch', 'check'] : ['type', 'sections', 'hitch', 'check'];
    }
  }
  function applyHeader() {
    if (!W.header) return;
    W.nSec.inp.value = '1';
    if (!W.swBox) W.swBox = el('div', 'tp-swgrid');
    syncWidths();
    const m = metricOf(W.cutW);
    const w = W.widths[0];
    if (w) { if (Number.isFinite(m) && m > 0) { writeUnitInput(w.inp, m * 100); w.edited = true; } else { w.inp.value = w.inp.dataset.init; w.edited = false; } }
    if (!W.nameTouched && W.mode === 'new') W.name = T(tr('Header')) + (Number.isFinite(m) && m > 0 ? ' ' + fmtUnit(m, 'm') : '');
  }
  function pageHeader(page) {
    page.appendChild(Object.assign(el('div', 'tp-lead'), { textContent: T(tr('Header of the harvester: how wide does it cut?')) }));
    const f = { label: tr('Cutting width'), unit: 'm', help: tr('Working width of the header, from one end of the cutter bar to the other.'), sk: 'tool:' };
    const wrap = el('div', 'tp-meas');
    const sk = el('div', 'tp-skbox'); W.skBox = sk; W.skDefault = 'tool:hitchLength';
    const col = el('div', 'tp-fields');
    col.appendChild(fieldRow(f, W.cutW));
    const hl = W.f.hitchLength.row; hl.querySelector('.tp-f-h').textContent = T(tr('Middle of the rear axle forwards to the cutter bar, along the vehicle.'));
    hl.querySelector('.tp-f-l').textContent = T(tr('Rear axle to cutter bar'));
    col.appendChild(hl);
    if (W.f.hitchLength.inp.value === '') col.appendChild(Object.assign(el('div', 'tp-note warn'), { textContent: T(tr('Measure the distance from the rear axle to the cutter bar.')) }));
    col.appendChild(Object.assign(el('div', 'tp-note'), { textContent: T(tr('Front fixed, one section as wide as the header. Sections, offset and the rest can be changed later in the tool settings.')) }));
    wrap.append(sk, col); page.appendChild(wrap);
    drawSketch();
    setTimeout(() => W.cutW && W.cutW.focus(), 50);
  }
  // The lengths the host uses per tool type (ToolPositionService.Update, ImplementSweptPath):
  // rigid front/rear: Tool.HitchLength = rear axle → working point; trailing: Vehicle.HitchLength
  // (rear axle → hitch pin, from the vehicle) + Tool.TrailingHitchLength (hitch pin → tool axle);
  // TBT: Vehicle.HitchLength + TankTrailingHitchLength (hitch pin → tank axle) + TrailingHitchLength
  // (tank axle → tool axle). Tool.HitchLength is not used for TBT, so it is not asked for there.
  // Length: from the working point (rigid) or the tool axle (trailing/TBT) to the rear end (front
  // tool: its front end); only the U-turn clearance from a hard boundary uses it.
  const toolTypeNo = () => (TOOL_TYPES.find(x => x[0] === W.type.cur) || TOOL_TYPES[1])[1];
  function hitchFields() {
    const ty = toolTypeNo();
    const trailing = ty === 3, tbt = ty === 2;
    const f = [];
    if (!trailing && !tbt) f.push(W.f.hitchLength);  // rigid front/rear only (the host ignores it for TBT)
    if (tbt) f.push(W.f.tankTrailingHitchLength);
    if (trailing || tbt) f.push(W.f.trailingHitchLength);
    f.push(W.f.length);
    return f;
  }
  const HITCH_HELP = {
    hitchLength: [tr('Middle of the rear axle forwards to the working point of the tool, along the vehicle.'), tr('Middle of the rear axle to the working point of the tool, along the vehicle.')],
    trailingHitchLength: { 2: tr('Axle of the tank to the axle of the tool.'), 3: tr('Hitch pin of the tractor to the axle of the tool.') },
    length: [tr('Working point forwards to the front end of the tool. Only used to keep the tool clear of a hard boundary in U-turns.'),
      tr('Working point to the rear end of the tool. Only used to keep the tool clear of a hard boundary in U-turns.'),
      tr('Axle of the tool to its rear end. Only used to keep the tool clear of a hard boundary in U-turns.'),
      tr('Axle of the tool to its rear end. Only used to keep the tool clear of a hard boundary in U-turns.')],
  };
  function setHitchHelp() {
    const ty = toolTypeNo();
    const set = (st, txt) => { const h = st.row.querySelector('.tp-f-h'); if (h && txt) h.textContent = T(txt); };
    set(W.f.hitchLength, HITCH_HELP.hitchLength[ty === 0 ? 0 : 1]);
    set(W.f.trailingHitchLength, HITCH_HELP.trailingHitchLength[ty]);
    set(W.f.length, HITCH_HELP.length[ty]);
  }
  // Trailing and TBT tools hang on the vehicle's hitch pin: show that length (from the vehicle).
  function vehHitchNote() {
    const v = config && config.vehicle;
    const r = el('div', 'tp-note');
    r.textContent = T(tr('Rear axle to the hitch pin: {len} (vehicle "{name}"; change it in the vehicle).',
      { len: fmtM(v ? v.hitchLength : NaN, 'm'), name: activeName('vehicle') }));
    return r;
  }
  function pageHitch(page) {
    const ty = toolTypeNo();
    setHitchHelp();
    pageFields(page, hitchFields(), [W.f.offset, W.f.overlap], 'tool:');
    if (ty === 2 || ty === 3) page.querySelector('.tp-fields').prepend(vehHitchNote());
    page.appendChild(W.hitch.row);
  }

  // All changes as commands, in the order the setup dialog would need them.
  function changes() {
    const out = []; // { key, send, val (metric or code), label, from, to }
    const num = (st, label) => { if (st.changed()) { const v = st.value(); out.push({ key: st.f.key, send: v, val: v, label: label || st.f.label, unit: st.f.unit, from: st.base }); } };
    if (W.kind === 'vehicle') {
      if (W.type.cur !== W.type.base) out.push({ key: 'vehicle.type', send: W.type.cur, val: W.type.cur, label: tr('Vehicle type'), from: W.type.base, kindOf: 'vtype' });
      if (W.hitch.changed()) out.push({ key: 'vehicle.hitchType', send: W.hitch.value(), val: +W.hitch.value(), label: W.hitch.label, from: W.hitch.base, kindOf: 'hitch' });
      for (const k of ['hitchLength', 'wheelbase', 'trackWidth', 'antennaPivot', 'antennaHeight', 'antennaOffset']) num(W.f[k]);
    } else {
      if (W.type.cur !== W.type.base) out.push({ key: 'tool.type', send: W.type.cur, val: W.type.cur, label: tr('Attach'), from: W.type.base, kindOf: 'ttype' });
      if (W.hitch.changed()) out.push({ key: 'tool.hitchType', send: W.hitch.value(), val: +W.hitch.value(), label: W.hitch.label, from: W.hitch.base, kindOf: 'hitch' });
      const shown = hitchFields();
      for (const k of ['hitchLength', 'trailingHitchLength', 'tankTrailingHitchLength', 'length']) if (shown.includes(W.f[k])) num(W.f[k]);
      num(W.f.offset); num(W.f.overlap); num(W.f.defaultSectionWidth);
      const n = Math.max(1, Math.min(64, Math.round(parseFloat(W.nSec.inp.value)) || 0));
      if (n !== W.nSec.base) out.push({ key: 'tool.numSections', send: n, val: n, label: tr('Number of sections'), from: W.nSec.base, kindOf: 'int' });
      for (let i = 0; i < n; i++) {
        const w = W.widths[i];
        if (!w || w.inp.value === w.inp.dataset.init) continue; // added sections: the host gives them the default width
        const v = metricOf(w.inp);
        out.push({ key: 'tool.sectionWidth', idx: i, send: i + ',' + v, val: v, label: 'S' + (i + 1), unit: 'cm', from: w.exists ? W.baseWidths[i] : NaN });
      }
    }
    return out;
  }
  function problems() {
    const p = [];
    // Units switched (a host setting, from any device): the fields still show the old units
    // but would now be read in the new ones.
    if (isMetric() !== W.metric) p.push(T(tr('The units were changed. Please cancel and start the assistant again.')));
    for (const c of changes()) if (c.kindOf == null && !Number.isFinite(c.val)) p.push(tr('{field}: please enter a number.', { field: T(c.label) }));
    if (W.kind === 'tool') {
      const n = Math.round(parseFloat(W.nSec.inp.value));
      if (!(n >= 1 && n <= 64)) p.push(T(tr('Number of sections: 1 to 64.')));
      // The host stores these as max(0, value): a negative entry would never be confirmed.
      for (const k of ['hitchLength', 'length']) if (W.f[k].value() < 0) p.push(tr('{field}: 0 or more.', { field: T(W.f[k].f.label) }));
    }
    return p;
  }
  function warnings() {
    const w = [];
    if (W.kind === 'vehicle') {
      for (const k of ['wheelbase', 'antennaPivot', 'antennaHeight', 'antennaOffset']) {
        const st = W.f[k], m = warnFor(st.f, st.value());
        if (m) w.push([st.f.label, m]);
      }
      const a = config && config.autosteer ? +config.autosteer.maxSteerAngle : NaN;
      if (Number.isFinite(a) && (a < 20 || a > 60)) w.push([tr('Max Steer Angle'), tr('Unusual value (expected {min} to {max}). Please measure again; it is saved as entered.', { min: '20°', max: '60°' })]);
    } else {
      const s = sumWidthM();
      if (Number.isFinite(s) && (s < 1 || s > 60))
        w.push([tr('Working width'), tr('Unusual value (expected {min} to {max}). Please measure again; it is saved as entered.', { min: fmtUnit(1, 'm'), max: fmtUnit(60, 'm') })]);
    }
    return w;
  }
  // Live: yellow warnings next to the fields, the section sum, the save button.
  function onEdit() {
    if (!W) return;
    const all = W.kind === 'vehicle' ? Object.values(W.f) : [];
    for (const st of all) {
      const box = st.row.querySelector('.tp-f-w'), m = warnFor(st.f, st.value());
      box.hidden = !m; box.textContent = m; st.row.classList.toggle('warn', !!m);
    }
    if (W.kind === 'tool' && W.sumEl && W.sumEl.isConnected) {
      const s = sumWidthM();
      W.sumEl.textContent = tr('Working width (sum of the sections): {w}', { w: fmtM(s, 'm') });
      const m = Number.isFinite(s) && (s < 1 || s > 60) ? warnFor({ warn: [1, 60], unit: 'm' }, s) : '';
      W.sumWarn.hidden = !m; W.sumWarn.textContent = m;
    }
    syncSaveBtn();
  }
  function syncSaveBtn() {
    const b = foot.querySelector('[data-role="save"]');
    if (!b || !W) return;
    const lock = lockReason(), sending = !!wjob();
    b.disabled = !!lock || !!sending || problems().length > 0;
    const li = body.querySelector('.tp-lockline');
    if (li) { li.hidden = !lock; li.textContent = lock ? T(lock) : ''; }
  }
  function fmtChange(c, v) {
    if (c.kindOf === 'vtype') return T((VEH_TYPES.find(x => x[0] === v) || [0, '', '—'])[2]);
    if (c.kindOf === 'ttype') return T((TOOL_TYPES.find(x => x[0] === v) || [0, 0, '—'])[2]);
    if (c.kindOf === 'hitch') { const h = TUI_HITCH.find(x => x.code === +v); return h ? T(h.name) : '—'; }
    if (c.kindOf === 'int') return String(v);
    return fmtM(v, c.unit);
  }
  // A signed value as amount + side ("0,30 m Links"), others with their unit.
  function fmtVal(f, v) {
    if (!f.sides || !Number.isFinite(v)) return fmtM(v, f.unit);
    const sg = v < -0.005 ? -1 : v > 0.005 ? 1 : 0;
    return fmtM(Math.abs(v), f.unit) + ' ' + T(f.sides.find(x => x[1] === sg)[2]);
  }
  function pageCheck(page) {
    const isV = W.kind === 'vehicle';
    const ch = changes(), warn = warnings(), prob = problems();
    const grid = el('div', 'tp-sum2');
    // What the profile will hold (changed rows marked, with the value before).
    const card = el('div', 'tp-sumc');
    card.appendChild(Object.assign(el('h4'), { textContent: W.mode === 'new' ? W.name : W.src }));
    card.querySelector('h4').setAttribute('translate', 'no');
    const row = (label, val, from, changed, warnTxt) => {
      const r = el('div', 'tp-row' + (changed ? ' ch' : '') + (warnTxt ? ' warn' : ''), '<span></span><b translate="no"></b>');
      r.firstChild.textContent = T(label); r.lastChild.textContent = val;
      if (changed && from != null) r.appendChild(Object.assign(el('small', null), { textContent: tr('before: {v}', { v: from }) }));
      card.appendChild(r);
    };
    const chOf = key => ch.find(c => c.key === key);
    if (isV) {
      const c = chOf('vehicle.type');
      row(tr('Vehicle type'), fmtChange({ kindOf: 'vtype' }, W.type.cur), c && fmtChange(c, c.from), !!c);
      for (const k of ['wheelbase', 'trackWidth', 'antennaPivot', 'antennaHeight', 'antennaOffset', 'hitchLength']) {
        const st = W.f[k], c2 = chOf(st.f.key), v = st.value();
        row(st.f.label, fmtVal(st.f, v), c2 && fmtVal(st.f, c2.from), !!c2, warnFor(st.f, v));
      }
      const a = config && config.autosteer ? config.autosteer.maxSteerAngle : null;
      row(tr('Max Steer Angle'), a == null ? '—' : a + '°', null, false, Number.isFinite(+a) && (a < 20 || a > 60) ? 'x' : '');
      card.appendChild(Object.assign(el('div', 'tp-note'), { textContent: T(tr('The max steer angle is set under AutoSteer and is not changed here.')) }));
    } else {
      const c = chOf('tool.type');
      row(tr('Attach'), fmtChange({ kindOf: 'ttype' }, W.type.cur), c && fmtChange(c, c.from), !!c);
      const n = Math.max(1, Math.min(64, Math.round(parseFloat(W.nSec.inp.value)) || 0)), cn = chOf('tool.numSections');
      row(tr('Number of sections'), String(n), cn && String(cn.from), !!cn);
      const s = sumWidthM();
      row(tr('Working width'), fmtM(s, 'm'), null, ch.some(x => x.key === 'tool.sectionWidth') || !!cn, Number.isFinite(s) && (s < 1 || s > 60) ? 'x' : '');
      for (const st of hitchFields().concat([W.f.offset, W.f.overlap])) {
        const c2 = chOf(st.f.key), v = st.value();
        row(st.f.label, fmtVal(st.f, v), c2 && fmtVal(st.f, c2.from), !!c2);
      }
      const sym = toolSymbol(W.mode === 'new' ? W.name : W.src, W.sym || '');
      const sr = el('div', 'tp-row', '<span></span><b class="tp-row-ic"></b>');
      sr.firstChild.textContent = T(tr('Symbol on this tablet')); sr.lastChild.innerHTML = ICON[sym];
      card.appendChild(sr);
    }
    grid.appendChild(card);
    // Right: what happens on Save.
    const info = el('div', 'tp-sumc');
    info.appendChild(Object.assign(el('h4'), { textContent: T(tr('On Save')) }));
    const ul = el('ul', 'tp-list');
    const li = t => ul.appendChild(Object.assign(el('li'), { textContent: t }));
    if (W.mode === 'new') {
      li(tr('A new profile "{name}" is made as a copy of "{src}" and becomes active.', { name: W.name, src: W.src }));
      li(tr('"{src}" stays unchanged.', { src: W.src }));
    }
    li(ch.length ? tr('{n} value(s) are sent and the profile is saved.', { n: ch.length }) : T(W.mode === 'new' ? tr('No values differ from the copy; the copy is saved.') : tr('Nothing was changed.')));
    if (isV && W.type.cur === 1 && W.type.base !== 1) li(T(tr('With a harvester the tool is always front fixed (as in the setup dialog).')));
    info.appendChild(ul);
    for (const [label, m] of warn) {
      const w = el('div', 'tp-note warn', '<b></b> <span></span>');
      w.firstChild.textContent = T(label) + ':'; w.lastChild.textContent = m;
      info.appendChild(w);
    }
    for (const p of prob) info.appendChild(Object.assign(el('div', 'tp-note bad'), { textContent: p }));
    info.appendChild(Object.assign(el('div', 'tp-lock tp-lockline'), { hidden: true }));
    const res = el('div', 'tp-result'); W.resEl = res;
    info.appendChild(res);
    grid.appendChild(info);
    page.appendChild(grid);
  }

  // --- Save: everything in one go, then check what the host reports back ---------------------
  // The commands leave in one burst (one JavaScript task, so the socket takes all or none) and
  // the host runs them in order. Done = the host's config and profile frames show every value
  // and the connection stayed up a moment longer (profile.save is the last command). If the
  // connection drops on the way, this says so and offers to send the same commands again
  // (they set absolute values) or, when editing, to put the old values back.
  // From sending until the host confirms, the save is kept on this device
  // (aow.ui.profilePending), so a red band in the driving view shows an unfinished save, also
  // after a reload, until "send again" or "put the old values back" has been confirmed.
  const PEND_KEY = 'aow.ui.profilePending';
  let pending = null, job = null; // job: { rec, state, t0, okAt, revert, expect, k }
  // Only a record this code could have written: a broken one would send "config.set|key:undefined".
  const recOk = r => !!r && r.v === 1 && (r.kind === 'vehicle' || r.kind === 'tool') && (r.mode === 'new' || r.mode === 'edit')
    && typeof r.name === 'string' && !!r.name && typeof r.src === 'string' && Array.isArray(r.ch)
    && r.ch.every(c => c && typeof c.key === 'string' && c.send !== undefined && c.send !== null);
  try { const r = JSON.parse(lsGet(PEND_KEY, '') || 'null'); if (recOk(r)) pending = r; } catch (_) { /* unreadable: none */ }
  if (pending) job = { rec: pending, state: 'lost', reloaded: true };
  // Point 22: read it back; if the browser keeps nothing (blocked storage), the band says so.
  let pendKept = true;
  function setPending(r) {
    pending = r;
    const v = r ? JSON.stringify(r) : null;
    lsSet(PEND_KEY, v);
    pendKept = !r || lsGet(PEND_KEY, null) === v;
    syncBand();
  }
  const wjob = () => (job && W && W.rec && job.rec === W.rec ? job : null); // this assistant's save

  function makeRec() {
    const t = W.kind === 'tool';
    return { v: 1, kind: W.kind, mode: W.mode, name: W.mode === 'new' ? W.name : W.src, src: W.src, ch: changes(),
      baseToolType: W.baseToolType, nSecBase: t ? W.nSec.base : 0, baseWidths: t ? W.baseWidths.slice(0, 64) : [], t: Date.now() };
  }
  function planCmds(rec, retry) {
    const cmds = [], isV = rec.kind === 'vehicle';
    if (rec.mode === 'new') {
      const exists = listOf(rec.kind).some(p => sameName(p.name, rec.name));
      if (!(retry && exists)) cmds.push('profile.new|' + rec.kind + '\t' + rec.name);        // copy of the active profile
      cmds.push((isV ? 'profile.configureVehicle|' : 'profile.configureTool|') + rec.name); // make the copy active
    }
    for (const c of rec.ch) cmds.push('config.set|' + c.key + ':' + c.send);
    cmds.push('profile.save');
    return cmds;
  }
  // Edit only: the values from before, exactly as the host had sent them.
  function revertList(rec) {
    const ex = [];
    for (const c of rec.ch) {
      if (c.key === 'tool.sectionWidth') { if (c.idx < rec.nSecBase) ex.push({ key: c.key, idx: c.idx, val: rec.baseWidths[c.idx] }); continue; }
      if (c.key === 'tool.numSections') { ex.push({ key: c.key, val: rec.nSecBase }); continue; }
      ex.push({ key: c.key, val: c.from });
    }
    // A harvester forces the tool to front fixed: put the tool's attach back too.
    if (rec.kind === 'vehicle' && rec.ch.some(c => c.key === 'vehicle.type')) {
      const tt = TOOL_TYPES.find(x => x[1] === rec.baseToolType); if (tt) ex.push({ key: 'tool.type', val: tt[0] });
    }
    if (rec.kind === 'tool' && rec.ch.some(c => c.key === 'tool.numSections'))
      for (let i = 0; i < rec.nSecBase; i++) if (!ex.some(e => e.idx === i)) ex.push({ key: 'tool.sectionWidth', idx: i, val: rec.baseWidths[i] });
    return ex;
  }
  function hostVal2(c) {
    if (!config) return undefined;
    if (c.key === 'tool.sectionWidth') return (config.tool.sectionWidths || [])[c.idx];
    if (c.key === 'tool.type') return (TOOL_TYPES.find(x => x[1] === config.tool.type) || [])[0];
    const [sec, f] = c.key.split('.'); return config[sec] && config[sec][f];
  }
  function valueOk(c) {
    const got = hostVal2(c);
    if (c.key === 'tool.type') return got === ((config.vehicle.type | 0) === 1 ? 'front' : c.val); // harvester: front (host, #111)
    return Number.isFinite(+got) && got !== undefined && Math.abs(+got - +c.val) <= 1e-6 * Math.max(1, Math.abs(+c.val));
  }
  function matches(rec, list) {
    if (!config || !profiles || activeName(rec.kind) !== rec.name) return false;
    return list.every(valueOk);
  }
  // The profile the commands must go to is not active: for an edit the profile itself; for a
  // new one not made yet its template, since profile.new copies whatever is active.
  const loadName = rec => rec.mode === 'edit' ? rec.name : rec.src;
  const wrongActive = rec => !!profiles && (rec.mode === 'edit' ? activeName(rec.kind) !== rec.name
    : !listOf(rec.kind).some(p => sameName(p.name, rec.name)) && activeName(rec.kind) !== rec.src);
  function startJob(rec, cmds, isRevert) {
    for (const c of cmds) transport.send(c);
    const tries = job && job.rec === rec ? (job.tries || 0) + 1 : 0; // attempts after the first, for deadEnd
    job = { rec, state: 'sending', t0: performance.now(), okAt: 0, revert: !!isRevert, expect: isRevert ? revertList(rec) : rec.ch, tries };
    setPending(rec); // stays until the host confirms
    refreshJob(true);
  }
  function canAct() { return !!job && connState === 'connected' && !lockReason() && !wrongActive(job.rec); }
  // Dead ends: cases no button here can repair. Only then is "Discard" offered, after a question
  // listing what is lost; otherwise the band stays until the save is confirmed or reverted.
  function deadEnd(j) {
    const rec = j.rec;
    if (!profiles || !config || connState !== 'connected') return '';
    const has = n => listOf(rec.kind).some(p => sameName(p.name, n));
    if (rec.mode === 'edit' && !has(rec.name))
      return tr('The profile "{name}" no longer exists on this guidance computer (deleted or renamed).', { name: rec.name });
    if (rec.mode === 'new' && !has(rec.name) && !has(rec.src))
      return tr('Neither "{name}" nor its template "{src}" exists on this guidance computer.', { name: rec.name, src: rec.src });
    // Not one value is the old or the new one: the note is not about this computer's data
    // (another guidance computer at the same address, or the profile was changed elsewhere).
    if (activeName(rec.kind) === rec.name && rec.ch.length
      && rec.ch.every(c => c.from !== undefined && !valueOk(c) && !valueOk(Object.assign({}, c, { val: c.from }))))
      return tr('None of the values on the guidance computer is the old or the new one. The note probably comes from another guidance computer, or the profile was changed elsewhere.');
    if ((j.tries || 0) >= 2 && j.state !== 'sending' && !matches(rec, rec.ch))
      return tr('The guidance computer did not take the values after two more attempts.');
    return '';
  }
  function askDiscard(rec) {
    const lines = rec.ch.map(c => '• ' + (c.label ? T(c.label) : c.key) + ': ' + (c.from !== undefined ? fmtChange(c, c.from) + ' → ' : '') + fmtChange(c, c.val));
    const text = (rec.mode === 'new' ? tr('The new profile "{name}" is not made complete. These values are not saved:', { name: rec.name })
      : tr('These values for "{name}" are not saved:', { name: rec.name })) + '\n' + (lines.length ? lines.join('\n') : '—') + '\n\n'
      + T(tr('The guidance computer keeps the values it has now. They are not saved there until a profile is loaded or saved.'));
    confirmAsk(T(tr('Discard the unfinished save?')), text, T(tr('Discard')), () => {
      setPending(null); job = null; msg = ''; close(); syncBand();
    }, true);
    const m = ask.querySelector('.tp-ask-m'); if (m) m.style.whiteSpace = 'pre-line';
  }
  function retryJob() { if (canAct()) startJob(job.rec, planCmds(job.rec, true), false); }
  function revertJob() {
    if (!canAct() || job.rec.mode !== 'edit') return;
    const ex = revertList(job.rec);
    startJob(job.rec, ex.map(e => 'config.set|' + e.key + ':' + (e.idx != null ? e.idx + ',' : '') + e.val).concat(['profile.save']), true);
  }
  // Edit, other profile active (e.g. after a reload): load the one the save was for.
  function loadTarget() {
    if (!job || connState !== 'connected' || lockReason()) return;
    const r = job.rec, n = loadName(r);
    transport.send('profile.load|' + (r.kind === 'vehicle' ? n + '\t' + profiles.activeTool : profiles.activeVehicle + '\t' + n));
  }
  function doSave() {
    if (!W || lockReason() || problems().length) return;
    if (pending && !wjob()) { openRecover(); return; } // an unfinished save comes first
    if (W.mode === 'new') {
      const p = nameProblem(W.kind, W.name);
      if (p) { W.step = W.steps.indexOf('name'); renderWizard(); W.nameErr && (W.nameErr.textContent = p); return; }
    }
    // Another device loaded or changed the profile since the assistant opened: the review page
    // no longer shows what would be saved (a new profile copies the active one as it is now).
    if (activeName(W.kind) !== W.src || snapOf(W.kind) !== W.snap) { W.err = 'stale'; renderResult(); return; }
    if (connState !== 'connected') { W.err = 'offline'; renderResult(); return; }
    W.err = '';
    const rec = makeRec();
    W.rec = rec;
    if (W.kind === 'tool') { const nm = rec.name; if ((W.sym || '') !== (W.symBase || '') || W.mode === 'new') lsSet(iconKey(nm), W.sym || null); }
    startJob(rec, planCmds(rec, false), false);
  }
  // Result lines and buttons (assistant's check page and the recovery view).
  function fillResult(r, j) {
    r.innerHTML = '';
    r.className = 'tp-result';
    if (!j) return;
    const rec = j.rec;
    const line = (t, cls) => { r.className = 'tp-result ' + (cls || ''); r.appendChild(Object.assign(el('div'), { textContent: t })); };
    const btn = (t, fn, cls) => { const b = el('button', 'tp-btn' + (cls ? ' ' + cls : '')); b.textContent = t; b.disabled = !canAct(); onTap(b, fn); r.appendChild(b); return b; };
    if (j.state === 'sending') line(T(tr('Saving…')));
    else if (j.state === 'done') line('✓ ' + T(tr('Saved. The guidance computer shows the new values.')), 'ok');
    else if (j.state === 'reverted') line('✓ ' + T(tr('The old values were sent back and saved.')), 'ok');
    else {
      line(j.reloaded ? T(tr('Saving was interrupted (connection lost or page reloaded). It is not certain that everything was saved.'))
        : j.state === 'lost' ? T(tr('The connection broke while saving. It is not certain that everything was saved.'))
        : T(tr('The guidance computer did not confirm all values.')), 'bad');
      if (connState !== 'connected') { line(T(tr('Waiting for the connection…')), 'bad'); return; }
      const dead = deadEnd(j);
      if (dead) {
        line(T(dead), 'bad');
        const b = btn(T(tr('Discard (do not save)')), () => askDiscard(rec), 'dan');
        b.disabled = false; // sends nothing, so no lock applies
        if (!canAct()) return; // nothing else would work
      }
      if (wrongActive(rec)) {
        line(rec.mode === 'edit' ? tr('"{name}" is not active. Load it first, then send again or put the old values back.', { name: rec.name })
          : tr('The new profile is made as a copy of "{name}", which is not active. Load it first, then send again.', { name: rec.src }), 'bad');
        const b = btn(tr('Load "{name}"', { name: loadName(rec) }), loadTarget); b.disabled = !!lockReason();
        return;
      }
      line(matches(rec, rec.ch) ? T(tr('The values are there now. Save again to be sure.')) : T(tr('Some values are missing.')), 'bad');
      btn(T(tr('Send again and save')), retryJob, 'pri');
      if (rec.mode === 'edit') btn(T(tr('Put the old values back')), revertJob);
      else r.appendChild(Object.assign(el('div'), { textContent: tr('"{src}" was not changed.', { src: rec.src }) }));
      const lock = lockReason(); if (lock) line(T(lock), 'bad');
    }
  }
  function renderResult() {
    const r = W && W.resEl;
    if (!r || !r.isConnected) return;
    if (W.err && !wjob()) {
      r.innerHTML = ''; r.className = 'tp-result bad';
      r.appendChild(Object.assign(el('div'), { textContent: W.err === 'offline' ? T(tr('No connection: nothing was sent.'))
        : T(tr('The active profile changed in the meantime. Nothing was sent; please start again.')) }));
      return;
    }
    fillResult(r, wjob());
  }

  // Recovery view: what was being saved, what the host shows now, and the two ways out.
  function openRecover() {
    if (!job) return;
    if (lnCloseAllOrig) lnCloseAllOrig();
    view = 'recover'; W = null; hideAsk();
    sheet.classList.add('open'); scrim.classList.add('open');
    renderRecover();
  }
  function renderRecover() {
    const j = job, rec = j && j.rec;
    hdrT.removeAttribute('translate');
    hdrT.textContent = T(tr('Profile not completely saved'));
    body.innerHTML = ''; foot.innerHTML = '';
    if (!rec) return;
    const lead = el('div', 'tp-lead');
    lead.textContent = rec.kind === 'vehicle' ? tr('Vehicle "{name}": these values were being saved.', { name: rec.name })
      : tr('Tool "{name}": these values were being saved.', { name: rec.name });
    body.appendChild(lead);
    const card = el('div', 'tp-sumc');
    const hd = el('div', 'tp-row hd', '<span></span><b></b><b></b>');
    hd.children[0].textContent = T(tr('Value')); hd.children[1].textContent = T(tr('To save')); hd.children[2].textContent = T(tr('Host now'));
    card.appendChild(hd);
    const list = j.revert || j.state === 'reverted' ? revertList(rec).map(e => Object.assign({}, rec.ch.find(c => c.key === e.key && c.idx === e.idx) || {}, e)) : rec.ch;
    for (const c of list) {
      const ok = connState === 'connected' && activeName(rec.kind) === rec.name && valueOk(c);
      const r = el('div', 'tp-row r3' + (ok ? '' : ' warn'), '<span></span><b translate="no"></b><b translate="no"></b>');
      r.children[0].textContent = c.label ? T(c.label) : c.key;
      r.children[1].textContent = fmtChange(c, c.val);
      const got = hostVal2(c);
      r.children[2].textContent = (got === undefined ? '—' : fmtChange(c, got)) + (ok ? ' ✓' : '');
      card.appendChild(r);
    }
    if (!list.length) card.appendChild(Object.assign(el('div', 'tp-note'), { textContent: T(tr('No values; only the profile itself was being saved.')) }));
    body.appendChild(card);
    const res = el('div', 'tp-result');
    body.appendChild(res);
    fillResult(res, j);
    const done = j.state === 'done' || j.state === 'reverted';
    const cl = el('button', 'tp-btn' + (done ? ' pri big' : '')); cl.textContent = T(done ? tr('Done') : tr('Close'));
    onTap(cl, () => { if (done) job = null; close(); syncBand(); });
    foot.append(el('span', 'tp-grow'), cl);
  }

  // Red band in the driving view (first in the bottom stack, so it sits above the section bar).
  const band = el('button', 'tp-pend', '<span class="tp-pend-t"></span><span class="tp-pend-s"></span>');
  band.id = 'tp-pend';
  band.hidden = true;
  { const bs = $('bottomstack'); if (bs) bs.prepend(band); else document.body.appendChild(band); }
  onTap(band, () => openRecover());
  function syncBand() {
    const show = !!pending && !(job && job.state === 'sending');
    const k = (pending ? pending.mode : '') + (pendKept ? '' : '!');
    if (band.hidden === !show && band.dataset.mode === k) return;
    band.hidden = !show;
    band.dataset.mode = k;
    band.querySelector('.tp-pend-t').textContent = T(tr('Profile not completely saved – check the values'));
    band.querySelector('.tp-pend-s').textContent = T(pending && pending.mode === 'edit' ? tr('Tap: send again or restore') : tr('Tap: send again'))
      + (pendKept ? '' : ' · ' + T(tr('This tablet cannot keep this note over a restart.')));
  }
  syncBand();
  function refreshJob(full) {
    syncBand();
    if (!isOpen()) return;
    if (view === 'recover') renderRecover();
    else if (view === 'wiz' && W && wjob()) { if (full) renderWizard(); else renderResult(); }
  }
  function watchJob() {
    const j = job;
    if (!j) return;
    if (j.state === 'sending') {
      if (connState !== 'connected') { j.state = 'lost'; refreshJob(true); return; }
      if (matches(j.rec, j.expect)) {
        if (!j.okAt) j.okAt = performance.now();
        else if (performance.now() - j.okAt > 1000) { j.state = j.revert ? 'reverted' : 'done'; j.reloaded = false; setPending(null); refreshJob(true); return; }
      } else j.okAt = 0;
      if (performance.now() - j.t0 > 8000) { j.state = 'unconfirmed'; refreshJob(true); }
    } else if (j.state === 'lost' || j.state === 'unconfirmed') {
      const k = [connState, matches(j.rec, j.rec.ch), lockReason(), profiles && activeName(j.rec.kind), JSON.stringify(config && config[j.rec.kind])].join('|');
      if (k !== j.k) { j.k = k; refreshJob(false); }
    }
  }

  // --- Refresh -------------------------------------------------------------------------------
  function render() {
    if (!isOpen()) return;
    if (view === 'pick') { hdrT.removeAttribute('translate'); renderPick(); }
    else if (view === 'recover') renderRecover();
    else if (W) renderWizard();
  }
  let loadWait = null;
  setInterval(() => {
    watchJob();
    if (loadWait && profiles) {
      if (sameName(activeName('vehicle'), loadWait.vehicle) && sameName(activeName('tool'), loadWait.tool)) {
        msg = tr('Loaded: {vehicle} + {tool}', loadWait); loadWait = null;
      } else if (Date.now() - loadWait.t > 8000) { msg = tr('Not loaded: the host did not confirm. Please check and try again.'); loadWait = null; }
    }
    if (!isOpen()) return;
    if (view === 'pick') {
      const k = JSON.stringify([profiles, sel, msg, lockReason(), config && config.tool && config.tool.totalWidth, config && config.vehicle && config.vehicle.type, I18n.language, !!pending]);
      if (k !== pickKey) { pickKey = k; renderPick(); }
    } else if (view === 'wiz') syncSaveBtn();
  }, 250);

  // --- Hooks: the Vehicle & Tool button (left bar, menu tile, hotkey) opens the cards ---------
  const lnOpenOrig = lnOpen, lnCloseAllOrig = lnCloseAll;
  lnOpen = function (id) {
    if (id === 'vehtoolhub') { if (isOpen()) close(); else open(); return; }
    if (isOpen()) close();
    return lnOpenOrig.apply(this, arguments);
  };
  lnCloseAll = function () { if (isOpen()) close(); return lnCloseAllOrig.apply(this, arguments); };

  // --- Menu: the active vehicle and tool on top of the setup tiles ----------------------------
  function nowTiles() {
    const m = $('tui-menu');
    const box = m && m.querySelector('.tui-sh-body');
    if (!box || !profiles) return;
    let band = box.querySelector('.tp-now');
    if (!band) {
      band = el('div', 'tp-now');
      for (const kind of ['vehicle', 'tool']) {
        const t = el('button', 'tui-tile tp-nowt', '<span class="tp-n-ic"></span><span class="tp-n-tx"><span class="l"></span><span class="v" translate="no"></span><span class="s" translate="no"></span></span><span class="tp-n-go"></span>');
        t.dataset.kind = kind;
        onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) x.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); open(); });
        band.appendChild(t);
      }
      box.prepend(band);
    }
    const lock = lockReason();
    for (const t of band.children) {
      const kind = t.dataset.kind, name = activeName(kind), p = listOf(kind).find(x => x.name === name) || { name, preview: '' };
      const mp = p.preview ? prevMap(p.preview) : activePreview(kind);
      const ic = kind === 'vehicle' ? ICON[(VEH_TYPES.find(v => v[0] === (config && config.vehicle ? config.vehicle.type : 0)) || VEH_TYPES[0])[1]] : ICON[toolSymbol(name)];
      const s = kind === 'vehicle' ? T(tr('Wheelbase')) + ' ' + hostVal(mp['Wheelbase'])
        : T(tr('Working width')) + ' ' + activeWidth() + ' · ' + T(tr('Sections')) + ' ' + hostVal(mp['Sections']);
      const k = [name, s, lock, ic.length].join('|');
      if (t.dataset.k === k) continue;
      t.dataset.k = k;
      t.querySelector('.tp-n-ic').innerHTML = ic;
      t.querySelector('.l').textContent = T(kind === 'vehicle' ? tr('Vehicle') : tr('Tool'));
      t.querySelector('.v').textContent = name || '—';
      t.querySelector('.s').textContent = s;
      // The lock has several reasons now (driving, steering, no data, another device has control).
      t.querySelector('.tp-n-go').textContent = lock ? T(tr('Locked')) : T(tr('Change'));
      t.title = lock ? T(lock) : '';
      t.classList.toggle('locked', !!lock);
    }
  }
  setInterval(() => { const m = $('tui-menu'); if (m && m.classList.contains('open')) nowTiles(); }, 300);

  // --- Setup dialogs (tablet-feedback-1): coupling types with everyday names, the tool lengths
  // drawn point to point, and no "Working center" for TBT (the host takes the vehicle's hitch
  // length there, ToolPositionService.Update). Values and commands stay those of the dialog.
  function relabelHitchSelect(sel) {
    if (!sel) return;
    for (const o of sel.options) {
      const h = TUI_HITCH.find(x => String(x.code) === o.value);
      const norm = HITCH_NORM[(+o.value) + 1];
      if (h) o.textContent = T(h.name) + (norm ? ' (' + norm + ')' : '');
    }
  }
  let dlgFocus = '';
  function toolDialogExtras() {
    const t = config && config.tool;
    if (!t) return;
    relabelHitchSelect(document.querySelector('#toolcfg .cfg-sel[data-key="tool.hitchType"]'));
    // TBT: the host takes the vehicle's hitch length, not Tool.HitchLength ("Working center").
    if (t.type === 2) for (const n of document.querySelectorAll('#toolcfg [data-show="rigid"]')) n.hidden = true;
    const img = document.getElementById('tc-img-hitch');
    if (!img) return;
    let box = document.getElementById('tui-tc-sk');
    if (!box) {
      box = el('div', 'tp-skbox'); box.id = 'tui-tc-sk';
      img.after(box); img.hidden = true;
      for (const k of ['hitchLength', 'trailingHitchLength', 'tankTrailingHitchLength', 'length']) {
        const inp = document.querySelector('#toolcfg .cfg-num[data-key="tool.' + k + '"]');
        if (inp) { inp.addEventListener('focus', () => { dlgFocus = k; toolDialogExtras(); }); inp.addEventListener('blur', () => { dlgFocus = ''; toolDialogExtras(); }); }
      }
    }
    const k = t.type + '|' + dlgFocus + '|' + (config.vehicle ? config.vehicle.hitchLength : '') + '|' + I18n.language;
    if (box.dataset.k !== k) { box.dataset.k = k; box.innerHTML = tuiToolSketch(t.type, dlgFocus, config.vehicle); }
  }
  // Pivot distance (Tool.TrailingToolToPivotLength) as the host uses it: the working line sits
  // at hitch − (TrailingHitchLength − value) (ToolPositionService.cs:223), so a POSITIVE value puts
  // it AHEAD of the tool axle, towards the tractor. The dialog's buttons send behind = +, ahead = −
  // (RemoteServerWiring.Helpers "tool.pivotSide"), i.e. their labels were the wrong way round. The
  // labels and the picture follow the host here; see docs/Host-Aenderungen.md (undo after a fix upstream).
  function pivotDialogExtras(t) {
    const body = document.getElementById('tcs-pivot');
    if (!body) return;
    const bB = body.querySelector('.cfg-act[data-val="behind"]'), bA = body.querySelector('.cfg-act[data-val="ahead"]');
    if (bB && bA) {
      if (!body.dataset.tuiPivot) { // order: behind | zero | ahead, by what each button really does
        body.dataset.tuiPivot = '1';
        const z0 = body.querySelector('.cfg-act[data-val="zero"]');
        bB.parentNode.insertBefore(bA, bB.parentNode.firstChild);
        if (z0) bB.parentNode.insertBefore(z0, bB);
      }
      bB.textContent = T(tr('Ahead of the axle')); bA.textContent = T(tr('Behind the axle'));
      const v = +t.trailingToolToPivotLength || 0;
      bB.classList.toggle('active', v > 0.0005); bA.classList.toggle('active', v < -0.0005);
      const z = body.querySelector('.cfg-act[data-val="zero"]'); if (z) z.classList.toggle('active', Math.abs(v) <= 0.0005);
    }
    const img = body.querySelector('img.vc-diag');
    let box = document.getElementById('tui-tc-pivot');
    if (img && !box) {
      box = el('div', 'tp-skbox'); box.id = 'tui-tc-pivot'; img.after(box); img.hidden = true;
      const note = el('div', 'tp-note'); note.id = 'tui-tc-pivot-n'; box.after(note);
      const wrap = el('div', 'tui-tc-pivot-w'); box.before(wrap); wrap.append(box, note);
    }
    if (!box) return;
    const v = +t.trailingToolToPivotLength || 0;
    const k = v.toFixed(3) + '|' + I18n.language;
    if (box.dataset.k === k) return;
    box.dataset.k = k;
    // Side view, tractor to the right: tool axle (pivot) and the working line.
    const ax = 300, wx = v > 0.0005 ? 400 : v < -0.0005 ? 200 : 300;
    let g = '<line class="sk-g" x1="20" y1="230" x2="580" y2="230"/><g class="sk-b"><rect x="150" y="110" width="300" height="70" rx="8"/><path d="M450 150h110"/><circle cx="566" cy="150" r="6"/>' +
      '<circle cx="' + ax + '" cy="204" r="26"/><circle cx="' + ax + '" cy="204" r="4"/></g>' +
      '<path class="sk-wp" d="M' + wx + ' 230l-9 -16h18z"/><text class="sk-dl sk-small" x="560" y="130" text-anchor="end">' + esc(T(tr('Tractor'))) + ' →</text>';
    if (wx !== ax) g += '<g class="sk-on">' + dash(ax, 170, ax, 262) + dash(wx, 170, wx, 262) + dim(Math.min(ax, wx), 252, Math.max(ax, wx), 252, '', 0, 0) + '</g>';
    g += '<text class="sk-dl sk-small" x="' + wx + '" y="100" text-anchor="middle">' + esc(T(tr('Working line'))) + '</text>';
    box.innerHTML = '<svg class="tp-sk" viewBox="0 0 600 280">' + g + '</svg>';
    document.getElementById('tui-tc-pivot-n').textContent = T(Math.abs(v) <= 0.0005 ? tr('Working line on the tool axle.')
      : v > 0 ? tr('Working line {d} ahead of the tool axle (towards the tractor).', { d: fmtUnit(v, 'm', 2) })
        : tr('Working line {d} behind the tool axle.', { d: fmtUnit(-v, 'm', 2) }));
  }
  populateToolCfg = (orig => function (force) { orig(force); toolDialogExtras(); if (config && config.tool) pivotDialogExtras(config.tool); })(populateToolCfg);

  // Point 15: Network IO fills empty subnet boxes with 192.168.5 (upstream). Without modules
  // found, that default would go out as the new subnet of every module after one confirm; it is
  // only sent once the operator has typed the subnet in.
  {
    const btn = document.getElementById('nio-subnet');
    const boxes = ['nio-o1', 'nio-o2', 'nio-o3'].map(id => document.getElementById(id)).filter(Boolean);
    let typed = false;
    for (const b of boxes) b.addEventListener('input', () => { typed = true; });
    // On the parent, capture phase: runs before the button's own (upstream) listener.
    if (btn) btn.parentNode.addEventListener('pointerdown', e => {
      if (!e.target.closest('#nio-subnet') || typed || (statusBar && statusBar.moduleSubnet)) return;
      e.stopImmediatePropagation(); e.preventDefault();
      showToast(T(tr('No modules found: please type in the subnet first (192.168.5 is only filled in as an example).')), 6000);
    }, true);
  }
  populateVehicleCfg = (orig => function (force) { orig(force); relabelHitchSelect(document.querySelector('#vehiclecfg .cfg-sel[data-key="vehicle.hitchType"]')); })(populateVehicleCfg);

  return { open, get view() { return view; } };
})();

// ===== Tablet UI (Phase 2c): known host texts in German ==============================
// The host sends the fix quality and the NTRIP state as fixed English texts. Known ones are
// translated for display; addresses and caster replies inside them stay as they are, and
// anything unknown stays English. Exact texts are keys (the page translates them itself);
// texts with a variable part are rewritten on the elements that show them.
const TabletHostText = (() => {
  [tr('No Fix'), tr('GPS Fix'), tr('DGPS Fix'), tr('RTK Fixed'), tr('RTK Float'), tr('Connected'), tr('Caster sent an invalid reply'),
   tr('Success: Connected to caster and mount point')];
  const FIX = /\b(No Fix|GPS Fix|DGPS Fix|RTK Fixed|RTK Float)\b/g;
  const PAT = [
    [/^Connecting to (.+)…$/s, x => tr('Connecting to {x}…', { x })],
    [/^Connected to (.+)$/s, x => tr('Connected to {x}', { x })],
    [/^Connection failed: (.+)$/s, x => tr('Connection failed: {x}', { x })],
    [/^Rejected: (.+)$/s, x => tr('Rejected: {x}', { x })],
    [/^Error: (.+)$/s, x => tr('Error: {x}', { x })],
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
    tr('Too few points to smooth (need at least 5)')]);
  showToast = (orig => function (msg, ms) { return orig(typeof msg === 'string' && tuiIsDe() && TOASTS.has(msg) ? I18n.text(msg) : msg, ms); })(showToast);
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
  const IDS = ['sb-fix', 'sb-gps-d', 'gc-fix', 'nio-ntrip-status', 'nio-ntrip-rx', 'sd-fix', 'nte-teststatus'];
  for (const id of IDS) { const e = document.getElementById(id); if (e) obs.observe(e, { subtree: true, childList: true, characterData: true }); }
  return { de };
})();

// ===== Tablet UI (Phase 4a): product look, help, support diagnosis ====================
// BRAND is the one place for the product name, colours, logo and links of the web app (the
// Android launcher name and icon live in the Android project, see docs/Host-Aenderungen.md).
// Look only: switched per device under Setup → Info (aow.ui.brand = on | off, default on);
// off = the AgOpenWeb look. Warning, stop and steer-direction colours never change.
const BRAND = {
  name: 'LM Steering Solutions',
  claim: tr('GPS steering aid for tractor and tool'),
  // Colour world B "Pflaume": accent per theme, [colour, text on it, r,g,b]
  night: ['#c995e0', '#1d0b26', '201,149,224'],
  day: ['#6b2d87', '#ffffff', '107,45,135'],
  sun: ['#4a1660', '#ffffff', '74,22,96'],
  source: 'https://github.com/MoritzLoibl10/AgOpenWeb',
  upstream: 'https://github.com/AgOpenGPS-Official/AgOpenWeb',
  agopengps: 'https://github.com/AgOpenGPS-Official/AgOpenGPS',
};
// The logo: tracks running to the horizon, the guidance line and the own position.
function brandLogo(size, bg, fg) {
  return '<svg class="tb-logo" viewBox="0 0 96 96" width="' + size + '" height="' + size + '" aria-hidden="true"><rect x="4" y="4" width="88" height="88" rx="22" fill="' + bg + '"/>' +
    '<g fill="none" stroke="' + fg + '" stroke-width="5" stroke-linecap="round" opacity=".55"><path d="M20 76 C30 52 34 38 36 20"/><path d="M36 78 C42 54 46 38 48 20"/><path d="M64 78 C58 54 54 38 52 20"/><path d="M80 76 C70 52 66 38 64 20"/></g>' +
    '<path d="M50 18 V62" stroke="' + fg + '" stroke-width="7" stroke-linecap="round"/><circle cx="50" cy="70" r="9" fill="' + fg + '"/></svg>';
}
const TabletBrand = (() => {
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const lsGet = (k, d) => { try { const v = window.localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch (_) { /* private / blocked */ } };
  const T = k => I18n.text(k);
  const KEY = 'aow.ui.brand';
  const on = () => lsGet(KEY, 'on') !== 'off';

  // --- Look: accent colours, title, web-app manifest ---------------------------------------
  const style = el('style'); style.id = 'tb-style';
  style.textContent =
    ':root[data-tb]{--tui-acc:' + BRAND.night[0] + ';--tui-acc-ink:' + BRAND.night[1] + ';--tui-acc-soft:rgba(' + BRAND.night[2] + ',0.18);--sel:rgba(' + BRAND.night[2] + ',0.35)}' +
    ':root[data-tb][data-theme="day"]{--tui-acc:' + BRAND.day[0] + ';--tui-acc-ink:' + BRAND.day[1] + ';--tui-acc-soft:rgba(' + BRAND.day[2] + ',0.14);--sel:rgba(' + BRAND.day[2] + ',0.22)}' +
    ':root[data-tb][data-theme="day"][data-tui-sun]{--tui-acc:' + BRAND.sun[0] + ';--tui-acc-ink:' + BRAND.sun[1] + ';--tui-acc-soft:rgba(' + BRAND.sun[2] + ',0.14)}';
  document.head.appendChild(style);
  const mf = document.querySelector('link[rel="manifest"]');
  const mfOrig = mf ? mf.getAttribute('href') : null, titleOrig = document.title;
  function manifest() {
    const o = location.origin;
    return 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify({
      name: BRAND.name, short_name: BRAND.name, start_url: o + '/', scope: o + '/',
      display: 'fullscreen', display_override: ['fullscreen', 'standalone'], orientation: 'landscape',
      background_color: '#0f1115', theme_color: BRAND.day[0],
      icons: [{ src: o + '/icons/brand-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: o + '/icons/brand-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: o + '/icons/brand-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
    }));
  }
  function apply() {
    const b = on();
    if (b) root.setAttribute('data-tb', ''); else root.removeAttribute('data-tb');
    document.title = b ? BRAND.name : titleOrig;
    if (mf) mf.setAttribute('href', b ? manifest() : mfOrig);
  }
  apply();

  // --- Setup → Info: name, version, origin, licence, source --------------------------------
  const LIC = { apache: ['tui-lic-apache', 'Apache License 2.0'], // LICENSE.md, embedded in index.html
    third: ['tui-lic-third', tr('Third-party components')] }; // fork: index.html, block third-party:begin/end (English, -de German)
  const sheet = el('div', 'tui-sheet tb-sheet', '<div class="tui-sh-hdr"><span class="t"></span><button class="x">✕</button></div><div class="tui-sh-body"></div>');
  sheet.id = 'tb-sheet';
  const scrim = el('div', 'tp-scrim');
  document.body.append(scrim, sheet);
  for (const n of [sheet, scrim]) n.addEventListener('pointerdown', e => e.stopPropagation());
  const shT = sheet.querySelector('.t'), shB = sheet.querySelector('.tui-sh-body');
  const closeSheet = () => { sheet.classList.remove('open'); scrim.classList.remove('open'); };
  onTap(sheet.querySelector('.x'), closeSheet);
  onTap(scrim, closeSheet);
  function openSheet(title, fill) {
    if (typeof lnCloseAll === 'function') lnCloseAll();
    shT.textContent = title; shB.innerHTML = ''; shB.scrollTop = 0;
    fill(shB);
    sheet.classList.add('open'); scrim.classList.add('open');
  }
  function showLicense(k) {
    const [id, name] = LIC[k], src = (k === 'third' && tuiIsDe() && $(id + '-de')) || $(id); // third-party page: German headings and notes, licence texts as is
    openSheet(T(name), b => {
      const back = el('button', 'tp-btn'); back.textContent = '← Info'; onTap(back, () => openInfo());
      b.appendChild(back);
      const pre = el('pre', 'tb-lic'); pre.setAttribute('translate', 'no');
      pre.textContent = src ? src.textContent.trim() : '—';
      b.appendChild(pre);
    });
  }
  const link = (label, url) => { const a = el('button', 'tp-btn quiet tb-link'); a.innerHTML = '<span></span><small translate="no"></small>';
    a.firstChild.textContent = label; a.lastChild.textContent = url.replace(/^https:\/\//, ''); onTap(a, () => openExternal(url)); return a; };
  function renderInfo() {
    const ab = $('about');
    if (!ab) return;
    for (const e of ab.querySelectorAll('.ab-title, .ab-desc')) e.hidden = true;
    let box = ab.querySelector('.tb-info');
    if (!box) { box = el('div', 'tb-info'); ab.appendChild(box); }
    box.innerHTML = '';
    const b = on();
    const head = el('div', 'tb-head', (b ? brandLogo(84, 'var(--tui-acc)', 'var(--tui-acc-ink)') : '') + '<div><div class="tb-name" translate="no"></div><div class="tb-claim"></div></div>');
    head.querySelector('.tb-name').textContent = b ? BRAND.name : 'AgOpenWeb';
    head.querySelector('.tb-claim').textContent = T(BRAND.claim);
    box.appendChild(head);
    const ori = el('div', 'tb-box');
    // Apache 2.0 (as upstream, LICENSE.md): the licence, that this is a changed version, the
    // copyright of AgOpenWeb and of the changes, and the no-warranty clause (§4, §7).
    ori.appendChild(Object.assign(el('div'), { textContent: T(tr('Changed version (fork) of AgOpenWeb, based on AgOpenWeb; changed since October 2026. AgOpenWeb builds on AgOpenGPS (Brian Tee and contributors).')) }));
    ori.appendChild(Object.assign(el('div'), { textContent: T(tr('Licensed under the Apache License 2.0. You may use, change and pass it on; the source code is open.')) }));
    ori.appendChild(Object.assign(el('div'), { textContent: T(tr('Copyright © 2024–2026 AgOpenWeb contributors. Changes in this version: Copyright © 2026 Moritz Loibl.')) }));
    ori.appendChild(Object.assign(el('div'), { textContent: T(tr('Provided “as is”, without warranties or conditions of any kind (see the licence text).')) }));
    const lr = el('div', 'tb-row');
    const ba = el('button', 'tp-btn'); ba.textContent = T(tr('Licence text (Apache 2.0)')); onTap(ba, () => showLicense('apache'));
    const b3 = el('button', 'tp-btn'); b3.textContent = T(tr('Third-party components')); onTap(b3, () => showLicense('third'));
    lr.append(ba, b3); ori.appendChild(lr);
    box.appendChild(ori);
    const src = el('div', 'tb-box');
    src.appendChild(Object.assign(el('div', 'tb-lbl'), { textContent: T(tr('Source code of this version')) }));
    const hash = appInfo && /^[0-9a-f]{7,40}$/.test(appInfo.gitHash || '') ? appInfo.gitHash : '';
    src.appendChild(link(T(tr('This version (fork)')), hash ? BRAND.source + '/tree/' + hash : BRAND.source));
    src.appendChild(link('AgOpenWeb', BRAND.upstream));
    src.appendChild(link('AgOpenGPS', BRAND.agopengps));
    box.appendChild(src);
    try { box.appendChild(TabletUpdate.box()); } catch (_) { /* not loaded yet */ } // fork: update check
    const sw = el('div', 'tb-box');
    sw.appendChild(Object.assign(el('div', 'tb-lbl'), { textContent: T(tr('Look')) }));
    const seg = el('div', 'tp-seg');
    for (const [v, label] of [['on', BRAND.name], ['off', 'AgOpenWeb']]) {
      const s = el('button', 'tp-segb' + ((v === 'on') === b ? ' on' : '')); s.textContent = label; s.setAttribute('translate', 'no');
      onTap(s, () => { lsSet(KEY, v); apply(); renderInfo(); });
      seg.appendChild(s);
    }
    sw.appendChild(seg);
    sw.appendChild(Object.assign(el('div', 'tp-note'), { textContent: T(tr('Only the look on this device changes.')) }));
    box.appendChild(sw);
  }
  renderAbout = (orig => function () { const r = orig.apply(this, arguments); renderInfo(); return r; })(renderAbout);
  const abTitle = $('about') && $('about').querySelector('.ln-hdr-title');
  if (abTitle) abTitle.textContent = 'Info';
  function openInfo() {
    closeSheet();
    if (typeof TabletTerminal !== 'undefined' && TabletTerminal.layout === 'terminal') TabletTerminal.setMode('setup');
    lnOpen('about', 'ln-filemenu', renderAbout);
  }

  // --- Help: short illustrated pages, offline -----------------------------------------------
  const sv = body => '<svg class="tb-ill" viewBox="0 0 320 170" aria-hidden="true">' + body + '</svg>';
  const box = (x, y, w, h, txt, cls) => '<rect class="' + (cls || 'hb') + '" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="8"/>' +
    (txt ? '<text class="ht" x="' + (x + w / 2) + '" y="' + (y + h / 2 + 5) + '" text-anchor="middle">' + esc(T(txt)) + '</text>' : '');
  const ILL = {
    vehicle: () => sv(box(10, 14, 300, 28, tr('Menu'), 'hb acc') + box(10, 52, 145, 56, tr('Vehicle')) + box(165, 52, 145, 56, tr('Tool')) + box(190, 124, 120, 34, tr('Load'), 'hb acc')),
    track: () => sv('<path class="hl" d="M40 160 L160 10"/><circle class="hp" cx="70" cy="122" r="9"/><circle class="hp" cx="136" cy="40" r="9"/>' +
      '<text class="ht" x="52" y="150">A</text><text class="ht" x="148" y="34">B</text>' + box(200, 60, 110, 36, tr('AB Line'), 'hb acc')),
    steer: () => sv(box(200, 20, 110, 130, '', 'hb') + box(212, 100, 86, 40, tr('Steer'), 'hb acc') + '<path class="hl" d="M90 160 L90 10"/>' +
      '<rect class="hb acc" x="20" y="8" width="150" height="30" rx="8"/><text class="ht inv" x="95" y="28" text-anchor="middle">' + esc(T(tr('Steering ON'))) + '</text>'),
    headland: () => sv('<rect class="hb" x="20" y="10" width="280" height="150" rx="6"/><rect class="hhl" x="50" y="34" width="220" height="102" rx="4"/>' +
      '<path class="hl" d="M160 150 L160 34"/><text class="ht" x="160" y="26" text-anchor="middle">' + esc(T(tr('Headland'))) + '</text>'),
    rtk: () => sv(box(10, 20, 96, 40, 'RTK Fix', 'hb f1') + box(112, 20, 96, 40, 'RTK Float', 'hb f2') + box(214, 20, 96, 40, 'DGPS', 'hb f3') +
      '<text class="ht" x="58" y="84" text-anchor="middle">———</text><text class="ht" x="160" y="84" text-anchor="middle">- - -</text><text class="ht" x="262" y="84" text-anchor="middle">· · ·</text>' + box(10, 106, 300, 40, tr('Network & GPS'))),
    band: () => sv('<rect class="hband" x="20" y="60" width="280" height="50" rx="10"/><text class="ht inv" x="160" y="90" text-anchor="middle">' + esc(T(tr('Profile not completely saved'))) + '</text>'),
    actnow: () => sv(box(40, 50, 110, 60, tr('Steer'), 'hb acc') + box(170, 50, 110, 60, tr('Auto'), 'hb acc')),
    demo: () => sv('<rect class="hband" x="20" y="60" width="280" height="50" rx="10"/><text class="ht inv" x="160" y="90" text-anchor="middle">' + esc(T(tr('DEMO – simulator only, no real outputs'))) + '</text>'),
    board: () => sv(box(60, 30, 200, 110, 'AiO v4') + box(84, 100, 70, 26, 'v4', 'hb acc') + box(166, 100, 70, 26, 'v26', 'hb f3')),
    direction: () => sv('<path class="hl" d="M160 150 L160 20"/><path class="hl" d="M146 40 L160 20 L174 40"/>' +
      box(110, 70, 100, 60, tr('Vehicle'), 'hb acc') + box(10, 14, 92, 34, tr('REVERSE'), 'hb f2') + box(218, 14, 92, 34, tr('Tap'), 'hb')),
    usb: () => sv(box(10, 40, 110, 90, tr('Tablet')) + '<path class="hl" d="M120 85 H200"/>' + box(200, 40, 110, 90, 'PC') + '<text class="ht" x="160" y="76" text-anchor="middle">USB</text>'),
  };
  const PAGES = [
    { id: 'vehicle', t: tr('Choose vehicle and tool'), steps: [
      tr('Open the menu {menu}. At the top you see the active vehicle and tool.'),
      tr('Tap one of them: the cards show all vehicles and tools.'),
      tr('Tap a card, then "Load". This only works standing, with steering off.'),
      tr('New vehicle or tool: "New" starts the assistant. Measure each value; the sketch shows where.'),
      tr('A yellow note means an unusual value. Check it; it is saved as entered.')] },
    { id: 'track', t: tr('Create a track'), steps: [
      tr('Open a field first: Menu → Fields and Jobs.'),
      tr('Tap {abline} "AB Line" in the bottom bar, then {quickab} "Quick AB Line".'),
      tr('"A+": a straight line through your position in the direction you drive.'),
      tr('"Drive AB": drive to the start, set A; drive to the end, set B.'),
      tr('{snapleft} "Track left" / {snapright} "Track right" move the line by one working width.'),
      tr('{next} "Next track" (right) switches to the next track. It switches steering and auto U-turn off; switch steering on again yourself.')] },
    { id: 'steer', t: tr('Steering on and off'), steps: [
      tr('Steering needs a track and, as set by default, an RTK fix.'),
      tr('Before the first steering: check the heading in setup mode (card "Heading check"). Driving, GPS and IMU heading should agree.'),
      tr('After every start, drive forward first or confirm the direction on the card ("Does the vehicle face the way it drives?").'),
      tr('Tap {steer} "Steer" (bottom right). The status bar shows "Steering ON".'),
      tr('Tap "Steer" again to switch it off. Turning the steering wheel by hand can switch it off too, if this is set up.'),
      tr('"Not steering" in red: steering is on, but the motor does not steer. Steer by hand and check the steering module.'),
      tr('Stay at the wheel. Steering is an aid; you remain responsible.')] },
    { id: 'headland', t: tr('Headland'), steps: [
      tr('The headland is set up per field: Field Tools → Field Builder → Headland.'),
      tr('{headland} "Headland" in the bottom bar switches it on and off.'),
      tr('"Headland 12.0 m" is the distance to the headland line ahead. It turns red inside the headland.'),
      tr('{secheadland} "Sec. in headl." switches the sections off in the headland.')] },
    { id: 'rtk', t: tr('Understand NTRIP and RTK'), steps: [
      tr('The box at the top shows the fix: solid frame = RTK Fix (steering ready), dashed = RTK Float, dotted = DGPS/GPS.'),
      tr('"Age" is the age of the correction in seconds. Above about 5 s the correction is old.'),
      tr('Corrections come from NTRIP over the internet. The state is under Setup → Network & GPS.'),
      tr('"Rejected: …": user, password or mount point is wrong. "Connection failed": no internet or wrong address.'),
      tr('Network RTK (VRS) needs your position; it is sent automatically once the receiver has a fix.')] },
    { id: 'band', t: tr('Red band: profile not completely saved'), steps: [
      tr('The connection broke while a profile was being saved. Not all values may have arrived.'),
      tr('Tap the band. You see which values were meant to be saved and what is there now.'),
      tr('"Send again and save" sends the same values again. When editing, "Put the old values back" restores the previous ones.'),
      tr('The band only goes away when one of the two has been confirmed. Do not drive with steering until then.')] },
    { id: 'direction', t: tr('Vehicle faces the wrong way'), steps: [
      tr('With one antenna, the direction the vehicle faces is learned from its first travel above 1.5 km/h.'),
      tr('If that first travel is backwards, it is learned the wrong way round: reversing shows as forward, and forward shows "REVERSE".'),
      tr('Then the steering would be computed for the wrong direction, and the auto sections stay off driving forward. Do not engage steering.'),
      tr('Stop, tap the vehicle on the map ("Reset direction"), then drive forward above 1.5 km/h.'),
      tr('So after switching on, drive forward first if you can. With two antennas (Dual GPS) this does not happen.'),
      tr('On the test bench, Menu → Bench checklist → "Reverse start" reproduces this case on purpose.')] },
    { id: 'actnow', t: tr('Buttons that act at once'), steps: [
      tr('Steer: switches automatic steering on or off. It needs a track and, as set by default, an RTK fix. Stay at the wheel; steering is an aid.'),
      tr('Auto U-turn: switches automatic U-turns at the headland on or off.'),
      tr('Sections automatic: the sections switch on and off by themselves, by the worked area and the boundary.'),
      tr('Sections manual: switches the sections on by hand; they stay on until you switch them off.'),
      tr("ISOBUS: switches the implement's own section control on or off."),
      tr('Contour: guidance along the path you drove before, instead of along a track.'),
      tr('Contour lock: keeps the contour you follow, so the guidance does not jump to another path.'),
      tr('Next track: switches to the next track. Steering and auto U-turn are switched off; switch steering on again yourself.'),
      tr('Previous track: switches to the previous track.'),
      tr('Auto track: picks the closest track by itself.'),
      tr('Section control in the headland on or off.'),
      tr('Headland on or off. The headland distance and the hydraulic lift follow it.'),
      tr('Demo mode: the simulator with a "DEMO" band, only without the kit connected.')] },
    { id: 'demo', t: tr('Demo mode'), steps: [
      tr('Demo only without the kit connected.'),
      tr('Menu → "Demo mode" starts the simulator; a striped "DEMO" band shows it runs.'),
      tr('If a module is detected, the demo ends: then check steering and sections yourself.'),
      tr('"End demo" on the band or in the menu stops it.')] },
    { id: 'usb', t: tr('Back up profiles by USB copy'), warn: tr('Not checked on a real tablet yet.'), steps: [
      tr('Easier: Setup → Menu → "Back up and restore" makes one file and restores it from the Import folder.'),
      tr('Close the app. Connect the tablet to a PC by USB and choose "File transfer" on the tablet.'),
      tr('On the PC open: Android/data/at.loibl.lenksystem/files/AgOpenWeb/'),
      tr('Copy the folders Vehicles, Tools, Fields and NtripProfiles to the PC. NtripProfiles contains your NTRIP password.'),
      tr('To restore, copy them back to the same place while the app is closed.'),
      tr('Older versions of this app used the folder Android/data/com.agopenweb.android/ instead.'),
      tr('Windows tablet: the same folders are in Documents\\AgOpenWeb (C:\\Users\\<name>\\Documents\\AgOpenWeb; with OneDrive possibly OneDrive\\Documents\\AgOpenWeb). Close the app and copy them to a USB stick.')] },
    { id: 'board', t: tr('Steering module: firmware'), warn: tr('Board and motor are not tested on real hardware yet.'), steps: [
      tr('AiO board (v4.x, also v4.5): use the AiO v4 firmware, not v26.'),
      tr('v26 sends 0 as IMU heading in the steering data. The system then takes 0° as a real heading, and the heading lags behind every turn.'),
      tr('Check it in setup mode on the card "Heading check": a yellow warning appears when the IMU heading stays exactly 0° while driving.')] },
  ];
  // Buttons named in a step show their real symbol inline: {abline} → the image of that button
  // as it is on screen now (the bottom bar's, the right nav's), else its file.
  const HELP_ICON = {
    abline: ['#bn-abmenu img', 'TrackOn.png'], quickab: ['#bn-quickab img', 'ABTrackAPlus.png'],
    snapleft: ['#bottomnav [data-cmd="track.snapLeft"] img', 'SnapLeft.png'], snapright: ['#bottomnav [data-cmd="track.snapRight"] img', 'SnapRight.png'],
    next: ['#rn-cycle img', 'ABLineCycle.png'], steer: [null, 'AutoSteerOff.png'],
    headland: ['#bn-headland-ic', 'HeadlandOff.png'], secheadland: ['#bn-secheadland-ic', 'HeadlandSectionOn.png'],
  };
  function stepItem(text) {
    const li = el('li');
    for (const part of text.split(/(\{[a-z]+\})/)) {
      const m = /^\{([a-z]+)\}$/.exec(part);
      if (m && m[1] === 'menu') { const b = $('tui-menu-btn'); const i = el('span', 'tb-ic tb-ic-svg', b ? (b.querySelector('svg') || {}).outerHTML || '' : ''); li.appendChild(i); continue; }
      if (m && HELP_ICON[m[1]]) {
        const [q, file] = HELP_ICON[m[1]];
        const live = q ? document.querySelector(q) : null;
        const img = el('img', 'tb-ic'); img.alt = ''; img.src = live && live.getAttribute('src') ? live.src : '/icons/' + file;
        li.appendChild(img); continue;
      }
      li.appendChild(document.createTextNode(part));
    }
    return li;
  }
  function openHelp(id) {
    const pg = PAGES.find(p => p.id === id);
    if (!pg) {
      openSheet(T(tr('Help')), b => {
        b.appendChild(Object.assign(el('div', 'tp-lead'), { textContent: T(tr('Short guide')) }));
        const g = el('div', 'tb-topics');
        for (const p of PAGES) {
          const t = el('button', 'tb-topic', (ILL[p.id] ? ILL[p.id]() : '') + '<span></span>'); t.querySelector('span').textContent = T(p.t); // a page without a picture must not break the index
          onTap(t, () => openHelp(p.id));
          g.appendChild(t);
        }
        b.appendChild(g);
        b.appendChild(Object.assign(el('div', 'tp-lead'), { textContent: T(tr('Online (needs internet)')) }));
        const r = el('div', 'tb-row');
        r.append(link(T(tr('This version (fork)')), BRAND.source), link(T(tr('Original project')), BRAND.upstream));
        b.appendChild(r);
      });
      return;
    }
    openSheet(T(pg.t), b => {
      const w = el('div', 'tb-page');
      if (ILL[pg.id]) w.appendChild(el('div', 'tb-pill', ILL[pg.id]()));
      const col = el('div');
      if (pg.warn) col.appendChild(Object.assign(el('div', 'tp-note warn'), { textContent: T(pg.warn) }));
      const ol = el('ol', 'tb-steps');
      for (const s of pg.steps) ol.appendChild(stepItem(T(s)));
      col.appendChild(ol);
      w.appendChild(col);
      b.appendChild(w);
      const nav = el('div', 'tb-row');
      const back = el('button', 'tp-btn'); back.textContent = '← ' + T(tr('All topics')); onTap(back, () => openHelp());
      nav.appendChild(back);
      const i = PAGES.indexOf(pg);
      if (i < PAGES.length - 1) { const nx = el('button', 'tp-btn pri'); nx.textContent = T(PAGES[i + 1].t) + ' →'; onTap(nx, () => openHelp(PAGES[i + 1].id)); nav.appendChild(nx); }
      b.appendChild(nav);
    });
  }
  // The upstream help panel (App & Files → Help) gets the short guide on top.
  { const h = $('help'); if (h) { const b = el('button', 'fo-btn tb-helpbtn'); b.textContent = tr('Short guide'); onTap(b, () => openHelp()); h.querySelector('.ln-hdr').after(b); } }

  // --- Diagnosis for support: the bug report with a summary from this device ----------------
  // Uses the existing bug report (app.bugReport): the host zips settings (secrets blanked),
  // profile values, logs, RTCM report, GPS log, the open field. The summary below goes in as the
  // description. NTRIP passwords and user names never go in; they are blanked if they appear.
  function summary() {
    const s = statusBar || {}, v = config && config.vehicle, t = config && config.tool;
    const L = [];
    L.push('DIAGNOSIS ' + new Date().toISOString());
    L.push('Product: ' + BRAND.name + ' (look ' + (on() ? 'on' : 'off') + ')');
    L.push('Version: ' + (appInfo ? appInfo.version + ' ' + appInfo.gitHash : '?'));
    L.push('Client: ' + navigator.userAgent + ' ' + innerWidth + 'x' + innerHeight + ' lang ' + I18n.language);
    L.push('Connection: ' + connState + ', control ' + (iHoldControl ? 'this device' : 'other / none'));
    L.push('');
    L.push('Active vehicle: ' + (profiles ? profiles.activeVehicle : '?'));
    if (v) L.push('  type ' + v.type + ', wheelbase ' + v.wheelbase + ' m, track ' + v.trackWidth + ' m, antenna pivot ' + v.antennaPivot +
      ' m, height ' + v.antennaHeight + ' m, offset ' + v.antennaOffset + ' m, hitch ' + v.hitchLength + ' m');
    if (config && config.autosteer) L.push('  max steer angle ' + config.autosteer.maxSteerAngle + ' deg');
    L.push('Active tool: ' + (profiles ? profiles.activeTool : '?'));
    if (t) L.push('  type ' + t.type + ', sections ' + t.numSections + ', widths cm ' + (t.sectionWidths || []).slice(0, t.numSections).join('/') +
      ', total ' + t.totalWidth + ' m, offset ' + t.offset + ' m, overlap ' + t.overlap + ' m, hitch ' + t.hitchLength + ' m');
    L.push('');
    L.push('GPS: fix ' + s.fixQuality + ' (' + (s.fixText || '?') + '), sats ' + s.sats + ', hdop ' + s.hdop + ', correction age ' + s.age + ' s' + (s.gpsLost ? ', DATA LOST' : ''));
    L.push('NTRIP: ' + (s.ntripEnabled ? 'on' : 'off') + ', connected ' + !!s.ntripConnected + ', bytes ' + s.ntripBytes + ', to ' + (s.ntripDestination || '?'));
    L.push('  status: ' + (s.ntripStatus || ''));
    L.push('Modules: gps ' + !!s.gpsOk + ', imu ' + !!s.imuOk + ', steer ' + !!s.autoSteerOk + ', machine ' + !!s.machineOk);
    // The bench checklist result, if one was ticked on this device (TabletBench).
    if (typeof TabletBench !== 'undefined') L.push(...TabletBench.lines());
    // The host's log and RTCM report are in the file as logs.txt and ntrip_rtcm.txt.
    let out = L.join('\n');
    // Never a password or NTRIP user name, even if it appears in a log line.
    const secrets = [];
    const np = ntripProfiles && ntripProfiles.profiles;
    if (np) for (const k of Object.keys(np)) for (const f of ['password', 'username']) { const x = np[k] && np[k][f]; if (x && x.length >= 3) secrets.push(x); }
    for (const x of secrets.sort((a, b) => b.length - a.length)) out = out.split(x).join('***');
    // The host reads a command in 1 KB pieces and runs each piece on its own: the summary has
    // to fit in one, with the command prefix (code points, so no character is cut in half).
    const enc = new TextEncoder(), max = 1000 - enc.encode('app.bugReport|diagnose\t').length;
    if (enc.encode(out).length > max) {
      let cp = Array.from(out);
      while (enc.encode(cp.join('') + ' …').length > max) cp = cp.slice(0, -16);
      out = cp.join('') + ' …';
    }
    return out;
  }
  let diagSent = false;
  function openDiag() {
    diagSent = false;
    openSheet(T(tr('Diagnosis for support')), fillDiag);
  }
  function fillDiag(b) {
    b.innerHTML = '';
    if (!diagSent) {
      b.appendChild(Object.assign(el('div', 'tp-lead'), { textContent: T(tr('A file for support with the state of this system.')) }));
      const ul = el('ul', 'tp-list');
      for (const x of [tr('Version, active vehicle and tool with their values'), tr('NTRIP state with the last caster reply, GPS fix quality, satellites, correction age'),
        tr('The last log lines, the settings and the NTRIP correction report')]) ul.appendChild(Object.assign(el('li'), { textContent: T(x) }));
      b.appendChild(ul);
      b.appendChild(Object.assign(el('div', 'tp-note warn'), { textContent: T(tr('The file also contains the open field (boundary, tracks, worked area) and the GPS positions of the last 5 minutes. Only pass it on to someone you trust.')) }));
      b.appendChild(Object.assign(el('div', 'tp-note'), { textContent: T(tr('Passwords and the NTRIP user name are not included.')) }));
      const r = el('div', 'tb-row');
      const go = el('button', 'tp-btn pri big'); go.textContent = T(tr('Understood, create the file'));
      go.disabled = connState !== 'connected';
      onTap(go, () => {
        if (connState !== 'connected') return;
        transport.send('app.bugReport|' + 'diagnose' + '\t' + summary().replace(/\t/g, ' '));
        diagSent = true; fillDiag(b);
      });
      const cancel = el('button', 'tp-btn'); cancel.textContent = T(tr('Cancel')); onTap(cancel, closeSheet);
      r.append(cancel, go);
      b.appendChild(r);
      return;
    }
    const st = appInfo ? appInfo.bugReportStatus || '' : '';
    const m = /(bugreport_[^\/\\]+\.zip)$/.exec(st);
    b.appendChild(Object.assign(el('div', 'tp-lead'), { textContent: m ? T(tr('The file is ready.')) : /^Error/.test(st) ? st : T(tr('Creating the file…')) }));
    if (m) {
      const dl = el('button', 'tp-btn pri big'); dl.textContent = T(tr('Download'));
      onTap(dl, () => openExternal(location.origin + '/bugreports/' + encodeURIComponent(m[1])));
      b.appendChild(dl);
      b.appendChild(Object.assign(el('div', 'tp-note'), { textContent: T(tr('The download opens in the browser and lands in Downloads on this device.')) }));
      const fn = el('div', 'tp-note'); fn.setAttribute('translate', 'no'); fn.textContent = m[1]; b.appendChild(fn);
    }
  }
  let diagKey = '';
  setInterval(() => {
    if (!sheet.classList.contains('open') || !diagSent) return;
    const k = appInfo ? appInfo.bugReportStatus : '';
    if (k !== diagKey) { diagKey = k; fillDiag(shB); }
  }, 400);

  // --- Menu tiles: Help (in the field), Info and Diagnosis (setup) --------------------------
  const ICS = {
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><circle cx="12" cy="17.5" r=".6" fill="currentColor"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".6" fill="currentColor"/></svg>',
    diag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  };
  function menuTiles() {
    const m = $('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const f = m.querySelector('.tui-tiles.tui-f'), s = m.querySelector('.tui-tiles.tui-s');
    const add = (box, key, cls, label, fn) => {
      if (!box || box.querySelector('[data-tile="' + key + '"]')) return;
      const t = el('button', 'tui-tile ' + cls, ICS[key.slice(3)] + '<span></span>'); t.dataset.tile = key;
      t.querySelector('span').textContent = T(label);
      onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) x.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); fn(); });
      box.appendChild(t);
    };
    add(f, 'tb-help', 'field', tr('Help'), () => openHelp());
    add(s, 'tb-info', 'setup', 'Info', () => openInfo());
    add(s, 'tb-diag', 'setup', tr('Diagnosis for support'), () => openDiag());
  }
  setInterval(menuTiles, 300);

  return { get on() { return on(); }, apply, openHelp, openInfo, openDiag, summary };
})();

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
    lastLang = I18n.language;
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
    if (lastLang !== I18n.language || !title.textContent) labels();
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

  function open(i) {
    if (typeof lnCloseAll === 'function') lnCloseAll();
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
    const key = JSON.stringify([rows, w, I18n.language]);
    if (key === lastKey) return;
    lastKey = key;
    valBox.innerHTML = '';
    for (const [k, v] of rows) { valBox.appendChild(el('span', '', st.raw ? k : T(k))); valBox.appendChild(el('b', '', v)); }
    warnBox.innerHTML = '';
    for (const x of w) warnBox.appendChild(el('div', '', '⚠ ' + (st.raw ? x : T(x))));
  }
  setInterval(tickVals, 250);
  // Close when leaving setup mode: the checklist is for the bench.
  setInterval(() => { if (sheet.classList.contains('open') && TabletTerminal.mode !== 'setup') close(); }, 500);

  // --- Menu tile (setup) --------------------------------------------------------------------
  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M8.5 10l1.5 1.5 3-3M8.5 16l1.5 1.5 3-3M15 11h1M15 17h1"/></svg>';
  setInterval(() => {
    const m = document.getElementById('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const s = m.querySelector('.tui-tiles.tui-s'); if (!s || s.querySelector('[data-tile="tbn"]')) return;
    const t = el('button', 'tui-tile setup'); t.dataset.tile = 'tbn'; t.innerHTML = IC + '<span></span>';
    t.querySelector('span').textContent = T(tr('Bench checklist'));
    onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) x.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); open(); });
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

// ===== Back up and restore profiles (feature/profil-backup), setup mode =======================
// Export: the host packs vehicles, tools, fields and the NTRIP profiles (without password) into
// one ZIP (backup.create), offered as a
// download like the bug report. Import: a ZIP copied into the Import folder, with a preview
// "new / overwrites / same" per entry (backup.preview), then the chosen entries
// (backup.apply, the operating device only; the host first saves the current state and refuses
// while steering is on or the vehicle moves). The state comes as JSON in appInfo.backupStatus.
const TabletBackup = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const STILL_MPS = 0.15;
  const KIND = { vehicle: tr('Vehicle'), tool: tr('Tool'), field: tr('Field'), ntrip: tr('NTRIP profile') };
  const STATE = { new: tr('new'), overwrites: tr('overwrites'), same: tr('same') };
  const ERR = {
    notzip: tr('The file is not a readable ZIP file.'),
    nomanifest: tr('Not a backup of this app (manifest.json missing or another format).'),
    version: tr('This backup has a format version this app does not support.'),
    toolarge: tr('The backup is too large.'),
    badname: tr('File not found in the Import folder.'), notfound: tr('File not found in the Import folder.'),
    empty: tr('Nothing selected.'),
    steer: tr('Steering is on. Switch steering off to import.'),
    moving: tr('The vehicle is moving. Stop to import.'),
    fieldopen: tr('The field {f} is open. Close it to import it.'),
    io: tr('Reading or writing failed: {f}'),
  };
  const DAMAGED = tr('The backup is damaged or was changed ({f}). Nothing was imported.');
  let st = {}, sel = new Set(), selFile = '', confirm = false, applySeq = -1, done = null, scrollTo = false;

  function status() {
    try { return appInfo && appInfo.backupStatus ? JSON.parse(appInfo.backupStatus) : {}; } catch (_) { return {}; }
  }
  function errText(b) {
    const f = b.arg || '';
    return T(ERR[b.err] || DAMAGED).replace('{f}', f);
  }
  function lockReason() {
    if (connState !== 'connected') return tr('No connection to the guidance computer.');
    if (!lastTick || performance.now() - lastTick.t > 2000) return tr('No current data from the guidance computer.');
    if (!iHoldControl) return tr('Only the device that has control can import.');
    if (tick && tick.op && tick.op.autoSteer) return tr('Steering is on. Switch steering off to import.');
    if (Math.abs(lastTick.speed || 0) > STILL_MPS) return tr('The vehicle is moving. Stop to import.');
    return '';
  }
  const importDir = () => {
    const d = appInfo && (appInfo.directories || []).find(x => x.name === 'Vehicle Profiles');
    return d && d.path ? d.path.replace(/[\\/][^\\/]+[\\/]?$/, '') + (d.path.includes('\\') ? '\\' : '/') + 'Import' : 'AgOpenWeb/Import';
  };

  // --- Sheet --------------------------------------------------------------------------------
  const sheet = el('div', 'tui-sheet tb-sheet tbk-sheet');
  sheet.id = 'tui-backup'; sheet.setAttribute('translate', 'no');
  sheet.innerHTML = '<div class="tui-sh-hdr"><span class="t"></span><button class="x">✕</button></div><div class="tui-sh-body"></div>';
  const scrim = el('div', 'tp-scrim');
  document.body.append(scrim, sheet);
  for (const n of [sheet, scrim]) n.addEventListener('pointerdown', e => e.stopPropagation());
  const shT = sheet.querySelector('.t'), shB = sheet.querySelector('.tui-sh-body');
  const close = () => { sheet.classList.remove('open'); scrim.classList.remove('open'); };
  onTap(sheet.querySelector('.x'), close); onTap(scrim, close);
  const isOpen = () => sheet.classList.contains('open');

  function open() {
    if (typeof lnCloseAll === 'function') lnCloseAll();
    confirm = false;
    sheet.classList.add('open'); scrim.classList.add('open');
    if (connState === 'connected') transport.send('backup.list');
    render(true);
  }
  const send = c => { if (connState === 'connected') transport.send(c); };

  function render(force) {
    if (!isOpen()) return;
    st = status();
    const lock = lockReason();
    const key = JSON.stringify([st.seq, lock, confirm, [...sel], selFile, I18n.language, connState]);
    if (!force && key === render.key) return;
    render.key = key;
    shT.textContent = T(tr('Back up and restore'));
    const top = shB.scrollTop;
    shB.innerHTML = '';
    // Export
    const ex = el('div', 'tb-box');
    ex.appendChild(el('div', 'tb-lbl', T(tr('Back up'))));
    ex.appendChild(el('div', '', T(tr('One file with all vehicles, tools, fields (boundaries, tracks, headland, background image) and NTRIP profiles.'))));
    ex.appendChild(el('div', 'tp-note', T(tr('Not included: the worked area of the jobs and all passwords (NTRIP, AgShare). NTRIP profiles come without their password; on restore a password stored on that device is kept.'))));
    ex.appendChild(el('div', 'tp-note warn', T(tr('The file contains your fields with their positions. Only pass it on to someone you trust.'))));
    const exRow = el('div', 'tb-row');
    const mk = el('button', 'tp-btn pri big', T(tr('Create backup')));
    const busyC = st.op === 'create' && st.busy;
    mk.disabled = connState !== 'connected' || busyC;
    onTap(mk, () => send('backup.create'));
    exRow.appendChild(mk);
    if (busyC) exRow.appendChild(el('span', 'tp-note', T(tr('Creating the file…'))));
    else if (st.op === 'create' && st.err) exRow.appendChild(el('span', 'tp-note bad', errText(st)));
    if (st.file && !(st.op === 'create' && (st.busy || st.err))) {
      const dl = el('button', 'tp-btn', T(tr('Download')) + ' ↓');
      onTap(dl, () => openExternal(location.origin + '/backups/' + encodeURIComponent(st.file)));
      exRow.appendChild(dl);
      const fn = el('div', 'tp-note'); fn.setAttribute('translate', 'no'); fn.textContent = st.file + ' · ' + T(tr('The download opens in the browser and lands in Downloads on this device.'));
      ex.append(exRow, fn);
    } else ex.appendChild(exRow);
    shB.appendChild(ex);

    // Import
    const im = el('div', 'tb-box');
    im.appendChild(el('div', 'tb-lbl', T(tr('Restore'))));
    im.appendChild(el('div', '', T(tr('Copy the backup ZIP by USB into the Import folder, then choose it here:'))));
    const p = el('div', 'tp-note'); p.setAttribute('translate', 'no'); p.textContent = importDir(); im.appendChild(p);
    const lr = el('div', 'tb-row');
    const files = st.list || [];
    for (const f of files) {
      const b = el('button', 'tp-btn' + (f === selFile ? ' pri' : ''), f); b.setAttribute('translate', 'no');
      onTap(b, () => { selFile = f; confirm = false; applySeq = -1; done = null; scrollTo = true; send('backup.preview|' + f); render(true); });
      lr.appendChild(b);
    }
    if (!files.length) lr.appendChild(el('span', 'tp-note', T(tr('No backup in the Import folder.'))));
    const rf = el('button', 'tp-btn quiet', '↻ ' + T(tr('Refresh list'))); onTap(rf, () => send('backup.list'));
    lr.appendChild(rf);
    im.appendChild(lr);
    const resBox = el('div', 'tbk-res'); im.appendChild(resBox); // the import's result, above the list
    const pv = st.preview && st.preview.file === selFile ? st.preview : null;
    if (selFile && st.op === 'preview' && st.busy) im.appendChild(el('div', 'tp-note', T(tr('Checking the backup…'))));
    else if (selFile && st.op === 'preview' && st.err) im.appendChild(el('div', 'tp-note bad', errText(st)));
    else if (pv) {
      const items = pv.items || [];
      // A new preview (another file, or after an import): new and overwriting entries preselected.
      const pvKey = pv.file + JSON.stringify(items);
      if (render.pvKey !== pvKey) { render.pvKey = pvKey; sel = new Set(); items.forEach((x, i) => { if (x.s !== 'same') sel.add(i); }); }
      const tb = el('div', 'tbk-list');
      items.forEach((x, i) => {
        const r = el('button', 'tbk-it ' + x.s + (sel.has(i) ? ' on' : ''));
        r.disabled = x.s === 'same';
        r.appendChild(el('span', 'tbk-ck', sel.has(i) ? '✓' : ''));
        const nm = el('span', 'tbk-nm'); nm.appendChild(el('small', '', T(KIND[x.k] || x.k)));
        const n = el('b', '', x.n); n.setAttribute('translate', 'no'); nm.appendChild(n);
        if (x.c && x.c.length) { const c = el('small', 'tbk-ch', x.c.join(' · ')); c.setAttribute('translate', 'no'); nm.appendChild(c); }
        r.appendChild(nm);
        r.appendChild(el('span', 'tbk-st', T(STATE[x.s] || x.s)));
        onTap(r, () => { if (sel.has(i)) sel.delete(i); else sel.add(i); confirm = false; render(true); });
        tb.appendChild(r);
      });
      im.appendChild(tb);
      const nOver = [...sel].filter(i => items[i] && items[i].s === 'overwrites').length;
      if (lock) im.appendChild(el('div', 'tp-note warn', T(lock)));
      const ar = el('div', 'tb-row');
      const busyA = st.op === 'apply' && st.busy;
      if (!confirm) {
        const go = el('button', 'tp-btn pri big', T(tr('Import selected ({n})')).replace('{n}', sel.size));
        go.disabled = !!lock || !sel.size || busyA;
        onTap(go, () => { confirm = true; render(true); });
        ar.appendChild(go);
      } else {
        im.appendChild(el('div', 'tp-note warn', T(nOver ? tr('{n} entries are overwritten. The current state is saved first.') : tr('The current state is saved first.')).replace('{n}', nOver)));
        const no = el('button', 'tp-btn', T(tr('Cancel'))); onTap(no, () => { confirm = false; render(true); });
        const yes = el('button', 'tp-btn pri big', T(tr('Import now')));
        yes.disabled = !!lock || !sel.size;
        onTap(yes, () => {
          if (lockReason()) { confirm = false; render(true); return; }
          scrollTo = true;
          applySeq = st.seq; confirm = false; done = null;
          send('backup.apply|' + selFile + '\t' + [...sel].sort((a, b) => a - b).join(','));
          render(true);
        });
        ar.append(no, yes);
      }
      im.appendChild(ar);
    }
    // The import's result stays shown while the preview is fetched again.
    if (st.op === 'apply' && applySeq >= 0 && st.seq > applySeq && !st.busy) { done = { err: st.err ? errText(st) : '', applied: st.applied, seq: st.seq }; applySeq = -1; }
    if (done) {
      if (done.err) resBox.appendChild(el('div', 'tp-note bad', done.err));
      else if (done.applied) {
        resBox.appendChild(el('div', 'tp-note', T(tr('Imported: {n} entries.')).replace('{n}', (done.applied.written || []).length)));
        for (const n of done.applied.needPassword || []) resBox.appendChild(el('div', 'tp-note warn', T(tr('Enter the password for NTRIP profile {n} again (Setup → Network & GPS).')).replace('{n}', n)));
        const ab = el('div', 'tb-row');
        const fn = el('span', 'tp-note', T(tr('Saved before the import:')) + ' ' + done.applied.auto); ab.appendChild(fn);
        const dl = el('button', 'tp-btn', T(tr('Download')) + ' ↓');
        onTap(dl, () => openExternal(location.origin + '/backups/' + encodeURIComponent(done.applied.auto)));
        ab.appendChild(dl); resBox.appendChild(ab);
        if (render.donePv !== done.seq) { render.donePv = done.seq; send('backup.preview|' + selFile); }
      }
    }
    shB.appendChild(im);
    shB.scrollTop = top;
    // At 1024×600 the restore part sits below the fold: bring it up once the preview is there.
    if (scrollTo && (pv || (st.op === 'preview' && st.err))) { scrollTo = false; im.scrollIntoView({ block: 'start' }); }
  }
  setInterval(() => render(false), 300);
  setInterval(() => { if (isOpen() && TabletTerminal.mode !== 'setup') close(); }, 500);

  // --- Menu tile (setup) --------------------------------------------------------------------
  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16v13H4z"/><path d="M8 7V4h8v3M12 10v6M9 13l3 3 3-3"/></svg>';
  setInterval(() => {
    const m = document.getElementById('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const s = m.querySelector('.tui-tiles.tui-s'); if (!s || s.querySelector('[data-tile="tbk"]')) return;
    const t = el('button', 'tui-tile setup'); t.dataset.tile = 'tbk'; t.innerHTML = IC + '<span></span>';
    t.querySelector('span').textContent = T(tr('Back up and restore'));
    onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) x.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); open(); });
    s.appendChild(t);
  }, 300);
  return { open, get state() { return status(); }, get selection() { return [...sel]; } };
})();

// ===== Ready-to-steer light (feature/bedienung-1) =============================================
// A traffic light in the status bar, left of the steer chip: display only, from states the
// client already has; it never sends a command and the steering logic is untouched.
// Red = something steering needs is missing (no data, no RTK fix as the host reports it, steer
// module not heard, no line). Yellow = steering works but check first: no IMU heard, or with one
// antenna the direction not yet confirmed on the card "Does the vehicle face the way it drives?"
// (TabletSteerConfirm; driving forward can't be told from backing with one antenna, so only the
// confirmation counts). The module flags are the host's own (gpsOk / autoSteerOk / imuOk); RTK
// fix = NMEA fix quality 4, the host's default minimum (MinFixQuality, not sent to the client).
// Tap it for the list. In the demo mode (TabletDemo) it says "Demo" instead.
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
  // [level, label, detail]: level 2 = ok, 1 = check, 0 = missing.
  function checks() {
    const s = statusBar || {}, op = tick && tick.op, gps = config && config.gps;
    if (!live()) return [[0, tr('Connection'), connState === 'connected' ? tr('No current data from the guidance computer.') : tr('No connection to the guidance computer.')]];
    const out = [];
    if (s.gpsSentence === 'SIM') out.push([1, tr('GPS'), tr('Simulator: not a real position')]);
    else if (s.gpsLost || !s.gpsOk) out.push([0, tr('GPS'), tr('No GPS data')]);
    else out.push([s.fixQuality === 4 ? 2 : 0, tr('GPS'), (s.fixText || '') + (s.fixQuality === 4 ? '' : ' – ' + T(tr('steering needs RTK Fix')))]);
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
    const key = JSON.stringify([demo, cs, pop.hidden, I18n.language, T(word)]); // T(word): the dictionary may arrive after the language
    if (key === last) return;
    last = key;
    pill.dataset.lv = demo ? 'demo' : String(lvl);
    pill.querySelector('.rd-t').textContent = T(word);
    pill.title = T(tr('Ready to steer'));
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
  return { checks, get level() { return Math.min(...checks().map(c => c[0])); } };
})();

// ===== Demo mode (feature/bedienung-1) ========================================================
// For showing the app: the existing simulator as the GPS source, with a striped "DEMO" band that
// can't be missed. It only starts while no module is heard (GPS, steer, machine): with a module
// on the network a simulated drive could switch real outputs (the host sends steer and section
// PGNs in the simulator too). If a module turns up while it runs, the demo ends with a warning
// to check steering and sections. Stops with "End demo"; the flag lives in this tab only.
// Ending never sends a command that switches steering or sections: the host only has toggles
// for them (autosteer.toggle, section.master, section.manual), and a toggle sent from a stale
// tick could switch them on. Explicit off commands would need a host change (docs/).
// demo:begin
const TabletDemo = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); fn(e); });
  const KEY = 'aow.demo';
  let active = false, simBefore = false; // simBefore: the simulator was already on; ending leaves it on
  try { const v = sessionStorage.getItem(KEY); active = !!v; simBefore = v === 'sim'; } catch (_) { /* blocked storage: off */ }
  const band = el('div'); band.id = 'tui-demo'; band.hidden = true; band.setAttribute('translate', 'no');
  band.addEventListener('pointerdown', e => e.stopPropagation());
  const bt = el('span', 'dm-t'), stop = el('button', 'tp-btn');
  band.append(bt, stop);
  document.body.appendChild(band);
  onTap(stop, () => end(''));
  const save = () => { try { if (active) sessionStorage.setItem(KEY, simBefore ? 'sim' : '1'); else sessionStorage.removeItem(KEY); } catch (_) { /* ignore */ } };
  // Real GPS = data that isn't the simulator's (as TabletSimGuard); steer and machine modules by the host's flags.
  const modules = () => { const s = statusBar || {}; return !!((s.gpsOk && s.gpsSentence && s.gpsSentence !== 'SIM') || s.autoSteerOk || s.machineOk); };
  function start() {
    if (connState !== 'connected' || !statusBar) { showToast(T(tr('No connection to the guidance computer.'))); return; }
    if (!iHoldControl) { showToast(T(tr('Only the device that has control can start the demo.'))); return; }
    if (modules()) { showToast(T(tr('A module is connected: the demo only runs without modules, so nothing real is switched.'))); return; }
    active = true; simBefore = !!statusBar.simEnabled; save();
    if (!statusBar.simEnabled) transport.send('sim.toggleEnable');
    if (!statusBar.simPanelVisible) transport.send('sim.togglePanel');
    render();
  }
  function end(why) {
    if (!active) return;
    if (statusBar && statusBar.simEnabled && !simBefore) transport.send('sim.toggleEnable');
    active = false; save();
    if (why) showToast(T(why), 15000);
    render();
  }
  function render() {
    // A module heard while the demo runs: end at once and tell the operator to check.
    if (active && connState === 'connected' && modules()) end(tr('Demo ended – kit detected. Check steering and sections.'));
    if (band.hidden === active) band.hidden = !active;
    document.documentElement.toggleAttribute('data-tui-demo', active);
    if (!active) return;
    bt.textContent = T(tr('DEMO – simulator only, no real outputs'));
    stop.textContent = T(tr('End demo'));
  }
  setInterval(render, 250);

  // --- Menu tile (setup) --------------------------------------------------------------------
  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M10 8l4 2-4 2z" fill="currentColor"/><path d="M8 20h8M12 16v4"/></svg>';
  setInterval(() => {
    const m = document.getElementById('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const s = m.querySelector('.tui-tiles.tui-s'); if (!s) return;
    let t = s.querySelector('[data-tile="demo"]');
    if (!t) {
      t = el('button', 'tui-tile setup'); t.dataset.tile = 'demo'; t.innerHTML = IC + '<span></span>';
      onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) x.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); if (active) end(''); else start(); });
      s.appendChild(t);
    }
    const lbl = T(active ? tr('End demo') : tr('Demo mode'));
    if (t.querySelector('span').textContent !== lbl) t.querySelector('span').textContent = lbl;
  }, 300);
  return { start, end, get active() { return active; } };
})();
// demo:end

// ===== Long press = explanation (feature/bedienung-2) =========================================
// Holding one of the main buttons or tiles for LONG_MS shows a short explanation instead of
// acting. A short press acts as before, only on release: the press is held back (capture phase)
// and given to the button when the finger lifts, so a long press never switches anything.
// Texts describe what the button does today (from the help and the buttons' own titles).
// Not here, on purpose: buttons that switch steering, sections, U-turn, the headland (hydraulic
// lift), the track or the demo (it switches the simulator). They act at once on touch, as before;
// their explanation is in the help ("Buttons that act at once").
// explain:begin
const TabletExplain = (() => {
  const T = k => I18n.text(k);
  const LONG_MS = 600, MOVE_PX = 12;
  const TEXT = [
    ['#bn-tracks', tr('Tracks: manage the AB lines and curves of this field.')],
    ['#bn-quickab', tr('Quick AB line: makes a track quickly, e.g. "A+" through your position in the direction you drive.')],
    ['#bn-abmenu', tr('AB line options: more ways to make and edit tracks.')],
    ['#bn-delcontours', tr('Deletes the recorded contour paths.')],
    ['#bn-nudge', tr('Shows how far the track is moved sideways. Tap to set it back to 0.')],
    ['#bn-skipcycle', tr('U-turn skip rows: tap to choose how many rows (0–9) each U-turn skips.')],
    ['#bn-skiptoggle', tr('U-turn skip mode: normal, alternative, or skip worked tracks.')],
    ['#bn-flags', tr('Flags: set a marker at your position or on the map, and see the list.')],
    ['#bn-tram', tr('Tram lines: changes how the tram lines are shown.')],
    ['#tui-menu-btn', tr('Menu: fields and jobs, field tools, help and setup.')],
    ['#tui-sb-steer', tr('Steering status: on, off, no line, or a fault such as "Not steering".')],
    ['#tui-sb-ready', tr('Ready to steer: green = all set, yellow = check first, red = something steering needs is missing. Tap for the list.')],
    ['#sb-fixbtn', tr('GPS: the fix quality. Solid frame = RTK Fix, dashed = RTK Float, dotted = DGPS/GPS. Tap for details.')],
    ['#sb-modbtn', tr('Modules: whether the steer, machine and GPS modules are heard. Tap for details.')],
    ['#sb-fs', tr('Fullscreen on or off.')],
    ['[data-tile="ln-fieldops"]', tr('Fields and Jobs: open, create or import a field, and start or resume a job.')],
    ['[data-tile="ln-fieldtools"]', tr('Field Tools: boundary, headland, flags and other tools for the open field.')],
    ['[data-tile="pages"]', tr('Work pages: choose which displays each page shows.')],
    ['[data-tile="quick"]', tr('Quick bar: choose the buttons in the quick bar.')],
    ['[data-tile="ln-vehicle"]', tr('Vehicle & Tool: profiles and dimensions of the vehicle and the tool.')],
    ['[data-tile="ln-autosteer"]', tr('AutoSteer: settings of the steering and the steer module.')],
    ['[data-tile="ln-network"]', tr('Network & GPS: modules, GPS receiver and NTRIP.')],
    ['[data-tile="ln-tools"]', tr('Tools & Wizards: setup assistants and calibration.')],
    ['[data-tile="ln-screenalerts"]', tr('Screen & Alerts: display and alarm settings.')],
    ['[data-tile="ln-filemenu"]', tr('App & Files: app settings, folders and files.')],
    ['[data-tile="language"]', tr('Language of the app.')],
    ['[data-tile="tb-help"]', tr('Help: short guides for the main tasks.')],
    ['[data-tile="tb-info"]', tr('Info: version, licence and source of this app.')],
    ['[data-tile="tb-diag"]', tr('Diagnosis for support: a file with the state of this system to send to support.')],
    ['[data-tile="tbk"]', tr('Back up and restore: one file with vehicles, tools, fields and NTRIP profiles.')],
    ['[data-tile="eama"]', tr('Fields from eAMA: import field boundaries from an eAMA Shapefile export.')],
    ['[data-tile="work"]', tr('Start work: step by step to field, track, direction and the ready light.')],
    ['[data-tile="setup1"]', tr('First setup: language, vehicle, tool, NTRIP, kit check and the direction trap.')],
  ];
  const SEL = TEXT.map(t => t[0]).join(',');
  const textFor = node => { for (const [s, t] of TEXT) if (node.matches(s)) return t; return null; };
  const pop = document.createElement('div'); pop.id = 'tui-explain'; pop.hidden = true; pop.setAttribute('translate', 'no');
  document.body.appendChild(pop);
  let press = null, swallowClick = false, hideAt = 0;

  function show(node, text) {
    pop.textContent = T(text);
    pop.hidden = false;
    const r = node.getBoundingClientRect(), w = Math.min(360, window.innerWidth - 20);
    pop.style.maxWidth = w + 'px';
    const ph = pop.offsetHeight, pw = pop.offsetWidth;
    let x = Math.min(Math.max(10, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 10);
    let y = r.bottom + 8; if (y + ph > window.innerHeight - 10) y = Math.max(10, r.top - ph - 8);
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
    hideAt = performance.now() + 8000;
  }
  setInterval(() => { if (!pop.hidden && performance.now() > hideAt) pop.hidden = true; }, 500);

  window.addEventListener('pointerdown', e => {
    if (e.__aowReplay || !e.isTrusted) return; // code that presses a button for the operator acts at once
    if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true;
    const node = e.target instanceof Element ? e.target.closest(SEL) : null;
    if (!node || node.disabled) return;
    e.stopImmediatePropagation();
    const init = { bubbles: true, cancelable: true, composed: true, clientX: e.clientX, clientY: e.clientY,
      pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary, button: e.button, buttons: e.buttons };
    press = { node, x: e.clientX, y: e.clientY, init, timer: setTimeout(() => {
      const t = textFor(node); press = null; swallowClick = true; if (t) show(node, t);
    }, LONG_MS) };
  }, true);
  const release = (e, act) => {
    if (!press) return;
    clearTimeout(press.timer);
    const p = press; press = null;
    if (!act) return;
    const ev = new PointerEvent('pointerdown', p.init); ev.__aowReplay = true;
    p.node.dispatchEvent(ev);
  };
  window.addEventListener('pointerup', e => { if (swallowClick) setTimeout(() => { swallowClick = false; }, 400); release(e, true); }, true);
  window.addEventListener('pointercancel', e => release(e, false), true);
  window.addEventListener('pointermove', e => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_PX) release(e, false); }, true);
  window.addEventListener('click', e => { if (swallowClick) { swallowClick = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  window.addEventListener('contextmenu', e => { if (e.target instanceof Element && e.target.closest(SEL)) e.preventDefault(); }, true);
  return { show };
})();
// explain:end

// ===== Start work (feature/bedienung-2) =======================================================
// One button that walks through: field → track → direction → ready light, then the drive view.
// Each step only opens what exists (Fields and Jobs, the track manager, the direction card's
// own two answers) and moves on by itself when the state is there. It finishes only on a green
// ready light and never switches steering on: that stays the operator's Steer button.
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
      btn(tr('Quick AB line'), () => { park(); const q = document.getElementById('bn-quickab'); if (q) q.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); });
    } else if (step.k === 'dir') {
      btn(tr('Yes'), () => { TabletSteerConfirm.confirm(); render(); }, true);
      btn(tr('No – learn the direction again'), () => {
        if (!iHoldControl) { showToast(T(tr('Take control to reset the direction'))); return; }
        transport.send('heading.resetDirection'); showToast(T(tr('Direction reset. Drive forward above 1.5 kph.')));
      });
    } else if (step.k === 'ready') {
      btn(tr('Show the list'), () => { park(); const r = document.getElementById('tui-sb-ready'); if (r) r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); }, true);
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
    const key = JSON.stringify([running, isOpen(), ss.map(s => [s.done, s.v]), I18n.language, iHoldControl]);
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
    const f = m.querySelector('.tui-tiles.tui-f'); if (!f || f.querySelector('[data-tile="work"]')) return;
    const t = el('button', 'tui-tile field'); t.dataset.tile = 'work'; t.innerHTML = IC + '<span></span>';
    t.querySelector('span').textContent = T(tr('Start work'));
    onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) x.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); start(); });
    f.insertBefore(t, f.firstChild);
  }, 300);
  return { start };
})();

// ===== First setup (feature/bedienung-2) ======================================================
// A guide through the first setup: language, vehicle, tool and working width (the existing
// profile cards and their wizard, TabletProfiles), NTRIP (Network & GPS), a live kit check
// (modules, GPS, IMU as the ready light sees them; the bench checklist for more) and the
// direction trap. It enters no values itself: everything is typed in the existing dialogs, an
// empty field stays empty. Shown by itself once, while no vehicle profile exists (on the device
// that has control), skippable at every step, and again any time from the menu ("First setup").
const TabletFirstSetup = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const KEY = 'aow.firstSetup';
  const lsOk = () => { try { return localStorage.getItem(KEY); } catch (_) { return 'blocked'; } };
  const mark = v => { try { localStorage.setItem(KEY, v); } catch (_) { /* ignore */ } };
  const sheet = el('div', 'tui-sheet tb-sheet tbk-sheet'); sheet.id = 'tui-setup1'; sheet.setAttribute('translate', 'no');
  sheet.innerHTML = '<div class="tui-sh-hdr"><span class="t"></span><button class="x">✕</button></div><div class="tui-sh-body"></div>';
  const scrim = el('div', 'tp-scrim');
  document.body.append(scrim, sheet);
  for (const n of [sheet, scrim]) n.addEventListener('pointerdown', e => e.stopPropagation());
  const shT = sheet.querySelector('.t'), shB = sheet.querySelector('.tui-sh-body');
  let step = 0, last = '';
  const isOpen = () => sheet.classList.contains('open');
  const hide = () => { sheet.classList.remove('open'); scrim.classList.remove('open'); };
  const close = () => { hide(); mark('done'); };
  onTap(sheet.querySelector('.x'), close); onTap(scrim, close);
  function open(at) {
    if (typeof lnCloseAll === 'function') lnCloseAll();
    if (typeof at === 'number') step = at;
    sheet.classList.add('open'); scrim.classList.add('open'); last = ''; render();
  }
  // Open an existing panel; the guide waits in the background and comes back with "Back to setup".
  const goPanel = id => { hide(); TabletTerminal.setMode('setup'); const b = document.getElementById(id); if (b) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); showBack(); };
  const back = el('button', 'tp-btn pri'); back.id = 'tui-setup1-back'; back.hidden = true; document.body.appendChild(back);
  back.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); back.hidden = true; open(); });
  function showBack() { back.textContent = '↩ ' + T(tr('Back to first setup')); back.hidden = false; }

  const STEPS = [
    { k: 'lang', t: tr('Language') },
    { k: 'vehicle', t: tr('Vehicle profile') },
    { k: 'tool', t: tr('Tool and working width') },
    { k: 'ntrip', t: tr('NTRIP') },
    { k: 'kit', t: tr('Check the kit') },
    { k: 'dir', t: tr('The direction trap') },
  ];
  const lv = l => l === 2 ? '✓' : l === 1 ? '!' : '✗';
  function body(s, box) {
    const note = t => box.appendChild(el('div', 'tp-note', T(t)));
    const row = el('div', 'tb-row'), btn = (label, fn, pri) => { const b = el('button', 'tp-btn' + (pri ? ' pri' : ''), T(label)); onTap(b, fn); row.appendChild(b); return b; };
    if (s.k === 'lang') {
      const cur = appInfo ? appInfo.currentLanguage : '';
      for (const l of (appInfo ? appInfo.languages : [])) {
        const b = el('button', 'tp-btn' + (l.code === cur ? ' pri' : ''), l.name);
        onTap(b, () => transport.send('app.setLanguage|' + l.code)); row.appendChild(b);
      }
    } else if (s.k === 'vehicle') {
      note(tr('Choose or create the profile of your tractor. The profile wizard asks for the dimensions; measure them, nothing is filled in for you.'));
      const v = config && config.vehicle;
      if (v) note(T(tr('Wheelbase')) + ': ' + (v.wheelbase > 0 ? fmtUnit(v.wheelbase, 'm') : '—'));
      btn(tr('Vehicle & Tool'), () => { hide(); TabletProfiles.open(); showBack(); }, true);
    } else if (s.k === 'tool') {
      note(tr('Choose or create the profile of your tool. The working width comes from its sections.'));
      const tw = typeof sectionsWidthM === 'function' ? sectionsWidthM() : 0;
      note(T(tr('Working width')) + ': ' + (tw > 0 ? fmtUnit(tw, 'm') : '—'));
      btn(tr('Vehicle & Tool'), () => { hide(); TabletProfiles.open(); showBack(); }, true);
    } else if (s.k === 'ntrip') {
      note(tr('For RTK corrections over the internet: an NTRIP profile with caster, port, mount point, user and password from your provider (e.g. APOS).'));
      const sb = statusBar || {};
      note(T(tr('NTRIP')) + ': ' + (sb.ntripConnected ? T(tr('connected')) : sb.ntripStatus ? T(sb.ntripStatus) : '—'));
      btn(tr('Network & GPS'), () => goPanel('ln-network'), true);
    } else if (s.k === 'kit') {
      note(tr('Power on the kit and connect it. The list follows live.'));
      const list = el('div', 'fs1-list');
      const KIT = [tr('Connection'), tr('GPS'), tr('Steer module'), tr('IMU')]; // line and direction belong to the work, not the kit
      for (const [l, k, v] of TabletReady.checks().filter(c => KIT.includes(c[1]))) {
        const r = el('div', 'fs1-r'); r.dataset.lv = String(l);
        r.append(el('span', 'fs1-i', lv(l)), el('span', 'fs1-k', T(k)), el('span', 'fs1-v', T(v)));
        list.appendChild(r);
      }
      box.appendChild(list);
      btn(tr('Network & GPS'), () => goPanel('ln-network'));
      if (typeof TabletBench !== 'undefined') btn(tr('Bench checklist'), () => { hide(); TabletBench.open(); showBack(); });
    } else if (s.k === 'dir') {
      for (const t of [
        tr('With one antenna the system learns which way the vehicle faces from the first travel.'),
        tr('If you back up first (e.g. out of the shed), it learns the direction the wrong way round: the steering then runs for the wrong direction.'),
        tr('After every start, drive forward first or confirm the direction on the card ("Does the vehicle face the way it drives?").'),
        tr('The ready light stays yellow until the direction is confirmed.'),
      ]) note(t);
    }
    if (row.children.length) box.appendChild(row);
  }
  function render() {
    if (!isOpen()) return;
    const s = STEPS[step];
    const key = JSON.stringify([step, I18n.language, appInfo && appInfo.currentLanguage, s.k === 'kit' ? TabletReady.checks() : 0,
      s.k === 'ntrip' ? [statusBar && statusBar.ntripConnected, statusBar && statusBar.ntripStatus] : 0, s.k === 'tool' && typeof sectionsWidthM === 'function' ? sectionsWidthM() : 0,
      s.k === 'vehicle' && config && config.vehicle ? config.vehicle.wheelbase : 0]);
    if (key === last) return;
    last = key;
    shT.textContent = T(tr('First setup')) + ' · ' + (step + 1) + '/' + STEPS.length;
    shB.innerHTML = '';
    const box = el('div', 'tb-box');
    box.appendChild(el('div', 'tb-lbl', T(s.t)));
    body(s, box);
    const nav = el('div', 'tb-row');
    const prev = el('button', 'tp-btn', '← ' + T(tr('Back'))); prev.disabled = step === 0; onTap(prev, () => { step--; last = ''; render(); });
    const next = el('button', 'tp-btn pri big', step === STEPS.length - 1 ? T(tr('Finish')) : T(tr('Next')) + ' →');
    onTap(next, () => { if (step === STEPS.length - 1) { close(); return; } step++; last = ''; render(); });
    const skip = el('button', 'tp-btn quiet', T(tr('Skip setup'))); onTap(skip, close);
    nav.append(prev, next, skip);
    box.appendChild(nav);
    box.appendChild(el('div', 'tp-note', T(tr('You can open the first setup again any time: Menu → First setup.'))));
    shB.appendChild(box);
  }
  setInterval(render, 500);
  // First start on this device: once, on the device that has control, not during a demo.
  const auto = setInterval(() => {
    if (lsOk() || navigator.webdriver) { clearInterval(auto); return; } // not in automated browsers (CI layout check)
    // Only while no vehicle profile exists yet (the profile list the client already has).
    if (profiles && profiles.vehicles && profiles.vehicles.length) { clearInterval(auto); return; }
    let legal = true; try { legal = TabletLegal.done; } catch (_) { legal = false; } // the notice at first start comes first
    if (legal && connState === 'connected' && iHoldControl && appInfo && config && profiles && !(typeof TabletDemo !== 'undefined' && TabletDemo.active)) {
      clearInterval(auto); mark('shown'); open(0);
    }
  }, 1000);

  // --- Menu tile (setup) ----------------------------------------------------------------------
  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16M6 16l9-9 3 3-9 9H6z"/><path d="M13 9l3 3"/></svg>';
  setInterval(() => {
    const m = document.getElementById('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const sBox = m.querySelector('.tui-tiles.tui-s'); if (!sBox || sBox.querySelector('[data-tile="setup1"]')) return;
    const t = el('button', 'tui-tile setup'); t.dataset.tile = 'setup1'; t.innerHTML = IC + '<span></span>';
    t.querySelector('span').textContent = T(tr('First setup'));
    onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) x.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); open(0); });
    sBox.insertBefore(t, sBox.firstChild);
  }, 300);
  return { open };
})();

// ===== Update check (feature/auslieferung) ====================================================
// Asks GitHub for the releases of this fork (BRAND.source) and says whether a newer one exists:
// a hint with a link, nothing is downloaded or installed. Runs from the browser (GitHub's API
// allows any origin), so the host is not involved; it needs internet on this device. "Newer" is
// only claimed when this build's commit (appInfo.gitHash) is itself one of the releases and a
// later one exists; otherwise the newest release is shown without comparing. On demand (Info) or
// at start, if switched on for this device.
// update:begin
const TabletUpdate = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const KEY = 'aow.update.onStart';
  const api = () => BRAND.source.replace('https://github.com/', 'https://api.github.com/repos/') + '/releases?per_page=30';
  let state = { busy: false, res: null };
  const onStart = () => { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } };

  // releases (GitHub JSON) + this build's hash → { kind: 'newer'|'current'|'unknown', latest, mine }
  function compare(releases, hash) {
    const list = (releases || []).filter(r => r && !r.draft && r.published_at)
      .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
    if (!list.length) return { kind: 'none' };
    const h = String(hash || '').replace(/-dirty$/, '').toLowerCase();
    const mine = h.length >= 7 ? list.find(r => String(r.target_commitish || '').toLowerCase().startsWith(h)) : null;
    const latest = list[0];
    if (!mine) return { kind: 'unknown', latest };
    return { kind: mine === latest ? 'current' : 'newer', latest, mine };
  }
  async function check() {
    state = { busy: true, res: null }; refresh();
    try {
      const r = await fetch(api(), { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      state = { busy: false, res: compare(await r.json(), appInfo && appInfo.gitHash) };
    } catch (e) { state = { busy: false, res: { kind: 'error', why: String(e && e.message || e) } }; }
    refresh();
    return state.res;
  }
  let host = null;
  function refresh() { if (host && host.isConnected) fill(host); }
  const day = s => { try { return new Date(s).toLocaleDateString(I18n.language || undefined); } catch (_) { return s; } };
  function fill(b) {
    b.innerHTML = '';
    b.appendChild(el('div', 'tb-lbl', T(tr('Updates'))));
    const r = state.res;
    if (state.busy) b.appendChild(el('div', 'tp-note', T(tr('Checking GitHub…'))));
    else if (r && r.kind === 'error') b.appendChild(el('div', 'tp-note warn', tr('No answer from GitHub ({f}). Internet on this device?', { f: r.why })));
    else if (r && r.kind === 'none') b.appendChild(el('div', 'tp-note', T(tr('No release published yet.'))));
    else if (r) {
      const L = r.latest, name = L.name || L.tag_name;
      const txt = r.kind === 'newer' ? tr('A newer version is available: {n} ({d}).', { n: name, d: day(L.published_at) })
        : r.kind === 'current' ? tr('This is the newest version ({n}).', { n: name })
          : tr('Newest published version: {n} ({d}). This build is not one of the published ones, so it is not compared.', { n: name, d: day(L.published_at) });
      b.appendChild(el('div', 'tp-note' + (r.kind === 'newer' ? ' warn' : ''), txt));
      if (r.kind !== 'current') {
        const a = el('button', 'tp-btn', T(tr('Open the release page')) + ' ↗'); onTap(a, () => openExternal(L.html_url)); b.appendChild(a);
      }
      b.appendChild(el('div', 'tp-note', T(tr('Installing stays with you: download and install the new version yourself.'))));
    }
    const row = el('div', 'tb-row');
    const go = el('button', 'tp-btn pri', T(tr('Check for updates'))); go.disabled = state.busy; onTap(go, check); row.appendChild(go);
    const tg = el('button', 'tp-btn' + (onStart() ? ' pri' : ''), (onStart() ? '✓ ' : '') + T(tr('Check at start')));
    onTap(tg, () => { try { localStorage.setItem(KEY, onStart() ? '0' : '1'); } catch (_) { /* ignore */ } refresh(); });
    row.appendChild(tg);
    b.appendChild(row);
  }
  function box() { host = el('div', 'tb-box'); fill(host); return host; }
  // At start (opt-in): once appInfo is there; only a newer version is announced.
  const auto = setInterval(() => {
    if (!onStart()) { clearInterval(auto); return; }
    if (!appInfo) return;
    clearInterval(auto);
    check().then(r => { if (r && r.kind === 'newer') showToast(T(tr('A newer version is available: {n} ({d}).', { n: r.latest.name || r.latest.tag_name, d: day(r.latest.published_at) })) + ' ' + T(tr('Setup → Info')), 8000); });
  }, 1000);
  return { check, box, compare };
})();
// update:end

// ===== Notice at first start (feature/auslieferung) ===========================================
// The liability notice from docs/Rechtliches-Entwurf.md (section A, a DRAFT, not legally checked),
// shown once per device and text version until "Read and understood". Stored only in this
// browser. It switches nothing; the first setup waits for it.
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
  const t = setInterval(() => {
    if (done) { clearInterval(t); return; }
    if (typeof I18n !== 'undefined' && appInfo) { clearInterval(t); show(); }
  }, 500);
  return { get done() { return done || acked(); }, show };
})();
