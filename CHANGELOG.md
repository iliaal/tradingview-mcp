# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `hotlist_get` MCP tool + `tv hotlist <slug>` CLI: fetch a TradingView
  US hotlist (volume_gainers, percent_change_gainers/losers,
  gap_gainers/losers, etc.) via the public scanner preset endpoint.
  No auth required, up to 20 symbols per call. Pairs with
  `watchlist_add_bulk` for refreshing watchlists with market movers.
  Ported from `lnv-louis/tradingview-mcp`.
- `src/core/scanner.js`: exchange→country mapping table for
  TradingView's region-partitioned scanner endpoints (america, uk,
  germany, japan, forex, crypto, etc.). Reusable primitive for
  future scanner-backed tools.
- `safeBacktickBody` helper in `src/connection.js` for escaping
  values pasted into backtick-template bodies evaluated remotely.

### Changed

- `scripts/pine_push.js` reliability fixes ported from
  `prezis/tradingview-mcp`: optional CLI arg for source path;
  pre-push cleanup that removes existing chart instances of the
  indicator before pushing (prevents max-5 limit on repeat pushes);
  skip Ctrl+Enter when the button matcher already triggered
  Add/Update (avoids double-add); longer waits (2400ms dialog,
  6600ms compile) for heavy indicators.

## [1.0.0] - 2026-04-29

First tagged release. Forked from `tradesdontlie/tradingview-mcp` at
`4795784`; the entries below describe the delta since fork. Total
surface: 95 MCP tools + a `tv` CLI mirroring most of them, all driving
TradingView Desktop via the Chrome DevTools Protocol on port 9222.

### Added

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
- **README** restructured: hero image, badges, decision-tree-driven
  tool reference (95 tools), output size table, footer CTA. Voice
  rules applied (em dashes scrubbed).

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

[Unreleased]: https://github.com/iliaal/tradingview-mcp/compare/1.0.0...HEAD
[1.0.0]: https://github.com/iliaal/tradingview-mcp/releases/tag/1.0.0
