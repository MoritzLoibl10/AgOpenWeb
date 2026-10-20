#!/usr/bin/env node
// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// Vergleichstabelle (Markdown) aus zwei oder mehr metrics.json von capture.js.
//
//   node compare.js out/vorher/metrics.json:Vorher out/handschuh/metrics.json:Handschuh
'use strict';

const fs = require('fs');

const runs = process.argv.slice(2).map(a => {
  const i = a.lastIndexOf(':');
  const file = i > 1 ? a.slice(0, i) : a;
  const label = i > 1 ? a.slice(i + 1) : a;
  return { label, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
});
if (runs.length < 2) {
  console.error('Aufruf: node compare.js <metrics.json>[:Name] <metrics.json>[:Name] …');
  process.exit(1);
}

const minDim = c => Math.min(c.w, c.h);

// Jedes Bedienelement einmal zählen, mit seiner kleinsten Größe über alle Ansichten.
function uniqueControls(views) {
  const all = new Map();
  for (const v of Object.values(views)) {
    for (const c of v.controls) {
      const key = c.id || c.txt || c.cls;
      const d = minDim(c);
      if (!all.has(key) || d < all.get(key)) all.set(key, d);
    }
  }
  const d = [...all.values()];
  return { n: d.length, lt40: d.filter(x => x < 40).length, lt48: d.filter(x => x < 48).length, ge64: d.filter(x => x >= 64).length };
}

const pct = (a, n) => (n ? Math.round((100 * a) / n) + ' %' : '–');
const out = [];
const head = cols => { out.push('| ' + cols.join(' | ') + ' |'); out.push('|' + cols.map((_, i) => (i ? '---:' : '---')).join('|') + '|'); };

out.push('### Alle Bedienelemente (je Element die kleinste gemessene Größe)\n');
head(['Lauf', 'Elemente', '< 40 px', '< 48 px', '≥ 64 px']);
for (const r of runs) {
  const u = uniqueControls(r.data.views);
  out.push(`| ${r.label} | ${u.n} | ${u.lt40} (${pct(u.lt40, u.n)}) | ${u.lt48} (${pct(u.lt48, u.n)}) | ${u.ge64} (${pct(u.ge64, u.n)}) |`);
}

out.push('\n### Kontrast (kleinster Wert je Bereich, WCAG-Verhältnis)\n');
const CONTRAST_VIEWS = ['13-day-driving-clean', '15-night-driving'];
head(['Lauf', 'Ansicht', 'Statusleiste', 'Teilbreiten', 'Leitlinie']);
for (const r of runs) {
  for (const name of CONTRAST_VIEWS) {
    const v = r.data.views[name];
    if (!v) continue;
    const reg = k => (v.contrastByRegion[k] ? `${v.contrastByRegion[k].cr}:1 („${v.contrastByRegion[k].t}“)` : '–');
    out.push(`| ${r.label} | ${name} | ${reg('#statusbar')} | ${reg('#sectionbar')} | ${v.guideline ? v.guideline.cr + ':1' : '–'} |`);
  }
}

out.push('\n### Fahrwerte: kleinste Schrift und Überlappungen\n');
out.push('Fahrwerte = Werte, die man beim Fahren abliest (Statusleiste, Querabweichung, HUDs, Teilbreiten, Schnellzugriff, Module); Überlappungen = feste Elemente über der Karte, die sich um mehr als 4 px schneiden.\n');
head(['Lauf', 'kleinste Fahrwert-Schrift (Ansicht, Element)', 'Ansichten mit Überlappung', 'Überlappungen gesamt', 'abgeschnittene Texte']);
for (const r of runs) {
  let min = null, at = '';
  let ovViews = 0, ov = 0, cut = null;
  for (const [name, v] of Object.entries(r.data.views)) {
    if (v.driveFonts && v.driveFonts.min != null && (min === null || v.driveFonts.min < min)) {
      min = v.driveFonts.min; at = `${name}, ${v.driveFonts.minAt.sel} „${v.driveFonts.minAt.t}“`;
    }
    if (v.overlaps && v.overlaps.length) { ovViews++; ov += v.overlaps.length; }
    if (v.truncated) cut = (cut || 0) + v.truncated.length;
  }
  out.push(`| ${r.label} | ${min === null ? '–' : min + ' px (' + at + ')'} | ${ovViews} | ${ov} | ${cut === null ? '–' : cut} |`);
}

out.push('\n### Je Ansicht: Elemente < 48 px / ≥ 64 px\n');
const names = [...new Set(runs.flatMap(r => Object.keys(r.data.views)))].sort();
head(['Ansicht', ...runs.map(r => r.label)]);
for (const name of names) {
  const cells = runs.map(r => {
    const v = r.data.views[name];
    return v ? `${v.sum.lt48} / ${v.sum.ge64} von ${v.sum.n}` : '–';
  });
  out.push(`| ${name} | ${cells.join(' | ')} |`);
}

console.log(out.join('\n'));
