# Rückgabe an upstream: PR-Entwürfe

Stand 27.10.2026. Je Änderung ein eigener Branch im Fork, abgezweigt von upstream `develop`
(77a03518, #441), nur mit dieser Änderung, englische Commits. **Nicht eingereicht.** Einreichen:
auf GitHub einen PR von `MoritzLoibl10/AgOpenWeb:<Branch>` nach `AgOpenGPS-Official/AgOpenWeb:develop`
anlegen und Titel und Text unten übernehmen. Vorher upstream nach passenden Issues/PRs suchen.

| Nr. | Branch | Fork-Stand | Prüfung im Branch |
|---|---|---|---|
| 1 | `upstream/ws-whole-commands` | Host-Paket D (#7) | RemoteServer-Tests 3, Wächtertests 11 |
| 2 | `upstream/explicit-off-commands` | Host-Paket A (Punkt 35) | ViewModels-Tests (SwitchOff) |
| 3 | `upstream/fix-quality-rank` | Upstream-Issue 5; im Fork nur in der Ampel | Services 1692 + 7 übersprungen, ViewModels 355 |
| 4 | `upstream/translatable-host-messages` | Host-Paket D (#11) | ViewModels 357, RemoteServer 13, Wächtertests 11 |

Nr. 3 ändert im Gegensatz zum Fork die Qualitätsschwelle der Führung im Host; das ist bewusst als
Vorschlag für upstream so gebaut und dort von den Maintainern zu prüfen. Im Fork bleibt der Host
unverändert.

---

## 1. WebSocket: run a command once, whole, at the end of its message

~~~~markdown
### What changed
`WebSocketHub` read client commands into a 1 KB buffer and passed every piece to `Dispatch`
without looking at `EndOfMessage`. A command longer than 1 KB (a bug report description, an NTRIP
profile with long fields) was cut, and its tail ran as a second, broken command.

`CommandAssembler` (new, internal) joins the pieces of one text message and returns the command at
`EndOfMessage`; a message over 64 KB is dropped whole, never cut. The receive buffer is 4 KB.
`CodePathContinuityTests.WebSocket_HostSendsBinaryOnly_TextIsTheCommandFrame` now also checks the
line after the one text use, so the command path stays the only one.

### Tests
- `CommandAssemblerTests`: pieces make one command only at the end; a UTF-8 character split
  across two pieces is joined; 64 KB + 1 byte is dropped and the next command is read.
- Existing RemoteServer and continuity tests pass.

### Not changed
Control gate, observer list, the command ids.
~~~~

## 2. Web commands `autosteer.off` and `sections.alloff`: switch off, never on

~~~~markdown
### What changed
The web client can only toggle autosteer (`autosteer.toggle`) and the section modes
(`section.master`, `section.manual`). A client that wants them off (a demo that ends, a page that
closes) has to decide from its last tick whether to send a toggle, and a stale tick turns that
toggle into an *on*.

Two commands that only switch off:
- `autosteer.off` → `MainViewModel.AutoSteerOff()`: runs the existing `ToggleAutoSteerCommand`
  only while autosteer is engaged (the same guarded call as when control is released).
- `sections.alloff` → `MainViewModel.AllSectionsOff()`: the existing manual and auto mode toggles
  only while they are on, then `SetAllSections(Off)` if a section is still on by its own button
  (#316), as on GPS loss.

Nothing on → nothing happens; repeating is harmless. Both need control like every other command
(not in `ObserverIds`). No change to steering, U-turn or the safety stops.

### Tests
`SwitchOffTests`: engaged → off once, repeated five times → still one disengage, never an
engage; already off → nothing; auto and manual mode → off, never Auto/On; all off → nothing; a
section on by its own button → off.
~~~~

## 3. Fix-quality gate: compare by goodness, not by the GGA number

~~~~markdown
### What changed
`GpsFixQualityValidator` refused a fix when its GGA quality number was below `MinFixQuality`
(`GpsFixQualityValidator.cs:33`). The GGA scale is not ordered by quality. With the default
minimum 4 (RTK fixed, `ConnectionConfig.cs:200`), RTK float (5), estimated (6), manual (7) and
simulated (8) positions passed and guidance ran on them (`GpsPipelineService.cs:583–586`); with a
minimum of 5, an RTK fixed position was refused.

The gate now compares `GpsFixQualityValidator.Rank`: RTK fixed > RTK float > DGPS = PPS >
estimated > GPS > none (manual, simulation and unknown values rank as none). For 0–6 this is the
order `NmeaParserServiceFast` already uses to pick the best GNS mode. A minimum of 0 still accepts
every fix. The simulator sends 4 and is not affected. The rejection message is unchanged.

**Please review:** this changes which fixes guidance runs on. Users with the default 4 will see RTK
float refused, as the comment at `GpsPipelineService.cs:578` already says it should be.

### Tests
`GpsFixQualityValidatorTests.Fix_quality_is_compared_by_goodness` (14 cases); the full Services
and ViewModels suites pass.
~~~~

## 4. Host failure messages with values: send a translation key and the values

~~~~markdown
### What changed
21 `ReportFailure` calls built their sentence with an interpolated string (an error message, a
file name, a count). The toast could only be English: the web client had no key to translate.

- `MainViewModel.ReportFailure(string key, params (string Name, string Value)[] args)`: the key
  has `{name}` placeholders; `StatusMessage` and `FailureReported` get the English sentence as
  before; `LastFailureKey` holds the key and values while `FailureReported` runs.
- The 21 call sites pass a key and values (counts in invariant culture).
- `RemoteServerWiring` sends key and values with the toast; `WireCodec.EncodeToast` appends them
  (key, then values as JSON) at the end of the frame; `transport.js` reads them only if present,
  so older clients and hosts keep working.
- `app.js` translates the sentence with `tr(key, values)`; the keys are listed so
  `Tools/i18n-extract.py` puts them into `en.json` (regenerated). Translations come from Weblate.

### Tests
`KeyedFailureTests` (English text, key and values during the event, nothing left afterwards; a
plain failure has no key), `ToastKeyTests` (frame layout).
~~~~
