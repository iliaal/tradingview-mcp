# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Dependabot `hono` 4.13.0 → 4.13.7 (upstream XSS fix, transitive via MCP
  SDK; stdio transport never loads the affected path) and `js-yaml`
  4.3.1 → 4.3.2 (merge-DoS backport, dev-only via eslint chain).
  Lockfile-only, CI green pre-merge.

### Added
- `draw_shape` style parameters (`color`/`linewidth`/`linestyle`, plus
  text styling) with a landed-vs-requested report in the result.
  Port of upstream #536, including its `tests/drawing_style.test.js`
  regression suite (19 tests, wired into `test:offline`/`test:unit`).
- Offline test coverage: `hotlist` + `replay` session smoke suites and a
  registry tool-count parity test; orphaned `new_features.e2e.test.js`
  gated on `SKIP_NETWORK_TESTS` and wired into new `npm run test:e2e-all`.
  Live `test:e2e-all` still requires TradingView Desktop on :9222.

### Changed

- Unified agent context: `AGENTS.md` now carries beads ledger, rules,
  TradingView decision tree, and CodeSage guide in one file; `CLAUDE.md`
  is a symlink to it. No stale tool counts.
- Pine `compile()` reuses the `data-qa-id` fast path for icon-only
  add-to-chart buttons; launch scripts silence child streams
  (`Start-Process` on Windows). Remainder of upstream #522/#532.

### Deferred (documented, not merged)

- Upstream #526 (new `indicator_get/set_style` tools, 455 additions) and
  #530 (MSIX sync-EPERM/sandbox) need a live-TV verification pass first;
  #523 (trade journal) and divergent iliaal forks stay out of scope.

## [1.2.0] - 2026-06-06

Upstream ports (screenshot render-wait, MCP config path, OHLCV symbol
parameter), a full-codebase correctness and security sweep, and the first
end-to-end validation pass against TV Desktop 3.2.0. The 3.2.0 auto-update
surfaced two Pine-editor API regressions — one fixed (`saveAs` script-id
extraction), one documented and deferred (`pine_open` slot rebind). No
breaking API changes.

### Added

- **`capture_screenshot wait_for_render`** — opt-in stabilizer that waits
  for the chart canvas to settle (same symbol/resolution/size across
  consecutive polls, no loading spinner) before capturing, so a shot taken
  right after `chart_set_symbol` / `chart_set_timeframe` doesn't catch the
  previous frame. Surfaced via MCP, CLI (`-w` / `--wait-for-render`), and
  core; default off. Echoes `waited_for_render` and discloses
  `render_stabilized:false` plus a note on timeout. Port of upstream #148
  (commit `a3e5160`).
- **`data_get_ohlcv` / `quote_get` symbol parameter** and **configurable MCP
  config path** — ports of upstream #154 and #129 (commit `318a101`).
- **`pine_open` slot rebind via `pineEditorTestApi`** — port of upstream #158
  (commit `a3e5160`). **Broken on TV Desktop 3.2.0 — see Known issues.**

### Changed

- **Boolean inputs reject garbage and read string spellings literally.**
  Replaced 16 `z.coerce.boolean()` sites — which coerced any non-empty
  string, including `"false"`/`"0"`/`"no"`, to `true` — with a shared
  `boolish` helper. A real hazard on default-true flags: `tv_launch
  kill_existing:"false"` killed the running session, `alert_create_indicator
  active:"false"` armed a staged alert (commit `e2f4601`).
- **Shared loading-spinner probe** across `waitForChartRender` and
  `waitForChartReady`, so the loader selectors can't drift between waiters
  (commit `7d62d78`).

### Fixed

- **Full-codebase correctness + security sweep** (commit `07d8117`):
  - Connection lifecycle: serialize `connect()` (no leaked CDP sockets on
    concurrent calls); swallow the orphaned liveness-probe rejection; signal
    handlers no longer `process.exit()` out from under async CDP teardown.
  - Pine data-loss guards: `saveAs` explicit `overwrite` (refuse a name
    collision, reopen by id); `newScript` reports `slot_rebound:false`;
    `getSource`/`saveAs` source reads go through `evaluateChecked`
    (truncation guard).
  - Chart: `setSymbol` `discard_unsaved` opt-in (refuse rather than silently
    discard unsaved Pine via the dialog); `setTimeframe` reads back the
    actual resolution and handles a blocking dialog without discarding
    unsaved work.
  - Data: multi-timeframe always restores the original timeframe;
    cross-symbol `getOhlcv`/`getQuote` refuse rather than strand the chart;
    `change_pct` divide-by-zero guard; ms-epoch handling.
  - Alerts: `alert_create_indicator` validates `web_hook` (rejects
    loopback / link-local / private, incl. IPv4-mapped IPv6) — SSRF;
    `alert_create` rejects an empty price instead of coercing it to 0.
  - Launch / capture / screener: `launch` returns `success:false` when CDP
    never comes up; skip a zero-dimension capture clip; guard a non-array
    scanner response.
- **`alert_create_indicator` tools/list schema generation** — switch to the
  two-arg `z.record(z.string(), …)` form so Zod v4 stops throwing during
  `tools/list`, which had aborted the entire tool list in strict MCP clients
  (commit `5742503`).
- **`saveAs` script-id extraction on TV Desktop 3.2.0** — TV 3.2.0 moved the
  pine-facade `save/new` id from a top-level `scriptIdPart` to
  `result.metaInfo.id` (`Script$USER;<hash>@tv-scripting-101`). Without
  unwrapping it `saveAs` returned a null id and degraded reopen-by-id to the
  unsafe reopen-by-name. Unwrapped with a back-compatible fallback (commit
  `7de97fa`).
- **`capture_screenshot` honest timeout disclosure** and **`openScript`
  payload guards** (commit `e2f4601`).

### Tests

- **`tests/new_features.e2e.test.js`** — first live e2e validation of the
  post-1.1.0 behaviors against TV Desktop 3.2.0.7916. 13 pass; the
  `pine_open` slot-rebind test is skipped with a documented root cause
  pending the rework (commit `7de97fa`).

### Known issues

- **`pine_open` (#158) is broken on TV Desktop 3.2.0.** `pineEditorTestApi`
  instantiates an editor instance desynced from the live Monaco, so
  `openScript` loads no source into the visible editor while still reporting
  `slot_rebound:true`. The root cause is documented and a
  `pine_open`/`pine_save` rework is planned. Earlier TV builds are
  unaffected.

## [1.1.0] - 2026-05-18

Three weeks of fork-audit ports, TV Desktop 3.1.0.7818 hardening, and a
correctness sweep that resolved 44 codesage findings across 19 core
files. No breaking API changes.

### Added

- **Tier-1 fork-audit ports — 11 new MCP tools** across 6 feature
  families (commit `611d357`):
  - **News** (`news_get_ticker`, `news_get_signal_snapshot`) — Nasdaq +
    Yahoo Finance RSS with keyword-based sentiment scoring; index/ETF
    aliasing (SPX→SPY, NDX→QQQ, RUT→IWM).
  - **Screener** (`screener_scan`, `tv screener scan`) — flexible
    multi-market scanner over TV's public scanner endpoint with
    asset-type presets (stock, etf, crypto, forex, futures, index),
    exchange filter, ticker hydration, numeric range filters.
  - **Strategy** (`strategy_set_deep_backtest_range`) — drive the Deep
    Backtesting calendar picker programmatically; locale-tolerant
    (English / French / "OK" / "Apply").
  - **Pine deploy / publish** (`pine_deploy`, `pine_publish_dialog_inspect`)
    — file-based atomic deploy (read → pre-clean → set source → save →
    Add-to-chart with honest_success), and a read-only probe that
    dumps the publish dialog's structure for selector discovery.
  - **Tab pinning** (`tab_pin`, `tab_unpin`, `tab_registry_list`) — pin
    a specific TV tab as the deterministic CDP target with a
    cross-process registry at `~/.tv-mcp-registry.json` (lock + stale
    PID reaping).
- **Tier-2 ports** (commit `b0dc68b`):
  - **`evaluateChecked` defensive CDP wrapper** that uses page-side
    `JSON.stringify` + length checksum to defeat CDP's "Object
    reference chain is too long" failure mode on heavy payloads.
  - **Replay CLI ergonomics** — `parseFlexDate` accepts ISO,
    8-digit (YYYYMMDD), 6-digit (YYMMDD), slash-form, month-name,
    `today`, `yesterday`, and `-Nd` relative offsets.
  - **`tv data shapes`** — first-class CLI subcommand for the existing
    `data_get_pine_shapes` MCP tool.
- **Tier-A small wins** (commit `e75ff13`):
  - IPv4 host default (`127.0.0.1`) avoids `::1` mis-resolution that
    burned 10–20s per CDP call on some Linux/Win boxes.
  - `indicator_set_inputs` now matches by display name in addition to
    the machine `id`, so `{ "Length": 21 }` works without first
    grepping `metaInfo()` for `in_0`.
  - `quote_get` honors the `symbol` param via chart-switch + restore.
  - `chart_set_visible_range` auto-extends the bar cache backward by
    briefly entering replay mode when the requested window predates
    the loaded buffer.
- **Pine workflow** (commits `27e16b9`, `8620f4e`, `141051d`):
  - `pine_switch_script` via the Ctrl+O picker (TV 3.1+ where the
    title button is a context menu, not a script list).
  - `replay_scroll_back` — wheel-scroll history bars in BEFORE
    engaging replay (the replay-on data feed freezes scrollback).
  - `chart_manage_indicator` routes `USER;<scriptIdPart>` references
    through the Pine editor for cleaner add+remove semantics.
  - `pine_smart_compile` returns honest `study_added` by diffing
    `getAllStudies()` before/after and verifying the new study's title.
- **CLI** (commit `f693f68`):
  - **`tv repl`** persistent CDP session for batch sweeps — keeps the
    CDP connection alive across commands so a 50-symbol sweep doesn't
    pay the connect cost per call.
  - Leading-hyphen arg parsing (`tv replay -d -7d` no longer mangles
    the negative date offset).
  - `--include-empty` flag on data readers.
- **Chart hygiene** (commits `aa0b45c`, `24d3c25`, `d31ace0`):
  - `chart_get_state` surfaces inert Pine studies left over after a
    hard reload so callers can clean them up.
  - `chart_remove_studies_by_title` — bulk title-match removal.
  - `data_get_strategy_info` reports the strategy name and the Strategy
    Tester's active date range.
- **Alerts via REST** (commits `4efbd1f`, `b5e9424`):
  - `alert_create` and `alert_delete` rewritten to call the
    `pricealerts.tradingview.com` REST endpoint (locale-proof, returns
    real `alert_id`, supports bulk delete).
  - `alert_create_indicator` posts a Pine `alertcondition()` alert
    with `inputs` + `offsets_by_plot` schema, suitable for BUY/SELL
    signal webhooks.
- **Data** (commits `3f52d3f`, `92b6b3e`, `0c26000`):
  - `quote_get` scanner-REST fast path with `route` flag (`auto` /
    `rest` / `chart_switch`).
  - `data_get_pine_labels` exposes `bar_time`, `signal_price`, and
    `since`/`until` filtering.

### Changed

- **CDP reliability layer** (commit `cc57300`):
  `withReconnect` helper wraps every CDP call with automatic
  reconnect-on-`EPIPE` semantics; liveness timeout prevents indefinite
  hangs; focus emulation lets keyboard input land reliably on
  background panes.
- **44 codesage findings resolved across 19 core files** (commit
  `05971d7`). See the categorized breakdown in that commit's body;
  highlights:
  - **Security** — `news_get_ticker` validates the resolved ticker
    against a strict regex before constructing the RSS URL;
    `layout_switch` now requires opt-in `discard_unsaved=true` and
    never silently destroys unsaved Pine code.
  - **Race conditions** — `pin_registry` holds the lock on every
    write (releaseAllSync), re-stats before stale-lock unlink, treats
    foreign-host PIDs as dead, and snapshots corrupt JSON to
    `.corrupt.<ts>` instead of silently emptying. `tab._readActivePineScript`
    captures the CDP client synchronously and closes it on late
    timeout-loser resolution. `pane_set_symbol` resolves the chart by
    index inside the eval, removing the focus-then-read-active race.
  - **Wrong-target safeguards** — `pine_delete`, `pine_open`,
    `pine_rename`, `indicator_set_inputs`, `watchlist_add_bulk`,
    `strategy_set_deep_backtest_range`, and the publish/cache flows
    all refuse-on-ambiguity rather than silently picking the first
    match.
  - **Input validation** — `pane_focus`/`pane_set_timeframe` reject
    non-integer / negative index; `screener` range filters reject
    non-finite values; `patterns._shape()` rejects bars with non-finite
    OHLC (root-cause fix for Doji/SpinningTop NaN-strength findings).
  - **HTTP timeouts** — every CDP-readiness probe in `health.js` now
    passes `{timeout:1500}` and destroys the request on timeout (no
    more 15-iteration hang on half-open sockets).

### Fixed

- **TradingView Desktop 3.1.0.7818 compatibility regression** — the
  webpack chunk extraction for Monaco needed to be re-derived after a
  hashed module-id shuffle (`429e3e3`).
- **Tab open/close.** `tab_new` reaches through React's `__reactProps`
  on the shell page's `+` button (CDP `Input.dispatchMouseEvent` does
  not fire the handler). `tab_close` uses CDP's
  `/json/close/<targetId>` (Ctrl+W has the same Electron user-gesture
  problem Ctrl+T does). (`0afc375`)
- **EPIPE on TV close.** Dropped `Runtime.enable` from the CDP setup
  and added a graceful disconnect handler so abrupt TV shutdowns no
  longer leave the MCP server crash-looping on stale socket writes.
  (`fb11109`)
- **Replay stuck-saved-state.** `replay_stop` now nulls
  `_replaySessionState` on the correct linking path so the next
  symbol change isn't trapped in the previous replay window. (`f22338d`)
- **Contract switch + intraday replay reliability** — multiple TV
  3.1+ DOM transitions tracked. (`afaf592`)
- **Chart inert-study heuristic** — dropped the false-positive
  `meta.pine.source` criterion. (`00b8715`)

### Documented

- `IDEAS.md` rolling backlog updated with fork-audit findings,
  pine_set_source workaround status, EPIPE fix delivery confirmation.

[Unreleased]: https://github.com/iliaal/tradingview-mcp/compare/1.1.0...HEAD
[1.1.0]: https://github.com/iliaal/tradingview-mcp/releases/tag/1.1.0

## [1.0.0] - 2026-04-29

First tagged release. Forked from `tradesdontlie/tradingview-mcp` at
`4795784`; the entries below describe the delta since fork. Total
surface: 96 MCP tools + a `tv` CLI mirroring most of them, all driving
TradingView Desktop via the Chrome DevTools Protocol on port 9222.

### Added

- **`hotlist_get`** MCP tool + `tv hotlist <slug>` CLI: fetch a
  TradingView US hotlist (volume_gainers,
  percent_change_gainers/losers, gap_gainers/losers, etc.) via the
  public scanner preset endpoint. No auth required, up to 20 symbols
  per call. Pairs with `watchlist_add_bulk` for refreshing watchlists
  with market movers. Ported from `lnv-louis/tradingview-mcp`.
  `src/core/scanner.js` ships an exchange→country mapping table
  reusable for future scanner-backed tools, and `safeBacktickBody`
  was added to `src/connection.js` for escaping values pasted into
  backtick-template bodies evaluated remotely.
- **Multi-timeframe + candlestick pattern tools.**
  `data_get_multi_timeframe` reads indicator values + price summary
  across a list of timeframes in one call (W→D→4H→1H→15m alignment),
  saving and restoring the original timeframe. `data_detect_candlestick_patterns`
  runs 17 classic patterns (doji, hammer/hanging-man, inverted-hammer/
  shooting-star, marubozu, spinning-top, engulfing, harami, piercing/
  dark-cloud, morning/evening star, three white soldiers / black crows)
  natively over OHLC bars: no chart pollution, no Pine indicator
  required.
- **Multi-pane + tab support.** `pane_list`, `pane_set_layout`,
  `pane_focus`, `pane_set_symbol`, `pane_set_timeframe`,
  `pane_read_batch` (single-call cross-pane reader), plus `tab_list`,
  `tab_new`, `tab_close`, `tab_switch`, `tab_switch_by_name`.
- **Pine Script lifecycle tools.** `pine_save_as`, `pine_rename`,
  `pine_version_history`, `pine_delete`, `pine_switch_script` (UI
  dropdown), `pine_smart_compile` (auto-detect + elapsed_ms),
  `pine_analyze` (offline static analysis), `pine_check` (server-side
  compile, no chart needed).
- **Pine drawing readers.** `data_get_pine_lines`, `data_get_pine_labels`,
  `data_get_pine_tables`, `data_get_pine_boxes`, `data_get_pine_shapes`:
  read horizontal price levels, text annotations, table cells, price
  zones, and plotshape/plotchar markers from any visible Pine indicator.
  Deduplicate and cap output by default; opt into raw via `verbose`.
- **Replay tick granularity.** `replay_set_resolution` controls bar
  granularity in replay mode.
- **Drawing additions.** `draw_position` (Long/Short trade boxes),
  `output_dir` parameter on `capture_screenshot` and `batch_run`.
- **Watchlist bulk ops.** `watchlist_remove`, `watchlist_add_bulk`.
- **Connection lifecycle tools.** `tv_ensure`, `tv_reconnect`,
  `tv_discover`, `ui_dismiss_dialogs`, plus `dismissBlockingDialogs`
  helper that handles "Continue your last replay?", "Save script?",
  and similar modals that previously stalled commands.
- **Cross-platform launch.** `tv_launch` auto-detects native macOS,
  Linux, Windows, and Windows MSIX (Microsoft Store) installs, and
  resolves the Windows path correctly when invoked from WSL2.
  macOS Electron 38 falls back to `open -a` when the binary refuses
  `--remote-debugging-port` from a direct spawn.
- **Symbol search via REST.** `symbol_search` uses TradingView's
  public symbol search API for offline-resolvable lookups.
- **CLI surface.** `tv` command with 30 commands and 66 subcommands
  mirroring the MCP tool list, including `tv stream {quote,bars,values,
  lines,tables,all}` for poll-and-diff JSONL output.
- **`study_filter` parameter** on `data_get_study_values` and the
  pine drawing readers, narrowing reads to a specific indicator by
  name substring.
- **Test infrastructure.** Smoke-test scaffold across 14 core modules
  with CDP test-override hooks (`installCdpMocks`, `mockEvaluateFromTable`),
  `tests/helpers/mock-cdp.js`, 338 offline tests covering pattern
  detection, multi-timeframe loop semantics, sanitization, replay,
  pine_analyze, and CLI routing.
- **Tooling.** ESLint config + CI workflow, GitHub Actions
  `upstream-tracker.yml` that auto-opens issues for new merged
  upstream PRs, `MERGED_UPSTREAM_PRS.md` log, `IDEAS.md` discoveries
  log, `scripts/audit_forks.sh` for periodic competitive audits.

### Changed

- **Per-call `_deps` dependency injection** across 10 core modules
  (chart, data, drawing, pane, pine, replay, ui, watchlist, alerts,
  capture). Removes module-global mutable state, makes each function
  independently testable without monkey-patching `connection.js`.
- **e2e tests refactored** to call core wrappers instead of
  reimplementing CDP IIFEs inline (~30 raw-CDP sites replaced),
  closing the wrapper-bug class where tests passed but production
  produced wrong output.
- **Setting symbol** now verifies + retries through blocking dialogs
  rather than failing silently when TradingView intercepts the change.
- **Pane focus** waits 300ms after `pane.focus()` for
  `_activeChartWidgetWV` to update, required since TV 3.1.0.
- **Output context-budget defaults** tightened: `data_get_ohlcv` ships
  with a `summary` mode, pine readers deduplicate and cap labels at
  50 (override via `max_labels`), `study_filter` available everywhere
  it makes sense.
- **README** restructured: hero image, CI status + Version badges,
  decision-tree-driven tool reference (96 tools), output size table,
  footer CTA. Voice rules applied (em dashes scrubbed).
- **`scripts/pine_push.js` reliability** lessons ported from
  `prezis/tradingview-mcp`: optional CLI arg for source path;
  pre-push cleanup that removes existing chart instances of the
  indicator before pushing (prevents max-5 limit on repeat pushes);
  skip Ctrl+Enter when the button matcher already triggered
  Add/Update (avoids double-add); longer waits (2400ms dialog,
  6600ms compile) for heavy indicators; "Save and add to chart"
  confirmation dialog handling.

### Fixed

- **TradingView Desktop 3.1.0 compatibility** across the surface:
  Pine Editor open + symbolInfo fallbacks, openPanel works on all
  action × initial-state combos, pine compile/deploy buttons matched
  by `title` attribute, resilient Pine Editor detection during state
  transitions, `pine_set_source` no longer hangs on large scripts.
- **Saved replay state** wiped from
  `_chartWidgetCollection._replaySessionState` in `replay.stop` and
  e2e setup, preventing "stuck saved replay" that blocked symbol
  changes after replay use.
- **Tab switching** uses `Target.activateTarget` instead of the
  deprecated `/json/activate` endpoint.
- **Cycle audit (1–2): 6 bugs + 3 perf items** addressed.
- **`quote_get` title vs assertion drift** corrected.

### Security

- **Removed `ui_evaluate`.** The tool accepted arbitrary JavaScript
  for execution in the authenticated TradingView session, giving any
  caller full read/write access to the user's TradingView account
  state. Dropped from the MCP surface.

### Documented

- `CLAUDE.md` decision tree for tool selection by intent.
- `README.md` hero image, badges, structured tool reference,
  context-management rules, output-size estimates.
- `IDEAS.md` rolling log of TV Desktop 3.1.0 quirks and live
  discoveries.
- `MERGED_UPSTREAM_PRS.md` tracks which upstream PRs have been
  ported.

[1.0.0]: https://github.com/iliaal/tradingview-mcp/releases/tag/1.0.0
