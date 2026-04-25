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
- **2026-04-25** — TV Desktop 3.1.0 quirks wiki entry written at `~/ai/wiki/vendors/tradingview-desktop.md` covering API surface changes, state-pollution traps, Pine graphics object path, and launch-path quirks.

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
