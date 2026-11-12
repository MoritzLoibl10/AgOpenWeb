// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// TabletLegal (wwwroot/js/tablet-*.js, legal:begin/end): the notice at first start in the page's
// language. The language is set at once and its dictionary arrives later; the notice (translate=no)
// waits for it (at most 5 s) and is drawn again if it changes while shown.
// Run: node --test Tests/web/legal.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cut, run, node } from './stubs.mjs';

const block = cut('// legal:begin', '// legal:end');
const DE = { 'Please read before use': 'Bitte vor der Nutzung lesen' };

function load(lang, now) {
  let dict = null;
  const els = [];
  const t = run(block + '\nthis.L = TabletLegal;', {
    I18n: { get language() { return lang; }, text: k => (dict && dict[k]) || k },
    BRAND: { name: 'X' }, appInfo: {},
    performance: { now: () => now.v },
    document: { createElement: tag => { const n = node(tag); els.push(n); n.hidden = false;
      Object.defineProperty(n, 'innerHTML', { set() { n.children.length = 0; }, get() { return ''; } }); return n; }, body: node(), getElementById: () => null, documentElement: node() },
  });
  const box = els[1];
  box.querySelector = sel => box.children.find(c => sel === '.lg-t' ? c.className === 'lg-t' : true);
  return { ...t, box, setDict: d => { dict = d; } };
}

test('German page: the notice waits for the dictionary, then shows in German', () => {
  const now = { v: 0 };
  const t = load('de', now);
  t.tick();
  assert.equal(t.box.hidden, true, 'not in English before the dictionary');
  t.setDict(DE); now.v = 600; t.tick();
  assert.equal(t.box.hidden, false);
  assert.equal(t.box.children.find(c => c.className === 'lg-t').textContent, 'Bitte vor der Nutzung lesen');
});

test('no dictionary after 5 s: shown anyway (English), then redrawn when it arrives', () => {
  const now = { v: 0 };
  const t = load('de', now);
  now.v = 5100; t.tick();
  assert.equal(t.box.hidden, false);
  assert.equal(t.box.children.find(c => c.className === 'lg-t').textContent, 'Please read before use');
  t.setDict(DE); t.tick();
  assert.equal(t.box.children.find(c => c.className === 'lg-t').textContent, 'Bitte vor der Nutzung lesen');
});

test('English page: shown at once', () => {
  const t = load('en', { v: 0 });
  t.tick();
  assert.equal(t.box.hidden, false);
});
