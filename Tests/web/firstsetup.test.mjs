// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// TabletFirstSetup (wwwroot/app.js, firstsetup:begin/end): the guide opens by itself once, on the
// device that has control, only while no vehicle profile exists; not when the guidance computer
// or this browser already has it as shown or done, not in a demo, not in an automated browser.
// Run: node --test Tests/web/firstsetup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cut, run } from './stubs.mjs';

const block = cut('// firstsetup:begin', '// firstsetup:end');

function load(g = {}) {
  const t = run(block + '\nthis.F = TabletFirstSetup;', {
    appInfo: { languages: [], currentLanguage: 'de', firstSetup: '' }, config: { vehicle: {}, gps: {}, tool: {} },
    profiles: { vehicles: [], tools: [] }, statusBar: {}, tick: null, scene: null, fieldOps: null,
    TabletLegal: { done: true }, TabletDemo: { active: false }, TabletProfiles: {}, TabletTerminal: { setMode() {} },
    TabletReady: { checks: () => [] }, TabletSteerConfirm: { confirmed: false }, sectionsWidthM: () => 0,
    ...g,
  });
  return { ...t, F: t.ctx.F };
}

test('no vehicle profile: opens once by itself and tells the guidance computer', () => {
  const t = load();
  t.tick();
  assert.equal(t.F.isOpen, true);
  assert.equal(t.store.get('aow.firstSetup'), 'shown');
  assert.ok(t.sent.includes('setup.first|shown'));
});

test('a vehicle profile exists: it does not open', () => {
  const t = load({ profiles: { vehicles: [{ name: 'Steyr' }], tools: [] } });
  t.tick();
  assert.equal(t.F.isOpen, false);
  assert.equal(t.store.get('aow.firstSetup'), undefined);
});

test('already shown or done, here or on the guidance computer: it does not open', () => {
  for (const firstSetup of ['shown', 'done']) {
    const t = load({ appInfo: { languages: [], currentLanguage: 'de', firstSetup } });
    t.tick();
    assert.equal(t.F.isOpen, false, 'host: ' + firstSetup);
  }
  const t = load();
  t.store.set('aow.firstSetup', 'done');
  t.tick();
  assert.equal(t.F.isOpen, false, 'this browser: done');
});

test('not without control, not in a demo, not before the legal notice, not in an automated browser', () => {
  for (const g of [{ iHoldControl: false }, { TabletDemo: { active: true } }, { TabletLegal: { done: false } }, { navigator: { webdriver: true } }]) {
    const t = load(g);
    t.tick();
    assert.equal(t.F.isOpen, false, JSON.stringify(g));
  }
});

test('a state this browser has but the guidance computer not yet is sent to it', () => {
  const t = load();
  t.store.set('aow.firstSetup', 'done');
  t.tick();
  assert.ok(t.sent.includes('setup.first|done'));
});
