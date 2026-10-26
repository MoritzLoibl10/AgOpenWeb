// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// TabletExplain (wwwroot/app.js, between explain:begin/end) in a real browser: a long press
// explains, a short press acts on release, and the buttons that switch steering, sections or
// outputs are left alone, so they act at once on touch. Needs Playwright with Chromium;
// skipped where it isn't installed, except with AOW_REQUIRE_BROWSER=1 (CI), where that fails.
// Run: node --test Tests/web/long-press.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const app = readFileSync(new URL('../../Shared/AgOpenWeb.RemoteServer/wwwroot/app.js', import.meta.url), 'utf8');
const block = app.slice(app.indexOf('// explain:begin'), app.indexOf('// explain:end'));
let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch (_) { /* not installed */ }

const IDS = ['rn-steer', 'rn-auto', 'rn-manual', 'rn-youturn', 'rn-isobus', 'rn-cycle', 'bn-headland', 'bn-secheadland', 'bn-tracks'];
const PAGE = `<!doctype html><body>${IDS.map(id => `<button id="${id}" style="width:80px;height:60px">${id}</button>`).join('')}
<script>
  const I18n = { text: k => k }; const tr = k => k;
  window.hits = {};
  for (const b of document.querySelectorAll('button'))
    b.addEventListener('pointerdown', () => { window.hits[b.id] = (window.hits[b.id] || 0) + 1; });
</script></body>`;

test('long press: actuating buttons act at once, others explain', { skip: !chromium && !process.env.AOW_REQUIRE_BROWSER && 'playwright not installed' }, async () => {
  assert.ok(chromium, 'playwright not installed');
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage();
    await p.setContent(PAGE);
    await p.addScriptTag({ content: block + '\nwindow.TabletExplain = TabletExplain;' });
    const centre = async id => { const b = await p.locator('#' + id).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    const hits = id => p.evaluate(i => window.hits[i] || 0, id);

    // Steer: switches on touch, while the finger is still down, and shows no explanation.
    for (const id of IDS.filter(i => i !== 'bn-tracks')) {
      const [x, y] = await centre(id);
      await p.mouse.move(x, y); await p.mouse.down();
      assert.equal(await hits(id), 1, id + ' acts on touch');
      await p.waitForTimeout(800);
      assert.equal(await p.evaluate(() => document.getElementById('tui-explain').hidden), true, id + ' shows no explanation');
      await p.mouse.up();
      assert.equal(await hits(id), 1, id + ' acts once');
    }

    // An explained button: a short press acts on release, a long press only explains.
    const [x, y] = await centre('bn-tracks');
    await p.mouse.move(x, y); await p.mouse.down();
    assert.equal(await hits('bn-tracks'), 0, 'held back while down');
    await p.mouse.up();
    assert.equal(await hits('bn-tracks'), 1, 'short press acts on release');
    await p.mouse.down(); await p.waitForTimeout(800); await p.mouse.up();
    assert.equal(await hits('bn-tracks'), 1, 'long press does not act');
    assert.equal(await p.evaluate(() => document.getElementById('tui-explain').hidden), false, 'long press explains');
  } finally { await browser.close(); }
});
