// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// The fork's client files (review 10.11.2026, measure 10): js/tablet-*.js, each listed once in
// index.html after upstream's scripts and before js/frame.js, tablet-base.js first; every tested block lies whole in one
// file; the styles are css/tablet.css, linked after upstream's. Run: node --test Tests/web/fork-files.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { forkFiles } from './stubs.mjs';

const WWW = new URL('../../Shared/AgOpenWeb.RemoteServer/wwwroot/', import.meta.url);
const html = readFileSync(new URL('index.html', WWW), 'utf8');

test('every fork file is loaded once, in order, after upstream; the old single file is gone', () => {
  const onDisk = readdirSync(new URL('js/', WWW)).filter(f => /^tablet-[\w-]+\.js$/.test(f)).sort();
  assert.deepEqual([...forkFiles].sort(), onDisk, 'index.html lists exactly the js/tablet-*.js files');
  assert.equal(new Set(forkFiles).size, forkFiles.length, 'no file twice');
  assert.equal(forkFiles[0], 'tablet-base.js');
  const last = html.indexOf('/js/' + forkFiles[forkFiles.length - 1]);
  assert.ok(html.indexOf('/js/map-layers.js') < html.indexOf('/js/tablet-base.js'), 'after upstream\'s scripts');
  assert.ok(last < html.indexOf('/js/frame.js'), 'before frame.js: the connection and the map start once the fork is loaded');
  assert.ok(!existsSync(new URL('js/tablet.js', WWW)));
  assert.ok(!html.includes('<style id="tablet-ui">'));
  assert.ok(html.indexOf('/css/tool-panels.css') < html.indexOf('/css/tablet.css'), 'fork styles after upstream styles');
});

test('each tested block begins and ends in the same file; each file has its licence header', () => {
  for (const f of forkFiles) {
    const s = readFileSync(new URL('js/' + f, WWW), 'utf8');
    assert.ok(s.startsWith('// AgOpenWeb\n') && s.includes('SPDX-License-Identifier: Apache-2.0'), f);
    for (const m of s.matchAll(/^\/\/ ([\w-]+):begin$/gm)) assert.ok(s.includes('// ' + m[1] + ':end'), `${f}: ${m[1]} ends in another file`);
  }
});
