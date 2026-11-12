// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: back up and restore profiles (TabletBackup).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

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
  const KIND = { vehicle: tr('Vehicle'), tool: tr('Tool'), field: tr('Field'), ntrip: tr('NTRIP profile'), worklog: tr('Work log') };
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

  let openMode = null; // closes when the mode changes, as the bench checklist
  function open() {
    tuiEnterSetup();
    if (typeof lnCloseAll === 'function') lnCloseAll();
    openMode = TabletTerminal.mode;
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
    const key = JSON.stringify([st.seq, lock, confirm, [...sel], selFile, tuiLang(), connState]);
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
        for (const n of done.applied.needPassword || []) resBox.appendChild(el('div', 'tp-note warn', T(tr('Enter the password for NTRIP profile {n} again (Menu → Settings → Network & GPS).')).replace('{n}', n)));
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
  setInterval(() => { if (isOpen() && TabletTerminal.mode !== openMode) close(); }, 500);

  // --- Menu tile (setup) --------------------------------------------------------------------
  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16v13H4z"/><path d="M8 7V4h8v3M12 10v6M9 13l3 3 3-3"/></svg>';
  setInterval(() => {
    const m = document.getElementById('tui-menu'); if (!m || !m.classList.contains('open')) return;
    const s = m.querySelector('.tui-tiles.tui-s'); if (!s || m.querySelector('[data-tile="tbk"]')) return;
    const t = el('button', 'tui-tile setup'); t.dataset.tile = 'tbk'; t.innerHTML = IC + '<span></span>';
    t.querySelector('span').textContent = T(tr('Back up and restore'));
    onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) tuiPress(x); open(); });
    s.appendChild(t);
  }, 300);
  return { open, get state() { return status(); }, get selection() { return [...sel]; } };
})();
