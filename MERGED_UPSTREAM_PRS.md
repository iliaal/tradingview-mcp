# Merged Upstream PRs

PRs from `tradesdontlie/tradingview-mcp` that have been reviewed and applied to this fork. The upstream-tracker workflow skips these when reporting new items.

| PR | Title | Applied | Notes |
|----|-------|---------|-------|
| #35 | feat: data_get_pine_shapes for plotshape/plotchar signals | 2026-04-25 | Phase B.12 |
| #39 | fix: default screenshot region to 'full' when unspecified | 2026-04-25 | Already in our fork pre-phase-A |
| #40 | fix: reconnect CDP client after tab switch | 2026-04-25 | Already in our fork pre-phase-A |
| #43 | feat: output_dir parameter on screenshot tools | 2026-04-25 | Phase B.14 |
| #45 | Init ESLint and debugging capabilities | 2026-04-25 | Phase N.39 — ESLint config + CI workflow (commit c395533) |
| #51 | feat: 3-phase strategy detection with DOM fallback | — | **DEFERRED** — conflicts with PR #90 in data.js |
| #54 | security: remove ui_evaluate tool | 2026-04-25 | Phase N.35 |
| #60 | feat: draw_position tool for Long/Short positions | 2026-04-25 | Phase B.13 |
| #62 | fix(drawing): restore DI in listDrawings/getProperties/removeOne/clearAll | 2026-04-25 | Phase A.5 (covered alongside floatalgo) |
| #64 | feat: tv_ensure and tv_reconnect tools | 2026-04-25 | Phase B.11 |
| #65 | feat: watchlist_remove + watchlist_add_bulk + Electron 38 click fix | 2026-04-25 | Phase B.15 |
| #67 | fix: missing 'bin' entry in package-lock.json | 2026-04-25 | Phase N.38 |
| #70 | fix: Windows libuv assertion on CLI exit after fetch | 2026-04-25 | Phase N.41 |
| #71 | fix: bump hono and @hono/node-server to patch CVEs | 2026-04-25 | Phase A.10 |
| #72 | fix: symbolInfo throwing 'evaluate is not defined' | 2026-04-25 | Phase A.4 (extended to getVisibleRange + scrollToDate) |
| #80 | fix: tv_launch for TV v2.14.0+ (Electron 38 / Node 22) | 2026-04-25 | Phase C.21 partial (macOS fallback ported; full DI refactor skipped — conflicts with our WSL/MSIX work) |
| #90 | fix: TV Desktop 3.1.0 compat for data.trades / strategy / equity | 2026-04-25 | Phase N.36 |
| #91 | fix: layout_switch dismisses unsaved-changes dialog in non-English locales | 2026-04-25 | Phase N.37 |
| #94 | chore(cdp): env-var overrides for TV CDP host/port | 2026-04-25 | Phase C.24 |
| #95 | fix(pine): match Add/Update-on-chart buttons by title attr | 2026-04-25 | Phase A.2 |
| #96 | fix(data): DOM-scrape fallback for strategy results + trades | — | **DEFERRED** — conflicts with PR #90 in data.js |
| #97 | fix(pine): resilient Pine Editor detection during state transitions | 2026-04-25 | Phase A.8 |
| #102 | CI and agent guardrails | 2026-04-25 | Phase N.40 partial — CI workflow ported (commit c395533); agent-guardrail bits not applicable |
| #536 | fix(drawing): accept color/linewidth/linestyle on draw_shape, report what landed | 2026-09-20 | Ported: first-class style params + landed/mismatch report, readback never fails draw |
| #522 | fix(pine): detect icon-only add/update-to-chart button | 2026-09-20 | Remainder ported: compile() data-qa-id fast path (title-attr base was Phase A.2) |
| #532 | Fix replay_stop leaving the chart in the past; make the test suite pass on Windows | 2026-09-20 | Fully ported: scripts (stream redirect, Start-Process); replay core exits without stopReplay() (leaveReplay() preferred on 3.4.1, goToRealtime() fallback) + live-bar readiness poll; e2e teardown via core stop. Live-verified on TV 3.4.1 |
| #528 | fix(tools): stop reading the string "false" as true | 2026-09-20 | Verified present (boolish superset in src/tools/_validation.js) — no change |
| #524 | Fix Windows path bug in source-audit test, apply npm audit fixes | 2026-09-20 | Verified present (fileURLToPath); remaining audit finding (brace-expansion DoS) fixed via `npm audit fix` → 0 vulns |
| #533 | Point the install docs at the real Claude Code config paths | 2026-09-20 | Verified present (README + SETUP_GUIDE) — no change |
| #534 | Stop the update check flagging branches ahead of upstream | 2026-09-20 | N/A — fork has no update-check surface |
| #530 | Fix tv_launch on MSIX installs: sync EPERM + sandbox | 2026-09-20 | **DEFERRED** — hunk assumes absent launch structure; needs live-Windows verification |
| #526 | Add indicator_get_style / indicator_set_style | 2026-09-20 | **DEFERRED** — new 2-tool surface (455 additions), needs design + live-TV pass |
| #523 | Add local trade journal and XAUUSD skill | 2026-09-20 | **SKIPPED** — personal-feature PR, out of scope |

## Fork-mined, no upstream PR (tradesdontlie forks audit 2026-09-20)

| Fork | Item | Applied | Notes |
|------|------|---------|-------|
| eltx88 | secrets/OS `.gitignore` entries | 2026-09-20 | Commit 762ea18 |
| lakshman1005 + 0xdungbui | CLI stdout truncation on `process.exit()` (65KB pipe cutoff) | 2026-09-20 | NOT REPRODUCIBLE locally — our result path already drains; unified the 6 help/error exits to exitCode+return for the same libuv-safe rationale (no live truncation bug found) |
| mustafagurbuzai | Drawing: N-point shapes, move/set/visible, two-point position, real shape list | 2026-09-20 | ADOPTED (cherry-picked onto #536 core; H10 DI-removal rejected). Live-verified 3.4.1 |
| lakshman1005 | Alert name/webhook/email/frequency/expiry/deactivate + list surfacing | 2026-09-20 | ADOPTED opt-in with defaults preserved + SSRF guard; directional + resolution already shipped; never-expiry default DEFERRED. Live-verified 3.4.1 |
| basghari | Bounded capture, occlusion recovery, axes clips, bars alias | 2026-09-20 | ADOPTED (macOS-gated, no-write-on-timeout). Live-verified 3.4.1 |
| 0xdungbui | draw_list price/title, watchlist anchor, scroll read-back, postcondition tests | 2026-09-20 | ADOPTED (40-char drop DEFERRED as too lossy; title objects unwrapped). Live-verified 3.4.1 |

## Untouched / not-applicable upstream PRs

| PR | Title | Reason |
|----|-------|--------|
| #18 | Fix tv_launch for TV v2.14.0+ | Superseded by #80 |
| #34 | rename draw_shape, expand to 80+ tools | Large breaking API change |
| #50 | Korean locale Pine compile buttons | Superseded by #95 (title-attr matches all locales) |
| #52, #73, #76, #79, #93, #100 | Windows MSIX detection variants | Superseded by our own MSIX detection (Phase C.27) |
| #53 | Docker support | Out of scope |
| #66 | Stock Screener tools | Out of scope |
| #69 | Real-time signal dashboard, price monitor | Out of scope |
| #74 | 12hr watchlist scanner workflow | Out of scope |
| #86 | Frankie candles pine scripts | Out of scope |
| #98 | Crypto swing-trading rules config | Out of scope |
