// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// TabletUpdate.compare (wwwroot/app.js, update:begin/end): when a newer release is claimed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../Shared/AgOpenWeb.RemoteServer/wwwroot/app.js', import.meta.url), 'utf8');
const block = app.slice(app.indexOf('// update:begin'), app.indexOf('// update:end'));
const U = new Function('I18n', 'tr', 'BRAND', 'appInfo', block + '\nreturn TabletUpdate;')(
  { text: k => k }, k => k, { source: 'https://github.com/MoritzLoibl10/AgOpenWeb' }, null);

const rel = (tag, sha, at, extra = {}) => ({ tag_name: tag, name: tag, target_commitish: sha, published_at: at, html_url: 'u/' + tag, ...extra });
const R = [rel('26.7.0-moritz.15', 'aaaaaaa111', '2026-10-26T15:46:00Z'),
  rel('26.7.0-moritz.16', 'bbbbbbb222', '2026-10-26T17:49:00Z'),
  rel('26.7.0-moritz.17', 'ccccccc333', '2026-10-26T18:20:00Z', { draft: true })];

test('newer only when this build is a release and a later one exists', () => {
  const r = U.compare(R, 'aaaaaaa1');
  assert.equal(r.kind, 'newer'); assert.equal(r.latest.tag_name, '26.7.0-moritz.16'); assert.equal(r.mine.tag_name, '26.7.0-moritz.15');
});
test('newest release = this build', () => assert.equal(U.compare(R, 'bbbbbbb-dirty'.replace('-dirty', '2-dirty')).kind, 'current'));
test('drafts never count', () => assert.equal(U.compare(R, 'bbbbbbb2').latest.tag_name, '26.7.0-moritz.16'));
test('unknown build: no claim, newest shown', () => {
  const r = U.compare(R, '1234567'); assert.equal(r.kind, 'unknown'); assert.equal(r.latest.tag_name, '26.7.0-moritz.16');
});
test('short or missing hash is not matched', () => assert.equal(U.compare(R, 'aaa').kind, 'unknown'));
test('no releases', () => assert.equal(U.compare([], 'aaaaaaa').kind, 'none'));
