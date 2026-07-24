/**
 * Tool-group registry + startup gating.
 *
 * Every MCP tool group is registered through registerEnabledTools() so a
 * deployment can skip groups via the TV_DISABLED_TOOLS env var (comma-separated
 * group names, consistent with the TV_CDP_HOST / TV_MCP_TARGET_FILTER
 * conventions). Default empty → every group registers, unchanged behavior.
 *
 * Motivating case (#52): the `news` group is the only one that reaches
 * third-party hosts (nasdaq.com, finance.yahoo.com). Strict-egress deployments
 * want to drop it without editing source: TV_DISABLED_TOOLS=news.
 */
import { registerHealthTools } from './health.js';
import { registerChartTools } from './chart.js';
import { registerPineTools } from './pine.js';
import { registerDataTools } from './data.js';
import { registerCaptureTools } from './capture.js';
import { registerDrawingTools } from './drawing.js';
import { registerAlertTools } from './alerts.js';
import { registerBatchTools } from './batch.js';
import { registerReplayTools } from './replay.js';
import { registerIndicatorTools } from './indicators.js';
import { registerWatchlistTools } from './watchlist.js';
import { registerUiTools } from './ui.js';
import { registerPaneTools } from './pane.js';
import { registerTabTools } from './tab.js';
import { registerHotlistTools } from './hotlist.js';
import { registerStrategyTools } from './strategy.js';
import { registerNewsTools } from './news.js';
import { registerScreenerTools } from './screener.js';
import { registerPineDeployTools } from './pine-deploy.js';
import { registerPinePublishTools } from './pine-publish.js';

// Group name → register fn. The name is the env-facing identifier used in
// TV_DISABLED_TOOLS. `news` reaches third-party hosts; everything else stays on
// the local CDP endpoint or *.tradingview.com.
export const TOOL_GROUPS = {
  health: registerHealthTools,
  chart: registerChartTools,
  pine: registerPineTools,
  data: registerDataTools,
  capture: registerCaptureTools,
  drawing: registerDrawingTools,
  alerts: registerAlertTools,
  batch: registerBatchTools,
  replay: registerReplayTools,
  indicators: registerIndicatorTools,
  watchlist: registerWatchlistTools,
  ui: registerUiTools,
  pane: registerPaneTools,
  tab: registerTabTools,
  hotlist: registerHotlistTools,
  strategy: registerStrategyTools,
  news: registerNewsTools,
  screener: registerScreenerTools,
  'pine-deploy': registerPineDeployTools,
  'pine-publish': registerPinePublishTools,
};

/** Parse a TV_DISABLED_TOOLS value into a normalized Set of group names. */
export function parseDisabledTools(raw) {
  return new Set(
    String(raw || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Register every tool group except those named in env.TV_DISABLED_TOOLS.
 * Returns { registered, disabled, unknown } for the startup notice + tests.
 * `groups` is injectable so the selection logic can be unit-tested without the
 * real register functions.
 */
export function registerEnabledTools(server, { env = process.env, groups = TOOL_GROUPS } = {}) {
  const disabled = parseDisabledTools(env.TV_DISABLED_TOOLS);
  const registered = [];
  const skipped = [];
  const unknown = [...disabled].filter(name => !(name in groups));

  for (const [name, register] of Object.entries(groups)) {
    if (disabled.has(name)) { skipped.push(name); continue; }
    register(server);
    registered.push(name);
  }
  return { registered, disabled: skipped, unknown };
}
