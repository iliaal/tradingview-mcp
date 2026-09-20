<!-- BEGIN beads-managed (br v6) -->
## Beads ledger (`br`)

This repo is onboarded to the central `br` ledger. A PATH wrapper routes every
`br` call from here into a private store under `~/ai/beads/<slug>/`; this work tree
carries **no** `.beads` artifacts (do not create any). Full protocol lives in
`~/ai/wiki/tools/beads-review-ledger.md`.

**Allowed commands** (the wrapper denies everything else): `create update comments
close reopen list show count stats search where info`, `doctor health`,
`sync --import-only|--status`, `config get|list`. Never pass `--db`,
`--no-auto-flush`, `--no-auto-import`, `--no-db`, `--allow-stale`, or `--prefix`.

**JSON envelopes**: `br list --json` → `{issues, total}`; `br show ID --json` →
a one-element array with comments under `.[0].comments`. Pipe `br` JSON to `jq`
only as `rtk proxy br … | rtk proxy jq …` (raw, unfiltered output).

**Finding schema** (review-cycle records):
- Native status `open`/`closed` only — `in_progress` is banned (it silently
  disappears from `--status open`). Priority is severity: P0 critical, P1
  important, P2 minor.
- Exactly one `type:{security|correctness|memory|perf|build|test|style}` label and
  one `cycle:<id>` label. Open findings carry exactly one
  `state:{proposed|disputed|fixed|needs-human}`; closed findings carry no `state:*`
  and a `close_reason` of `fixed|false-positive|wont-fix|duplicate`.
- Description first line is `file: <path>:<line>`, repo-relative.
- Attribution: `br create --actor <id>`, `br comments add --author <id>`.
- Closing is two steps (0.2.19 refuses a terminal status in `update`): first
  `br update ID` clearing `state:*` and the assignee, then `br close ID --reason <r>`.
- Never `--set-labels` (it erases other labels); use `--add-label`/`--remove-label`.

**Human gate** — create as `state:needs-human` and get pre-change approval for: P0,
`type:security`, `type:memory`, destructive operations, schema/data migrations, or
public API changes.
<!-- END beads-managed (br v6) -->

---

## Rules — authority, proof, failure attribution

- The user's word is absolute: user-reported state (errors, failures, observations) is ground truth — act on it directly, never re-run checks to confirm it.
- External actions need approval first: `alert_create` / `alert_create_indicator` / `alert_delete`, `pine_save` / `pine_save_as` / `pine_delete` / `pine-deploy` / `pine-publish`, replay trades (`replay_trade`), and `tv_launch` with `kill_existing`. Reads, screenshots, and compiles are safe without asking.
- Prove behavior against the real surface: verify every path/command against `src/` before writing it in docs; verify TradingView claims against the live chart via `tv_health_check`, not from memory.
- Report only what you checked: never claim a snippet, tool, or external ID verified without checking it; unobserved claims are marked `[INFERENCE]`.
- Attribute failures honestly: a wrong tool call is your bug, not the chart's — re-read the decision tree and retry before blaming TradingView state.

---

# TradingView MCP — agent instructions

MCP bridge for TradingView Desktop via Chrome DevTools Protocol. Tool count is not pinned here — the registry is the source of truth: `TOOL_GROUPS` in `src/tools/registry.js` (health, chart, pine, data, capture, drawing, alerts, batch, replay, indicators, watchlist, ui, pane, tab, hotlist, strategy, news, screener, pine-deploy, pine-publish; disable groups via `TV_DISABLED_TOOLS`). Never hardcode a tool count.

## Decision tree — which tool when

### "What's on my chart right now?"
1. `chart_get_state` → symbol, timeframe, chart type, all indicators with entity IDs
2. `data_get_study_values` → current numeric values from all visible indicators (`study_filter` targets one by name substring)
3. `quote_get` → real-time price, OHLC, volume (`symbol` omitted = active chart; `route: "rest"` is scanner-only/fast US-equities; `"chart_switch"` is universal but slower)

### "What levels/lines/labels are showing?"
Custom Pine drawings are invisible to normal data tools. Use:
1. `data_get_pine_lines` → horizontal price levels (`study_filter`, `verbose`, `include_empty`)
2. `data_get_pine_labels` → text annotations with price + `signal_price` + bar (`study_filter`, `max_labels` default 50, `verbose`, `since`/`until`, `include_empty`)
3. `data_get_pine_tables` → table rows (`study_filter`, `include_empty`)
4. `data_get_pine_boxes` → price zones as `{high, low}` (`study_filter`, `verbose`, `include_empty`)

### "Give me price data"
- `data_get_ohlcv` with `summary: true` → compact stats (high, low, range, change%, avg volume, last 5 bars); without summary → all bars (`count`, max 500, default 100; `symbol` reads a non-active ticker via chart-switch + restore)
- `quote_get` → single latest price snapshot
- `data_detect_candlestick_patterns` → native scan over recent OHLC for 17 classic patterns (`last_n_bars` max 500, `min_strength`, `pattern_filter`) — no chart pollution

### "Top-down / multi-timeframe view"
- `data_get_multi_timeframe` with `timeframes: ["W","D","240","60","15"]` (array or comma string, max 10) → per-TF indicator values + price summary in one call (`study_filter`, `include_ohlcv` default true). Saves and restores the original timeframe. Same indicators must already be loaded.

### "Analyze my chart" (full report workflow)
1. `quote_get` → current price
2. `data_get_study_values` → all indicator readings
3. `data_get_pine_lines` → key price levels
4. `data_get_pine_labels` → labeled levels with context
5. `data_get_pine_tables` → session stats, analytics tables
6. `data_get_ohlcv` with `summary: true` → price action summary
7. `capture_screenshot` → visual confirmation (`region: "full"|"chart"|"strategy_tester"`, `filename`, `method: "cdp"|"api"`)

### "Change the chart"
- `chart_set_symbol` → switch ticker (`symbol`, e.g. "AAPL", "ES1!", "NYMEX:CL1!"; `discard_unsaved` defaults safe-refuse on unsaved edits)
- `chart_set_timeframe` → switch resolution (`timeframe`: "1", "5", "15", "60", "D", "W", "M")
- `chart_set_type` → switch style (`chart_type` name or number: Bars(0), Candles(1), Line(2), Area(3), Renko(4), Kagi(5), PointAndFigure(6), LineBreak(7), HeikinAshi(8), HollowCandles(9))
- `chart_manage_indicator` → add/remove studies (`action: "add"|"remove"`; full names only: "Relative Strength Index", not "RSI"; `entity_id` required for remove; `inputs` JSON string for built-ins)
- `chart_remove_studies_by_title` → bulk-remove by name substring (`title_match`, case-insensitive)
- `chart_scroll_to_date` → jump to a date (`date` ISO or unix string)
- `chart_set_visible_range` → zoom to exact range (`from`/`to` unix seconds; `auto_extend_cache` default true preloads history via replay)
- `chart_get_visible_range`, `symbol_info`, `symbol_search` (`query`, `type`) for inspection/discovery

### "Work on Pine Script"
1. `pine_set_source` (`source`) → inject code into editor
2. `pine_smart_compile` → compile with auto-detection + error check (or `pine_compile` for plain compile)
3. `pine_get_errors` → read compilation errors (Monaco markers)
4. `pine_get_console` → read `log.info()` output
5. `pine_get_source` → read current code back (WARNING: can be very large — see context rules)
6. `pine_save` → save to TradingView cloud (Ctrl+S)
7. `pine_new` (`type: "indicator"|"strategy"|"library"`) → blank script; `pine_open` (`name`) → load saved script; `pine_list_scripts` → list saved; `pine_switch_script` (`name`) → switch editor context via picker; `pine_save_as` (`name`, `overwrite`); `pine_rename` (`name`); `pine_version_history`; `pine_delete` (`name`, irreversible — needs approval)
8. `pine_analyze` (`source`) → offline static analysis (array bounds, bad loops, bool casts — no TV connection needed); `pine_check` (`source`) → server-side compile validation
9. `pine_deploy` (`pine_path`, `clean_match`) → PREFERRED file-based deploy for scripts on disk: replaces set_source + save + smart_compile with no token tax, pre-cleans duplicate chart instances

### "Practice trading with replay"
1. `replay_start` (`date: "2025-03-01"` day-precision = midnight UTC, or ISO with offset for intraday; `scroll_back` to preload history for backward jumps) → enter replay mode
2. `replay_step` → advance one bar; `replay_set_resolution` (`interval`: "1T", "1S", "1", "5", "1H", "1D", "auto") → tick granularity
3. `replay_autoplay` (`speed` ms: 100, 143, 200, 300, 1000, 2000, 3000, 5000, 10000) → auto-advance
4. `replay_trade` (`action: "buy"|"sell"|"close"`) → execute trades (needs approval)
5. `replay_status` → position, P&L, current date
6. `replay_stop` → return to realtime

### "Screen multiple symbols"
- `batch_run` with `symbols: ["ES1!", "NQ1!", "YM1!"]` (+ optional `timeframes`) and `action: "screenshot"|"get_ohlcv"|"get_strategy_results"`
- `screener_scan` for flexible market scans (`market`: stock, etf, crypto, forex, futures, index, america, global, cfd; plus keyword/exchange/numeric-range filters); `watchlist_get` / `watchlist_add` (`symbol`) / `watchlist_remove` (`symbols`) / `watchlist_add_bulk` (`symbols`) manage the TV watchlist
- `pane_read_batch` (`indices`, `reads`) reads pine_tables/lines/labels/boxes, study_values, ohlcv_summary, drawings across grid panes in one CDP call; `pane_list` / `pane_set_layout` (`layout`: s, 2h, 2v, 4, 6, 8…) / `pane_focus` (`index`) / `pane_set_symbol` / `pane_set_timeframe` manage the grid

### "Find today's market movers"
- `hotlist_get` with `slug: "volume_gainers"` (or `percent_change_gainers`, `percent_change_losers`, `gap_gainers`, `gap_losers`, `percent_range_gainers`, `percent_range_losers`, `percent_gap_gainers`, `percent_gap_losers`) → up to 20 US symbols ranked by the hotlist field. Pairs with `watchlist_add_bulk`.

### "Draw on the chart"
- `draw_shape` → horizontal_line, vertical_line, trend_line, rectangle, text (`point` + optional `point2` as `{time, price}`); `draw_position` (`direction: "long"|"short"`, `entry_price`, `stop_loss`, take-profit) for trade overlays
- `draw_list` → see what's drawn; `draw_get_properties` (`entity_id`); `draw_remove_one` (`entity_id`); `draw_clear` → remove all

### "Manage alerts"
All four post to `pricealerts.tradingview.com` REST. No DOM scraping, returns real `alert_id`.
- `alert_create` → price alert on active symbol. `condition`: "crossing"/"greater_than"/"less_than" (aliases "above"/"cross_up"/etc. normalized to `cross`/`cross_up`/`cross_down`). Returns `alert_id`.
- `alert_create_indicator` → fires on a Pine `alertcondition()` signal. Needs `pine_id`, `alert_cond_id` (e.g. `plot_12`), `inputs`, `offsets_by_plot`. Discover the schema by creating one alert manually in the UI, then reading it back via `alert_list`.
- `alert_list` → active alerts with `alert_id`s.
- `alert_delete` → `alert_id` for one, `alert_ids: [...]` for bulk, or `delete_all: true`.

### "Navigate the UI"
- `ui_open_panel` (`panel: pine-editor|strategy-tester|watchlist|alerts|trading`, `action: open|close|toggle`)
- `ui_click` (`by: aria-label|data-name|text|class-contains`, `value`); `ui_hover`, `ui_find_element` (`query`, `strategy`), `ui_mouse_click` (prefer `selector` over raw coords — WSL2/HiDPI scaling), `ui_keyboard` (`key`, `modifiers`), `ui_type_text` (`text`), `ui_scroll` (`direction`, `amount`), `ui_dismiss_dialogs` (safe no-op when clean)
- `layout_list` → saved layouts; `layout_switch` (`name`, `discard_unsaved` defaults safe-refuse)
- `ui_fullscreen` → toggle fullscreen
- `capture_screenshot` (`region: "full"|"chart"|"strategy_tester"`)
- `tab_list` (`include_pine_script` default true) / `tab_new` / `tab_close` (`id`) / `tab_switch` (`index`) / `tab_switch_by_name` (`name`) / `tab_pin` (exactly one of `id|title|symbol|url`; cross-instance claim at `~/.tv-mcp-registry.json`) / `tab_unpin` / `tab_registry` for multi-tab work
- Strategy Tester reads: `data_get_strategy_results`, `data_get_trades` (`max_trades`), `data_get_strategy_info`, `data_get_equity`; `depth_get` needs the DOM panel open; `indicator_set_inputs` (`entity_id`, `inputs` JSON) / `indicator_toggle_visibility` (`entity_id`, `visible`); `tv_ui_state`, `tv_discover` for inspection

### "TradingView isn't running"
- `tv_launch` (`port` default matches server config, `kill_existing` default true — needs approval) → auto-detect and launch TradingView with CDP on Mac/Win/Linux
- `tv_ensure` → idempotent ensure-CDP (no-op if up; kills + relaunches if TV runs without CDP; launches if absent)
- `tv_health_check` → verify connection; `tv_reconnect` → reload page to reclaim a stale backend session

## Context management rules

These tools can return large payloads. Follow these rules to avoid context bloat:

1. **Always use `summary: true` on `data_get_ohlcv`** unless you specifically need individual bars
2. **Always use `study_filter`** on pine tools when you know which indicator you want — don't scan all studies unnecessarily
3. **Never use `verbose: true`** on pine tools unless the user specifically asks for raw drawing data with IDs/colors
4. **Avoid calling `pine_get_source`** on complex scripts — it can return 200KB+. Only read if you need to edit the code.
5. **Avoid calling `data_get_indicator`** on protected/encrypted indicators — their inputs are encoded blobs. Use `data_get_study_values` instead for current values.
6. **Use `capture_screenshot`** for visual context instead of pulling large datasets — a screenshot is ~300KB but gives you the full visual picture
7. **Call `chart_get_state` once** at the start to get entity IDs, then reference them — don't re-call repeatedly
8. **Cap your OHLCV requests** — `count: 20` for quick analysis, `count: 100` for deeper work, `count: 500` only when specifically needed

### Output size estimates (compact mode)
| Tool | Typical output |
|------|---------------|
| `quote_get` | ~200 bytes |
| `data_get_study_values` | ~500 bytes (all indicators) |
| `data_get_pine_lines` | ~1-3 KB per study (deduplicated levels) |
| `data_get_pine_labels` | ~2-5 KB per study (capped at 50) |
| `data_get_pine_tables` | ~1-4 KB per study (formatted rows) |
| `data_get_pine_boxes` | ~1-2 KB per study (deduplicated zones) |
| `data_get_ohlcv` (summary) | ~500 bytes |
| `data_get_ohlcv` (100 bars) | ~8 KB |
| `data_detect_candlestick_patterns` (100 bars) | ~1-3 KB (only matched bars) |
| `data_get_multi_timeframe` (5 TFs × 5 indicators) | ~1-2 KB |
| `hotlist_get` (20 symbols) | ~1-2 KB |
| `capture_screenshot` | ~300 bytes (returns file path, not image data) |

## Tool conventions

- All tools return `{ success: true/false, ... }`
- Entity IDs (from `chart_get_state`) are session-specific — don't cache across sessions
- Pine indicators must be **visible** on chart for pine graphics tools to read their data
- `chart_manage_indicator` requires **full indicator names**: "Relative Strength Index" not "RSI", "Moving Average Exponential" not "EMA", "Bollinger Bands" not "BB"
- Screenshots save to `screenshots/` directory with timestamps
- OHLCV capped at 500 bars, trades at 20 per request
- Pine labels capped at 50 per study by default (pass `max_labels` to override)

## Architecture

```
Claude Code ←→ MCP Server (stdio) ←→ CDP (localhost:9222) ←→ TradingView Desktop (Electron)
```

Pine graphics path: `study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById`

## Tech stack and commands

- Node ESM service (`"type": "module"` in `package.json` — engine/lockfile versions live there, not here). Runtime deps: MCP SDK server + `chrome-remote-interface` (CDP client); dev: eslint + globals. Entry `src/server.js` (MCP name `tradingview`, stdio transport, graceful SIGTERM/SIGINT/stdin-close CDP teardown); CLI `src/cli/index.js` (`tv` bin); tool groups `src/tools/*.js` behind `src/tools/registry.js`; connection `src/connection.js` (default CDP port 9222, overridable via `TV_CDP_PORT`); `TV_MCP_TARGET_FILTER` narrows the CDP target; `TV_DISABLED_TOOLS` drops groups (e.g. `news`, the only group reaching third-party hosts).
- Structure: `src/server.js`, `src/connection.js`, `src/wait.js`, `src/core/`, `src/tools/`, `src/cli/`; `tests/` (node:test suites + `tests/smoke/` + `tests/helpers/`); `scripts/launch_tv_debug_{linux,mac}.sh` (+ `.bat`/`.vbs` for Windows); `screenshots/`; `skills/` (chart-analysis, multi-symbol-scan, pine-develop, replay-practice, strategy-report); `agents/`.
- Commands (exact, from `package.json` scripts):
  - `npm start` (`node src/server.js`) / `npm run tv` (`node src/cli/index.js`)
  - `npm test` — e2e + pine_analyze (needs live TradingView + CDP)
  - `npm run test:offline` — full offline suite (`SKIP_NETWORK_TESTS=1`; pine_analyze, sanitization, replay, cli, patterns, multi_timeframe, hotlist, chart_remove_studies, connection_reconnect, chart_indicator, data_formatting, format, tool_registry, tool_count, drawing_style, smoke)
  - `npm run test:unit`, `npm run test:smoke`, `npm run test:e2e`, `npm run test:cli` — scoped suites (`test:unit` = pine_analyze, cli, chart_indicator, data_formatting, format, tool_registry, tool_count, drawing_style); `npm run test:verbose`, `npm run test:count` — reporting variants
  - `npm run test:e2e-all` — both live suites (`e2e` + `new_features`, the latter skips under `SKIP_NETWORK_TESTS=1`); `npm run test:all` — e2e + pine_analyze + cli combo
  - `npm run check:syntax` — `node --check` over `src` + `tests`
  - `npm run lint` / `npm run lint:fix` — eslint over `src/` (config `eslint.config.mjs`)
- Never commit `screenshots/` output or `.beads` artifacts (repo carries none; `screenshots/` is `.gitignore`d).

---

<!-- codesage-onboard-hint-begin -->
<!-- codesage-onboard-hint-version: 0.13.0 -->
# Local: code intelligence (CodeSage)

Global MCP server `codesage` provides semantic search and structural graph queries for this project.

## The `project` argument

Every CodeSage MCP tool requires an absolute path to the project root. For this project:

```
project: "/home/ilia/ai/tradingview-mcp"
```

Pass that on every call. The server uses it to route to the right index.

## Tool selection

### Code intelligence
- `project_overview`: call ONCE at the start of a session to orient — languages, index freshness/drift, feature summary, top-risk files, trust-boundary clusters, test conventions, entrypoints, and suggested next calls in one bounded response. Cheaper than fanning out `status` + `features-list` + risk probes.
- `search`: "where does X happen?", debugging by symptom, intent queries spanning files, when you don't know the symbol name.
- `find_symbol` / `find_references`: exact symbol lookups, callers/callees, dependency mapping. `find_references` rows carry `from_symbol` (the enclosing caller), so you get caller→callee edges directly.
- `impact_analysis`: before renaming a symbol or modifying a widely-used class or function. Identifies tests to run. Add `include_forward` / `include_siblings` for the target's own deps and same-file neighbours; `limit` / `summary_only` to cap a wide blast radius.
- `export_context`: package code for another LLM around a free-form query or a single named symbol. For an already-mapped feature slice, use `feature_bundle` instead — it avoids re-running semantic search.
- grep / ripgrep: exact strings, constants, error messages; when you already have the exact symbol name.

### Feature slices and trust boundaries (0.7.0)

A feature slice is a behavior-keyed bundle: entrypoint + owned files + context files + tests + crossed trust boundaries + tags. Mapped deterministically (no LLM) from build manifests, framework routing, and source-level signals across PHP/Laravel, C/C++, Rust, Python, JS/TS, Go.

- `list_features`: enumerate feature slices, filter by `kind` (`route`, `cli-command`, `library`, `test-suite`, `service`, `config`, `job`), `language`, or `tag`. Use to discover the agent-facing surface area before deep-diving.
- `find_feature`: given a file path, return the feature(s) that own it. Answers "what slice owns app/Http/Controllers/UserController.php?" without scanning by hand.
- `feature_bundle`: curated code bundle for one `feature_id`. Same shape as `export_context` but anchored on the feature's pre-resolved file list (entry + owned + tests + context) — avoids fan-out Read calls per file when reviewing or modifying a whole slice. Optionally expand the entry symbol's callers/callees.
- Trust-boundary signal: each file in the index carries a derived tag set (`network`, `filesystem`, `process-exec`, `secrets`, `database`, `user-input`, `external-api`, `serialization`, `auth`, `concurrency`). The same signal feeds `assess_risk` and surfaces a `"crosses N trust boundaries (X, Y, Z) — security review recommended"` note when ≥3 are crossed. Quote that note in PR descriptions for security-sensitive patches.

### Risk and history (V2b)

Per-file (slice 1):
- `assess_risk`: BEFORE writing a patch, query risk for the file. Score combines churn, fix ratio, blast radius, coupling, test gap, import-cycle membership, and trust-boundary count. Hot+fix-heavy file means smaller patch + broader test sweep. Quote the notes in PR descriptions so reviewers see your calibration.
- `assess_risk_batch`: per-file risk for N files in one call, no aggregation. Use when you have a list of files (impact analysis output, coupling neighbours, the files of a feature you're touching one-by-one) and want each individual score — saves per-file MCP round-trips. For patch-level aggregation use `assess_risk_diff`.
- `find_coupling`: when planning the test sweep, ask which files have historically changed with the file you're touching. Replaces "consider running tests in X" guesses with named files.

Patch-level (slice 2, added in 0.3.0):
- `assess_risk_diff`: aggregate risk for a SET of files (the file list of a patch). Returns max/mean scores, the highest-risk file, and bucketed lists (hotspot, fix-heavy, test-gap, wide blast radius). Use BEFORE submitting: if max_score is high or any test_gap_files exist, add tests, split the patch, or flag concerns. `summary_notes` are paste-ready for a PR description. When ≥3 files share a categorical note, per-file `notes[]` carries short codes (`"T"`, `"NG"`) — resolve via the top-level `_legend` map.
- `recommend_tests`: tests an agent should run after editing a set of files. `primary` resolves siblings by language convention; `coupled` adds tests from co-change history. Replaces "I'll run all tests" hedging with a focused list. Sibling conventions covered:
  - PHP/Laravel: `FooTest.php` flat siblings; mirror-tree `tests/{Unit,Feature,Integration,Browser}/<rest>/<file>Test.php` for `app/<rest>/<file>.php` sources.
  - PHP/Symfony: mirror-tree `tests/<rest>/<file>Test.php` for `src/<rest>/<file>.php` sources.
  - PHP internals: `<dir>/tests/*.phpt` for `.c` / `.h` source files (capped at 50 to keep noisy dirs like `ext/standard/tests` out of `primary`).
  - Python: `test_foo.py` and `foo_test.py` (sibling and `tests/` flat).
  - Go: `foo_test.go`.
  - JavaScript/TypeScript: `foo.test.ts(x)`, `foo.spec.ts(x)`, `.js` variants.
  - Rust: integration tests under `<crate_root>/tests/*.rs`. (Inline `#[cfg(test)] mod tests` not surfaced — they ride along with the source file.)
- `review_rehearsal`: the LAST step before committing. Pass the patch's file list; returns severity-ranked objections (missing tests, high-risk / blast-radius / fix-prone / hotspot files with hot-symbol evidence, import cycles, trust-boundary expansion, feature-test gaps, and `scope-spread` when the patch touches ≥4 unrelated feature areas) plus paste-ready `summary_notes`. Composes `assess_risk_diff` + `recommend_tests` + drift + feature mapping — fix or consciously accept each objection. CLI: `git diff --name-only | codesage rehearse`.

All four of `assess_risk` / `assess_risk_batch` / `assess_risk_diff` / `recommend_tests` require git history indexed. Initial `codesage git-index` runs at onboard; subsequent commits/merges auto-refresh via git hooks. Run `codesage git-index --full` weekly to rebaseline. Empty results mean either no history yet or the file is too new.

## Operations

- Structural + semantic + feature mapping + trust-boundary derivation all auto-refresh on commit/merge/checkout via installed git hooks (`codesage index` runs the whole pipeline).
- Git history index auto-refreshes incrementally on commit/merge/checkout/rebase via the same hooks. Weekly `codesage git-index --full` to rebaseline is still good hygiene.
- Manual refresh: `codesage index`, or `/codesage-reindex`. Force a full git-history rescan with `codesage git-index --full`.
- CLI: `codesage search --limit 5 'query'`, `codesage coupling <file>`, `codesage risk <file>`, `codesage risk-batch <files...>`, `codesage risk-diff <files...>`, `codesage tests-for <files...>` (all the multi-file commands accept stdin too: `git diff --name-only | codesage risk-diff`).
- Feature CLI: `codesage map`, `codesage features-list [--kind --lang --tag --json]`, `codesage feature-show <id>`, `codesage feature-for <file>`, `codesage feature-bundle <id>`, `codesage trust-boundaries <file>`.

## Feature-slice review workflow (plugin slash commands)

The `codesage-tools` plugin ships four slash commands that drive a subagent-based review over mapped feature slices. State persists under gitignored `.codesage/findings/` and `.codesage/reviews/`.

- `/codesage-review <project> [--limit N] [--jobs N] [--feature <id>] [--kind k] [--focus all|product] [--severity s] [--categories ...] [--deep] [--no-verify] [--max-verify-findings N]`: dispatches `codesage-feature-reviewer` subagents in parallel batches, one per feature slice. Each subagent calls `feature_bundle` + `assess_risk_batch` + structural tools and returns a fenced JSON findings block. Results merge into `.codesage/findings/<feature_id>.json` (status + history preserved across runs) and write a run record at `.codesage/reviews/<run_id>.json`.
- `/codesage-triage <project> --finding <fnd_id> --status <open|false-positive|wont-fix|fixed> [--note]`: pure local-state edit, appends a history entry.
- `/codesage-revalidate <project> --finding <fnd_id> | --feature <feat_id> | --all [--status s]`: re-runs the subagent through the same evidence gate. A missing `open` finding stays open as `needs-confirmation`; omission alone never proves a fix. Current evidence can reopen a `fixed` finding. `false-positive` and `wont-fix` remain user-owned.
- `/codesage-report <project> [--status s] [--severity s] [--category c] [--feature <id>]`: deterministic Markdown render, no LLM call.

When working on a file that the feature mapper owns, check `.codesage/findings/<feature_id>.json` for prior open findings before re-raising the same concern. Findings carry stable IDs (`fnd_<hex>`) so they can be referenced in commit messages and PR comments.
<!-- codesage-onboard-hint-end -->
