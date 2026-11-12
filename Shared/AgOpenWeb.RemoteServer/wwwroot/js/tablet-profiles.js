// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: vehicle and tool profiles, their wizard and sketches (TabletProfiles).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

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
    const k = id + '|' + (id === 'sections' ? W.nSec.inp.value + W.widths.map(w => w.inp.value).join(',') : id === 'hitch' || id.startsWith('tool:') ? W.type.cur : '') + '|' + tuiLang();
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
      const k = JSON.stringify([profiles, sel, msg, lockReason(), config && config.tool && config.tool.totalWidth, config && config.vehicle && config.vehicle.type, tuiLang(), !!pending]);
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
        onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) tuiPress(x); open(); });
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
    const k = t.type + '|' + dlgFocus + '|' + (config.vehicle ? config.vehicle.hitchLength : '') + '|' + tuiLang();
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
    const k = v.toFixed(3) + '|' + tuiLang();
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
