# Ideas & Backlog

Improvements tracked but not yet implemented.

## Deferred from previous fork-incorporation work

- **B.18 `pane_read_batch`** (ttnsx888 668cc55d) — one-CDP-call multi-pane reader. Requires extracting per-pine-tool formatters (`formatPineLines` / `formatPineLabels` / `formatPineTables` / `formatPineBoxes`) into shared helpers; conflicts with our existing PR #90 + B.20 modifications to `data.js`.
- **C.22 3-phase strategy detection with DOM fallback** (PR #51) — adds DOM-scrape fallback for strategy metrics. Conflicts with our PR #90 in `data.js`.
- **C.26 DOM-scrape fallback for strategy results + trades** (PR #96) — same conflict family as C.22.
- **C.23 AsyncLocalStorage tab routing + persistent pin + study-readiness gate** (floatalgo `81efb1ff`) — significant architectural change to how tools are routed across tabs. Held for design discussion.

These three (B.18, C.22, C.26) all rework `data.js` and need to be done together as a "data.js refactoring sweep" — applying any one without the others creates conflicts.

## Carried-forward smaller items

- **`pine_smart_compile`**: expose `elapsed_ms` so callers know how long compilation took.
- **`data_get_strategy_results_dom`**: tighten regex patterns as TradingView UI text changes (covered by C.22 if/when ported).
- **`tab_list`**: include which Pine script is active in each tab's editor (requires `pine-facade` introspection).
- **`tab_switch_by_name`**: switch directly by Pine script name instead of by index.
- **E2e wrapper refactor remainder**: ~73 raw-CDP sites in `tests/e2e.test.js` (`${CHART_API}.setSymbol`, `${REPLAY_API}.*`, etc.). 4 of 79 tests refactored so far (`ui_open_panel`, `replay_stop`, `tv_launch`, plus a partial). Rewriting the rest to use our wrapper functions makes e2e immune to TV API renames.
- **`quote_get output < 500 bytes`** size threshold: passes/fails depending on chart contents; threshold may need adjustment.

## Known TV Desktop 3.1.0 quirks worth documenting

- `_replaySessionState` cleanup (live-discovered, fixed in our `replay.stop()`).
- `WatchableValue` accessor breakage on `bottomWidgetBar` (`isAvailable`, `isHidden`, `mode` etc. now return subscription objects, not booleans).
- `bottomWidgetBar.hideWidget` removed; `_hideWidget` and `toggleWidget` are silent no-ops; only the toolbar collapse button actually closes the panel.
- `chart.symbolExt()` removed; `chart.symbolInfo()` not exposed via the public API. Our `symbolInfo()` falls back to `chart.symbol()` + `chart.resolution()` + `chart.chartType()`.
- `window.monaco` not exposed globally on TV 3.1.0; the React fiber walk in `FIND_MONACO` is the only working path.

## Sub-Agent Personas (Strategy Development) — speculative

- **Architect**: writes Pine Script strategy from spec.
- **Backtester**: runs parameter sweeps, reads strategy tester results.
- **Reviewer**: static analysis + `pine_check` before compile.
- **Reporter**: formats backtest results into structured summary.
