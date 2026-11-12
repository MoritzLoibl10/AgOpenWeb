// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// TabletHostText (wwwroot/js/tablet-*.js, hosttext:begin/end): the host's English NTRIP texts in
// German, the address and the caster's reply kept as written (tablet test moritz.31, point 8:
// the Test button showed "Error: No answer from …"). The German comes from i18n/de.json.
// Run: node --test Tests/web/hosttext.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cut, run, fill } from './stubs.mjs';

const DE = JSON.parse(readFileSync(new URL('../../Shared/AgOpenWeb.RemoteServer/wwwroot/i18n/de.json', import.meta.url), 'utf8'));
const I18n = { language: 'de', text: k => DE[k] ?? k, t: (k, p) => (p ? fill(DE[k] ?? k, p) : k) };
const t = run(cut('// hosttext:begin', '// hosttext:end') + '\nthis.H = TabletHostText;', {
  I18n, tr: I18n.t, tuiIsDe: () => true, showToast() {}, MutationObserver: class { observe() {} }, Node: {}, NodeFilter: {},
});
const de = s => t.ctx.H.de(s);

test('NTRIP test and connection texts in German, values kept', () => {
  const cases = [
    ['Error: No answer from caster.example.at:2101.', 'Fehler: Keine Antwort von caster.example.at:2101.'],
    ['Error: Cannot reach 10.0.0.5:2101. Is the base station or caster switched on?', 'Fehler: 10.0.0.5:2101 nicht erreichbar. Ist die Basisstation bzw. der Caster eingeschaltet?'],
    ['Error: Cannot find apos.example. Check the address and your internet connection.', 'Fehler: apos.example nicht gefunden. Adresse und Internetverbindung prüfen.'],
    ['Error: Authentication failed (check username and password)', 'Fehler: Anmeldung fehlgeschlagen (Benutzername und Passwort prüfen)'],
    ['Error: Mount point not found', 'Fehler: Mountpoint nicht gefunden'],
    ['Error: caster.example:2101 closed the connection without answering.', 'Fehler: caster.example:2101 hat die Verbindung ohne Antwort beendet.'],
    ['Error: Cannot connect to h:1 (AccessDenied).', 'Fehler: Keine Verbindung zu h:1 (AccessDenied).'],
    ['Connection failed: No network connection.', 'Verbindung fehlgeschlagen: Keine Netzwerkverbindung.'],
    ['Rejected: Caster refused: HTTP/1.1 400 Bad Request', 'Abgelehnt: Caster lehnt ab: HTTP/1.1 400 Bad Request'],
    ['Error: Mount point is required', 'Fehler: Mountpoint fehlt'],
  ];
  for (const [en, want] of cases) assert.equal(de(en), want, en);
});

test('an unknown reason stays as the host wrote it, inside the German frame', () => {
  assert.equal(de('Error: something new'), 'Fehler: something new');
});

test('every NTRIP text the client knows has a German translation', () => {
  const block = cut('// hosttext:begin', '// hosttext:end');
  const keys = [...block.slice(block.indexOf('NT_EXACT'), block.indexOf('function ntDe')).matchAll(/tr\('((?:[^'\\]|\\.)*)'/g)].map(m => m[1]);
  assert.ok(keys.length >= 20, 'found ' + keys.length);
  for (const k of keys) assert.ok(DE[k] && DE[k] !== k, 'de.json: ' + k);
});
