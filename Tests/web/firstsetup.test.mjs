// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// TabletFirstSetup (wwwroot/js/tablet-*.js, firstsetup:begin/end): the guide opens by itself once, on the
// device that has control, only while no vehicle profile exists (or only the host's untouched
// "Default"); not when the guidance computer
// or this browser already has it as shown or done, not in a demo, not in an automated browser.
// Run: node --test Tests/web/firstsetup.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// moritz.31, point 4: the host saves its untouched profile "Default" as soon as anything is saved,
// so after a new installation the list was never empty and the guide never came.
const HOSTDEF = { type: 0, wheelbase: 2.5, trackWidth: 1.8, antennaHeight: 3.0, antennaPivot: 0, antennaOffset: 0, hitchLength: 1.8, imuPivot: 0, imuHeight: 0, imuOffset: 0 };
const onlyDefault = (vehicle, extra = []) => ({ profiles: { activeVehicle: 'Default', activeTool: 'Default', vehicles: [{ name: 'Default', preview: '' }, ...extra], tools: [] }, config: { vehicle, gps: {}, tool: {} } });

test('only the host\'s untouched "Default" vehicle profile: opens', () => {
  const t = load(onlyDefault({ ...HOSTDEF, name: 'Default' }));
  t.tick();
  assert.equal(t.F.isOpen, true);
});

test('"Default" with one value changed, or a second profile: it does not open', () => {
  for (const [k, v] of [['wheelbase', 2.75], ['antennaHeight', 2.9], ['type', 1], ['antennaOffset', 0.1]]) {
    const t = load(onlyDefault({ ...HOSTDEF, [k]: v }));
    t.tick();
    assert.equal(t.F.isOpen, false, k);
  }
  const t = load(onlyDefault({ ...HOSTDEF }, [{ name: 'Steyr', preview: '' }]));
  t.tick();
  assert.equal(t.F.isOpen, false, 'second profile');
  const u = load({ ...onlyDefault({ ...HOSTDEF }), profiles: { activeVehicle: 'Steyr', vehicles: [{ name: 'Default' }], tools: [] } });
  u.tick();
  assert.equal(u.F.isOpen, false, 'another profile active');
});

test('"Default" before the active vehicle\'s values arrived: waits, then decides', () => {
  const t = load({ ...onlyDefault({ ...HOSTDEF }), config: null });
  t.tick();
  assert.equal(t.F.isOpen, false);
  t.ctx.config = { vehicle: { ...HOSTDEF }, gps: {}, tool: {} };
  t.tick();
  assert.equal(t.F.isOpen, true);
});

test('the untouched values are the host\'s own (VehicleConfig.cs and CreateDefaultProfile)', () => {
  const src = f => readFileSync(new URL('../../Shared/' + f, import.meta.url), 'utf8');
  const vc = src('AgOpenWeb.Models/Configuration/VehicleConfig.cs');
  const ps = src('AgOpenWeb.Services/VehicleProfileService.cs');
  const create = ps.slice(ps.indexOf('public void CreateDefaultProfile'), ps.indexOf('store.Guidance', ps.indexOf('public void CreateDefaultProfile')));
  const js = cut('// firstsetup:begin', '// firstsetup:end');
  const table = JSON.parse(js.match(/HOST_DEFAULT_VEHICLE = (\{[^}]*\})/)[1].replace(/(\w+):/g, '"$1":'));
  assert.deepEqual(table, HOSTDEF);
  const cs = { type: 'Type', wheelbase: 'Wheelbase', trackWidth: 'TrackWidth', antennaHeight: 'AntennaHeight', antennaPivot: 'AntennaPivot', antennaOffset: 'AntennaOffset', hitchLength: 'HitchLength', imuPivot: 'ImuPivot', imuHeight: 'ImuHeight', imuOffset: 'ImuOffset' };
  for (const [k, n] of Object.entries(cs)) {
    const field = '_' + n[0].toLowerCase() + n.slice(1);
    const init = vc.match(new RegExp('private \\w+ ' + field + ' = ([^;]+);'));
    const set = create.match(new RegExp('store\\.Vehicle\\.' + n + ' = ([^;]+);'));
    assert.ok(init && set, n + ' not found');
    const val = s => (s.includes('VehicleType.Tractor') ? 0 : parseFloat(s));
    assert.equal(val(init[1]), table[k], 'VehicleConfig.' + n);
    assert.equal(val(set[1]), table[k], 'CreateDefaultProfile ' + n);
  }
});
