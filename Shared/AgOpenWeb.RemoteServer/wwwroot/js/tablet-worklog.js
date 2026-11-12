// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: work log (WorkLogCore, TabletWorkLog).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

// ===== Work log (feature/arbeitsdoku) =========================================================
// One entry per working session: from the moment this device (holding control) sees a job open
// on a field until the job closes, the field changes or the connection is gone. The numbers are
// the host's: worked area of the job (Status.workedAreaSqM), ground covered once
// (fieldData.actualAreaSqM), trip distance (fieldData.tripDistanceM), each at the start and at
// the end of the session; the session's own share is the difference. Times are this tablet's
// clock. Activity, product, amount and note are free text the operator types. Kept in this
// browser (localStorage) and on the guidance computer (/worklog, WorkLog/worklog.json), merged by
// entry id: the later change wins (mod, then end), a deleted id stays deleted (host-paket B). The
// pure part (step, merge, csv, sums) is tested by Tests/web/worklog.test.mjs.
// worklog:begin
const WorkLogCore = (() => {
  const GAP_MS = 5 * 60 * 1000; // a reload or a short drop within this continues the session
  const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
  // state: { entries: [...], open: entry|null }; s: snapshot of what the client sees; now: ms.
  function step(state, s, now) {
    const st = { entries: state.entries, open: state.open, deleted: state.deleted || [] };
    const active = !!(s && s.live && s.control && s.field && s.job);
    const o = st.open;
    if (o && (!active || o.field !== s.field || o.job !== s.job || now - o.seenAt > GAP_MS)) {
      // Closed because the job or field was closed or changed (not a lost link or control):
      // the host's job end can stand in for this tablet's clock (ended()).
      const byJob = !!(s && s.live && s.control) && now - o.seenAt <= GAP_MS && (!s.field || !s.job || o.field !== s.field || o.job !== s.job);
      st.entries = st.entries.concat([{ ...o, open: false, byJob }]); st.open = null;
    }
    if (!active) return st;
    const vals = { worked: num(s.worked), actual: num(s.actual), trip: num(s.trip) };
    if (!st.open) {
      st.open = { id: 'w' + now.toString(36) + Math.random().toString(36).slice(2, 6), field: s.field, job: s.job,
        workType: s.workType || '', start: now, end: now, seenAt: now,
        workedStart: vals.worked, workedEnd: vals.worked, actualStart: vals.actual, actualEnd: vals.actual,
        tripStart: vals.trip, tripEnd: vals.trip, tool: s.tool || '', vehicle: s.vehicle || '', widthM: num(s.widthM),
        // A job newly started on the host while this tablet watched: its start is the host's.
        hostStart: s.jobNew && num(s.jobStart) > 0 ? s.jobStart : null, hostEnd: null,
        activity: '', product: '', amount: '', note: '', open: true };
      return st;
    }
    const e = { ...st.open, end: now, seenAt: now };
    if (vals.worked != null) { if (e.workedStart == null) e.workedStart = vals.worked; e.workedEnd = vals.worked; }
    if (vals.actual != null) { if (e.actualStart == null) e.actualStart = vals.actual; e.actualEnd = vals.actual; }
    if (vals.trip != null) { if (e.tripStart == null) e.tripStart = vals.trip; e.tripEnd = vals.trip; }
    if (num(s.widthM) != null) e.widthM = s.widthM;
    if (s.tool) e.tool = s.tool;
    if (s.vehicle) e.vehicle = s.vehicle;
    if (s.workType) e.workType = s.workType;
    st.open = e;
    return st;
  }
  // Session share of a host counter; null when it went down during the session (area deleted,
  // trip reset): then only the host's job totals are shown, nothing is made up.
  const delta = (a, b) => a == null || b == null || b < a ? null : b - a;
  const sessionArea = e => delta(e.workedStart, e.workedEnd);
  const overlap = e => e.workedEnd != null && e.actualEnd != null && e.workedEnd >= e.actualEnd ? e.workedEnd - e.actualEnd : null;
  // Host-paket C: the host's job start and end (Job.StartedAt / EndedAt) where they mark this
  // session's start or end, else this tablet's clock; both from one clock if they disagree.
  function ended(e, job) {
    if (!e.byJob || e.hostEnd != null || !job || !(num(job.endedMs) > 0)) return e;
    return { ...e, hostEnd: job.endedMs, byJob: false };
  }
  const hostOk = e => (e.hostEnd != null ? e.hostEnd : e.end) >= (e.hostStart != null ? e.hostStart : e.start);
  const t0 = e => e.hostStart != null && hostOk(e) ? e.hostStart : e.start;
  const t1 = e => e.hostEnd != null && hostOk(e) ? e.hostEnd : e.end;
  const season = e => new Date(t0(e)).getFullYear();
  function sums(entries) {
    const out = new Map();
    for (const e of entries) {
      const k = e.field + '\u0000' + season(e);
      const r = out.get(k) || { field: e.field, season: season(e), count: 0, ms: 0, areaSqM: 0, areaMissing: 0 };
      r.count++; r.ms += Math.max(0, t1(e) - t0(e));
      const a = sessionArea(e); if (a == null) r.areaMissing++; else r.areaSqM += a;
      out.set(k, r);
    }
    return [...out.values()].sort((a, b) => a.field.localeCompare(b.field) || b.season - a.season);
  }
  // CSV for Excel: ";" between fields, German decimal comma, UTF-8 with BOM, CRLF. Areas in ha
  // with 2 decimals and distance in m without decimals, as the app shows them.
  const p2 = n => String(n).padStart(2, '0');
  const dDate = ms => { const d = new Date(ms); return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear(); };
  const dTime = ms => { const d = new Date(ms); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const dur = ms => { const m = Math.round(Math.max(0, ms) / 60000); return Math.floor(m / 60) + ':' + p2(m % 60); };
  const ha = m2 => m2 == null ? '' : (m2 * 0.0001).toFixed(2).replace('.', ',');
  const metres = m => m == null ? '' : m.toFixed(0);
  const widthTxt = w => w == null ? '' : w.toFixed(2).replace('.', ',');
  const cell = v => { const t = String(v == null ? '' : v); return /[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  function csv(entries, head) {
    const rows = [head];
    for (const e of entries) rows.push([e.field, e.job, e.workType, dDate(t0(e)), dTime(t0(e)), dTime(t1(e)), dur(t1(e) - t0(e)),
      ha(sessionArea(e)), ha(e.workedEnd), ha(e.actualEnd), ha(overlap(e)), metres(delta(e.tripStart, e.tripEnd)),
      e.tool, widthTxt(e.widthM), e.vehicle, e.activity, e.product, e.amount, e.note]);
    return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
  }
  // Same rule as WorkLogStore.Merge on the host: union by id, the later change wins, deleted
  // ids removed, open sessions not taken (each device keeps its own until it closes).
  function merge(a, b) {
    const deleted = [...new Set([...(a.deleted || []), ...(b.deleted || [])].filter(x => typeof x === 'string' && x))].sort();
    const gone = new Set(deleted), byId = new Map();
    const newer = (x, y) => (num(x.mod) || 0) !== (num(y.mod) || 0) ? (num(x.mod) || 0) > (num(y.mod) || 0) : (num(x.end) || 0) > (num(y.end) || 0);
    for (const d of [a, b]) for (const e of d.entries || []) {
      if (!e || typeof e.id !== 'string' || !e.id || num(e.start) == null || gone.has(e.id) || e.open === true) continue;
      const h = byId.get(e.id); if (!h || newer(e, h)) byId.set(e.id, e);
    }
    const entries = [...byId.values()].sort((x, y) => x.start - y.start || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    return { entries, deleted };
  }
  return { step, merge, ended, t0, t1, sums, csv, sessionArea, overlap, season, delta, dDate, dTime, dur, ha, GAP_MS };
})();
// worklog:end

// Recorder + overview sheet for WorkLogCore (feature/arbeitsdoku). Tested by
// Tests/web/worklog-ui.test.mjs (block worklog-ui:begin/end).
// worklog-ui:begin
const TabletWorkLog = (() => {
  const T = k => I18n.text(k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const onTap = (node, fn) => node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (!node.disabled) fn(e); });
  const KEY = 'aow.worklog.v1';
  const C = WorkLogCore;
  let state = { entries: [], open: null, deleted: [] }, storeOk = true, dirty = false, lastSave = 0;
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && Array.isArray(v.entries)) state = { entries: v.entries, open: v.open || null, deleted: Array.isArray(v.deleted) ? v.deleted : [] }; }
  catch (_) { storeOk = false; }
  function save(force) {
    const now = Date.now();
    if (!force && now - lastSave < 10000) { dirty = true; return; }
    try { localStorage.setItem(KEY, JSON.stringify(state)); storeOk = true; dirty = false; lastSave = now; } catch (_) { storeOk = false; }
  }
  window.addEventListener('pagehide', () => save(true));

  // --- Guidance computer -------------------------------------------------------------------------
  // The tablet holding control sends its copy and takes the merged log back; an observer only
  // reads. Every 30 s and soon after a change; the local copy stays the buffer when the host is away.
  // unsent: this tablet has entries the host's copy hasn't (e.g. a session left open when the
  // ignition went off, closed at the next start): sent as soon as this tablet holds control,
  // not only at the next 30 s round (an observer's read doesn't deliver them).
  let hostAt = 0, hostErr = false, syncing = false, syncSoon = false, unsent = true;
  async function sync() {
    if (syncing || connState !== 'connected') return;
    syncing = true; syncSoon = false;
    try {
      const mine = { format: 'aow-worklog', version: 1, entries: state.entries, deleted: state.deleted };
      const r = iHoldControl && myClientId
        ? await fetch('/worklog?client=' + encodeURIComponent(myClientId), { method: 'POST', body: JSON.stringify(mine) })
        : await fetch('/worklog', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const v = await r.json();
      if (!v || v.format !== 'aow-worklog' || !Array.isArray(v.entries)) throw new Error('format');
      const m = C.merge({ entries: state.entries, deleted: state.deleted }, v); // changes made meanwhile stay
      state = { entries: m.entries, deleted: m.deleted, open: state.open && !m.deleted.includes(state.open.id) ? state.open : null };
      const onHost = new Set(v.entries.map(e => e && e.id));
      unsent = state.entries.some(e => !onHost.has(e.id));
      save(true); hostAt = Date.now(); hostErr = false;
    } catch (_) { hostErr = true; }
    syncing = false; last = ''; if (isOpen()) render();
  }
  const changed = () => { save(true); syncSoon = true; };
  setInterval(() => { if (syncSoon || (unsent && iHoldControl) || Date.now() - hostAt > 30000) sync(); }, 3000);

  // --- Recording -------------------------------------------------------------------------------
  function snapshot() {
    const s = statusBar || {}, fd = s.fieldData || {};
    const field = fieldOps && fieldOps.activeField || '', job = s.jobName || '';
    const j = fieldOps && (fieldOps.jobs || []).find(x => x.fieldName === field && x.taskName === job);
    // A job started on the host while this tablet watched: the previous tick (live, with control)
    // had no job or another one, and the job is new (opened in the minute it started; a resumed
    // job was opened later). Then its start is the session's start.
    const live = connState === 'connected' && !!lastTick && performance.now() - lastTick.t < 2000;
    const key = field && job ? field + '\u0000' + job : '';
    const jobNew = !!(j && key && prevKey !== null && prevKey !== key && j.status === 0 && j.startedMs > 0 && j.lastOpened === hostMinute(j.startedMs));
    prevKey = live && iHoldControl ? key : null;
    return {
      live,
      control: !!iHoldControl, field, job, workType: j ? j.workType : '', jobStart: j ? j.startedMs : null, jobNew,
      worked: s.workedAreaSqM, actual: fd.actualAreaSqM, trip: fd.tripDistanceM,
      tool: profiles ? profiles.activeTool : '', vehicle: profiles ? profiles.activeVehicle : '',
      widthM: typeof sectionsWidthM === 'function' && sectionsWidthM() > 0 ? sectionsWidthM() : null,
    };
  }
  let prevKey = null; // field+job of the previous tick while live with control; null = not watched
  const p2 = n => String(n).padStart(2, '0');
  const hostMinute = ms => { const d = new Date(ms); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  setInterval(() => {
    let before = state.entries.length; const wasOpen = !!state.open;
    state = C.step(state, snapshot(), Date.now());
    // The host's end for a session closed with its job, once the job list shows it (a few s later).
    const jobs = fieldOps && fieldOps.jobs || [];
    if (state.entries.some(e => e.byJob)) {
      const now = Date.now();
      state = { ...state, entries: state.entries.map(e => {
        if (!e.byJob) return e;
        const x = C.ended(e, jobs.find(j => j.fieldName === e.field && j.taskName === e.job));
        return x.byJob && now - e.end > 60000 ? { ...x, byJob: false } : x; // not reported within a minute: tablet clock
      }) };
      before = -1;
    }
    const moved = state.entries.length !== before || wasOpen !== !!state.open;
    save(moved); if (moved) { syncSoon = true; if (state.entries.length > Math.max(0, before)) unsent = true; }
    if (isOpen()) render();
  }, 2000);

  // --- Sheet -----------------------------------------------------------------------------------
  const sheet = el('div', 'tui-sheet tb-sheet tbk-sheet'); sheet.id = 'tui-worklog'; sheet.setAttribute('translate', 'no');
  sheet.innerHTML = '<div class="tui-sh-hdr"><span class="t"></span><button class="x">✕</button></div><div class="tui-sh-body"></div>';
  const scrim = el('div', 'tp-scrim');
  const fileIn = el('input'); fileIn.type = 'file'; fileIn.accept = '.json,application/json'; fileIn.style.display = 'none';
  const printBox = el('div'); printBox.id = 'tui-print';
  document.body.append(scrim, sheet, fileIn, printBox);
  for (const n of [sheet, scrim]) n.addEventListener('pointerdown', e => e.stopPropagation());
  const shT = sheet.querySelector('.t'), shB = sheet.querySelector('.tui-sh-body');
  const isOpen = () => sheet.classList.contains('open');
  const close = () => { sheet.classList.remove('open'); scrim.classList.remove('open'); edit = null; };
  onTap(sheet.querySelector('.x'), close); onTap(scrim, close);
  let fField = '', fSeason = '', fText = '', edit = null, last = '', msg = '';
  function open() { if (typeof lnCloseAll === 'function') lnCloseAll(); sheet.classList.add('open'); scrim.classList.add('open'); last = ''; render(); }

  // Entries with a kind (the acceptance records, TabletAcceptance) share the store and its sync
  // with the guidance computer but are not working sessions.
  const all = () => (state.open ? state.entries.concat([state.open]) : state.entries).filter(e => !e.kind);
  function filtered() {
    const q = fText.trim().toLowerCase();
    return all().filter(e => (!fField || e.field === fField) && (!fSeason || String(C.season(e)) === fSeason)
      && (!q || [e.field, e.job, e.workType, e.tool, e.vehicle, e.activity, e.product, e.amount, e.note].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => a.field.localeCompare(b.field) || C.t0(b) - C.t0(a));
  }
  const HEAD = () => [tr('Field'), tr('Job'), tr('Work type'), tr('Date'), tr('Start'), tr('End'), tr('Duration (h:mm)'), tr('Area this session (ha)'),
    tr('Job area total (ha)'), tr('Covered once, job total (ha)'), tr('Overlap, job total (ha)'), tr('Distance (m)'), tr('Tool'), tr('Working width (m)'), tr('Vehicle'),
    tr('Activity'), tr('Product / variety'), tr('Amount'), tr('Note')].map(T);
  const NOTE = tr('Records of this app; whether they meet legal record-keeping duties is not checked.');

  function selectBox(val, opts, onChange) {
    const s = el('select', 'tp-in wl-sel'); s.style.cssText = 'width:auto;text-align:left;font:inherit';
    for (const [v, t] of opts) { const o = el('option', '', t); o.value = v; if (v === val) o.selected = true; s.appendChild(o); }
    s.addEventListener('change', () => { onChange(s.value); last = ''; render(); });
    s.addEventListener('pointerdown', e => e.stopPropagation());
    return s;
  }
  function render() {
    if (!isOpen()) return;
    const list = filtered(), key = JSON.stringify([list.map(e => [e.id, e.end, e.hostEnd, e.activity, e.product, e.amount, e.note]), fField, fSeason, fText, edit, msg, storeOk, hostAt, hostErr, tuiLang()]);
    if (key === last) return;
    if (document.activeElement && sheet.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; // don't rebuild under the cursor
    last = key;
    shT.textContent = T(tr('Work log'));
    const top = shB.scrollTop; shB.innerHTML = '';
    if (edit) { renderEdit(); return; }
    const box = el('div', 'tb-box');
    box.appendChild(el('div', 'tp-note', T(tr('One entry per working session, recorded on this tablet while it has control and a job is open. Areas and distance come from the guidance computer.'))));
    box.appendChild(el('div', hostAt && !hostErr ? 'tp-note' : 'tp-note warn', hostAt && !hostErr
      ? T(tr('Also stored on the guidance computer (last at {t}). A running session is stored when it ends.', { t: C.dTime(hostAt) }))
      : T(tr('Not stored on the guidance computer yet: kept on this tablet until it can be. "Save as file" makes an extra copy.'))));
    if (!storeOk) box.appendChild(el('div', 'tp-note bad', T(tr('This browser does not store data: entries are lost when the page is closed.'))));
    if (msg) box.appendChild(el('div', 'tp-note', T(msg)));
    // Filters
    const fields = [...new Set(all().map(e => e.field))].sort(), seasons = [...new Set(all().map(e => String(C.season(e))))].sort().reverse();
    const fr = el('div', 'tb-row');
    fr.appendChild(selectBox(fField, [['', T(tr('All fields'))], ...fields.map(f => [f, f])], v => { fField = v; }));
    fr.appendChild(selectBox(fSeason, [['', T(tr('All seasons'))], ...seasons.map(y => [y, y])], v => { fSeason = v; }));
    const q = el('input', 'tp-in'); q.placeholder = T(tr('Search')); q.value = fText; q.style.cssText = 'width:12em;text-align:left;font:inherit';
    q.addEventListener('input', () => { fText = q.value; }); q.addEventListener('change', () => { last = ''; render(); });
    fr.appendChild(q);
    box.appendChild(fr);
    // Sums per field and season (calendar year)
    const sm = C.sums(list);
    if (sm.length) {
      const t = el('div', 'wl-sums');
      for (const r of sm) t.appendChild(el('div', 'wl-sum', r.field + ' · ' + r.season + ': ' + tr('Sessions: {n}', { n: r.count }) + ' · ' + C.dur(r.ms) + ' h · '
        + fmtArea(r.areaSqM) + (r.areaMissing ? ' (' + tr('without area: {n}', { n: r.areaMissing }) + ')' : '')));
      box.appendChild(t);
    }
    // Entries
    const ul = el('div', 'tbk-list');
    if (!list.length) ul.appendChild(el('div', 'tp-note', T(tr('No entries yet.'))));
    for (const e of list) {
      const r = el('button', 'tbk-it wl-it' + (e.open ? ' on' : ''));
      const nm = el('span', 'tbk-nm');
      nm.appendChild(el('small', '', C.dDate(C.t0(e)) + ' · ' + C.dTime(C.t0(e)) + '–' + (e.open ? T(tr('running')) : C.dTime(C.t1(e))) + ' · ' + C.dur(C.t1(e) - C.t0(e)) + ' h'));
      nm.appendChild(el('b', '', e.field + ' · ' + e.job));
      const a = C.sessionArea(e);
      nm.appendChild(el('small', '', [a == null ? T(tr('area: —')) : fmtArea(a), e.tool, e.widthM != null ? fmtUnit(e.widthM, 'm') : '', e.activity, e.product, e.amount].filter(Boolean).join(' · ')));
      if (e.note) nm.appendChild(el('small', 'tbk-ch', e.note));
      r.append(el('span', ''), nm, el('span', 'tbk-st', '✎')); // the list's three columns
      onTap(r, () => { edit = e.id; last = ''; render(); });
      ul.appendChild(r);
    }
    box.appendChild(ul);
    // Export, print, file
    const er = el('div', 'tb-row');
    const btn = (label, fn, pri) => { const b = el('button', 'tp-btn' + (pri ? ' pri' : ''), T(label)); onTap(b, fn); er.appendChild(b); return b; };
    btn(tr('Export CSV'), () => download('arbeitsprotokoll.csv', 'text/csv;charset=utf-8', C.csv(list, HEAD())), true);
    btn(tr('Copy CSV'), () => copy(C.csv(list, HEAD()).replace(/^﻿/, '')));
    btn(tr('Print page per field'), () => printFields(list));
    btn(tr('Save as file'), () => download('arbeitsprotokoll.json', 'application/json', JSON.stringify({ format: 'aow-worklog', version: 1, entries: all() }, null, 1)));
    btn(tr('Load from file'), () => fileIn.click());
    box.appendChild(er);
    box.appendChild(el('div', 'tp-note', T(NOTE)));
    shB.appendChild(box);
    shB.scrollTop = top;
  }
  function renderEdit() {
    const e = all().find(x => x.id === edit); if (!e) { edit = null; render(); return; }
    const box = el('div', 'tb-box');
    box.appendChild(el('div', 'tb-lbl', e.field + ' · ' + e.job + ' · ' + C.dDate(C.t0(e))));
    const a = C.sessionArea(e), ov = C.overlap(e), tr0 = C.delta(e.tripStart, e.tripEnd);
    const src = (e.hostStart != null || e.hostEnd != null) && C.t0(e) === (e.hostStart != null ? e.hostStart : e.start) && C.t1(e) === (e.hostEnd != null ? e.hostEnd : e.end)
      ? ' · ' + T(e.hostStart != null && e.hostEnd != null ? tr('start and end from the guidance computer') : e.hostStart != null ? tr('start from the guidance computer') : tr('end from the guidance computer')) : '';
    for (const [k, v] of [[tr('Time'), C.dTime(C.t0(e)) + '–' + (e.open ? T(tr('running')) : C.dTime(C.t1(e))) + ' (' + C.dur(C.t1(e) - C.t0(e)) + ' h)' + src],
      [tr('Area this session'), a == null ? '—' : fmtArea(a)], [tr('Job area total'), e.workedEnd == null ? '—' : fmtArea(e.workedEnd)],
      [tr('Overlap, job total'), ov == null ? '—' : fmtArea(ov)], [tr('Distance'), tr0 == null ? '—' : fmtUnit(tr0, 'm', 0)],
      [tr('Tool'), e.tool || '—'], [tr('Working width'), e.widthM == null ? '—' : fmtUnit(e.widthM, 'm')], [tr('Vehicle'), e.vehicle || '—'], [tr('Work type'), e.workType || '—']])
      box.appendChild(el('div', 'tp-note', T(k) + ': ' + v));
    const inputs = {};
    for (const [k, label] of [['activity', tr('Activity')], ['product', tr('Product / variety')], ['amount', tr('Amount')], ['note', tr('Note')]]) {
      const row = el('label', 'wl-f'); row.appendChild(el('span', '', T(label)));
      const i = el('input', 'tp-in'); i.value = e[k] || ''; i.style.cssText = 'width:100%;text-align:left;font:inherit'; i.maxLength = 500;
      inputs[k] = i; row.appendChild(i); box.appendChild(row);
    }
    const r = el('div', 'tb-row');
    const ok = el('button', 'tp-btn pri big', T(tr('Save'))); onTap(ok, () => {
      const upd = x => x.id === e.id ? { ...x, ...Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()])), mod: Date.now() } : x;
      state = { entries: state.entries.map(upd), open: state.open ? upd(state.open) : null, deleted: state.deleted }; changed(); edit = null; last = ''; render();
    });
    const back = el('button', 'tp-btn', '← ' + T(tr('Back'))); onTap(back, () => { edit = null; last = ''; render(); });
    const del = el('button', 'tp-btn quiet', T(tr('Delete entry'))); del.disabled = !!e.open;
    let armed = false;
    onTap(del, () => {
      if (!armed) { armed = true; del.textContent = T(tr('Tap again to delete')); return; }
      state = { entries: state.entries.filter(x => x.id !== e.id), open: state.open, deleted: state.deleted.concat([e.id]) }; changed(); edit = null; last = ''; render();
    });
    r.append(ok, back, del); box.appendChild(r);
    shB.appendChild(box);
  }

  // --- Files -----------------------------------------------------------------------------------
  // Browser download. The Android/iOS app views have no download or print hook (see
  // docs/Arbeitsdoku.md); "Copy CSV" is the way there.
  function download(name, type, text) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type }));
      const a = el('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      msg = tr('File created: {f}. If nothing is downloaded on this tablet, use "Copy CSV".', { f: name });
    } catch (_) { msg = tr('Download not possible here. Use "Copy CSV".'); }
    last = ''; render();
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); msg = tr('CSV copied. Paste it into a spreadsheet or an e-mail.'); }
    catch (_) { msg = tr('Copying is not possible in this browser.'); }
    last = ''; render();
  }
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (!f) return;
    try {
      const v = JSON.parse(await f.text());
      if (!v || v.format !== 'aow-worklog' || !Array.isArray(v.entries)) throw new Error('format');
      const have = new Set(all().map(e => e.id));
      const add = v.entries.filter(e => e && e.id && !have.has(e.id) && typeof e.field === 'string' && typeof e.start === 'number').map(e => ({ ...e, open: false }));
      const m = C.merge({ entries: state.entries, deleted: state.deleted }, { entries: add });
      state = { entries: m.entries, open: state.open, deleted: m.deleted }; changed();
      msg = tr('{n} entries loaded; entries already here are kept.', { n: add.length });
    } catch (_) { msg = tr('Not a work log file of this app.'); }
    last = ''; render();
  });

  // --- Print: one page per field, through the browser's print (save as PDF there) -------------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function printFields(list) {
    const by = new Map(); for (const e of list) { if (!by.has(e.field)) by.set(e.field, []); by.get(e.field).push(e); }
    let h = '';
    for (const [field, es] of by) {
      const s = C.sums(es);
      h += '<section class="wl-page"><h1>' + esc(T(tr('Work log'))) + ': ' + esc(field) + '</h1>'
        + '<p>' + s.map(r => esc(r.season + ': ' + tr('Sessions: {n}', { n: r.count }) + ' · ' + C.dur(r.ms) + ' h · ' + fmtArea(r.areaSqM))).join('<br>') + '</p>'
        + '<table><tr>' + [tr('Date'), tr('Time'), tr('Job'), tr('Area this session'), tr('Tool'), tr('Working width'), tr('Activity'), tr('Product / variety'), tr('Amount'), tr('Note')]
          .map(k => '<th>' + esc(T(k)) + '</th>').join('') + '</tr>'
        + es.slice().sort((a, b) => a.start - b.start).map(e => '<tr>' + [C.dDate(C.t0(e)), C.dTime(C.t0(e)) + '–' + C.dTime(C.t1(e)), e.job,
          C.sessionArea(e) == null ? '—' : fmtArea(C.sessionArea(e)), e.tool, e.widthM == null ? '' : fmtUnit(e.widthM, 'm'), e.activity, e.product, e.amount, e.note]
          .map(v => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('') + '</table>'
        + '<p class="wl-n">' + esc(T(NOTE)) + '</p></section>';
    }
    printBox.innerHTML = h;
    document.documentElement.setAttribute('data-print', 'worklog');
    const done = () => { document.documentElement.removeAttribute('data-print'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    try { window.print(); } catch (_) { done(); }
    setTimeout(() => { if (document.documentElement.hasAttribute('data-print')) { msg = tr('If no print dialog opened, this app view cannot print; use a browser on a PC.'); last = ''; render(); } }, 1500);
  }

  // --- Menu tile (in the field) ---------------------------------------------------------------
  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7M9 8h2"/></svg>';
  setInterval(() => {
    const m = document.getElementById('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const f = m.querySelector('.tui-tiles.tui-f'); if (!f || m.querySelector('[data-tile="worklog"]')) return;
    const t = el('button', 'tui-tile field'); t.dataset.tile = 'worklog'; t.innerHTML = IC + '<span></span>';
    t.querySelector('span').textContent = T(tr('Work log'));
    onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) tuiPress(x); open(); });
    f.appendChild(t);
  }, 300);
  // Other records kept in the same store (kind set): read, add or replace, delete.
  const records = kind => state.entries.filter(e => e.kind === kind);
  function put(rec) {
    const r = { ...rec, mod: Date.now(), open: false };
    state = { ...state, entries: state.entries.some(e => e.id === r.id) ? state.entries.map(e => e.id === r.id ? r : e) : state.entries.concat([r]) };
    unsent = true; changed();
  }
  function remove(id) { state = { ...state, entries: state.entries.filter(e => e.id !== id), deleted: state.deleted.concat([id]) }; changed(); }
  return { open, records, put, remove, get entries() { return all(); }, get unsent() { return unsent; },
    get hostAt() { return hostErr ? 0 : hostAt; } };
})();
// worklog-ui:end
