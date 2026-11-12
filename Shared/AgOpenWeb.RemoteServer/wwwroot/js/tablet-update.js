// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: update check and channels (TabletUpdate).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

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
  const KEY = 'aow.update.onStart', CH = 'aow.update.channel';
  // Channels: "stable" = releases published as full releases (approved with the "Fork Stable
  // Release" workflow), the default; "test" = also the pre-releases (test versions). Per device.
  const channel = () => { try { return localStorage.getItem(CH) === 'test' ? 'test' : 'stable'; } catch (_) { return 'stable'; } };
  const api = () => BRAND.source.replace('https://github.com/', 'https://api.github.com/repos/') + '/releases?per_page=30';
  let state = { busy: false, res: null };
  const onStart = () => { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } };

  // releases (GitHub JSON) + this build's hash + channel →
  // { kind: 'newer'|'current'|'ahead'|'unknown'|'none', latest, mine }. This build is looked up
  // among all published releases (it may be a test version); the newest is taken from the channel
  // only. 'ahead': this test version is newer than the newest stable release.
  function compare(releases, hash, ch = 'stable') {
    const all = (releases || []).filter(r => r && !r.draft && r.published_at)
      .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
    const list = ch === 'test' ? all : all.filter(r => !r.prerelease);
    if (!list.length) return { kind: 'none' };
    const h = String(hash || '').replace(/-dirty$/, '').toLowerCase();
    const mine = h.length >= 7 ? all.find(r => String(r.target_commitish || '').toLowerCase().startsWith(h)) : null;
    const latest = list[0];
    if (!mine) return { kind: 'unknown', latest };
    if (mine === latest) return { kind: 'current', latest, mine };
    return { kind: String(latest.published_at) > String(mine.published_at) ? 'newer' : 'ahead', latest, mine };
  }
  async function check() {
    state = { busy: true, res: null }; refresh();
    try {
      const r = await fetch(api(), { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      state = { busy: false, res: compare(await r.json(), appInfo && appInfo.gitHash, channel()) };
      // Remember whether this build is a test version (pre-release) or a stable release
      // (TabletSimAccess shows the simulator switch in test versions only).
      try { if (state.res && state.res.mine) localStorage.setItem('aow.build.kind', JSON.stringify({ hash: String(appInfo.gitHash || '').replace(/-dirty$/, ''), pre: !!state.res.mine.prerelease })); } catch (_) { /* ignore */ }
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
    else if (r && r.kind === 'none') b.appendChild(el('div', 'tp-note', T(channel() === 'test' ? tr('No release published yet.') : tr('No stable release published yet.'))));
    else if (r) {
      const L = r.latest, name = L.name || L.tag_name;
      const txt = r.kind === 'newer' ? tr('A newer version is available: {n} ({d}).', { n: name, d: day(L.published_at) })
        : r.kind === 'current' ? tr('This is the newest version ({n}).', { n: name })
        : r.kind === 'ahead' ? tr('This test version is newer than the newest stable release ({n}).', { n: name })
          : tr('Newest published version: {n} ({d}). This build is not one of the published ones, so it is not compared.', { n: name, d: day(L.published_at) });
      b.appendChild(el('div', 'tp-note' + (r.kind === 'newer' ? ' warn' : ''), txt));
      if (r.kind !== 'current' && r.kind !== 'ahead') {
        const a = el('button', 'tp-btn', T(tr('Open the release page')) + ' ↗'); onTap(a, () => openExternal(L.html_url)); b.appendChild(a);
      }
      b.appendChild(el('div', 'tp-note', T(tr('Installing stays with you: download and install the new version yourself.'))));
    }
    const cr = el('div', 'tb-row');
    cr.appendChild(el('span', 'tp-note', T(tr('Channel'))));
    for (const [c, t] of [['stable', tr('Stable')], ['test', tr('Test (pre-releases)')]]) {
      const cb = el('button', 'tp-btn' + (channel() === c ? ' pri' : ''), T(t));
      onTap(cb, () => { try { localStorage.setItem(CH, c); } catch (_) { /* ignore */ } state = { busy: false, res: null }; refresh(); });
      cr.appendChild(cb);
    }
    b.appendChild(cr);
    b.appendChild(el('div', 'tp-note', T(channel() === 'test'
      ? tr('Test: also test versions, which may have faults. Only on this device.')
      : tr('Stable: only versions released as stable. Only on this device.'))));
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
    check().then(r => { if (r && r.kind === 'newer') showToast(T(tr('A newer version is available: {n} ({d}).', { n: r.latest.name || r.latest.tag_name, d: day(r.latest.published_at) })) + ' ' + T(tr('Menu → Settings → Info')), 8000); });
  }, 1000);
  return { check, box, compare };
})();
// update:end
