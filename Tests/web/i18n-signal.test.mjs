// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// The fork's language signal (wwwroot/js/tablet.js, i18n:begin/end): tuiLang() changes, and
// onI18n handlers run, when the language changes and again when its dictionary arrives later
// (review 10.11.2026, measure 3; the whole app: Tools/i18n-late-check.mjs).
// Run: node --test Tests/web/i18n-signal.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cut, run } from './stubs.mjs';

const block = cut('// i18n:begin', '// i18n:end');

function load() {
  let dict = null, lang = 'en';
  const listeners = [];
  const t = run(block + '\nthis.lang = tuiLang; this.on = onI18n; this.check = tuiI18nCheck;', {
    I18n: { get language() { return lang; }, text: k => (dict && dict[k]) || k },
    window: { addEventListener: (n, f) => listeners.push([n, f]), dispatchEvent: e => { for (const [n, f] of listeners) if (n === e.type) f(e); return true; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  });
  return { ...t, setLang: l => { lang = l; }, setDict: d => { dict = d; } };
}

test('the language, then its late dictionary, each change tuiLang() and run the handlers', () => {
  const t = load();
  const a = t.ctx.lang(); // the first look: the page's language as it starts
  let runs = 0;
  t.ctx.on(() => runs++);
  assert.equal(t.ctx.lang(), a, 'nothing changed: same');
  t.setLang('de');
  const b = t.ctx.lang();
  assert.notEqual(b, a, 'language set');
  assert.equal(runs, 1);
  t.setDict({ Steering: 'Lenkung', Yes: 'Ja' });
  t.tick(); // the 200 ms check
  const c = t.ctx.lang();
  assert.notEqual(c, b, 'dictionary arrived: a module keyed on the language alone missed this');
  assert.equal(runs, 2);
  t.tick();
  assert.equal(t.ctx.lang(), c);
  assert.equal(runs, 2, 'no change, no redraw');
});

test('the fork modules key their redraws on tuiLang(), not on I18n.language', async () => {
  const { app } = await import('./stubs.mjs');
  const keyed = app.split('\n').filter(l => /I18n\.language/.test(l) && /JSON\.stringify|\+ '\|' \+|lastLang/.test(l)
    && !/^\s*\/\//.test(l) && !l.includes('TUI_I18N_PROBES'));
  assert.deepEqual(keyed, [], 'redraw keys still on I18n.language:\n' + keyed.join('\n'));
});
