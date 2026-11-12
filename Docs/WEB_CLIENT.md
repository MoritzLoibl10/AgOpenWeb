# The web client

The web client is the whole UI: plain HTML, CSS and JavaScript in
`Shared/AgOpenWeb.RemoteServer/wwwroot`, served by the host and shown by every head's web view
(or any browser on the LAN). There is no framework and no build step: the browser loads the
files as they are in the repo.

```
wwwroot/
├── index.html      the page: every panel's markup, then the scripts in load order
├── css/            the styles, one file per area
├── js/             the client, one file per feature
├── transport.js    the WebSocket and the binary frames (pairs with WireCodec.cs)
├── i18n.js         the translation loader; i18n/<lang>.json the strings
├── vendor/         CanvasKit (Skia in WebAssembly), bundled for offline use
├── icons/, sounds/
└── manifest.webmanifest
```

## Where things are

| File | Holds |
|---|---|
| `js/core.js` | The map canvas and its area, the model the transport feeds (`scene`, `tick`, `config`, `statusBar`…), units, render and camera state, the transport wiring, the tool width |
| `js/alerts.js` | Host prompts and failure notices, alert sounds |
| `js/skia-setup.js` | Map theme, UI scale, the placement of the corner pad, panels and HUD, the Skia paints |
| `js/map-input.js` | Camera controls (pan, zoom, tilt), map-tap capture, simulator drive keys, configured hotkeys |
| `js/sim-bar.js` | The simulator bar |
| `js/dialogs.js` | The dialog host and its cards: simulator coordinates, the lat/lon line, the shared confirm |
| `js/osk.js` | The on-screen keyboard; the numeric-field filter |
| `js/bars.js` | Unsaved-coverage guard, section bar, bottom nav, the on-screen U-turn / lateral buttons |
| `js/cfg-controls.js` | The config controls every settings panel uses (`cfgGet`, `cfgSend`, `wireCfgControls`, `populateCfgControls`…) |
| `js/tracks.js` | Flags, Ref Nudge, AB line creation, drawing on the map, the tracks manager |
| `js/left-nav.js` | The left nav and its menu panels (`lnOpen`, `lnCloseAll`, chain panels) |
| `js/field-builder.js` | Field Builder (tracks, headland, tram), KML boundary, offset fix |
| `js/settings-panels.js` | Screen & Alerts, vehicle configuration |
| `js/config-panels.js` | Tool configuration, AutoSteer, Smart WAS |
| `js/network.js` | Network IO, NTRIP profiles and settings |
| `js/fields.js` | Field Operations (fields and jobs), AgShare |
| `js/app-menu.js` | The application menu: settings and tools, language, About, bug report |
| `js/wizards.js` | Steer wizard, vehicle and tool picker |
| `js/control.js` | Control authority (operator / observer, #397) and the right nav's actions |
| `js/projection.js` | The screen matrix, `w2s` / `s2w` |
| `js/overlays.js` | The per-frame DOM overlays: light bar text, HUDs, status bar, GPS and field cards, the bars' state, U-turn indicator |
| `js/hud-tools.js` | Lower-right cluster, the clock, charts, the tool panels (roll correction, offset fix, import tracks, recorded path, boundary recording), card dragging |
| `js/card-pane.js` | The card pane (split layout, #456) |
| `js/vt.js` | The VT painter and VT cards |
| `js/web-cards.js` | Web cards |
| `js/map-draw.js` | Skia map layers: lines and tracks, previews, flags, grid, hitch, vehicle, ground, imagery |
| `js/map-layers.js` | Satellite tiles, coverage, tool footprint, light bar and steer bar |
| `js/frame.js` | `renderSkia`, the frame loop and its DOM updates; the start |

The styles follow the same areas: `css/base.css` (safe areas, the map's area, the theme
palette), `map-hud.css`, `panels.css`, `dialogs.css`, `map-side.css`, `cards.css`,
`tool-panels.css`. `index.html` starts with a contents comment for the markup.

Each file starts with a line saying what it holds. To find where something is handled, search
for the element's `id` or the command id (`transport.send('…`) across `js/`.

## How the scripts load

The files in `js/` are **classic scripts**, listed in `index.html` in load order. They share
one global scope: a top-level `function`, `const` or `let` in one file is visible in all the
others, and from the browser console (`transport`, `config`, `tick`, `iHoldControl`). There are
no ES modules, no `import` and no workers; CI checks that (`CodePathContinuityTests`).

Two rules follow from loading several files in order:

1. **Code that runs while the page loads may only use what earlier files declare.** A function
   *called* later (from a listener, a timer, the frame loop) can live in any file. A function
   declaration may move to an earlier file at any time; moving one later needs a check that
   nothing earlier calls it while loading.
2. **Anything asynchronous starts in `js/frame.js`**, at the end, before the first frame: the
   connection (`transport.start()`), CanvasKit, the frame loop. Between two script files the
   browser may run a callback (a WebSocket message, a timer, a promise), and that callback would
   find later files not loaded yet. In one big file this couldn't happen; at the end of the last
   file it still can't.

A new file goes in `js/` with a lower-case name, the licence header and its one-line purpose,
and a `<script src="/js/<name>.js">` in `index.html` at its place in the order. CI fails if a
file in `js/` or `css/` isn't loaded by `index.html`, or if `index.html` loads one that
doesn't exist.

## The fork's files (LM Steering Solutions)

The fork's own client code is `js/tablet-*.js`, one file per area, loaded after upstream's
scripts and **before `js/frame.js`** in the order `index.html` lists them, so the connection and the
map start only once all of it is there (rule 2 above; with the fork after `frame.js`, the first map
frame could run between two fork files). Its styles are `css/tablet.css`, linked after upstream's. `tablet-base.js` comes first: the helpers the others use while they load (presses made
by code `tuiPress`, the language signal `tuiLang`/`onI18n`, the number formatters). A file may
use what earlier files declare while it loads; anything in a later file is reached only from a
callback and behind `typeof X !== 'undefined'` (a timer of an earlier file can fire before a later
file is loaded). Nothing in the fork uses what `frame.js` declares. The blocks marked `// name:begin` / `// name:end` are what `Tests/web` cut out of
the files joined in load order (`Tests/web/stubs.mjs`); `Tests/web/fork-files.test.mjs` checks
the list, the order and that no block spans two files.

| File | Area |
|---|---|
| `tablet-base.js` | shared helpers |
| `tablet-ui.js`, `tablet-terminal.js`, `tablet-polish.js` | scale and sun theme; terminal layout, status bar, quick bar, menu and its pages; labels and German units |
| `tablet-profiles.js`, `tablet-hosttext.js`, `tablet-brand.js` | vehicle and tool profiles; host texts in German; product look, help, info, diagnosis |
| `tablet-direction.js`, `tablet-ready.js`, `tablet-steeroff.js` | heading check and direction card; ready light; steering off over every layer |
| `tablet-work.js`, `tablet-firstsetup.js`, `tablet-explain.js` | start work; first setup; long press = explanation |
| `tablet-worklog.js`, `tablet-acceptance.js`, `tablet-bench.js`, `tablet-backup.js` | work log; acceptance record; bench checklist; backup |
| `tablet-demo.js`, `tablet-update.js`, `tablet-legal.js`, `tablet-startup.js` | demo mode and simulator access; update check; notice at first start; firewall warning, loading screen, image preloading |

## Adding a panel

1. **Markup** in `index.html`, beside the panels it belongs with: a `<div class="ln-panel">` for
   a menu panel (`ln-hdr` header with title and ✕), written in English.
2. **Style** in the `css/` file for that area (`panels.css` for a menu panel).
3. **Code** in the `js/` file for that feature, or a new one: open it with
   `lnOpen('<id>', '<nav button id>', populate)`, fill it from `config` / `statusBar` / `scene`,
   send changes with `cfgSend('<section>.<key>', value)` (a `config.set`) or
   `transport.send('<command>|<arg>')`.
4. **Host:** a new command is routed in `RemoteServerWiring` (see `CLAUDE.md`, "Adding a web
   command"); new state comes in a frame (`Contracts.cs`, `WireCodec.cs` / `transport.js`).
5. **Text:** `tr('…')` for strings the script builds; then `Tools/i18n-extract.py` and commit
   `en.json` (`Docs/TRANSLATIONS.md`).

Every command needs control: an observer (a browser without control) sees everything and
changes nothing (#397).

## Checking a change

- `node --check` on the files you changed (CI runs it on all of them).
- `python3 Tools/i18n-extract.py --check` if you added text.
- Run the Desktop head `--headless` and open `http://localhost:5174` (see `CLAUDE.md`,
  "Verifying a change in the running app"); the browser console shows load errors with the file
  and line.
- On a tablet over WiFi if the change touches loading or start-up.
