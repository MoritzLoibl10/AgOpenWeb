// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// tuiSimInMenu (wwwroot/app.js, simaccess:begin/end): the simulator switch is in the normal menu
// only in test versions; otherwise under "Expert" and through the demo mode.
// Run: node --test Tests/web/simaccess.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cut } from './stubs.mjs';

const f = new Function(cut('// simaccess:begin', '// simaccess:end') + '\nreturn tuiSimInMenu;')();

test('a build found as a pre-release is a test version, whatever the channel', () => {
  assert.equal(f({ hash: 'abc1234', pre: true }, 'abc1234', 'stable'), true);
  assert.equal(f({ hash: 'abc1234', pre: true }, 'abc1234-dirty', 'stable'), true);
});
test('a build found as a stable release hides it, even on the test channel', () =>
  assert.equal(f({ hash: 'abc1234', pre: false }, 'abc1234', 'test'), false));
test('unknown build (no check yet, or another build): the channel decides', () => {
  assert.equal(f(null, 'abc1234', 'stable'), false);
  assert.equal(f(null, 'abc1234', 'test'), true);
  assert.equal(f({ hash: 'old0000', pre: true }, 'abc1234', 'stable'), false);
});
