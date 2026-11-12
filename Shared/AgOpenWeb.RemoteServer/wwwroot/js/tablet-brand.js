// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fork module: product look, help, info, diagnosis for support (TabletBrand).
// The fork's client files are js/tablet-*.js, classic scripts loaded in the order of index.html, after
// upstream's scripts and before js/frame.js (Docs/WEB_CLIENT.md); the blocks marked `// name:begin` / `// name:end` are what
// Tests/web cut out and test.

// ===== Tablet UI (Phase 4a): product look, help, support diagnosis ====================
// BRAND is the one place for the product name, colours, logo and links of the web app (the
// Android launcher name and icon live in the Android project, see docs/Host-Aenderungen.md).
// Look only: switched per device under Menu → Settings → Info (aow.ui.brand = on | off, default on);
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

  // --- Menu → Settings → Info: name, version, origin, licence, source --------------------------------
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
      tr('Corrections come from NTRIP over the internet. The state is under Menu → Settings → Network & GPS.'),
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
      tr('On the test bench, Menu → Service → Bench checklist → "Reverse start" reproduces this case on purpose.')] },
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
      tr('Menu → Service → "Demo mode" starts the simulator; a striped "DEMO" band shows it runs.'),
      tr('If a module is detected, the demo ends and steering and sections are switched off: check them anyway.'),
      tr('"End demo" on the band or in the menu stops it.')] },
    { id: 'usb', t: tr('Back up profiles by USB copy'), warn: tr('Not checked on a real tablet yet.'), steps: [
      tr('Easier: Menu → Settings → "Back up and restore" makes one file and restores it from the Import folder.'),
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
      if (!box || m.querySelector('[data-tile="' + key + '"]')) return; // anywhere in the menu: placed tiles move
      const t = el('button', 'tui-tile ' + cls, ICS[key.slice(3)] + '<span></span>'); t.dataset.tile = key;
      t.querySelector('span').textContent = T(label);
      onTap(t, () => { const x = m.querySelector('.tui-sh-hdr .x'); if (x) tuiPress(x); fn(); });
      box.appendChild(t);
    };
    add(f, 'tb-help', 'field', tr('Help'), () => openHelp());
    add(s, 'tb-info', 'setup', 'Info', () => openInfo());
    add(s, 'tb-diag', 'setup', tr('Diagnosis for support'), () => openDiag());
  }
  setInterval(menuTiles, 300);

  return { get on() { return on(); }, apply, openHelp, openInfo, openDiag, summary };
})();
