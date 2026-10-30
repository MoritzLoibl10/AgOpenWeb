# Issues für upstream (AgOpenGPS-Official/AgOpenWeb)

Fertige englische Texte zum Kopieren: je Issue der Titel und der Text in getrennten Blöcken.
Ein viertes Thema, die uneinheitliche Lizenz, hat upstream selbst erledigt (#360, #363); dazu
ist kein Issue mehr nötig. Geprüft gegen upstream `develop` am 20.10.2026 (Commit 9705344). Ob es upstream schon passende
Issues gibt, ließ sich aus der Fork-Sitzung nicht prüfen; vor dem Anlegen kurz suchen.

| Nr. | Thema | Stand |
|---|---|---|
| 1 | IMU-Kurs aus PGN 253 (#357) | Entwurf fertig (27.10.2026), einreichen |
| 2 | Mehrgeräte-Sicherheit (Beobachter-Rechte, gleichzeitiges Speichern, Klartext-Passwörter) | upstream erledigt (#397: #404, #402) |
| 3 | Arbeitsbreite: Ersatzwert 6 m im Web-Client | upstream erledigt (#398: #401) |
| 4 | **Dringend:** Eine Antenne, zuerst rückwärts (Ausfahren aus der Halle) → Richtung verkehrt gelernt, Motor lenkt falsch herum | Entwurf fertig (27.10.2026), einreichen, zuerst |
| 5 | MinFixQuality vergleicht die NMEA-Zahl: RTK Float (5) besteht die Vorgabe RTK Fix (4) | Entwurf fertig (27.10.2026), einreichen |
| 6 | Simulator mit Teilbreiten: Bedienseite hängt bei jedem Abdeckungs-Update ~1 s, Totmann (1,5 s) nimmt die Bedienung weg, Lenkung geht aus | Entwurf fertig (30.10.2026), einreichen |

## 1. IMU heading from PGN 253 (#357): AiO v26 sends 0 for "no IMU", which now goes into the heading fusion as a real heading

Stand: **Entwurf zum Einreichen** (Struktur Beschreibung / Schritte / Erwartung / Ist). Code-Stellen
geprüft gegen upstream `develop` e20c6a29 (27.10.2026). Fork: `docs/Offene-Punkte.md` Punkt 32.

**Titel:**

~~~~text
IMU heading from PGN 253 (#357): AiO v26 sends 0 for "no IMU", which is used as a real heading
~~~~

**Text:**

~~~~markdown
### Description
Since #357 the host takes the IMU heading from PGN 253, bytes 7–8, whenever the GPS sentence carries none, and blends it into the heading fusion. "No IMU" is recognised only as 9999:
`PgnBuilder.TryParseSteerData`: `bool hasImuHeading = headingRaw != 9999;` (PgnBuilder.cs:782).

The AiO v26 firmware (`Firmware_Teensy_AiO_26`, commit 2551bff) always sends 0 there:
`lib/aio_autosteer/AutosteerProcessor.cpp`, lines 1148–1149, packed at 1171–1174:
```cpp
int16_t heading = 0;            // Deprecated - sent by GNSS
int16_t roll = 0;               // Deprecated - sent by GNSS
```
Two v26 setups therefore have no IMU heading in the sentence, and the host uses PGN 253 = 0° as an IMU heading:
- v26 without an IMU: `$PANDA` carries 65535 (`lib/aio_navigation/NAVProcessor.cpp`, line 150; set from the IMU only when `imuProcessor.hasValidData()`, lines 155–157);
- v26 with GPS pass-through: no `$PANDA` at all (line 298), plain GGA/VTG even with an IMU fitted.

The AiO v4 firmware (`AgOpenGPS-Official/Boards`, commit 60e8d89) sends 9999 / 8888 (`Autosteer.ino`, Keya build lines 655–660, standard build 603–608), so it is not affected. #357's commit message already mentions the v26 zero (Firmware_Teensy_AiO_26#60).

### Steps to reproduce
1. Desktop head `--headless`, simulator off.
2. Play over UDP to port 9999: `$GPGGA` + `$GPVTG` at 10 Hz, 2.5 m/s, 15 s east, a 90° left turn over 5 s, then north; and PGN 253 at 10 Hz with heading raw = 0 (as v26 sends it).
3. Read `statusBar.systemData.imuHeading`, `tick.chartImuHeading`, `tick.chartGpsHeading` and the vehicle heading in the web client.
4. Repeat with heading raw = 9999 (as v4 sends it).

Bench script: `Tools/ui-audit/heading-bench.js` in MoritzLoibl10/AgOpenWeb (`node heading-bench.js 0 out.json`).

### Expected
A module that sends 0 for "no IMU" is not taken as a heading source; the vehicle heading follows the GPS through the turn as with 9999.

### Actual
| | 9999 (v4) | 0 (v26) |
|---|---|---|
| IMU heading (as received) | none (NaN) | 0.0°, accepted as valid |
| IMU + offset vs GPS in the turn | — | up to ~28° apart |
| Vehicle heading error, 1–7 s after the turn | ≤ 1.8° | up to 9°, decaying over several seconds |

Why: in `GpsHeadingFusionService` the result is IMU + `_imuGpsOffset`, and the offset is pulled toward the GPS heading by `FusionWeight` per step (GpsHeadingFusionService.cs:256–257; weight = share × 0.2, line 305). A constant 0 is a gyro that never turns, so the heading lags every turn. Not reproduced, but the same code: the reverse check (lines 242–243) flips the heading when IMU + offset is more than 90° from the fix-to-fix heading; a sharp enough turn could get there. No setting stops a module heading from being used.

### Proposal
1. Firmware: send 9999 / 8888 when there is no IMU or the IMU goes out in the sentence (Firmware_Teensy_AiO_26#60).
2. Host, until every firmware does: accept a PGN 253 / 211 heading only once it has changed while the fix-to-fix heading changed, and/or a setting "Use IMU heading from the steer module".
3. UI: show the received IMU heading next to the GPS heading, with a warning when it stays exactly 0 while driving (our fork does this in setup mode; happy to send a PR).
~~~~

## 2. Multi-client safety: observers can change vehicle geometry, concurrent saves interleave, credentials go to every LAN client

Stand: anlegen. Fork: `docs/Offene-Punkte.md` Punkte 3, 4, 5.

**Titel:**

~~~~text
Multi-client safety: observers can change vehicle geometry, concurrent saves interleave, credentials go to every LAN client
~~~~

**Text:**

~~~~markdown
While reviewing a fork that runs several tablets against one host, I found three related issues in how the host treats clients other than the operator. All three are in the current `develop` (9705344). None of this is a bug in one place; it is about which commands need control and what the host sends to whom. I'm reporting them together because the fixes touch the same areas (`IsRestrictedCommand`, the profile commands, the projectors).

### 1. Observers can change geometry and load profiles, also while AutoSteer is engaged

`IsRestrictedCommand` (RemoteServerWiring.cs:698) treats `section.`, `autosteer.`, `youturn.`, `contour.`, `track.`, `headland.` (and a few more) as Tier-2. `config.set|…` and `profile.*` are Tier-1, so any connected client can send them at any time:

- `config.set|vehicle.wheelbase:…`, `vehicle.antennaPivot`, `vehicle.antennaOffset`, `tool.offset`, section widths …
- `profile.load|<vehicle>\t<tool>`, `profile.delete`, `profile.configureVehicle` …

**Example:** the operator holds control, steering is engaged on a pass (or off at the headland, about to re-engage). A second browser (an office PC, a phone, a second tablet in observer mode) opens Vehicle settings and changes the antenna offset or loads another vehicle. The host applies it immediately, and guidance runs on the new geometry.

**Proposal:**
- Treat geometry keys of `config.set` (vehicle and tool dimensions, antenna, sections) and the `profile.*` commands that change the active pair as Tier-2, or
- at least reject them while AutoSteer is engaged or the vehicle is moving, with a toast to the sender.
- Read-only commands and display settings can stay Tier-1.

### 2. Two clients saving at the same time interleave; one can write into the other's profile

Each WebSocket message is posted to the dispatcher on its own (`WebSocketHub` → `server.CommandHandler` → `dispatcher.Post`). A client that saves a profile sends a burst: `config.set|…` ×N, then `profile.save`. If another client sends `profile.load|Y` in between, the rest of the first client's values and its `profile.save` go to profile Y and are written to Y's file. Nothing tells either user.

Related: `profile.new` copies whatever profile is active when it runs, and `profile.load` / `profile.new` save the outgoing pair first. A load that lands in the middle of another client's edit therefore persists a half-applied state.

**Proposal:** one command that applies a set of values to a named profile in a single dispatcher step and fails if that profile is not the active one, e.g.

```
profile.apply|<vehicle|tool>\t<name>\t<key:value>\t<key:value>…
```

The dialogs can keep their per-field `config.set` for live preview. Saving would then use `profile.apply`, or `profile.save|<vehicle>\t<tool>`, which refuses when the active names differ. A small reply ("saved" / "not saved: profile changed") would also let clients show an honest result; today `profile.save` sends nothing back.

### 3. NTRIP passwords and the AgShare API key go to every client in plain text

- `SceneProjector` puts `Password` into each `NtripProfileDto` (line 464), and `WireCodec` sends it to every connected client in the NtripProfiles frame. The same goes for the AgShare `ApiKey`.
- Anyone who opens `http://<host>:5174` on the LAN, without signing in, receives all caster passwords and the API key.
- Bug report ZIPs under `/bugreports/` can be downloaded by anyone who knows the file name. The name is in the status every client receives.
- The bug report itself redacts the credentials correctly (`DebugDumpService.RedactSecrets`). This is only about the live wire and the download route.

**Proposal:**
- Don't project secrets. Send a "set / not set" flag, or a fixed placeholder, and treat an empty or placeholder password in `ntrip.save` as "unchanged". The editor would show "••••••" and only send a new value when the user types one.
- Same for the AgShare key.
- Serve `/bugreports/` only to the client holding control, or use an unguessable name per report.

### Environment

`develop` at 7a8f3f8 (unchanged in these parts at 9705344), Desktop head `--headless` with the simulator. Found by reading the code along the paths named above. 1 reproduced with two browsers: the second one (no control, `iHoldControl === false`) sent `config.set|vehicle.antennaOffset:0.42` and the operator's client showed the antenna offset change from 0 to 0.42 m. 2 and 3 not reproduced, only traced. Not tested on real hardware.

I'm happy to send PRs for any of these once you've said which direction you prefer, especially for 2, which needs a new command.
~~~~

## 3. Web client: tool width falls back to a made-up 6 m

Stand: anlegen. Teil 2 des früheren Textes (Profilvorschau zeigt `Tool.Width`) ist gestrichen: upstream #350 zeigt dort jetzt `ActualToolWidth`. Fork: `docs/Offene-Punkte.md` Punkt 26.

**Titel:**

~~~~text
Web client: tool width falls back to a made-up 6 m
~~~~

**Text:**

~~~~markdown
**What happens**

`toolWidthM()` in `wwwroot/app.js` returns 6 m when the scene has no tool sections. Callers use it as the real width:

- Field Builder → Add Headland → "N tool widths" (`fbApplyTw()`) fills the inset with N × 6 m, which is sent with the headland command if accepted.
- `fbDefaultOffset()` (empty inset box) gives 12 m.
- The rate (ha/h) is computed from 6 m, in the status line and on the Field data card (`renderFieldCard()`, #322).
- Extra guidelines and the map grid use 6 m spacing (display only).

**Expected**

No invented width: without sections, leave the inset empty and say the width is missing; show "—" for the rate.

Note: `ConfigurationStore.ActualToolWidth` itself falls back to `Tool.Width` when the section sum is 0.

Checked against `develop` at 9705344.
~~~~

## 4. Urgent: single antenna, backing out first (e.g. out of the shed) → the heading is learned backwards and the motor steers the wrong way

Stand: **Entwurf zum Einreichen**, dringend. Code-Stellen geprüft gegen upstream `develop` e20c6a29
(27.10.2026). Fork: `docs/Bericht-Simulator-Richtung.md`.

**Titel:**

~~~~text
Single antenna: backing out first learns the heading backwards; steering and sections then work for the wrong direction
~~~~

**Text:**

~~~~markdown
### Description
With one antenna (with or without an IMU) the first heading is taken from the first travel above the fix-to-fix distance and is assumed to be forward (`GpsHeadingFusionService.TryStartHeading`, GpsHeadingFusionService.cs:338). If that travel is backwards — backing out of the shed, the most ordinary start of the day — the heading is learned facing backwards. With an IMU the offset snaps onto it (`_imuGpsOffset = Wrap(AngleDelta(imuRad, _gpsHeading))`, line 360). It stays that way until the operator taps the vehicle ("Reset direction"); it does not wear off with distance. The behaviour is known — the test `StartedWhileBacking_ForwardTravelReadsAsReverse_UntilTheDirectionIsReset` (GpsHeadingFusionServiceTests.cs:433) calls it "the trap" — but what it does to steering and sections is not visible.

The simulator falls into it every time it starts backwards: it reports a signed speed (`Speed = simulatedData.SpeedKmh / 3.6`, MainViewModel.Simulator.cs:101), but the fusion uses `Math.Abs(speedMs)` (GpsHeadingFusionService.cs:146).

### Steps to reproduce (simulator)
1. Open a field with an AB line about 8° off the vehicle's heading.
2. Start the simulator and set −3 km/h first (backwards).
3. Then set +3 km/h (forward) and switch AutoSteer on.
4. Compare with a start at +3 km/h.

### Expected
Forward travel reads as forward; the vehicle captures the line; sections and steering follow the real direction.

### Actual
After the backwards start: heading 180° out, the REVERSE badge shows while driving forward. Started forward the sim captures the line (XTE < 0.1 m); started backwards it runs off and swings (XTE up to 25 m, steer angle −35° … +23°). In the host:

| Really | Host thinks | Effect |
|---|---|---|
| forward | reverse | Auto sections stay off; steering paused (`steerPaused`, GpsPipelineService.cs:1018), **unless "Steer in reverse" is on: then the motor steers with the reverse computation while driving forward** |
| backing | forward | No reverse pause: **with AutoSteer engaged the motor steers with the forward computation while backing**; auto sections are not switched off |

Reverse detection with an IMU: travel more than 90° off IMU + offset (lines 242–243); without an IMU: the filtered change against the last heading (line 273). Both keep the flipped reference. Dual antenna is not affected. In the simulator the paused steer still follows guidance (`simFollowsGuidance = g.HasGuidance && IsAutoSteerEngaged`, MainViewModel.ApplyResults.cs:231), which is the swinging above; a real motor would stand still while paused. Not tested on real hardware.

### Proposal
1. Simulator: follow guidance only while it really steers (engaged and not paused); and/or use the sign of the simulator's speed for the first heading (NMEA speed is unsigned, real GPS unchanged).
2. Single antenna: make the trap visible — say when the first heading was learned ("if the vehicle faces the wrong way, tap it"), and don't allow engaging AutoSteer until the direction is confirmed by the operator or by travel with a steer angle (with IMU and WAS: a left steer angle turns the heading left driving forward, right when backing).
3. Optionally keep the IMU offset across restarts while IMU and antenna haven't moved.

Our fork shows, in the web client only, a card "Does the vehicle face the way it drives?" after every (re)connection, a warning in the simulator when the speed sign and the reverse flag disagree, and a ready light that stays yellow until the direction is confirmed. For real GPS the client cannot tell the trap itself, so this needs the host.
~~~~

## 5. MinFixQuality compares the NMEA number: RTK Float (5) passes the default minimum RTK Fixed (4)

Stand: **Entwurf zum Einreichen**. Code-Stellen geprüft gegen upstream `develop` 77a03518
(27.10.2026). Im Fork nur in der Ampel abgefangen (strenger als der Host, `docs/Host-Aenderungen.md` 17);
der Host-Vergleich ist unverändert.

**Titel:**

~~~~text
MinFixQuality compares the NMEA fix number, so RTK Float (5) passes the default minimum RTK Fixed (4)
~~~~

**Text:**

~~~~markdown
### Description
The guidance quality gate compares the GGA fix quality as a number:

- `Shared/AgOpenWeb.Services/Gps/GpsFixQualityValidator.cs:33`: `if (fixQuality < config.MinFixQuality)` → rejected.
- `Shared/AgOpenWeb.Models/Configuration/ConnectionConfig.cs:200`: default `_minFixQuality = 4` (RTK Fixed).
- `Shared/AgOpenWeb.Services/Pipeline/GpsPipelineService.cs:583–586`: a rejected fix sets `data.IsValid = false`; the comment at line 578 reads "fell below MinFixQuality (default 4 = RTK Fixed)".

The NMEA numbers are not ordered by quality: 4 = RTK Fixed, 5 = RTK Float, 6 = estimated (dead reckoning), 7 = manual input, 8 = simulation. With the default 4, every one of 5–8 is `>= 4` and passes the gate.

### Steps to reproduce
1. Default settings (MinFixQuality 4).
2. Feed GGA sentences with fix quality 5 (RTK Float), e.g. a receiver losing its fix, or a replayed log.
3. Check `GpsData.IsValid` after the pipeline's quality gate (or engage AutoSteer on a line).

### Expected
With the minimum set to RTK Fixed, RTK Float (and estimated/manual/simulated fixes) are refused like DGPS or GPS: `IsValid = false`, as the comment at line 578 describes.

### Actual
Fix quality 5, 6, 7 and 8 pass (`5 < 4` is false); `IsValid` stays true and guidance runs on an RTK Float position, which can be off by decimetres.

### Proposal
Compare by a quality rank instead of the number, e.g. 4 > 5 > 2 = 3 > 1, with 0 and 6–8 as no usable fix, in `GpsFixQualityValidator`; keep the setting's meaning ("at least this good"). Not tested on real hardware.
~~~~

## 6. Coverage painting stalls the web client for ~1 s per update; the 1.5 s deadman then revokes control and AutoSteer disengages

Stand: **Entwurf zum Einreichen**. Nachgestellt am 30.10.2026 mit upstream `develop` ca44833e
(unverändert gebaut) und mit dem Fork, gleiches Ergebnis. Befund am Tablet: Simulator, ohne GPS
und Kit, nach einigen Sekunden Fahrt geht die Lenkung aus und lässt sich nur kurz wieder
einschalten. Messung: `Tools/sim-soak.mjs` (Fork) bzw. das Skript unten. Der Fork ändert an der
Lenkung, am Totmann und am Zeichnen der Abdeckung nichts; er schickt `autosteer.off` nur beim
Beenden des Vorführmodus (im Versuch nicht aktiv).

**Titel:**

~~~~text
Web client: coverage painting blocks the main thread ~1 s per update; the 1.5 s control deadman then disengages AutoSteer
~~~~

**Text:**

~~~~markdown
### Description
With sections on, every coverage update makes the web client's main thread busy for roughly 0.8–1.2 s
(headless Chromium, SwiftShader WebGL). The control heartbeat (`control.presence`, `setInterval` 500 ms
in app.js) runs on that thread; `ControlAuthority.DeadmanMs` is 1500 ms. When one stall plus the
heartbeat phase passes 1.5 s, the host revokes control, `AuthorityChangedHandler` toggles AutoSteer
off and the sections off, and the client reclaims the empty seat a moment later. To the operator:
steering switches itself off a few seconds after the sections start, and again soon after each
re-engage.

Likely cause: `drawCoverageSk` draws the new cells into the coverage render target and then takes
`makeImageSnapshot()` every frame with new cells. The next draw into a surface that has a live
snapshot copies the whole texture (copy-on-write). A field without a boundary gets coverage bounds
of 500 m × 500 m at 0.1 m (host log: `Display 5000x5001 @ 0.10m = 25,005,000 pixels / 47.7MB`), so
each copy moves a ~100 MB RGBA texture. Chromium logs `GPU stall due to ReadPixels`. A CPU profile
over 15 s (fork build, same rendering code) spends ~98 % in "(program)" (GPU/native); the app's own
JS is a few hundred ms.

### Steps to reproduce (develop ca44833e)
1. `AGOPENWEB_DATA=<empty dir> AgOpenWeb.Desktop --headless`; open the UI (simulator is on by default).
2. `field.new|Repro`, `field.startJob|Repro\tSpraying\t\tJob1`, `sim.speedUp` ×4 (2 km/h),
   `track.aPlus`, `autosteer.toggle`, `section.master`.
3. Watch the time between tick frames in the page (`lastTick.t`) and `iHoldControl`.

### Expected
Ticks every ~100 ms; AutoSteer stays engaged while driving straight in the simulator.

### Actual
Without sections: no gap above 600 ms in 60 s. With sections: a tick gap of 0.75–1.2 s about
every second for the whole run. In one of two upstream runs (1920×1200, dpr 1.5), about 14 s after
engaging:
`as=false`, `iHoldControl=false`, 0.4 s later control back — AutoSteer off by the deadman. A
WebSocket client in another process (no rendering) receives ticks without gaps at the same time,
so the host sends on time; the browser cannot read them.

### Notes
- On a tablet with a weaker GPU the stalls are longer, so the deadman trips more often.
- Ideas: no per-frame snapshot of the whole surface (draw the surface's texture directly, or
  tile the coverage), smaller default bounds without a boundary, or a heartbeat that is not
  starved by rendering (keeping the deadman's purpose: a frozen UI must still stop the machine).
~~~~

