import { register } from '../router.js';
import * as core from '../../core/data.js';

register('quote', {
  description: 'Get real-time price quote. Pass a symbol to quote a non-active ticker (auto-routes through scanner REST or chart-switch).',
  options: {
    route: { type: 'string', short: 'r', description: 'auto (default — scanner REST then chart-switch), rest (US equities only), or chart-switch (universal, slower, includes bid/ask)' },
  },
  handler: (opts, positionals) => core.getQuote({
    symbol: positionals[0],
    route: opts.route === 'chart-switch' ? 'chart_switch' : opts.route,
  }),
});

register('ohlcv', {
  description: 'Get OHLCV bar data. Pass a symbol to read a non-active ticker (chart-switches, reads, restores).',
  options: {
    count: { type: 'string', short: 'n', description: 'Number of bars (default 100, max 500)' },
    bars: { type: 'string', short: 'b', description: 'Alias for --count (number of bars; ignored when --count is set)' },
    summary: { type: 'boolean', short: 's', description: 'Return summary stats instead of all bars' },
  },
  handler: (opts, positionals) => core.getOhlcv({
    symbol: positionals[0],
    count: opts.count ? Number(opts.count) : opts.bars ? Number(opts.bars) : undefined,
    summary: opts.summary,
  }),
});

register('values', {
  description: 'Get current indicator values from data window',
  handler: () => core.getStudyValues(),
});

register('data', {
  description: 'Advanced data tools (lines, labels, tables, boxes, shapes, strategy, trades, equity, depth)',
  subcommands: new Map([
    ['lines', {
      description: 'Get Pine Script line.new() price levels',
      options: {
        filter: { type: 'string', short: 'f', description: 'Filter by study name substring' },
        verbose: { type: 'boolean', short: 'v', description: 'Include raw line data' },
        'include-empty': { type: 'boolean', description: 'Include loaded studies that drew zero lines (distinguishes inactive from not-loaded)' },
      },
      handler: (opts) => core.getPineLines({ study_filter: opts.filter, verbose: opts.verbose, include_empty: opts['include-empty'] }),
    }],
    ['labels', {
      description: 'Get Pine Script label.new() annotations',
      options: {
        filter: { type: 'string', short: 'f', description: 'Filter by study name substring' },
        max: { type: 'string', short: 'n', description: 'Max labels per study (default 50)' },
        verbose: { type: 'boolean', short: 'v', description: 'Include raw label data' },
        'include-empty': { type: 'boolean', description: 'Include loaded studies that drew zero labels' },
      },
      handler: (opts) => core.getPineLabels({ study_filter: opts.filter, max_labels: opts.max ? Number(opts.max) : undefined, verbose: opts.verbose, include_empty: opts['include-empty'] }),
    }],
    ['tables', {
      description: 'Get Pine Script table.new() data',
      options: {
        filter: { type: 'string', short: 'f', description: 'Filter by study name substring' },
        'include-empty': { type: 'boolean', description: 'Include loaded studies that have no tables' },
      },
      handler: (opts) => core.getPineTables({ study_filter: opts.filter, include_empty: opts['include-empty'] }),
    }],
    ['boxes', {
      description: 'Get Pine Script box.new() price zones',
      options: {
        filter: { type: 'string', short: 'f', description: 'Filter by study name substring' },
        verbose: { type: 'boolean', short: 'v', description: 'Include raw box data' },
        'include-empty': { type: 'boolean', description: 'Include loaded studies that drew zero boxes' },
      },
      handler: (opts) => core.getPineBoxes({ study_filter: opts.filter, verbose: opts.verbose, include_empty: opts['include-empty'] }),
    }],
    ['shapes', {
      description: 'Get Pine Script plotshape/plotchar markers (triangle, diamond, cross, etc.) with OHLC at signal bars',
      options: {
        filter: { type: 'string', short: 'f', description: 'Filter by study name substring' },
        bars: { type: 'string', short: 'n', description: 'Last N bars to scan (default 100, max 500)' },
      },
      handler: (opts) => core.getPineShapes({ study_filter: opts.filter, last_n_bars: opts.bars ? Number(opts.bars) : undefined }),
    }],
    ['strategy', {
      description: 'Get strategy performance metrics',
      handler: () => core.getStrategyResults(),
    }],
    ['trades', {
      description: 'Get strategy trade list',
      options: {
        max: { type: 'string', short: 'n', description: 'Max trades to return' },
      },
      handler: (opts) => core.getTrades({ max_trades: opts.max ? Number(opts.max) : undefined }),
    }],
    ['equity', {
      description: 'Get strategy equity curve',
      handler: () => core.getEquity(),
    }],
    ['depth', {
      description: 'Get order book / DOM data',
      handler: () => core.getDepth(),
    }],
    ['indicator', {
      description: 'Get indicator info and inputs by entity ID',
      handler: (opts, positionals) => {
        if (!positionals[0]) throw new Error('Entity ID required. Usage: tv data indicator eFu1Ot');
        return core.getIndicator({ entity_id: positionals[0] });
      },
    }],
    ['mtf', {
      description: 'Read indicator values + price summary across multiple timeframes',
      options: {
        timeframes: { type: 'string', short: 't', description: 'Comma-separated timeframes (e.g., "W,D,60,15"). Required.' },
        filter: { type: 'string', short: 'f', description: 'Filter by study name substring' },
        'no-ohlcv': { type: 'boolean', description: 'Skip price summary' },
      },
      handler: (opts) => {
        if (!opts.timeframes) throw new Error('--timeframes required. Example: tv data mtf -t "W,D,60,15"');
        return core.getMultiTimeframe({
          timeframes: opts.timeframes,
          study_filter: opts.filter,
          include_ohlcv: !opts['no-ohlcv'],
        });
      },
    }],
    ['patterns', {
      description: 'Detect classic candlestick patterns over recent OHLC bars',
      options: {
        bars: { type: 'string', short: 'n', description: 'Number of recent bars to scan (default 100, max 500)' },
        'min-strength': { type: 'string', description: 'Filter by minimum pattern strength 0..1' },
        filter: { type: 'string', short: 'f', description: 'Substring filter (e.g., "engulfing,hammer")' },
      },
      handler: (opts) => core.detectCandlestickPatterns({
        last_n_bars: opts.bars ? Number(opts.bars) : undefined,
        min_strength: opts['min-strength'] ? Number(opts['min-strength']) : undefined,
        pattern_filter: opts.filter,
      }),
    }],
  ]),
});
