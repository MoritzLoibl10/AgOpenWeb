# Issues für upstream (AgOpenGPS-Official/AgOpenWeb)

Fertige englische Texte zum Kopieren: je Issue der Titel und der Text in getrennten Blöcken.
Ein viertes Thema, die uneinheitliche Lizenz, hat upstream selbst erledigt (#360, #363); dazu
ist kein Issue mehr nötig. Geprüft gegen upstream `develop` am 20.10.2026 (Commit 9705344). Ob es upstream schon passende
Issues gibt, ließ sich aus der Fork-Sitzung nicht prüfen; vor dem Anlegen kurz suchen.

| Nr. | Thema | Stand |
|---|---|---|
| 1 | IMU-Kurs aus PGN 253 (#357) | anlegen |
| 2 | Mehrgeräte-Sicherheit (Beobachter-Rechte, gleichzeitiges Speichern, Klartext-Passwörter) | anlegen |
| 3 | Arbeitsbreite: Ersatzwert 6 m im Web-Client | anlegen (Teil „Profilvorschau“ gestrichen, #350 hat ihn behoben) |
| 4 | Eine Antenne: rückwärts zuerst gefahren → Richtung verkehrt gelernt, Lenkung rechnet falsch herum (Simulator pendelt) | anlegen (geprüft gegen d075aa2) |

## 1. IMU heading from PGN 253 (#357): AiO v26 sends 0 for "no IMU", which now goes into the heading fusion as a real heading

Stand: anlegen. Bezug: upstream #357; Fork: `docs/Offene-Punkte.md` Punkt 32.

**Titel:**

~~~~text
IMU heading from PGN 253 (#357): AiO v26 sends 0 for "no IMU", which now goes into the heading fusion as a real heading
~~~~

**Text:**

~~~~markdown
Since #357 the host takes the IMU heading from PGN 253, bytes 7–8. It does this whenever the GPS sentence carries none, and blends it into the heading fusion. "No IMU" is recognised only as 9999 (`PgnBuilder.TryParseSteerData`, `bool hasImuHeading = headingRaw != 9999;`, PgnBuilder.cs:657). The #357 commit message already mentions that AiO v26 sends 0 there (Firmware_Teensy_AiO_26#60). Here is what the firmware sends, and what that does in the host.

### What the firmware sends in PGN 253

**AiO v4 firmware** (`AgOpenGPS-Official/Boards`, commit 60e8d89), used for AiO v4.x boards. This includes the Keya/CAN build `TeensyModules/AIO v4 Firmware/AIO_v4_Firmware_Keya_CANBUS_HPR_Dual_27.04.2025`.

Heading and roll are always the "none" values, whether or not a BNO08x is found:
- Keya build, `Autosteer.ino`, lines 655–660:
  ```c
  // heading
  PGN_253[7] = (uint8_t)9999;
  PGN_253[8] = 9999 >> 8;
  // roll
  PGN_253[9] = (uint8_t)8888;
  PGN_253[10] = 8888 >> 8;
  ```
- Standard build, `AIO_v4_Firmware/Autosteer.ino`, lines 603–608: the same.
- The IMU goes into `$PANDA` instead (`zHandlers.ino`):
  - RVC mode: `itoa(bnoData.yawX10, imuHeading, 10)`, line 148 (standard build: line 112).
  - No IMU and no dual: `itoa(65535, imuHeading, 10); //65535 is max value to stop AgOpen using IMU in Panda`, line 101 (standard build: line 96).

So with v4 firmware #357 changes nothing, which is fine.

**AiO v26 firmware** (`AgOpenGPS-Official/Firmware_Teensy_AiO_26`, commit 2551bff):
- `lib/aio_autosteer/AutosteerProcessor.cpp`, lines 1148–1149, then packed at 1171–1174:
  ```cpp
  int16_t heading = 0;            // Deprecated - sent by GNSS
  int16_t roll = 0;               // Deprecated - sent by GNSS
  ```
  PGN 253 always carries heading 0 and roll 0.
- `lib/aio_navigation/NAVProcessor.cpp`:
  - The `$PANDA` IMU heading defaults to `"65535"` (line 150). It is set from the IMU only when `imuProcessor.hasValidData()` (lines 155–157).
  - With GPS pass-through on, no `$PANDA` is sent at all (line 298).

Two v26 setups therefore have no IMU heading in the sentence, and the host falls back to PGN 253 = **0°**:
- v26 without an IMU (`$PANDA` with 65535);
- v26 with GPS pass-through (plain GGA/VTG, even with an IMU fitted).

(Roll: v26 also sends roll 0, and 0 ≠ 8888. Since #356 that becomes a "valid" roll 0 for fixes without sentence roll. That is the same value as before #356, so it should be harmless.)

### What 0° does in the fusion (reproduced on the host)

`develop` at 7a8f3f8 (the code involved is unchanged at 9705344, only the licence headers moved the line numbers), Desktop head `--headless`, simulator off. A small script played a GPS and a steer module over UDP to port 9999:
- `$GPGGA` + `$GPVTG` at 10 Hz, 2.5 m/s;
- 15 s east, then a 90° left turn over 5 s, then north;
- PGN 253 at 10 Hz with heading raw = 0 (v26), or 9999 (v4).

Read back from the web client: `statusBar.systemData.imuHeading`, `tick.chartImuHeading` (IMU + offset), `tick.chartGpsHeading`, and the vehicle heading.

| | 9999 (v4) | 0 (v26) |
|---|---|---|
| IMU heading (as received) | none (NaN) | 0.0°, accepted as valid |
| IMU + offset vs GPS in the turn | — | up to ~28° apart |
| Vehicle heading error, 1–7 s after the turn | ≤ 1.8° | up to 9°, decaying over several seconds |

The fusion takes a constant 0 as a gyro that never turns. In `GpsHeadingFusionService.FuseHeading` the result is IMU + `_imuGpsOffset`, and the offset is pulled toward the GPS heading by `FusionWeight` each step (GpsHeadingFusionService.cs:257; default share 0.3 → weight 0.06). So the heading lags behind every turn and settles slowly. That error is in the heading guidance uses right when the tractor comes back onto the line after a headland turn.

Not reproduced, but follows from the same code: reverse detection (lines 243–244) flips the heading when IMU + offset is more than 90° from the fix-to-fix heading. A sharper turn than the one above could get there and flip the heading by 180°.

Settings don't avoid it. The heading fusion slider (`gps.headingFusionWeight`, 0–1, weight = share × 0.2) only speeds up the correction; at 1.0 it is still 0.2 per step. Turning it down makes it worse. Turning off reverse detection avoids only the flip. No setting stops a module heading from being used.

### Proposal

1. **Firmware:** send 9999 / 8888 in PGN 253 when the IMU data goes out in the sentence or there is no IMU (Firmware_Teensy_AiO_26#60).
2. **Host, until every firmware does:** don't take a PGN 253 / 211 heading as an IMU until it is plausibly one. Some options:
   - accept it only after it has changed (a module heading that is still exactly the value it started with, e.g. 0, while the fix-to-fix heading changed by more than a few degrees, is not a heading source);
   - or a setting "Use IMU heading from the steer module", off by default, so single-antenna users with an IMU on the steer module opt in;
   - or both.
3. **UI:** show the received IMU heading next to the GPS heading in the GPS / System Data card, with a warning when it is stuck at 0 while driving. We do this in our fork's setup mode for bench testing; happy to send a PR for the upstream card.

The bench script is in our fork: `Tools/ui-audit/heading-bench.js` in MoritzLoibl10/AgOpenWeb (Node, UDP to :9999, about 70 lines). Run `node heading-bench.js 0 out.json` against a test host; it switches the simulator off itself.
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

## 4. Single antenna: backing first learns the heading facing backwards; steering then runs for the wrong direction

Stand: anlegen. Fork: `docs/Bericht-Simulator-Richtung.md`. Geprüft gegen upstream `develop` d075aa2 (25.10.2026).

**Titel:**

~~~~text
Single antenna: backing first learns the heading facing backwards; steering then runs for the wrong direction
~~~~

**Text:**

~~~~markdown
With one antenna (with or without an IMU), the first heading is taken from the first travel above 1.5 km/h, and that travel is assumed to be forward. If it is backwards (backing out of the shed), the heading is learned facing backwards and stays that way until the operator taps the vehicle. This is known (the test `StartedWhileBacking_ForwardTravelReadsAsReverse_UntilTheDirectionIsReset` calls it "the trap", and AgOpenGPS behaves the same), but what it does to steering and sections isn't visible anywhere, and the simulator falls into it every time it is started backwards.

### Where

`GpsHeadingFusionService` (develop d075aa2):
- `TryStartHeading` (line 338): first heading = start fix → first fix ≥ `FixToFixDistance` away. With an IMU the offset snaps onto it (`_imuGpsOffset = Wrap(AngleDelta(imuRad, _gpsHeading))`, line 360), so it is 180° out after a backwards start.
- With an IMU, reverse = travel more than 90° off IMU + offset (line 243). After the trap, backing reads as forward and forward reads as reverse, for as long as it lasts (the 0.02 offset nudge pulls toward the flipped heading).
- Without an IMU, reverse = filtered change > 90° against the last heading (line 273). After a backwards start the first heading is already flipped, so every forward run reads as reverse, also for as long as it lasts (checked with a scratch test like the one above, `imuValid: false`).
- Dual antenna: not affected.

### What it does while the heading is flipped

| Really | Host thinks | Effect |
|---|---|---|
| forward | reverse | Heading 180° out, REVERSE badge. Auto sections stay off (`IsReversing`). Steering paused (PGN 254 status 0), **unless Steer in reverse is on: then the motor steers with the reverse computation while driving forward.** |
| backing | forward | No reverse pause. **With AutoSteer engaged the motor steers with the forward computation while backing: wrong way round, it diverges.** Auto sections are not switched off in reverse. |

Reproduced in the simulator (our fork at 1b9ba20, before #415; #415 doesn't change this, as a paused steer still counts as engaged): start the sim, set −3 km/h first: heading 180°, no reverse flag; then +3 km/h: heading stays 180°, reverse flag on. A line 8° off, AutoSteer on: started forward, the sim captures the line (XTE < 0.1 m); started backwards, it runs off and swings (XTE up to 25 m, steer angle −35° … +23°). Not tested on real hardware.

### The simulator part

- The sim reports a signed speed (`Speed = simulatedData.SpeedKmh / 3.6`, MainViewModel.Simulator.cs:101) and its true heading as the IMU heading (line 119), but `FuseHeading` uses `Math.Abs(speedMs)`, so the sim always falls into the trap when started backwards.
- While steering is paused for reverse (`steerPaused`, GpsPipelineService.cs:1017), the sim still follows the guidance angle: `simFollowsGuidance = g.HasGuidance && IsAutoSteerEngaged` (MainViewModel.ApplyResults.cs:231, #415). A real motor would stand still (status 0); the sim steers with the reverse computation, which is the swinging above.

### Proposal

1. **Sim:** follow guidance only while it actually steers (engaged and not `IsSteerPaused`), like the motor. And/or let the first heading use the sign of the speed when the source is the simulator (NMEA speed is unsigned, so this changes nothing for real GPS).
2. **Real GPS, single antenna:** make the trap visible and harmless:
   - after the first heading is learned, say so ("Direction learned from the first travel – if the vehicle faces the wrong way, tap it");
   - don't allow engaging AutoSteer within the first few metres after a first heading, or until it has been confirmed by travel with a steer angle;
   - with an IMU and a WAS, the direction can be told once the wheels are turned: forward, a left steer angle turns the heading left; backing, it turns it right. A few degrees of consistent yaw against the WAS sign could reset the direction automatically, or at least warn.
3. Optionally keep the IMU offset across restarts (as long as the IMU and the antenna haven't moved), so a restart in the shed doesn't need a first travel.

In our fork (web client only) we show a warning in the simulator when the sim's speed sign and the reverse flag disagree, with a "Reset direction" button (the existing `heading.resetDirection`), and a help page. For real GPS the client can't tell, which is why this needs the host.
~~~~
