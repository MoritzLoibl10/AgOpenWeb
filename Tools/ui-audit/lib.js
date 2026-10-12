// Messfunktionen für den UI-Audit: Tippflächen, Schriftgrößen, Kontrast.
// Läuft in Node mit Playwright; alles, was den DOM liest, läuft per page.evaluate im Browser.
'use strict';

const { chromium } = require('playwright');

/** Browser starten. CHROMIUM_PATH überschreibt das von Playwright mitgebrachte Chromium. */
async function launch() {
  const opts = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] };
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  return chromium.launch(opts);
}

/**
 * Neue Seite öffnen und warten, bis der Client verbunden ist. Mit waitForControl wartet sie,
 * bis dieser Client die Steuerung hält (der erste Client bekommt sie automatisch).
 * localStorage-Einträge (z. B. UI-Einstellungen) werden vor dem Laden gesetzt.
 */
async function openPage(browser, { url, viewport, localStorage = {}, waitForControl = true }) {
  const ctx = await browser.newContext({ viewport, hasTouch: true });
  await ctx.addInitScript(entries => {
    try { for (const [k, v] of Object.entries(entries)) window.localStorage.setItem(k, v); } catch (_) { /* privat/blockiert */ }
  }, localStorage);
  const page = await ctx.newPage();
  await page.goto(url);
  if (waitForControl) {
    await page.waitForFunction(() => typeof iHoldControl !== 'undefined' && iHoldControl === true, null, { timeout: 30000 });
  } else {
    await page.waitForFunction(() => typeof transport !== 'undefined', null, { timeout: 30000 });
  }
  await page.waitForTimeout(1500);
  return { ctx, page };
}

/** Alle sichtbaren, obenliegenden Bedienelemente mit Größe; dazu ein Histogramm der Schriftgrößen. */
function measure(page) {
  return page.evaluate(() => {
    const visibleRect = el => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return null;
      if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return null;
      // Nur zählen, was am Mittelpunkt wirklich oben liegt (nicht von Panels verdeckt).
      const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
      const cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(cx, cy);
      if (!top || !(top === el || el.contains(top) || top.contains(el))) return null;
      return r;
    };
    const controls = [];
    for (const el of document.querySelectorAll('button, input:not([type=hidden]), select, [role=button], a[href], .sec-btn')) {
      const r = visibleRect(el);
      if (!r) continue;
      const cls = typeof el.className === 'string' ? el.className : '';
      const label = (el.innerText || el.title || el.getAttribute('aria-label') || (el.querySelector && el.querySelector('img') && el.querySelector('img').alt) || '').trim();
      controls.push({ id: el.id || '', cls: cls.slice(0, 40), tag: el.tagName, type: el.type || '', txt: label.slice(0, 30),
        w: Math.round(r.width), h: Math.round(r.height) });
    }
    const fontHist = {};
    let textNodes = 0;
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) {
      const n = tw.currentNode;
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      textNodes++;
      const fs = Math.round(parseFloat(cs.fontSize));
      fontHist[fs] = (fontHist[fs] || 0) + 1;
    }
    return { controls, fontHist, textNodes };
  });
}

/**
 * WCAG-Kontrast jedes sichtbaren DOM-Textes gegen die nächste deckende Hintergrundfarbe.
 * Texte ohne deckenden Hintergrund (direkt über der Karte) werden ausgelassen. Jeder Eintrag
 * trägt den Bereich, in dem er liegt (Statusleiste, Teilbreiten, …).
 */
function contrast(page) {
  return page.evaluate(() => {
    const parse = c => {
      const m = c && c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const v = m[1].split(',').map(x => parseFloat(x));
      return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 };
    };
    const lum = ({ r, g, b }) => {
      const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = el => {
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c.a > 0.5) return c;
      }
      return null;
    };
    const REGIONS = ['#statusbar', '#sectionbar', '#rightnav', '#leftnav', '#bottomnav', '#simbar', '.ln-panel', '#dialoghost'];
    const out = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) {
      const n = tw.currentNode;
      const t = n.textContent.trim();
      if (!t) continue;
      const el = n.parentElement;
      if (!el || el.closest('svg')) continue; // SVG-Text färbt per fill, nicht per color
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const fg = parse(cs.color), bg = bgOf(el);
      if (!fg || !bg) continue;
      const L1 = lum(fg), L2 = lum(bg);
      const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const region = REGIONS.find(s => el.closest(s)) || 'other';
      out.push({ region, t: t.slice(0, 28), id: el.id || (typeof el.className === 'string' ? el.className.slice(0, 20) : ''),
        fs: parseFloat(cs.fontSize), cr: Math.round(cr * 10) / 10, fg: cs.color });
    }
    return out;
  });
}

/**
 * Kontrast der Leitlinie auf der Karte (Canvas, daher aus dem Bildschirmfoto). Jede Spalte
 * zwischen x0 und x1 wird über 80 Zeilen um y gemittelt, damit die Bodentextur herausfällt.
 * Hintergrund = Median der Spaltenmittel, Leitlinie = die Spalte, die sich am stärksten davon
 * abhebt. Erwartet Heading-Up-Ansicht mit der Linie senkrecht nahe der Bildmitte.
 */
async function guidelineContrast(page, { y, x0, x1 }) {
  const png = await page.screenshot();
  return page.evaluate(async ({ b64, y, x0, x1 }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const lin = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    const H = 80, W = x1 - x0;
    const d = g.getImageData(x0, y - H / 2, W, H).data;
    const cols = [];
    for (let i = 0; i < W; i++) {
      let r = 0, gg = 0, b = 0;
      for (let j = 0; j < H; j++) { const k = (j * W + i) * 4; r += lin(d[k]); gg += lin(d[k + 1]); b += lin(d[k + 2]); }
      cols.push({ x: x0 + i, L: 0.2126 * r / H + 0.7152 * gg / H + 0.0722 * b / H });
    }
    const bgL = cols.map(p => p.L).sort((a, b) => a - b)[Math.floor(cols.length / 2)];
    const line = cols.reduce((a, p) => (Math.abs(p.L - bgL) > Math.abs(a.L - bgL) ? p : a), cols[0]);
    const cr = (Math.max(line.L, bgL) + 0.05) / (Math.min(line.L, bgL) + 0.05);
    return { cr: Math.round(cr * 10) / 10, lineX: line.x };
  }, { b64: png.toString('base64'), y, x0, x1 });
}

/** Kennzahlen einer Ansicht. */
function summarize(m) {
  const c = m.controls;
  const minDim = x => Math.min(x.w, x.h);
  const lt = n => c.filter(x => minDim(x) < n).length;
  const ge = n => c.filter(x => minDim(x) >= n).length;
  return {
    n: c.length, lt40: lt(40), lt48: lt(48), lt56: lt(56), ge64: ge(64),
    smallest: c.slice().sort((a, b) => minDim(a) - minDim(b)).slice(0, 8).map(x => `${x.id || x.txt || x.cls}:${x.w}x${x.h}`),
    textLt14: Object.entries(m.fontHist).filter(([k]) => +k < 14).reduce((s, [, v]) => s + v, 0),
    textNodes: m.textNodes, fontHist: m.fontHist,
  };
}

/** Minimaler Kontrast je Bereich. */
function contrastByRegion(list) {
  const out = {};
  for (const e of list) {
    if (!out[e.region] || e.cr < out[e.region].cr) out[e.region] = { cr: e.cr, t: e.t, id: e.id };
  }
  return out;
}

module.exports = { launch, openPage, measure, contrast, guidelineContrast, summarize, contrastByRegion };
