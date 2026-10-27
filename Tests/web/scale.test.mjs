// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// tuiInitialScale (wwwroot/app.js, scale-default:begin/end): new devices start with the glove
// size, devices that used the app before keep theirs, a stored choice always wins.
// Run: node --test Tests/web/scale.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cut } from './stubs.mjs';

const f = new Function(cut('// scale-default:begin', '// scale-default:end') + '\nreturn tuiInitialScale;')();

test('a new device starts with the glove size and stores it', () =>
  assert.deepEqual(f(null, [], false), { scale: 'glove', store: true }));
test('a device that used the app keeps the size it had (normal) and stores it', () => {
  assert.deepEqual(f(null, ['aow.worklog.v1', 'other'], false), { scale: 'normal', store: true });
  assert.deepEqual(f(null, ['agopenweb.lang'], false), { scale: 'normal', store: true });
});
test('a stored choice always wins', () => {
  assert.deepEqual(f('large', [], false), { scale: 'large', store: false });
  assert.deepEqual(f('normal', [], false), { scale: 'normal', store: false });
});
test('automated browsers keep normal and store nothing', () =>
  assert.deepEqual(f(null, [], true), { scale: 'normal', store: false }));
