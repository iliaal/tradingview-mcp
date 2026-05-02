/**
 * Core data access logic.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, KNOWN_PATHS, safeString } from '../connection.js';
import { setTimeframe as _setTimeframe } from './chart.js';
import { detectPatternsInBars, KNOWN_PATTERNS } from './patterns.js';

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    evaluateAsync: deps?.evaluateAsync || _evaluateAsync,
  };
}

const MAX_OHLCV_BARS = 500;
const MAX_TRADES = 20;
const CHART_API = KNOWN_PATHS.chartApi;
const BARS_PATH = KNOWN_PATHS.mainSeriesBars;

// Page-side cap on the number of items returned per study. Labels can have
// thousands of entries on long Pine scripts; serializing them all over CDP
// just to drop them server-side wastes time and memory. We keep the LAST N
// (matching formatPineLabels' slice(-limit) intent) and report the full
// `count` separately so callers know how much was truncated.
const DEFAULT_GRAPHICS_ITEM_CAP = 5000;

function buildGraphicsJS(collectionName, mapKey, filter, maxItems) {
  const cap = Math.max(1, Number(maxItems) || DEFAULT_GRAPHICS_ITEM_CAP);
  return `
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var sources = model.model().dataSources();
      var mainBars = null;
      try { mainBars = chart.model().mainSeries().bars(); } catch(e) {}
      function barValueAt(barIdx) {
        if (typeof barIdx !== 'number') return null;
        if (!mainBars || typeof mainBars.valueAt !== 'function') return null;
        try { return mainBars.valueAt(barIdx) || null; } catch(e) { return null; }
      }
      function barTimeAt(barIdx) { var v = barValueAt(barIdx); return v ? v[0] : null; }
      function barOhlcvAt(barIdx) {
        var v = barValueAt(barIdx);
        if (!v) return null;
        return { time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0 };
      }
      // Drawing primitives store v.x as a sequence number into the study's
      // _indexes array, NOT a chart bar index. Resolve via _indexes[seq] before
      // calling barValueAt — same lookup TV's internal _materializePrimitive does.
      // Filter sentinel values (INVALID_TIME_POINT_INDEX is a large negative).
      function realBarIdx(seq, indexes) {
        if (typeof seq !== 'number' || !indexes) return null;
        if (seq < 0 || seq >= indexes.length) return null;
        var idx = indexes[seq];
        return (typeof idx === 'number' && idx > -1e9) ? idx : null;
      }
      var results = [];
      var filter = ${safeString(filter || '')};
      var maxItems = ${cap};
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          if (filter && name.indexOf(filter) === -1) continue;
          var g = s._graphics;
          if (!g || !g._primitivesCollection) continue;
          var pc = g._primitivesCollection;
          var indexes = Array.isArray(g._indexes) ? g._indexes : null;
          var items = [];
          var totalCount = 0;
          function decorate(v, id) {
            var bIdx = realBarIdx(v.x, indexes);
            return {
              id: id,
              raw: v,
              bar_time: barTimeAt(bIdx),
              bar_time1: barTimeAt(realBarIdx(v.x1, indexes)),
              bar_time2: barTimeAt(realBarIdx(v.x2, indexes)),
              bar_ohlcv: barOhlcvAt(bIdx),
            };
          }
          try {
            var outer = pc.${collectionName};
            if (outer) {
              var inner = outer.get('${mapKey}');
              if (inner) {
                var coll = inner.get(false);
                if (coll && coll._primitivesDataById && coll._primitivesDataById.size > 0) {
                  totalCount = coll._primitivesDataById.size;
                  coll._primitivesDataById.forEach(function(v, id) { items.push(decorate(v, id)); });
                }
              }
            }
          } catch(e) {}
          if (items.length === 0 && '${collectionName}' === 'dwgtablecells') {
            try {
              var tcOuter = pc.dwgtablecells;
              if (tcOuter) {
                var tcColl = tcOuter.get('tableCells');
                if (tcColl && tcColl._primitivesDataById && tcColl._primitivesDataById.size > 0) {
                  totalCount = tcColl._primitivesDataById.size;
                  tcColl._primitivesDataById.forEach(function(v, id) { items.push(decorate(v, id)); });
                }
              }
            } catch(e) {}
          }
          if (items.length > maxItems) items = items.slice(-maxItems);
          if (totalCount > 0) results.push({name: name, count: totalCount, items: items, truncated: totalCount > items.length});
        } catch(e) {}
      }
      return results;
    })()
  `;
}

function _toEpochSeconds(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  const d = new Date(val);
  const t = d.getTime();
  if (isNaN(t)) return null;
  return Math.floor(t / 1000);
}

export async function getOhlcv({ count, summary, _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const limit = Math.min(count || 100, MAX_OHLCV_BARS);
  let data;
  try {
    data = await evaluate(`
      (function() {
        var bars = ${BARS_PATH};
        if (!bars || typeof bars.lastIndex !== 'function') return null;
        var result = [];
        var end = bars.lastIndex();
        var start = Math.max(bars.firstIndex(), end - ${limit} + 1);
        for (var i = start; i <= end; i++) {
          var v = bars.valueAt(i);
          if (v) result.push({time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0});
        }
        return {bars: result, total_bars: bars.size(), source: 'direct_bars'};
      })()
    `);
  } catch { data = null; }

  if (!data || !data.bars || data.bars.length === 0) {
    throw new Error('Could not extract OHLCV data. The chart may still be loading.');
  }

  if (summary) {
    const bars = data.bars;
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const volumes = bars.map(b => b.volume);
    const first = bars[0];
    const last = bars[bars.length - 1];
    return {
      success: true, bar_count: bars.length,
      period: { from: first.time, to: last.time },
      open: first.open, close: last.close,
      high: Math.max(...highs), low: Math.min(...lows),
      range: Math.round((Math.max(...highs) - Math.min(...lows)) * 100) / 100,
      change: Math.round((last.close - first.open) * 100) / 100,
      change_pct: Math.round(((last.close - first.open) / first.open) * 10000) / 100 + '%',
      avg_volume: Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length),
      last_5_bars: bars.slice(-5),
    };
  }

  return { success: true, bar_count: data.bars.length, total_available: data.total_bars, source: data.source, bars: data.bars };
}

export async function getIndicator({ entity_id, _deps }) {
  const { evaluate } = _resolve(_deps);
  const data = await evaluate(`
    (function() {
      var api = ${CHART_API};
      var study = api.getStudyById(${safeString(entity_id)});
      if (!study) return { error: 'Study not found: ' + ${safeString(entity_id)} };
      var result = { name: null, inputs: null, visible: null };
      try { result.visible = study.isVisible(); } catch(e) {}
      try { result.inputs = study.getInputValues(); } catch(e) { result.inputs_error = e.message; }
      return result;
    })()
  `);

  if (data?.error) throw new Error(data.error);

  let inputs = data?.inputs;
  if (Array.isArray(inputs)) {
    inputs = inputs.filter(inp => {
      if (inp.id === 'text' && typeof inp.value === 'string' && inp.value.length > 200) return false;
      if (typeof inp.value === 'string' && inp.value.length > 500) return false;
      return true;
    });
  }
  return { success: true, entity_id, visible: data?.visible, inputs };
}

// TV Desktop 3.1.0 exposes overlay strategies with metaInfo().is_price_study: true,
// so the legacy filter (is_price_study === false) misses them. The authoritative
// marker is metaInfo().id starting with 'StrategyScript'. Fall back to the legacy
// filter for older TV builds.
const FIND_STRATEGY_SRC = `
  function __findStrategy(sources) {
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      try {
        var id = s.metaInfo && (s.metaInfo() || {}).id;
        if (id && /^StrategyScript/.test(String(id))) return s;
      } catch(e) {}
    }
    for (var j = 0; j < sources.length; j++) {
      var t = sources[j];
      try {
        if (t.metaInfo && t.metaInfo().is_price_study === false &&
            (t.ordersData || t.reportData || t._reportData)) return t;
      } catch(e) {}
    }
    return null;
  }
`;

export async function getStrategyResults({ _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const results = await evaluate(`
    (function() {
      try {
        ${FIND_STRATEGY_SRC}
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        var strat = __findStrategy(sources);
        if (!strat) return {metrics: {}, source: 'internal_api', error: 'No strategy found on chart. Add a strategy indicator first.'};
        var metrics = {};
        // TV 3.1.0+: _reportData.performance is where metrics actually live.
        if (strat._reportData && strat._reportData.performance) {
          var perf1 = strat._reportData.performance;
          for (var k1 in perf1) {
            var v1 = perf1[k1];
            if (v1 === null || v1 === undefined) continue;
            if (typeof v1 === 'object') {
              for (var k2 in v1) {
                var v2 = v1[k2];
                if (v2 !== null && v2 !== undefined && typeof v2 !== 'object' && typeof v2 !== 'function') {
                  metrics[k1 + '.' + k2] = v2;
                }
              }
            } else if (typeof v1 !== 'function') {
              metrics[k1] = v1;
            }
          }
        }
        if (Object.keys(metrics).length === 0 && strat.reportData) {
          var rd = typeof strat.reportData === 'function' ? strat.reportData() : strat.reportData;
          if (rd && typeof rd === 'object') {
            if (typeof rd.value === 'function') rd = rd.value();
            if (rd) { var keys = Object.keys(rd); for (var k = 0; k < keys.length; k++) { var val = rd[keys[k]]; if (val !== null && val !== undefined && typeof val !== 'function') metrics[keys[k]] = val; } }
          }
        }
        if (Object.keys(metrics).length === 0 && strat.performance) {
          var perf = strat.performance();
          if (perf && typeof perf.value === 'function') perf = perf.value();
          if (perf && typeof perf === 'object') { var pkeys = Object.keys(perf); for (var p = 0; p < pkeys.length; p++) { var pval = perf[pkeys[p]]; if (pval !== null && pval !== undefined && typeof pval !== 'function') metrics[pkeys[p]] = pval; } }
        }
        return {metrics: metrics, source: 'internal_api'};
      } catch(e) { return {metrics: {}, source: 'internal_api', error: e.message}; }
    })()
  `);
  return { success: true, metric_count: Object.keys(results?.metrics || {}).length, source: results?.source, metrics: results?.metrics || {}, error: results?.error };
}

export async function getTrades({ max_trades, _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const limit = Math.min(max_trades || 20, MAX_TRADES);
  const trades = await evaluate(`
    (function() {
      try {
        ${FIND_STRATEGY_SRC}
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        var strat = __findStrategy(sources);
        if (!strat) return {trades: [], source: 'internal_api', error: 'No strategy found on chart.'};

        // TV 3.1.0+: _reportData.trades is the canonical closed-trade-pair list.
        // Each entry: {e: entry, x: exit, q, tp, cp, rn, dd} with nested {v, p}.
        if (strat._reportData && Array.isArray(strat._reportData.trades)) {
          var rtrades = strat._reportData.trades;
          var flat = [];
          var cap = Math.min(rtrades.length, ${limit});
          for (var t = 0; t < cap; t++) {
            var tr = rtrades[t];
            if (!tr) continue;
            var e = tr.e || {}, x = tr.x || {};
            flat.push({
              entry_order_id: e.c || null,
              entry_price: e.p,
              entry_time_ms: e.tm,
              entry_type: e.tp,
              exit_order_id: x.c || null,
              exit_price: x.p,
              exit_time_ms: x.tm,
              exit_type: x.tp,
              quantity: tr.q,
              pnl: tr.tp ? tr.tp.v : null,
              pnl_pct: tr.tp ? tr.tp.p : null,
              cum_pnl: tr.cp ? tr.cp.v : null,
              cum_pnl_pct: tr.cp ? tr.cp.p : null,
              runup: tr.rn ? tr.rn.v : null,
              runup_pct: tr.rn ? tr.rn.p : null,
              drawdown: tr.dd ? tr.dd.v : null,
              drawdown_pct: tr.dd ? tr.dd.p : null
            });
          }
          return {trades: flat, source: 'internal_api', total_trade_count: rtrades.length};
        }

        var orders = null;
        if (strat.ordersData) { orders = typeof strat.ordersData === 'function' ? strat.ordersData() : strat.ordersData; if (orders && typeof orders.value === 'function') orders = orders.value(); }
        if (!orders || !Array.isArray(orders)) {
          if (strat._orders) orders = strat._orders;
          else if (strat.tradesData) { orders = typeof strat.tradesData === 'function' ? strat.tradesData() : strat.tradesData; if (orders && typeof orders.value === 'function') orders = orders.value(); }
        }
        if (!orders || !Array.isArray(orders)) return {trades: [], source: 'internal_api', error: 'no trade data (_reportData.trades or ordersData).'};
        var result = [];
        for (var t2 = 0; t2 < Math.min(orders.length, ${limit}); t2++) {
          var o = orders[t2];
          if (typeof o === 'object' && o !== null) {
            var trade = {};
            var okeys = Object.keys(o);
            for (var k = 0; k < okeys.length; k++) { var v = o[okeys[k]]; if (v !== null && v !== undefined && typeof v !== 'function' && typeof v !== 'object') trade[okeys[k]] = v; }
            result.push(trade);
          }
        }
        return {trades: result, source: 'internal_api'};
      } catch(e) { return {trades: [], source: 'internal_api', error: e.message}; }
    })()
  `);
  return { success: true, trade_count: trades?.trades?.length || 0, total_trade_count: trades?.total_trade_count, source: trades?.source, trades: trades?.trades || [], error: trades?.error };
}

export async function getEquity({ _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const equity = await evaluate(`
    (function() {
      try {
        ${FIND_STRATEGY_SRC}
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        var strat = __findStrategy(sources);
        if (!strat) return {data: [], source: 'internal_api', error: 'No strategy found on chart.'};
        var data = [];
        // TV 3.1.0+: _reportData.buyHold holds per-bar equity points
        if (strat._reportData && Array.isArray(strat._reportData.buyHold)) {
          var bh = strat._reportData.buyHold;
          for (var bi = 0; bi < bh.length; bi++) {
            var bv = bh[bi];
            if (typeof bv === 'number') data.push({index: bi, value: bv});
            else if (bv && typeof bv === 'object') data.push(Object.assign({index: bi}, bv));
          }
          if (data.length) return {data: data, source: 'internal_api'};
        }
        if (strat.equityData) {
          var eq = typeof strat.equityData === 'function' ? strat.equityData() : strat.equityData;
          if (eq && typeof eq.value === 'function') eq = eq.value();
          if (Array.isArray(eq)) data = eq;
        }
        if (data.length === 0 && strat.bars) {
          var bars = typeof strat.bars === 'function' ? strat.bars() : strat.bars;
          if (bars && typeof bars.lastIndex === 'function') {
            var end = bars.lastIndex(); var start = bars.firstIndex();
            for (var i = start; i <= end; i++) { var v = bars.valueAt(i); if (v) data.push({time: v[0], equity: v[1], drawdown: v[2] || null}); }
          }
        }
        if (data.length === 0) {
          var perfData = {};
          if (strat.performance) {
            var perf = strat.performance();
            if (perf && typeof perf.value === 'function') perf = perf.value();
            if (perf && typeof perf === 'object') { var pkeys = Object.keys(perf); for (var p = 0; p < pkeys.length; p++) { if (/equity|drawdown|profit|net/i.test(pkeys[p])) perfData[pkeys[p]] = perf[pkeys[p]]; } }
          }
          if (Object.keys(perfData).length > 0) return {data: [], equity_summary: perfData, source: 'internal_api', note: 'Full equity curve not available via API; equity summary metrics returned instead.'};
        }
        return {data: data, source: 'internal_api'};
      } catch(e) { return {data: [], source: 'internal_api', error: e.message}; }
    })()
  `);
  return { success: true, data_points: equity?.data?.length || 0, source: equity?.source, data: equity?.data || [], equity_summary: equity?.equity_summary, note: equity?.note, error: equity?.error };
}

export async function getQuote({ symbol, _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const data = await evaluate(`
    (function() {
      var api = ${CHART_API};
      var sym = ${safeString(symbol || '')};
      if (!sym) { try { sym = api.symbol(); } catch(e) {} }
      if (!sym) { try { sym = api.symbolExt().symbol; } catch(e) {} }
      var ext = {};
      try { ext = api.symbolExt() || {}; } catch(e) {}
      var bars = ${BARS_PATH};
      var quote = { symbol: sym };
      if (bars && typeof bars.lastIndex === 'function') {
        var last = bars.valueAt(bars.lastIndex());
        if (last) { quote.time = last[0]; quote.open = last[1]; quote.high = last[2]; quote.low = last[3]; quote.close = last[4]; quote.last = last[4]; quote.volume = last[5] || 0; }
      }
      try {
        var bidEl = document.querySelector('[class*="bid"] [class*="price"], [class*="dom-"] [class*="bid"]');
        var askEl = document.querySelector('[class*="ask"] [class*="price"], [class*="dom-"] [class*="ask"]');
        if (bidEl) quote.bid = parseFloat(bidEl.textContent.replace(/[^0-9.\\-]/g, ''));
        if (askEl) quote.ask = parseFloat(askEl.textContent.replace(/[^0-9.\\-]/g, ''));
      } catch(e) {}
      try {
        var hdr = document.querySelector('[class*="headerRow"] [class*="last-"]');
        if (hdr) { var hdrPrice = parseFloat(hdr.textContent.replace(/[^0-9.\\-]/g, '')); if (!isNaN(hdrPrice)) quote.header_price = hdrPrice; }
      } catch(e) {}
      if (ext.description) quote.description = ext.description;
      if (ext.exchange) quote.exchange = ext.exchange;
      if (ext.type) quote.type = ext.type;
      return quote;
    })()
  `);
  if (!data || (!data.last && !data.close)) throw new Error('Could not retrieve quote. The chart may still be loading.');
  return { success: true, ...data };
}

export async function getDepth({ _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const data = await evaluate(`
    (function() {
      var domPanel = document.querySelector('[class*="depth"]')
        || document.querySelector('[class*="orderBook"]')
        || document.querySelector('[class*="dom-"]')
        || document.querySelector('[class*="DOM"]')
        || document.querySelector('[data-name="dom"]');
      if (!domPanel) return { found: false, error: 'DOM / Depth of Market panel not found.' };
      var bids = [], asks = [];
      var rows = domPanel.querySelectorAll('[class*="row"], tr');
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var priceEl = row.querySelector('[class*="price"]');
        var sizeEl = row.querySelector('[class*="size"], [class*="volume"], [class*="qty"]');
        if (!priceEl) continue;
        var price = parseFloat(priceEl.textContent.replace(/[^0-9.\\-]/g, ''));
        var size = sizeEl ? parseFloat(sizeEl.textContent.replace(/[^0-9.\\-]/g, '')) : 0;
        if (isNaN(price)) continue;
        var rowClass = row.className || '';
        var rowHTML = row.innerHTML || '';
        if (/bid|buy/i.test(rowClass) || /bid|buy/i.test(rowHTML)) bids.push({ price, size });
        else if (/ask|sell/i.test(rowClass) || /ask|sell/i.test(rowHTML)) asks.push({ price, size });
        else if (i < rows.length / 2) asks.push({ price, size });
        else bids.push({ price, size });
      }
      if (bids.length === 0 && asks.length === 0) {
        var cells = domPanel.querySelectorAll('[class*="cell"], td');
        var prices = [];
        cells.forEach(function(c) { var val = parseFloat(c.textContent.replace(/[^0-9.\\-]/g, '')); if (!isNaN(val) && val > 0) prices.push(val); });
        if (prices.length > 0) return { found: true, raw_values: prices.slice(0, 50), bids: [], asks: [], note: 'Could not classify bid/ask levels.' };
      }
      bids.sort(function(a, b) { return b.price - a.price; });
      asks.sort(function(a, b) { return a.price - b.price; });
      var spread = null;
      if (asks.length > 0 && bids.length > 0) spread = +(asks[0].price - bids[0].price).toFixed(6);
      return { found: true, bids: bids, asks: asks, spread: spread };
    })()
  `);

  if (!data || !data.found) throw new Error(data?.error || 'DOM panel not found.');
  return { success: true, bid_levels: data.bids?.length || 0, ask_levels: data.asks?.length || 0, spread: data.spread, bids: data.bids || [], asks: data.asks || [], raw_values: data.raw_values, note: data.note };
}

export async function getStudyValues({ study_filter, _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const filter = study_filter || '';
  const data = await evaluate(`
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var sources = model.model().dataSources();
      var results = [];
      var filter = ${safeString(filter)};
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          if (filter && name.indexOf(filter) === -1) continue;
          var values = {};
          try {
            var dwv = s.dataWindowView();
            if (dwv) {
              var items = dwv.items();
              if (items) {
                for (var i = 0; i < items.length; i++) {
                  var item = items[i];
                  if (item._value && item._value !== '∅' && item._title) values[item._title] = item._value;
                }
              }
            }
          } catch(e) {}
          if (Object.keys(values).length > 0) results.push({ name: name, values: values });
        } catch(e) {}
      }
      return results;
    })()
  `);
  return { success: true, study_count: data?.length || 0, studies: data || [] };
}

export async function getPineLines({ study_filter, verbose, _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwglines', 'lines', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => {
    const hLevels = [];
    const seen = {};
    const allLines = [];
    for (const item of s.items) {
      const v = item.raw;
      const y1 = v.y1 != null ? Math.round(v.y1 * 100) / 100 : null;
      const y2 = v.y2 != null ? Math.round(v.y2 * 100) / 100 : null;
      if (verbose) allLines.push({ id: item.id, y1, y2, x1: v.x1, x2: v.x2, horizontal: v.y1 === v.y2, style: v.st, width: v.w, color: v.ci });
      if (y1 != null && v.y1 === v.y2 && !seen[y1]) { hLevels.push(y1); seen[y1] = true; }
    }
    hLevels.sort((a, b) => b - a);
    const result = { name: s.name, total_lines: s.count, horizontal_levels: hLevels };
    if (verbose) result.all_lines = allLines;
    return result;
  });
  return { success: true, study_count: studies.length, studies };
}

export async function getPineLabels({ study_filter, max_labels, verbose, since, until, _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const filter = study_filter || '';
  const limit = max_labels || 50;
  const raw = await evaluate(buildGraphicsJS('dwglabels', 'labels', filter, limit));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = formatPineLabels(raw, limit, verbose, since, until);
  return { success: true, study_count: studies.length, studies };
}

export async function getPineTables({ study_filter, _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwgtablecells', 'tableCells', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => {
    const tables = {};
    for (const item of s.items) {
      const v = item.raw;
      const tid = v.tid || 0;
      if (!tables[tid]) tables[tid] = {};
      if (!tables[tid][v.row]) tables[tid][v.row] = {};
      tables[tid][v.row][v.col] = v.t || '';
    }
    const tableList = Object.entries(tables).map(([_tid, rows]) => {
      const rowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);
      const formatted = rowNums.map(rn => {
        const cols = rows[rn];
        const colNums = Object.keys(cols).map(Number).sort((a, b) => a - b);
        return colNums.map(cn => cols[cn]).filter(Boolean).join(' | ');
      }).filter(Boolean);
      return { rows: formatted };
    });
    return { name: s.name, tables: tableList };
  });
  return { success: true, study_count: studies.length, studies };
}

/**
 * Read plotshape/plotchar markers from Pine Script indicators.
 * These are stored in the study's bar data series (not _primitivesCollection),
 * so buildGraphicsJS can't reach them. We scan each study's metaInfo for
 * "shapes" type plots, then read the bar data to find which bars have active markers.
 */
export async function getPineShapes({ study_filter, last_n_bars, _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const filter = study_filter || '';
  const maxBars = Math.min(last_n_bars || 100, 500);
  const raw = await evaluate(`
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var sources = model.model().dataSources();
      var mainSeries = model.mainSeries();
      var mainBars = mainSeries.bars();
      var filter = ${safeString(filter)};
      var maxBars = ${maxBars};
      var results = [];

      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          if (filter && name.indexOf(filter) === -1) continue;
          if (!meta.plots) continue;

          var shapePlots = [];
          for (var pi = 0; pi < meta.plots.length; pi++) {
            var plot = meta.plots[pi];
            if (plot.type !== 'shapes') continue;
            var style = meta.styles && meta.styles[plot.id] ? meta.styles[plot.id] : {};
            var defaults = meta.defaults && meta.defaults.styles && meta.defaults.styles[plot.id]
              ? meta.defaults.styles[plot.id] : {};
            shapePlots.push({
              plotIndex: pi,
              dataIndex: pi + 1,
              id: plot.id,
              title: style.title || plot.id,
              shape: defaults.plottype || 'unknown',
              location: defaults.location || 'AboveBar',
              color: defaults.color || null,
              size: style.size || 'auto'
            });
          }
          if (shapePlots.length === 0) continue;

          var data = s._data;
          if (!data) continue;
          var lastIdx = data.lastIndex();
          var firstIdx = Math.max(data.firstIndex(), lastIdx - maxBars + 1);

          var signals = [];
          for (var b = lastIdx; b >= firstIdx; b--) {
            var row = data.valueAt(b);
            if (!row) continue;
            for (var sp = 0; sp < shapePlots.length; sp++) {
              var di = shapePlots[sp].dataIndex;
              var val = row[di];
              if (val && val !== 0 && !isNaN(val)) {
                var mainRow = mainBars.valueAt(b);
                var ohlc = null;
                if (mainRow) {
                  ohlc = {
                    time: new Date(mainRow[0] * 1000).toISOString(),
                    timestamp: mainRow[0],
                    open: mainRow[1],
                    high: mainRow[2],
                    low: mainRow[3],
                    close: mainRow[4]
                  };
                }
                signals.push({
                  plot: shapePlots[sp].title,
                  shape: shapePlots[sp].shape,
                  location: shapePlots[sp].location,
                  color: shapePlots[sp].color,
                  barIndex: b,
                  value: val,
                  ohlc: ohlc
                });
              }
            }
          }

          if (shapePlots.length > 0) {
            results.push({
              name: name,
              shapePlots: shapePlots,
              signals: signals,
              signalCount: signals.length,
              barsScanned: lastIdx - firstIdx + 1
            });
          }
        } catch(e) {}
      }
      return results;
    })()
  `);

  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => ({
    name: s.name,
    shape_plots: s.shapePlots,
    signal_count: s.signalCount,
    bars_scanned: s.barsScanned,
    signals: s.signals,
  }));

  return { success: true, study_count: studies.length, studies };
}

export async function getPineBoxes({ study_filter, verbose, _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwgboxes', 'boxes', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => {
    const zones = [];
    const seen = {};
    const allBoxes = [];
    for (const item of s.items) {
      const v = item.raw;
      const high = v.y1 != null && v.y2 != null ? Math.round(Math.max(v.y1, v.y2) * 100) / 100 : null;
      const low = v.y1 != null && v.y2 != null ? Math.round(Math.min(v.y1, v.y2) * 100) / 100 : null;
      if (verbose) allBoxes.push({ id: item.id, high, low, x1: v.x1, x2: v.x2, borderColor: v.c, bgColor: v.bc });
      if (high != null && low != null) { const key = high + ':' + low; if (!seen[key]) { zones.push({ high, low }); seen[key] = true; } }
    }
    zones.sort((a, b) => b.high - a.high);
    const result = { name: s.name, total_boxes: s.count, zones };
    if (verbose) result.all_boxes = allBoxes;
    return result;
  });
  return { success: true, study_count: studies.length, studies };
}

// ── batchReadPanes (B.18 — port of ttnsx888 668cc55d) ──────────────
//
// Read multiple pane data types in ONE CDP call across multiple panes.
// Replaces the pane_focus → data_* loop for multi-symbol grid workflows.
// Iterates pane indices via _chartWidgetCollection.getAll(), bypassing the
// _activeChartWidgetWV singleton — non-active panes still have populated
// pine graphics, study values, and line-tool drawings.

function formatPineLines(raw, verbose) {
  return (raw || []).map(s => {
    const hLevels = [];
    const seen = {};
    const allLines = [];
    for (const item of s.items) {
      const v = item.raw;
      const y1 = v.y1 != null ? Math.round(v.y1 * 100) / 100 : null;
      const y2 = v.y2 != null ? Math.round(v.y2 * 100) / 100 : null;
      if (verbose) allLines.push({ id: item.id, y1, y2, x1: v.x1, x2: v.x2, horizontal: v.y1 === v.y2, style: v.st, width: v.w, color: v.ci });
      if (y1 != null && v.y1 === v.y2 && !seen[y1]) { hLevels.push(y1); seen[y1] = true; }
    }
    hLevels.sort((a, b) => b - a);
    const result = { name: s.name, total_lines: s.count, horizontal_levels: hLevels };
    if (verbose) result.all_lines = allLines;
    return result;
  });
}

function formatPineLabels(raw, max_labels, verbose, since, until) {
  const limit = max_labels || 50;
  const sinceSec = _toEpochSeconds(since);
  const untilSec = _toEpochSeconds(until);
  const round4 = (n) => (typeof n === 'number' && isFinite(n) ? Math.round(n * 10000) / 10000 : null);
  return (raw || []).map(s => {
    let labels = s.items.map(item => {
      const v = item.raw;
      const text = v.t || '';
      const price = v.y != null ? Math.round(v.y * 100) / 100 : null;
      const bar_time = item.bar_time != null ? item.bar_time : null;
      const ohlcv = item.bar_ohlcv || null;
      // signal_price = the bar's close at the time the label was drawn — i.e.
      // the actual market price when the signal fired. Independent of where
      // the indicator chose to *draw* the label (often offset above/below
      // the candle for legibility), so agents can correlate labels to the
      // real bar event without misreading the visual offset as the price.
      const signal_price = ohlcv ? round4(ohlcv.close) : null;
      const bar = ohlcv ? {
        open: round4(ohlcv.open),
        high: round4(ohlcv.high),
        low: round4(ohlcv.low),
        close: round4(ohlcv.close),
        volume: ohlcv.volume,
      } : null;
      if (verbose) return { id: item.id, text, price, signal_price, bar, bar_time, bar_index: v.x, yloc: v.yl, size: v.sz, textColor: v.tci, color: v.ci };
      return { text, price, signal_price, bar, bar_time };
    }).filter(l => l.text || l.price != null);
    if (sinceSec != null) labels = labels.filter(l => l.bar_time != null && l.bar_time >= sinceSec);
    if (untilSec != null) labels = labels.filter(l => l.bar_time != null && l.bar_time <= untilSec);
    if (labels.length > limit) labels = labels.slice(-limit);
    return { name: s.name, total_labels: s.count, showing: labels.length, labels };
  });
}

function formatPineTables(raw) {
  return (raw || []).map(s => {
    const tables = {};
    for (const item of s.items) {
      const v = item.raw;
      const tid = v.tid || 0;
      if (!tables[tid]) tables[tid] = {};
      if (!tables[tid][v.row]) tables[tid][v.row] = {};
      tables[tid][v.row][v.col] = v.t || '';
    }
    const tableList = Object.entries(tables).map(([_tid, rows]) => {
      const rowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);
      const formatted = rowNums.map(rn => {
        const cols = rows[rn];
        const colNums = Object.keys(cols).map(Number).sort((a, b) => a - b);
        return colNums.map(cn => cols[cn]).filter(Boolean).join(' | ');
      }).filter(Boolean);
      return { rows: formatted };
    });
    return { name: s.name, tables: tableList };
  });
}

function formatPineBoxes(raw, verbose) {
  return (raw || []).map(s => {
    const zones = [];
    const seen = {};
    const allBoxes = [];
    for (const item of s.items) {
      const v = item.raw;
      const high = v.y1 != null && v.y2 != null ? Math.round(Math.max(v.y1, v.y2) * 100) / 100 : null;
      const low = v.y1 != null && v.y2 != null ? Math.round(Math.min(v.y1, v.y2) * 100) / 100 : null;
      if (verbose) allBoxes.push({ id: item.id, high, low, x1: v.x1, x2: v.x2, borderColor: v.c, bgColor: v.bc });
      if (high != null && low != null) { const key = high + ':' + low; if (!seen[key]) { zones.push({ high, low }); seen[key] = true; } }
    }
    zones.sort((a, b) => b.high - a.high);
    const result = { name: s.name, total_boxes: s.count, zones };
    if (verbose) result.all_boxes = allBoxes;
    return result;
  });
}

export async function batchReadPanes({ indices, reads, wait_ms, _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  if (!reads || typeof reads !== 'object') throw new Error('batchReadPanes: `reads` is required');

  const idxArg = Array.isArray(indices) && indices.length > 0
    ? JSON.stringify(indices.map(Number))
    : 'null';
  const waitMs = Number(wait_ms) > 0 ? Math.min(Number(wait_ms), 5000) : 0;
  if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));

  const wantTables      = !!reads.pine_tables;
  const wantLines       = !!reads.pine_lines;
  const wantLabels      = !!reads.pine_labels;
  const wantBoxes       = !!reads.pine_boxes;
  const wantStudyValues = !!reads.study_values;
  const wantOhlcv       = !!reads.ohlcv_summary;
  const wantDrawings    = !!reads.drawings;

  const tablesFilter = reads.pine_tables?.study_filter || '';
  const linesFilter  = reads.pine_lines?.study_filter  || '';
  const labelsFilter = reads.pine_labels?.study_filter || '';
  const boxesFilter  = reads.pine_boxes?.study_filter  || '';
  const ohlcvBars    = Math.min(Math.max(Number(reads.ohlcv_summary?.bars) || 20, 2), 500);

  const expression = `
    (function() {
      var cwc = window.TradingViewApi._chartWidgetCollection;
      var all = cwc.getAll();
      var layoutType = cwc._layoutType;
      if (typeof layoutType === 'object' && layoutType && typeof layoutType.value === 'function') layoutType = layoutType.value();
      var inlineCount = cwc.inlineChartsCount;
      if (typeof inlineCount === 'object' && inlineCount && typeof inlineCount.value === 'function') inlineCount = inlineCount.value();
      var paneCount = Math.min(all.length, inlineCount || all.length);

      var requestedIndices = ${idxArg};
      var idxList = [];
      if (requestedIndices) {
        for (var i = 0; i < requestedIndices.length; i++) {
          var ri = requestedIndices[i];
          if (ri >= 0 && ri < paneCount) idxList.push(ri);
        }
      } else {
        for (var j = 0; j < paneCount; j++) idxList.push(j);
      }

      function readGraphics(chart, collectionName, mapKey, filter) {
        try {
          var sources = chart.model().model().dataSources();
          var results = [];
          for (var si = 0; si < sources.length; si++) {
            var s = sources[si];
            if (!s.metaInfo) continue;
            try {
              var meta = s.metaInfo();
              var name = meta.description || meta.shortDescription || '';
              if (!name) continue;
              if (filter && name.indexOf(filter) === -1) continue;
              var g = s._graphics;
              if (!g || !g._primitivesCollection) continue;
              var outer = g._primitivesCollection[collectionName];
              if (!outer || typeof outer.get !== 'function') continue;
              var inner = outer.get(mapKey);
              if (!inner || typeof inner.get !== 'function') continue;
              var coll = inner.get(false);
              if (!coll || !coll._primitivesDataById) continue;
              var map = coll._primitivesDataById;
              if (typeof map.forEach !== 'function') continue;
              var items = [];
              map.forEach(function(v, id) { items.push({id: id, raw: v}); });
              if (items.length > 0) results.push({name: name, count: items.length, items: items});
            } catch(e) {}
          }
          return results;
        } catch(e) { return []; }
      }

      function readStudyValues(chart) {
        try {
          var sources = chart.model().model().dataSources();
          var results = [];
          for (var si = 0; si < sources.length; si++) {
            var s = sources[si];
            if (!s.metaInfo) continue;
            try {
              var meta = s.metaInfo();
              var name = meta.description || meta.shortDescription || '';
              if (!name) continue;
              var values = {};
              try {
                var dwv = s.dataWindowView();
                if (dwv) {
                  var items = dwv.items();
                  if (items) {
                    for (var i = 0; i < items.length; i++) {
                      var it = items[i];
                      if (it._value && it._value !== '∅' && it._title) values[it._title] = it._value;
                    }
                  }
                }
              } catch(e) {}
              if (Object.keys(values).length > 0) results.push({ name: name, values: values });
            } catch(e) {}
          }
          return results;
        } catch(e) { return []; }
      }

      function readOhlcv(chart, barCount) {
        try {
          var bars = chart.model().mainSeries().bars();
          if (!bars || typeof bars.lastIndex !== 'function') return null;
          var end = bars.lastIndex();
          var start = Math.max(bars.firstIndex(), end - barCount + 1);
          var out = [];
          for (var i = start; i <= end; i++) {
            var v = bars.valueAt(i);
            if (v) out.push({time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0});
          }
          if (out.length === 0) return null;
          var first = out[0];
          var last = out[out.length - 1];
          var high = -Infinity, low = Infinity, volSum = 0;
          for (var k = 0; k < out.length; k++) {
            if (out[k].high > high) high = out[k].high;
            if (out[k].low < low) low = out[k].low;
            volSum += out[k].volume;
          }
          return {
            bar_count: out.length,
            period: { from: first.time, to: last.time },
            open: first.open, close: last.close, high: high, low: low,
            range: Math.round((high - low) * 100) / 100,
            change: Math.round((last.close - first.open) * 100) / 100,
            change_pct: Math.round(((last.close - first.open) / first.open) * 10000) / 100 + '%',
            avg_volume: Math.round(volSum / out.length),
            last_5_bars: out.slice(-5),
            total_bars: bars.size()
          };
        } catch(e) { return { error: e.message }; }
      }

      function safeCall(obj, method) {
        try { if (typeof obj[method] === 'function') return obj[method](); } catch(e) {}
        return undefined;
      }

      function readDrawings(chart) {
        try {
          var sources = chart.model().model().dataSources();
          var out = [];
          for (var si = 0; si < sources.length; si++) {
            var s = sources[si];
            if (typeof s.points !== 'function' || typeof s.properties !== 'function') continue;
            try {
              var id = safeCall(s, 'id');
              if (typeof id !== 'string' && typeof id !== 'number') continue;
              var entry = { entity_id: id };
              var nm = safeCall(s, 'name');
              if (typeof nm === 'string') entry.name = nm;
              else if (typeof s.toolname === 'string') entry.name = s.toolname;
              var canon = null;
              var rawT = safeCall(s, 'toolname');
              if (typeof rawT === 'string' && rawT.length > 0) canon = rawT;
              if (!canon && typeof s.toolname === 'string') canon = s.toolname;
              if (!canon && entry.name) {
                var n = String(entry.name).trim().toLowerCase();
                var nameMap = {
                  'trend line': 'trend_line', 'trendline': 'trend_line',
                  'horizontal line': 'horizontal_line', 'horizontal ray': 'horizontal_ray',
                  'vertical line': 'vertical_line',
                  'fib retracement': 'fib_retracement', 'fibonacci retracement': 'fib_retracement',
                  'fib extension': 'fib_extension', 'fibonacci extension': 'fib_extension',
                  'rectangle': 'rectangle', 'ellipse': 'ellipse',
                  'text': 'text', 'note': 'note', 'callout': 'callout',
                  'arrow': 'arrow', 'price label': 'price_label', 'price range': 'price_range',
                };
                canon = nameMap[n] || n.replace(/\\s+/g, '_');
              }
              if (canon) entry.type = canon;
              var pts = safeCall(s, 'points');
              if (pts) entry.points = pts;
              try {
                var pRaw = s.properties();
                if (pRaw) {
                  var flat = (typeof pRaw.state === 'function') ? pRaw.state() : pRaw;
                  entry.properties = flat;
                }
              } catch(e) { entry.properties_error = e.message; }
              var vis = safeCall(s, 'isVisible');
              if (vis !== undefined) entry.visible = vis;
              var lock = safeCall(s, 'isLocked');
              if (lock !== undefined) entry.locked = lock;
              var sel = safeCall(s, 'isSelectionEnabled');
              if (sel !== undefined) entry.selectable = sel;
              out.push(entry);
            } catch(e) {}
          }
          return out;
        } catch(e) { return []; }
      }

      var panes = [];
      for (var p = 0; p < idxList.length; p++) {
        var idx = idxList[p];
        var chart = all[idx];
        var paneOut = { index: idx };
        try {
          var ms = chart.model().mainSeries();
          paneOut.symbol = ms.symbol();
          paneOut.resolution = ms.interval();
          ${wantTables      ? 'paneOut.pine_tables  = readGraphics(chart, "dwgtablecells", "tableCells", ' + JSON.stringify(tablesFilter) + ');' : ''}
          ${wantLines       ? 'paneOut.pine_lines   = readGraphics(chart, "dwglines",      "lines",      ' + JSON.stringify(linesFilter)  + ');' : ''}
          ${wantLabels      ? 'paneOut.pine_labels  = readGraphics(chart, "dwglabels",     "labels",     ' + JSON.stringify(labelsFilter) + ');' : ''}
          ${wantBoxes       ? 'paneOut.pine_boxes   = readGraphics(chart, "dwgboxes",      "boxes",      ' + JSON.stringify(boxesFilter)  + ');' : ''}
          ${wantStudyValues ? 'paneOut.study_values = readStudyValues(chart);' : ''}
          ${wantOhlcv       ? 'paneOut.ohlcv_summary = readOhlcv(chart, ' + ohlcvBars + ');' : ''}
          ${wantDrawings    ? 'paneOut.drawings = readDrawings(chart);' : ''}
        } catch(e) { paneOut.error = e.message; }
        panes.push(paneOut);
      }

      return { layout: layoutType, pane_count: paneCount, panes: panes };
    })()
  `;

  const rawResult = await evaluate(expression);
  if (!rawResult) throw new Error('batchReadPanes: empty response from CDP');

  const labelsMax = reads.pine_labels?.max_labels;
  const linesVerbose  = !!reads.pine_lines?.verbose;
  const labelsVerbose = !!reads.pine_labels?.verbose;
  const boxesVerbose  = !!reads.pine_boxes?.verbose;

  const panes = rawResult.panes.map(p => {
    const out = { index: p.index, symbol: p.symbol, resolution: p.resolution };
    if (p.error) out.error = p.error;
    if (p.pine_tables)  out.pine_tables  = formatPineTables(p.pine_tables);
    if (p.pine_lines)   out.pine_lines   = formatPineLines(p.pine_lines, linesVerbose);
    if (p.pine_labels)  out.pine_labels  = formatPineLabels(p.pine_labels, labelsMax, labelsVerbose);
    if (p.pine_boxes)   out.pine_boxes   = formatPineBoxes(p.pine_boxes, boxesVerbose);
    if (p.study_values) out.study_values = p.study_values;
    if (p.ohlcv_summary) out.ohlcv_summary = p.ohlcv_summary;
    if (p.drawings)     out.drawings     = p.drawings;
    return out;
  });

  return {
    success: true,
    layout: rawResult.layout,
    pane_count: rawResult.pane_count,
    requested: panes.length,
    panes,
  };
}

const MAX_TIMEFRAMES_PER_CALL = 10;

/**
 * Read indicator values + price summary across multiple timeframes in one call.
 * Saves the original timeframe, loops through the requested set reusing the
 * standard setTimeframe / waitForStudiesReady / getStudyValues / getOhlcv
 * primitives, and restores the original timeframe in finally{}.
 */
export async function getMultiTimeframe({ timeframes, study_filter, include_ohlcv, _deps } = {}) {
  const tfs = Array.isArray(timeframes)
    ? timeframes.map(t => String(t).trim()).filter(Boolean)
    : String(timeframes || '').split(',').map(s => s.trim()).filter(Boolean);
  if (tfs.length === 0) {
    throw new Error('timeframes is required (array or comma-separated string, e.g. ["W","D","60","15"])');
  }
  if (tfs.length > MAX_TIMEFRAMES_PER_CALL) {
    throw new Error(`Maximum ${MAX_TIMEFRAMES_PER_CALL} timeframes per call to keep output bounded`);
  }

  const { evaluate } = _resolve(_deps);
  const includeOhlcv = include_ohlcv !== false;

  let originalTf = null;
  try { originalTf = await evaluate(`${CHART_API}.resolution()`); } catch {}

  const results = {};
  const errors = {};

  try {
    for (const tf of tfs) {
      try {
        await _setTimeframe({ timeframe: tf, _deps });
        const studyValues = await getStudyValues({ study_filter, _deps });
        const entry = {
          timeframe: tf,
          study_count: studyValues.study_count,
          studies: studyValues.studies,
        };
        if (includeOhlcv) {
          try {
            const ohlcv = await getOhlcv({ summary: true, _deps });
            entry.price = {
              open: ohlcv.open,
              close: ohlcv.close,
              high: ohlcv.high,
              low: ohlcv.low,
              range: ohlcv.range,
              change: ohlcv.change,
              change_pct: ohlcv.change_pct,
              avg_volume: ohlcv.avg_volume,
              bar_count: ohlcv.bar_count,
            };
          } catch (err) {
            entry.price_error = err.message;
          }
        }
        results[tf] = entry;
      } catch (err) {
        errors[tf] = err.message;
      }
    }
  } finally {
    if (originalTf && tfs[tfs.length - 1] !== originalTf) {
      try { await _setTimeframe({ timeframe: originalTf, _deps }); } catch {}
    }
  }

  return {
    success: true,
    original_timeframe: originalTf,
    timeframes: tfs,
    include_ohlcv: includeOhlcv,
    results,
    ...(Object.keys(errors).length ? { errors } : {}),
  };
}

const MAX_PATTERN_BARS = 500;

/**
 * Native candlestick pattern detection over the chart's OHLC bars.
 * No CDP-side pattern logic, no chart pollution: pulls bars via getOhlcv
 * and runs deterministic pure detectors from patterns.js.
 */
export async function detectCandlestickPatterns({
  last_n_bars,
  min_strength,
  pattern_filter,
  _deps,
} = {}) {
  const requested = Math.max(3, Math.min(Number(last_n_bars) || 100, MAX_PATTERN_BARS));
  const minStrength = Math.max(0, Math.min(Number(min_strength) || 0, 1));

  const ohlcv = await getOhlcv({ count: requested, summary: false, _deps });
  const bars = ohlcv?.bars || [];
  if (bars.length === 0) {
    return { success: true, bar_count: 0, hits: [], known_patterns: KNOWN_PATTERNS };
  }

  const hits = detectPatternsInBars(bars, {
    minStrength,
    patternFilter: pattern_filter || null,
  });
  hits.sort((a, b) => b.time - a.time);

  return {
    success: true,
    bar_count: bars.length,
    period: { from: bars[0].time, to: bars[bars.length - 1].time },
    min_strength: minStrength,
    hit_count: hits.length,
    hits,
    known_patterns: KNOWN_PATTERNS,
  };
}
