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

// Host-paket follow-up (feature/abnahme): the comparison's edge cases.
test('order by publication, not by list order or tag text (moritz.10 after moritz.9)', () => {
  const L = [rel('26.7.0-moritz.10', 'ddddddd444', '2026-10-27T10:00:00Z'), rel('26.7.0-moritz.9', 'eeeeeee555', '2026-10-26T09:00:00Z')].reverse();
  const r = U.compare(L, 'eeeeeee5');
  assert.equal(r.kind, 'newer'); assert.equal(r.latest.tag_name, '26.7.0-moritz.10');
});
test('the hash is matched without regard to case; "-dirty" is ignored', () => {
  assert.equal(U.compare(R, 'BBBBBBB2').kind, 'current');
  assert.equal(U.compare(R, 'AAAAAAA1-dirty').kind, 'newer');
});
test('unpublished entries and junk are skipped', () => {
  const L = [null, {}, rel('x', 'fffffff666', null), ...R];
  assert.equal(U.compare(L, 'fffffff6').kind, 'unknown');
  assert.equal(U.compare(L, 'fffffff6').latest.tag_name, '26.7.0-moritz.16');
  assert.equal(U.compare(null, 'aaaaaaa').kind, 'none');
});
test('a draft that is this build is not claimed as installed', () => assert.equal(U.compare(R, 'ccccccc3').kind, 'unknown'));

// feature/installer: channels. Stable = full releases only (the default); test = also pre-releases.
const C = [rel('26.7.0', 'aaaaaaa111', '2026-10-20T10:00:00Z'),
  rel('26.7.0-moritz.30', 'bbbbbbb222', '2026-10-25T10:00:00Z', { prerelease: true }),
  rel('26.7.1', 'ccccccc333', '2026-10-28T10:00:00Z'),
  rel('26.7.1-moritz.31', 'ddddddd444', '2026-10-29T10:00:00Z', { prerelease: true })];
test('stable channel: only full releases are offered', () => {
  const r = U.compare(C, 'aaaaaaa1');
  assert.equal(r.kind, 'newer'); assert.equal(r.latest.tag_name, '26.7.1');
  assert.equal(U.compare(C, 'ccccccc3').kind, 'current', 'the newest stable, though a newer test version exists');
});
test('test channel: pre-releases count too', () => {
  assert.equal(U.compare(C, 'ccccccc3', 'test').latest.tag_name, '26.7.1-moritz.31');
  assert.equal(U.compare(C, 'ccccccc3', 'test').kind, 'newer');
  assert.equal(U.compare(C, 'ddddddd4', 'test').kind, 'current');
});
test('a test version on the stable channel: a newer stable is offered, an older one is not', () => {
  assert.equal(U.compare(C, 'bbbbbbb2').kind, 'newer');
  assert.equal(U.compare(C, 'bbbbbbb2').latest.tag_name, '26.7.1');
  assert.equal(U.compare(C, 'ddddddd4').kind, 'ahead');
});
test('stable channel without any full release: none', () => assert.equal(U.compare([C[1], C[3]], 'bbbbbbb2').kind, 'none'));
