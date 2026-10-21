// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

// Kurs-Prüfstand ohne Hardware: spielt ein GPS- und ein Lenkmodul (UDP an den Host, :9999).
// GGA + VTG mit 10 Hz (15 s nach Osten, 90°-Linkskurve über 5 s, dann nach Norden) und PGN 253
// mit dem IMU-Kurs-Rohwert aus dem ersten Argument: 0 wie die AiO-v26-Firmware, 9999 wie die
// AiO-v4-Firmware (= kein IMU). Schaltet den Simulator aus, stellt den Einrichtungsmodus ein
// und schreibt alle 0,5 s mit: GPS-Kurs, IMU-Kurs empfangen / mit Versatz, Fahrzeugkurs und
// den Text der Karte „Kurs-Prüfung“. Host vorher mit restart-host.sh starten.
//
//   node heading-bench.js <imuRaw> <out.json> [screenshot.png]     (VP=1024x600 für 7 Zoll)
const dgram = require('dgram');
const { chromium } = require('playwright');
const L = require('/home/user/AgOpenWeb/Tools/ui-audit/lib.js');
const imuRaw = +process.argv[2], OUT = process.argv[3], SHOT = process.argv[4];
const sock = dgram.createSocket('udp4');
const send = b => sock.send(b, 9999, '127.0.0.1');
const cks = s => { let c = 0; for (const ch of s) c ^= ch.charCodeAt(0); return c.toString(16).toUpperCase().padStart(2, '0'); };
const nmea = body => '$' + body + '*' + cks(body) + '\r\n';
const dm = (v, lat) => { const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
  return (lat ? String(d).padStart(2, '0') : String(d).padStart(3, '0')) + m.toFixed(7).padStart(10, '0'); };
const pgn253 = h => { const b = Buffer.from([0x80, 0x81, 0x7E, 0xFD, 8, 0, 0, h & 0xFF, (h >> 8) & 0xFF, 0xB8, 0x22, 0, 0, 0]);
  let c = 0; for (let i = 2; i < 13; i++) c += b[i]; b[13] = c & 0xFF; return b; };   // roll 8888 = none
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const { page: p } = await L.openPage(browser, { url: 'http://localhost:5174/', viewport: (([w, h]) => ({ width: +w, height: +h }))((process.env.VP || '1280x800').split('x')), localStorage: { 'aow.ui.scale': 'glove' } });
  await p.waitForTimeout(2000);
  if (await p.evaluate(() => statusBar && statusBar.simEnabled)) { await p.evaluate(() => transport.send('sim.toggleEnable')); await p.waitForTimeout(1500); }
  await p.evaluate(() => TabletTerminal.setMode('setup'));
  let lat = 48.2, lon = 16.37, hdg = 90; const v = 2.5; // m/s ≈ 9 km/h
  const rec = []; let t = 0;
  const timer = setInterval(() => {
    t += 0.1;
    if (t > 15 && t <= 20) hdg -= 90 / 50;               // 90° left over 5 s
    const r = hdg * Math.PI / 180;
    lat += v * 0.1 * Math.cos(r) / 111320; lon += v * 0.1 * Math.sin(r) / (111320 * Math.cos(lat * Math.PI / 180));
    const ts = new Date(); const hms = ts.toISOString().slice(11, 19).replace(/:/g, '') + '.' + String(Math.floor(ts.getUTCMilliseconds() / 100));
    send(Buffer.from(nmea(`GPGGA,${hms},${dm(lat, 1)},N,${dm(lon, 0)},E,4,14,0.8,171.0,M,44.0,M,1.0,0000`)
      + nmea(`GPVTG,${((hdg % 360) + 360) % 360},T,,M,${(v * 1.94384).toFixed(2)},N,${(v * 3.6).toFixed(2)},K,D`)));
    send(pgn253(imuRaw));
  }, 100);
  for (let i = 0; i < 60; i++) {
    await p.waitForTimeout(500);
    const s = await p.evaluate(() => ({ gps: tick && tick.chartGpsHeading, imuCorr: tick && tick.chartImuHeading,
      imuRaw: statusBar && statusBar.systemData ? statusBar.systemData.imuHeading : null,
      pose: lastTick ? lastTick.heading : null, rev: !!(tick && tick.op && tick.op.reverse), spd: lastTick ? lastTick.speed : null,
      warn: (document.getElementById('tui-hdgchk') || {}).textContent || '' }));
    s.t = +(i * 0.5).toFixed(1); s.truth = Math.max(0, 90 - Math.max(0, Math.min(5, s.t - 15)) * 18); rec.push(s);
    if (SHOT && i === 40) await p.screenshot({ path: SHOT });
  }
  clearInterval(timer);
  require('fs').writeFileSync(OUT, JSON.stringify(rec, null, 0));
  for (const r of rec.filter((_, k) => k % 4 === 0)) console.log(JSON.stringify(r));
  sock.close(); await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
