# Ideas & Backlog

Improvements tracked but not yet implemented.

## Recently shipped (kept for context, dated)

- **2026-04-25** — B.18 `pane_read_batch` (ttnsx888 668cc55d): self-contained additive port, format helpers duplicated rather than refactored to avoid conflict.
- **2026-04-25** — `pine_smart_compile` exposes `elapsed_ms` so callers know how long compilation took.
- **2026-04-25** — `tab_list` includes the active Pine script name per tab (DOM probe via `pine-script-title-button`).
- **2026-04-25** — `tab_switch_by_name`: switch by Pine script name (exact-then-substring match) instead of by index.
- **2026-04-25** — Cycle 1 (6 bugs): `tv_launch` null pid, `pane_read_batch` wrong unwrap path, port param fiction in `ensureCDP`, `watchlist.addBulk` macOS modifier, `paths.resolveScreenshotDir` traversal vector, `pine.saveAs` silent reopen failure. Cycle 2 (3 perf items): page-side cap in `buildGraphicsJS`, dialog selector pre-filter, per-target Pine read timeout. (`fork-port/cycle-1-2-fixes`)
- **2026-04-25** — `stream.js` smoke coverage (10 tests). Added `_deps` to `pollLoop` so iteration count, sleep, signals, and stdout/stderr are injectable. Includes regressions for the `inner.get(false)` unwrap path and study-filter threading.
- **2026-04-25** — Per-call `_deps` DI migration for 10 core modules: alerts, batch, capture, data, health, indicators, pane, pine, ui, watchlist. The global `__setTestOverrides` hook still works as the underlying fallback. (`refactor/wrappers-and-di`)
- **2026-04-25** — E2e wrapper refactor: 37 of 79 raw `evaluate(...CHART_API...)` sites replaced with wrapper calls (`coreChart`, `coreDrawing`, `coreHealth`, `corePine`, `coreData`, `coreUi`, `coreIndicators`). Includes the four "output size budget" tests that were re-implementing wrapper IIFEs verbatim — now they assert the wrapper's actual output, so a TV API rename produces a single-source failure instead of parallel-implementation drift. Down to 42 raw sites; the rest are DOM existence probes, FIND_MONACO walks, or BARS_PATH single-bar reads with no wrapper equivalent. (`refactor/wrappers-and-di`)
- **2026-04-25** — TV Desktop 3.1.0 quirks written up in private maintainer notes, covering API surface changes, state-pollution traps, Pine graphics object path, and launch-path quirks.

## Fork audit 2026-05-09

Sourced from `scripts/audit_forks.sh --top 100` (report at `/tmp/fork_audit.md`).

### Shipped this audit cycle

- **`chart_remove_studies_by_title`** — bulk title-substring removal via `getAllStudies` + `removeEntity`. Saves a `chart_get_state` roundtrip when the caller has the script name but not entity_id. Sourced from prezis (their `pine_remove_study` fix didn't apply directly because our `chart_manage_indicator` already used `removeEntity`, but the title-match capability was a genuine gap).
- **CDP reliability bundle** — `withReconnect()` helper, 2s liveness timeout in `getClient()` with timer cleanup, and `Emulation.setFocusEmulationEnabled` on every (re)attach (so background-tab screenshots keep painting). Sourced from upstream PR #131 + dsfortescue fork (`99cc9c5`).
- **`data_get_strategy_info`** — strategy name (internal API on `metaInfo`) + Strategy Tester date range (DOM scrape). Sourced from PasanteAdmin.
- **EPIPE-on-TV-close fix** — `connect()` no longer calls `Runtime.enable` / `Page.enable` / `DOM.enable`, eliminating the console-event forwarding channel that EPIPEs on TV's renderer at shutdown. `disconnect()` sends `disable` defensively and waits 250 ms for the close frame to flush. `connect()` registers a `disconnect` event handler so the cached client drops immediately when TV closes. `server.js` adds SIGTERM, SIGINT, and stdin-close handlers that route through `disconnectCdp()` before exit. Sourced from PasanteAdmin (`bcd8176` + `cf9785a`).
- **`replay_stop` linking-path fix** — `_replaySessionState` now nulls on `chartWidget._linking._chartWidgetCollection` (the path that survives a TV process restart), not the non-existent `TradingViewApi.linking`. Surfaced this session.

### Audited, no genuine gap

- **KarmicP — CDP injection sanitization across 9 modules.** Our `tests/sanitization.test.js` (353 lines) already covers `safeString`, `requireFinite`, source-level audit. The two files without `safeString` (`capture.js`, `pine.js`) interpolate server-controlled strings (internal `colPath`, generated `token`), not user input.
- **KarmicP — `pine_set_source` hangs on large scripts.** Already shipped — `src/core/pine.js` setSource (lines 326-380) uses `pushEditOperations` + `setTimeout(...,0)` + 15s polling timeout, identical pattern to KarmicP's fix.
- **dsfortescue — `tab_switch` CDP redirect.** Our `switchTab` already calls `connectToTarget(target.id)` after `Target.activateTarget`. Their fix targeted a fork that didn't reconnect at all.
- **PasanteAdmin — `strategy_tester_open/close/get_results/get_trades`.** `ui_open_panel('strategy-tester')` covers open/close. Our `data_get_strategy_results` uses `_reportData.performance` (internal API) which is locale-stable and exposes more metrics than PasanteAdmin's DOM scrape. Same for `data_get_trades` (uses `_reportData.trades`). Their `set_settings` was deferred upstream by PasanteAdmin themselves (DOM-text matching was unreliable).

### Still on the backlog

- **KarmicP — validate cloud-persisted values** before round-tripping (alert payloads, watchlist names, layout names). Belt-and-braces against TV-side input that bypasses our local sanitization.
- ~~**PasanteAdmin — strict `smart_compile` honest success.**~~ — Shipped 2026-05-17. Diff studies by ID then match new study name against pine-script-title-button text.
- **prezis — `deployMultipleScripts`** (sequential multi-script deploy with auto-switch between editor slots). Audited 2026-05-09: it's a 433-LOC workflow tool that orchestrates `setSource` + `save` + `add-to-chart` per script. Our existing primitives (`pine_set_source`, `pine_smart_compile`, `pine_save`, `chart_manage_indicator`, `pine_switch_script`, `pine_deploy`) compose well enough for callers to chain themselves. Worth porting only if user-facing demand surfaces.
- ~~**prezis — `pine_deploy` (file-based atomic)**~~ — Shipped 2026-05-17. Reads `.pine` from disk, auto-derives indicator()/strategy() title for pre-clean, sets source → saves → smart_compile in one tool call. Anti-token-tax for 50–100 KB Pine files. Composes from our hardened primitives rather than verbatim port (~80 LoC orchestrator).
- ~~**prezis — `pine_switch_script`**~~ — Shipped 2026-05-17. TV 3.1+ title-button dropdown is a context menu (Save/Copy/Rename), NOT a script list. Switching uses the Ctrl+O picker instead: focus pine editor → Ctrl+O → React-friendly setter on search input → React onClick on `.itemInfo-gisYB8vu` row → close via mouse-event sequence on `[data-qa-id="close"]`. Updates the editor's title binding (unlike `pine_open` which only rewrites source).
- **prezis — `fib-truth.js`** exact OHLCV wick lookup for Fib ground-truth verification.
- ~~**KarmicP — replay CLI ergonomics.**~~ — Shipped 2026-05-17.
  `tv replay start` now accepts `-l/--layout` (load saved layout with
  graceful fallback), `-c/--chart` (switch to tab by title-substring;
  hard-error on miss to avoid replaying the wrong chart), `--tf`
  (1m/5m/1h/4h/D/W aliases → TV-native), `-d/--date` with rich format
  set (ISO, YYYYMMDD, YYMMDD, slash, month name, today/yesterday, -7d
  relative), `-H/--hour` separate time, `-s/--speed` (1x..10x or raw
  ms), `-i/--interval` (1s/1t/chart aliases). Compound flow: layout →
  tab → tf → replay.start → speed → interval. Parsers live in
  `src/cli/replay_parsers.js`, 29 unit tests covering all formats.
  MCP `replay_start` unchanged — keep the wire schema minimal; Claude
  formats dates ahead of the tool call.
- **yaojinhui1993 — chart data download workflow.** `target_id` + filename params for bulk OHLCV export via TV's native download path; complements our 500-bar `data_get_ohlcv` cap.

## Audit 2026-05-16 — historical-replay sweep findings

Sourced from a validation pass against a private NQ master DB that tried to
sweep 50 corpus sessions across 10 NQ futures contracts, replay each to 9:33
ET, and compare the Pine `-4 CB Model Indicator`'s drawn line Y values to a
Python-computed reference. **One session validated bit-exact** (2026-05-08
NQM6, all 6 lines + OR OHLC match) but the 49-session scale-out hit the bugs
below. Each one blocked work in this session — listed in rough priority order.

### Shipped 2026-05-18 — Tier-A bug fixes + small wins

- **CDP_HOST defaults to 127.0.0.1** (from sfbayman) — replaces
  `localhost`. Some Windows/WSL/Node setups resolve `localhost` to
  `::1` (IPv6) first while Chrome's CDP listens only on `0.0.0.0`
  (IPv4); explicit IPv4 avoids the resulting ETIMEDOUT that looks
  like a missing port. Override via `TV_CDP_HOST`.
- **`indicator_set_inputs` display-name resolution** (from
  jacktradesnq) — `{ Length: 21 }` now resolves the case-insensitive
  display label to the underlying input id (e.g. `in_0`) when no
  direct id match. Response surfaces `unmatched_keys` + full
  `detected_inputs[]` (id, value, name, type, options) so the caller
  can retry with the right key.
- **`tv quote --route`** CLI flag — exposes the auto/rest/chart-switch
  routing we already had in the MCP wrapper; pairs naturally with the
  recently-shipped `screener_scan` so a caller can quote any returned
  ticker without disturbing the chart.
- **`chart_set_visible_range auto_extend_cache`** (from jacktradesnq)
  — when the requested `from` predates the loaded bar buffer, TV
  silently clamps the zoom. Default-on cache extension detects the
  clamp (`actual.from > requested.from + 60s`), briefly enters replay
  mode at `from` to force TV to preload bars, stops replay, retries
  the zoom. Response carries `cache_extended` + final `clamped`. Same
  mechanism family as the replay `--scroll-back` we shipped earlier,
  but cleaner exit (no UI toolbar lingers). `scrollToDate` shares the
  extracted `_zoomTimeRange` helper now.

### Shipped 2026-05-17 — Tier 2 fork audit ports

- **`evaluateChecked`** (concept from valleyfresh, reimplemented) —
  Defensive CDP evaluate wrapper. Page-side `JSON.stringify` returns
  a string so CDP only ships a primitive — solves the
  "Object reference chain is too long" failures we hit on Monaco /
  chart-widget / fiber probes. Page-side length checksum verified
  on client also catches silent CDP truncation. Page-side errors
  (cycles, BigInt, runtime exceptions) surface as labeled Error
  messages instead of half-serialized blobs. Use in place of
  `evaluate()` for any expression returning a TV-internal object
  graph (>~500 KB, deep React fibers).
- **`tv data shapes` CLI** — `data_get_pine_shapes` core + MCP tool
  were already in tree from a prior dawsman port; the CLI
  subcommand was the missing surface area. Reads plotshape/plotchar
  signals (triangle/diamond/cross/etc.) per study with OHLC at each
  signal bar; the SMC / scanner / profiler Pine indicators in your
  library all emit via this primitive.

### Shipped 2026-05-17 — Tier 1 fork audit ports

Sourced from fork audit at `/tmp/fork_audit_2026-05-17.md`.

- **`strategy_set_deep_bt_range`** (from jacktradesnq) — drives the
  Strategy Tester Deep Backtesting calendar via DOM: opens picker,
  fills two YYYY-MM-DD inputs via React-friendly setter, clicks
  locale-appropriate submit (Select / Sélectionner / Apply / OK),
  verifies displayed range. Useful for historical-replay sweep
  workflows that need to scope a strategy backtest before re-run.
- **`news_get_ticker` + `signal_get_snapshot`** (from QuantAgentLabs)
  — RSS pull from Nasdaq + Yahoo Finance with keyword sentiment
  scoring; SP:SPX/NDX/DJI/RUT/VIX auto-route to tracking ETFs for
  news lookup. `signal_get_snapshot` rolls quote + 100-bar price
  action (SMA20/50, ATR14) + visible indicators + news into one
  compact response, each section degrading gracefully on failure.
- **`screener_scan`** (from QuantAgentLabs) — flexible scan of TV's
  public scanner endpoint with market presets
  (stock/etf/crypto/forex/futures/index), ticker hydration via
  `symbolSearch`, exchange filter, sort, and numeric range filters
  on price/volume/change. More flexible than the fixed-slug
  `hotlist_get`.
- **`pine_deploy`** (from prezis) — file-based atomic deploy:
  read `.pine` from disk → pre-clean (auto-derived from
  `indicator()` / `strategy()` title) → setSource → save →
  smart_compile. Anti-token-tax for big Pine files (50–100 KB).
  Composes from our hardened primitives.
- **`pine_publish_dialog_inspect`** (from jacktradesnq) — read-only
  probe for the Pine "Publish script" dialog. Active publish flow
  deferred — upstream impl is French-locale-only with TV-build-
  hashed CSS classes; needs per-build adaptation. Inspect is the
  unblocker.
- **Tab pinning + cross-instance registry** (from ogdeeeezy) —
  `tab_pin {id|title|symbol|url}` makes one tab deterministic for
  every subsequent MCP call; `tab_unpin` releases. Cross-instance
  registry at `~/.tv-mcp-registry.json` prevents two Claude
  sessions from claiming the same tab (`PIN_CONFLICT` unless
  `force=true`). `TV_MCP_TARGET_FILTER` env (`symbol=ES1!`,
  `title~ICC`, `url=chart/Wfn4`, `id=ABC123`) narrows auto-pick
  candidates at startup. Per-process pins released on exit.
  Added without regressing our EPIPE-on-close fix, `withReconnect`,
  liveness-timeout, or focus-emulation paths.

### Shipped 2026-05-17

- **`FIND_MONACO` restored on TV 3.1.0.7818** — `window.monaco` is
  unexposed and the React fiber's `value.monacoEnv` path is gone, but
  TV's webpack chunk array (`window.webpackChunktradingview`) still
  contains the monaco namespace. FIND_MONACO now extracts it by pushing
  a synthetic chunk whose runtime callback scans `__webpack_require__`'s
  module map for one exporting `editor.getEditors`, caches the namespace
  on `window.__tvMonaco`, and uses `monaco.editor.getEditors()` to find
  the Pine editor instance. ~100 ms one-time cost, then ~free per call.
  New `MONACO_PINE_EDITOR_AVAILABLE` probe returns boolean only — never
  the editor reference — because CDP's `returnByValue:true` chokes on
  the editor object with "Object reference chain is too long". Restores
  `pine_open`, `pine_save`, `pine_compile`, `pine_set_source`,
  `pine_get_source` and the `chart_manage_indicator USER;<id>` path.
- **`chart_manage_indicator` USER;<scriptIdPart> routing** — passing
  a `USER;<hash>` form (from `pine_list_scripts`) routes through the
  Pine editor: open script via pine-facade by ID → smart_compile clicks
  Add to chart → diff studies to surface the new entity_id. `openScript`
  extended to accept `id` in addition to `name`. Live-validated end-to-
  end: added `-4 CB Model Indicator` via id `USER;9ec0639b...` →
  entity_id `jNavdo` on BATS:NVDA chart, clean compile, no errors.
- **`tv repl` persistent CDP session** — `tv repl` reads commands from
  stdin and writes one JSON-per-line to stdout, reusing a single CDP
  client across all commands. Live-measured: cold first command 123 ms,
  subsequent commands 1–5 ms (vs ~500 ms per fresh CLI invocation).
  Closes the highest-leverage IDEAS line 211-219 perf gap for batch
  sweeps. parseShellLine handles double/single quotes + escapes; the
  `tv` prefix is stripped so users can paste either form.
- **`tv ui mouse --selector`** + `device_pixel_ratio` in `ui_find_element`
  results — fixes the WSL2 / HiDPI mismatch where CSS-pixel coords from
  find landed clicks on adjacent elements. Selector path computes the
  element center then multiplies by devicePixelRatio internally before
  `Input.dispatchMouseEvent`. Raw x/y path unchanged for callers who
  already pre-scaled.
- **`ensurePineEditorOpen` cold-start polish** — cheap
  `[data-qa-id="pine-editor-dialog"]` presence check short-circuits the
  heavier FIND_MONACO React fiber walk; polling budget extended from
  10 s → 20 s; selector cascade adds `[data-qa-id="legend-pine-action"]`
  as another opener. Fixes the "fresh chart, button doesn't render in
  budget" timeout case.
- **Pine compile button selectors strengthened** — fast-path stable
  `[data-qa-id="add-script-to-chart"]` selector first, then a hardened
  text walk that skips elements with >30-char labels (defeats the
  "Untitled scriptAdd to chartAdd to chart…" parent-wrapper trap).
- **`smart_compile` honest success** — snapshot studies as `{id, name}`
  arrays before/after, match newly-added studies against the Pine
  editor's `pine-script-title-button` text. New unrelated study added
  concurrently no longer falsely reports `study_added: true`. Response
  surfaces `pine_title`, `new_studies`, `matched_study` for inspection.
- **`data lines/labels/tables/boxes --include-empty`** — page-side IIFE
  gate becomes `totalCount > 0 || <flag>`. Surfaces loaded-but-silent
  studies so callers can distinguish "session indicator not triggered"
  from "indicator not on chart".
- **CLI leading-hyphen positional shield** — router auto-inserts `--`
  before any `^-\d` arg, so `tv indicator add "-4 CB Model"` works
  without the manual `--` separator.
- **`tab_new` + `tab_close` rewrite** — `tab_new` was unreliable on TV 3.1+
  because the chart canvas absorbs `Ctrl+T` before Electron's window handler
  sees it. Investigation found that the tab-strip `+` button lives in a
  separate Electron shell page (file:///.../index.html) as
  `button.create-new-tab-button`; triggering its React `onClick` handler
  directly (via `__reactProps`) reliably spawns a new tab. The new tab
  lands on TV's layout-picker page (URL `.../new-tab/index.html?...`) and
  needs a layout selection to become a real chart. `tab_new` now returns
  `picker_tab_id` so callers can switch into it or clean up. `tab_close`
  rewritten to use CDP `/json/close/<id>` (Ctrl+W had the same user-gesture
  problem); accepts an optional `id` param so callers can target picker
  tabs explicitly, defaults to the currently-attached target. Refuses to
  close the last chart tab. Layout selection in the picker still requires
  user action in TV (no programmatic path discovered).
- **`chart_set_symbol` recovery cascade** — three-tier auto-recovery now lives
  in `setSymbol`: poll `chart.symbol()` for JS-API match (8s window, replaces
  the old DOM-legend gate that false-positived on exchange-prefix mismatch);
  on mismatch, dismiss blocking dialogs + retry; on still-mismatch OR a
  visible "This symbol doesn't exist" / "No data here" / "Invalid symbol"
  overlay, hard-reload via `Page.reload` and retry once. Response carries
  `hard_reloaded:true` + `prior_studies` so callers can restore wiped
  studies; new error code `SYMBOL_LOAD_ERROR` (vs `SYMBOL_DID_NOT_CHANGE`)
  flags the overlay variant. Live-validated: clean switches no longer
  trigger false-positive reload; replay-active switches preserve cursor.
- **`replay_start` intraday + re-jump** — accepts ISO-with-time strings
  (`2026-05-08T13:33:00Z` / `+offset`); when called against an already-
  running replay, runs `stopReplay` + clears `_replaySessionState` on both
  top-level and `_linking` paths + 300 ms settle before `selectDate` so TV
  doesn't silently restore the cached cursor. Cursor poll is now target-
  aware (waits until `currentDate` is within 60 s of the requested ts);
  response includes `requested_ts`, `drift_seconds`, and a `warning` string
  when drift > 5 min (catches the silent-clamp-to-unloaded-data symptom).
  Live-validated 09:33 ET / 10:30 / 11:30 ET jumps round-trip with drift
  1 s on NQM2026 60 m.

### Replay API

- ~~**`replay_start --date` only handles day-precision strings.**~~ —
  Shipped 2026-05-17. Wrapper accepts ISO-with-time; tool/CLI docs name
  the supported formats explicitly.

- ~~**`replay_start` should clear `_replaySessionState` before every `selectDate`.**~~ —
  Shipped 2026-05-17. Active-replay re-call now does
  `stopReplay` + clear both `_replaySessionState` paths + 300 ms settle
  before `selectDate`. Cursor poll is target-aware (60 s window).

- ~~**`selectDate` silently clamps backward jumps to unloaded historical
  dates.**~~ — Detection shipped 2026-05-17 (drift_seconds + warning >5 min).
  Recovery shipped 2026-05-17 (`replay_start scroll_back: true` / CLI
  `--scroll-back`). Pre-engages backward loads via mouseWheel events on
  the main chart pane BEFORE `showReplayToolbar` (data feed freezes once
  replay engages). Loops until `bars.firstIndex()` timestamp ≤ target,
  bails on two consecutive no-progress iterations (`no_more_history`),
  or hits 30-attempt cap. Result reports `scroll_back: { loaded,
  attempts, firstTsBefore, firstTsAfter, reason }`.

- ~~**`_replayUIController.disableReplayMode()` doesn't actually stop replay.**~~ —
  Informational only; our `core/replay.js stop()` already calls
  `stopReplay()` + `goToRealtime()` + clears `_replaySessionState` on both
  paths. The cited bug only affects callers who reach for
  `disableReplayMode` directly, which we don't.

### Chart / symbol

- ~~**`chart.setSymbol` stuck-state is irrecoverable from CDP.**~~ —
  Shipped 2026-05-17. `setSymbol` has a three-tier recovery cascade
  (dialog dismissal → hard reload via `Page.reload`) and additionally
  detects "This symbol doesn't exist" / "No data here" overlays that
  appear when the JS API matches but the data layer is broken.
  Response carries `hard_reloaded:true` + `prior_studies`.

- ~~**`tv tab switch <n>` doesn't propagate to subsequent commands.**~~ —
  Verified working 2026-05-17: `tab switch 2` to `N6mimYXe` chart followed
  by `state` correctly returned NQM2026/60m on the new tab. Either the
  reproducer is intermittent (related to CDP cache liveness) or this got
  fixed incidentally. Reopen only if it regresses.

- ~~**`tv tab new` (Ctrl+T via `Input.dispatchKeyEvent`) doesn't reliably
  create a new tab.**~~ — Shipped 2026-05-17. Fixed by triggering the
  Electron shell's `.create-new-tab-button` React `onClick` directly;
  returns the picker tab id. Layout selection still manual.

### Indicators / Pine

- ~~**`tv indicator add` parses leading hyphen in indicator name as a flag.**~~ —
  Shipped 2026-05-17. Router auto-shields `^-\d` positionals with `--`.

- ~~**`tv indicator add USER;<scriptIdPart>` doesn't resolve user-saved
  Pine scripts.**~~ — Shipped 2026-05-17. `chart_manage_indicator` detects
  `USER;` prefix, opens the script via pine-facade by ID, clicks Add to
  chart via the hardened smart_compile path. Live-validated end-to-end
  after FIND_MONACO restoration.

- ~~**`tv pine open <name>` fails with "Could not open Pine Editor" on fresh charts.**~~ —
  Shipped 2026-05-17. Polling extended to 20s, added cheap dialog-presence
  short-circuit + legend-pine-action opener cascade.
- ~~**Pine editor "Add to chart" button needs broader selectors for TV 3.1.0+ icon-only headers.**~~ —
  Shipped 2026-05-17. Fast-path on `[data-qa-id="add-script-to-chart"]`
  + hardened text walk that skips 30+ char wrapper-div labels.

### Pine indicator data extraction

- ~~**Pine `line` primitives expose `y1`/`y2` directly on the primitive object, NOT under `.v`.**~~ —
  Wiki and code both clean as of 2026-05-17. Grep confirms no `.v.y1` path
  in the wiki; `buildGraphicsJS` reads `v.y1` directly. Already fixed.

- ~~**`tv data lines -f "..."` returns empty study list when indicator hasn't yet drawn lines.**~~ —
  Shipped 2026-05-17 as `--include-empty` flag on lines / labels / tables / boxes.

### UI automation

- ~~**`tv ui mouse <x> <y>` click coords don't match `tv ui find` reported positions.**~~ —
  Shipped 2026-05-17. `ui_mouse_click` accepts `selector` (computes CSS
  center → multiplies by devicePixelRatio); `ui_find_element` surfaces
  `device_pixel_ratio` + per-element `device_x`/`device_y` for callers
  who want to scale themselves.

### Performance / DX

- ~~**Per-call CDP target enumeration dominates batch-job runtime.**~~ —
  Shipped 2026-05-17 as `tv repl`. Live-measured 1–5 ms per command
  after cold start (vs ~500 ms per fresh CLI invocation).

## Held for design discussion

- **C.23 AsyncLocalStorage tab routing + persistent pin + study-readiness gate** (floatalgo `81efb1ff`) — significant architectural change to how tools are routed across tabs. Needs design call before code.

## Permanently skipped (kept so future-me doesn't re-investigate)

- **C.22 3-phase strategy detection with DOM fallback** (PR #51) — superseded by PR #90 (which we merged); also contains a duplicate of the `ui_evaluate` security hole we removed in N.35; also Korean-locale-specific DOM scraping that wouldn't work for most users.
- **C.26 DOM-scrape fallback for strategy results + trades** (PR #96) — English-only label parsing with line-position fragility. PR #90 covers TV 3.1.0 strategy detection robustly enough that the fallback complexity isn't worth the maintenance cost.
- **`data_get_strategy_results_dom` regex tightening** — was tied to C.22; skipped by transitivity.

## Speculative future direction

Sub-agent personas for strategy development:

- **Architect**: writes Pine Script strategy from spec.
- **Backtester**: runs parameter sweeps, reads strategy tester results.
- **Reviewer**: static analysis + `pine_check` before compile.
- **Reporter**: formats backtest results into structured summary.

Not action items — captured for later if/when we go this direction.
