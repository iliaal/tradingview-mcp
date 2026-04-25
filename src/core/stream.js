/**
 * Core streaming logic — real-time JSONL output from TradingView.
 * Uses efficient poll + dedup: only emits when data changes.
 */
import { evaluate as _evaluate } from '../connection.js';

const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';
const MODEL = `${CHART_API}._chartWidget.model()`;

/**
 * Generic poll-and-diff loop.
 * Calls fetcher(), compares to last value, emits JSONL on change.
 * Writes to stdout directly for pipe-friendliness.
 *
 * @param {Function} fetcher - returns the data object (or null) on each tick
 * @param {object} [opts]
 * @param {number} [opts.interval=500] - ms between polls
 * @param {boolean} [opts.dedupe=true] - skip emit when JSON-stringified data matches the previous tick
 * @param {string} [opts.label='stream'] - tag attached to JSONL `_stream` field and stderr lines
 * @param {object} [opts._deps] - test injection (writeStdout, writeStderr, sleep, maxIterations, registerSignal, removeSignal)
 */
async function pollLoop(fetcher, { interval = 500, dedupe = true, label = 'stream', _deps } = {}) {
  const writeStdout = _deps?.writeStdout || ((s) => process.stdout.write(s));
  const writeStderr = _deps?.writeStderr || ((s) => process.stderr.write(s));
  const sleepFn = _deps?.sleep || sleep;
  const maxIterations = _deps?.maxIterations ?? Infinity;
  const registerSignal = _deps?.registerSignal || ((sig, h) => process.on(sig, h));
  const removeSignal = _deps?.removeSignal || ((sig, h) => process.removeListener(sig, h));

  let lastHash = null;
  let running = true;
  let iter = 0;

  const cleanup = () => { running = false; };
  registerSignal('SIGINT', cleanup);
  registerSignal('SIGTERM', cleanup);

  // Emit header with compliance notice
  const start = Date.now();
  writeStderr(`\u26A0  tradingview-mcp  |  Unofficial tool. Not affiliated with TradingView Inc. or Anthropic.\n`);
  writeStderr(`   Streams from your locally running TradingView Desktop instance only.\n`);
  writeStderr(`   Does not connect to TradingView servers. Requires --remote-debugging-port=9222.\n`);
  writeStderr(`   Ensure your usage complies with TradingView's Terms of Use.\n`);
  writeStderr(`[stream:${label}] started, interval=${interval}ms, Ctrl+C to stop\n`);

  while (running && iter < maxIterations) {
    iter++;
    try {
      const data = await fetcher();
      if (!data) { await sleepFn(interval); continue; }

      const hash = dedupe ? JSON.stringify(data) : null;
      if (!dedupe || hash !== lastHash) {
        lastHash = hash;
        const line = JSON.stringify({ ...data, _ts: Date.now(), _stream: label });
        writeStdout(line + '\n');
      }
    } catch (err) {
      // Connection errors — retry silently
      if (/CDP|ECONNREFUSED/i.test(err.message)) {
        await sleepFn(2000);
        continue;
      }
      writeStderr(`[stream:${label}] error: ${err.message}\n`);
    }
    await sleepFn(interval);
  }

  writeStderr(`[stream:${label}] stopped after ${((Date.now() - start) / 1000).toFixed(1)}s\n`);
  removeSignal('SIGINT', cleanup);
  removeSignal('SIGTERM', cleanup);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Stream: quote ──

async function fetchQuote(evalFn) {
  return evalFn(`
    (function() {
      var chart = ${CHART_API};
      var m = ${MODEL};
      var bars = m.mainSeries().bars();
      var last = bars.lastIndex();
      var v = bars.valueAt(last);
      if (!v) return null;
      return {
        symbol: chart.symbol(),
        time: v[0],
        open: v[1],
        high: v[2],
        low: v[3],
        close: v[4],
        volume: v[5] || 0,
      };
    })()
  `);
}

export async function streamQuote({ interval, _deps } = {}) {
  const evalFn = _deps?.evaluate || _evaluate;
  return pollLoop(() => fetchQuote(evalFn), { interval: interval || 300, label: 'quote', _deps });
}

// ── Stream: ohlcv (last N bars, emits on new bar) ──

async function fetchLastBar(evalFn) {
  return evalFn(`
    (function() {
      var chart = ${CHART_API};
      var m = ${MODEL};
      var bars = m.mainSeries().bars();
      var last = bars.lastIndex();
      var v = bars.valueAt(last);
      if (!v) return null;
      return {
        symbol: chart.symbol(),
        resolution: chart.resolution(),
        bar_time: v[0],
        open: v[1],
        high: v[2],
        low: v[3],
        close: v[4],
        volume: v[5] || 0,
        bar_index: last,
      };
    })()
  `);
}

export async function streamBars({ interval, _deps } = {}) {
  const evalFn = _deps?.evaluate || _evaluate;
  return pollLoop(() => fetchLastBar(evalFn), { interval: interval || 500, label: 'bars', _deps });
}

// ── Stream: indicator values ──

async function fetchValues(evalFn) {
  return evalFn(`
    (function() {
      var chart = ${CHART_API};
      var m = ${MODEL};
      var studies = chart.getAllStudies();
      var results = [];
      for (var i = 0; i < studies.length; i++) {
        try {
          var study = chart.getStudyById(studies[i].id);
          if (!study || !study.isVisible()) continue;
          var src = study._study || study;
          var data = src._lastBarValues || src._data;
          if (!data) continue;
          var vals = {};
          if (typeof data === 'object') {
            for (var k in data) {
              if (typeof data[k] === 'number' && !isNaN(data[k])) vals[k] = data[k];
            }
          }
          if (Object.keys(vals).length > 0) results.push({ name: studies[i].name, values: vals });
        } catch(e) {}
      }
      return { symbol: chart.symbol(), study_count: results.length, studies: results };
    })()
  `);
}

export async function streamValues({ interval, _deps } = {}) {
  const evalFn = _deps?.evaluate || _evaluate;
  return pollLoop(() => fetchValues(evalFn), { interval: interval || 500, label: 'values', _deps });
}

// ── Stream: pine lines ──

async function fetchLines(evalFn, studyFilter) {
  const filter = studyFilter ? JSON.stringify(studyFilter) : 'null';
  return evalFn(`
    (function() {
      var filter = ${filter};
      var chart = ${CHART_API};
      var studies = chart.getAllStudies();
      var results = [];
      for (var i = 0; i < studies.length; i++) {
        var s = studies[i];
        if (filter && (s.name || '').toLowerCase().indexOf(filter.toLowerCase()) === -1) continue;
        try {
          var study = chart.getStudyById(s.id);
          if (!study) continue;
          var src = study._study || study;
          var g = src._graphics || (src._source && src._source._graphics);
          if (!g) continue;
          var pc = g._primitivesCollection;
          if (!pc || !pc.dwglines) continue;
          var linesMap = pc.dwglines.get('lines');
          if (!linesMap) continue;
          var data = linesMap.get(false);
          if (!data || !data._primitivesDataById) continue;
          var levels = [];
          var seen = {};
          data._primitivesDataById.forEach(function(line) {
            var p1 = line.points && line.points[0] ? line.points[0].price : null;
            var p2 = line.points && line.points[1] ? line.points[1].price : null;
            var price = (p1 !== null && p1 === p2) ? p1 : (p1 || p2);
            if (price !== null && !seen[price]) { seen[price] = true; levels.push(price); }
          });
          levels.sort(function(a, b) { return b - a; });
          if (levels.length > 0) results.push({ study: s.name, levels: levels });
        } catch(e) {}
      }
      return { symbol: chart.symbol(), study_count: results.length, studies: results };
    })()
  `);
}

export async function streamLines({ interval, filter, _deps } = {}) {
  const evalFn = _deps?.evaluate || _evaluate;
  return pollLoop(() => fetchLines(evalFn, filter), { interval: interval || 1000, label: 'lines', _deps });
}

// ── Stream: pine labels ──

async function fetchLabels(evalFn, studyFilter) {
  const filterStr = studyFilter ? JSON.stringify(studyFilter) : 'null';
  return evalFn(`
    (function() {
      var filter = ${filterStr};
      var chart = ${CHART_API};
      var studies = chart.getAllStudies();
      var results = [];
      for (var i = 0; i < studies.length; i++) {
        var s = studies[i];
        if (filter && (s.name || '').toLowerCase().indexOf(filter.toLowerCase()) === -1) continue;
        try {
          var study = chart.getStudyById(s.id);
          if (!study) continue;
          var src = study._study || study;
          var g = src._graphics || (src._source && src._source._graphics);
          if (!g) continue;
          var pc = g._primitivesCollection;
          if (!pc || !pc.dwglabels) continue;
          var labelsMap = pc.dwglabels.get('labels');
          if (!labelsMap) continue;
          var data = labelsMap.get(false);
          if (!data || !data._primitivesDataById) continue;
          var labels = [];
          data._primitivesDataById.forEach(function(lbl) {
            var text = lbl.text || '';
            var price = lbl.points && lbl.points[0] ? lbl.points[0].price : null;
            if (text) labels.push({ text: text, price: price });
          });
          if (labels.length > 0) results.push({ study: s.name, labels: labels.slice(0, 50) });
        } catch(e) {}
      }
      return { symbol: chart.symbol(), study_count: results.length, studies: results };
    })()
  `);
}

export async function streamLabels({ interval, filter, _deps } = {}) {
  const evalFn = _deps?.evaluate || _evaluate;
  return pollLoop(() => fetchLabels(evalFn, filter), { interval: interval || 1000, label: 'labels', _deps });
}

// ── Stream: pine tables ──

async function fetchTables(evalFn, studyFilter) {
  const filterStr = studyFilter ? JSON.stringify(studyFilter) : 'null';
  return evalFn(`
    (function() {
      var filter = ${filterStr};
      var chart = ${CHART_API};
      var studies = chart.getAllStudies();
      var results = [];
      for (var i = 0; i < studies.length; i++) {
        var s = studies[i];
        if (filter && (s.name || '').toLowerCase().indexOf(filter.toLowerCase()) === -1) continue;
        try {
          var study = chart.getStudyById(s.id);
          if (!study) continue;
          var src = study._study || study;
          var g = src._graphics || (src._source && src._source._graphics);
          if (!g) continue;
          var pc = g._primitivesCollection;
          if (!pc || !pc.ownFirstValue) continue;
          var tableMap = pc.ownFirstValue();
          if (!tableMap) continue;
          var tables = [];
          if (typeof tableMap.forEach === 'function') {
            tableMap.forEach(function(table) {
              if (!table || !table.data) return;
              var rows = [];
              for (var r = 0; r < table.data.length; r++) {
                var row = [];
                for (var c = 0; c < table.data[r].length; c++) {
                  row.push(table.data[r][c].text || '');
                }
                rows.push(row);
              }
              tables.push({ rows: rows });
            });
          }
          if (tables.length > 0) results.push({ study: s.name, tables: tables });
        } catch(e) {}
      }
      return { symbol: chart.symbol(), study_count: results.length, studies: results };
    })()
  `);
}

export async function streamTables({ interval, filter, _deps } = {}) {
  const evalFn = _deps?.evaluate || _evaluate;
  return pollLoop(() => fetchTables(evalFn, filter), { interval: interval || 2000, label: 'tables', _deps });
}

// ── Stream: all panes (multi-symbol) ──

const CWC = 'window.TradingViewApi._chartWidgetCollection';

async function fetchAllPanes(evalFn) {
  return evalFn(`
    (function() {
      var cwc = ${CWC};
      var all = cwc.getAll();
      var layoutType = cwc._layoutType;
      if (typeof layoutType === 'object' && layoutType && typeof layoutType.value === 'function') layoutType = layoutType.value();
      var count = cwc.inlineChartsCount;
      if (typeof count === 'object' && count && typeof count.value === 'function') count = count.value();

      var panes = [];
      for (var i = 0; i < Math.min(all.length, count || all.length); i++) {
        try {
          var c = all[i];
          var model = c.model();
          var ms = model.mainSeries();
          var bars = ms.bars();
          var last = bars.lastIndex();
          var v = bars.valueAt(last);
          if (!v) { panes.push({ index: i, symbol: ms.symbol(), error: 'no bars' }); continue; }
          panes.push({
            index: i,
            symbol: ms.symbol(),
            resolution: ms.interval(),
            time: v[0],
            open: v[1],
            high: v[2],
            low: v[3],
            close: v[4],
            volume: v[5] || 0,
          });
        } catch(e) { panes.push({ index: i, error: e.message }); }
      }
      return { layout: layoutType, pane_count: panes.length, panes: panes };
    })()
  `);
}

export async function streamAllPanes({ interval, _deps } = {}) {
  const evalFn = _deps?.evaluate || _evaluate;
  return pollLoop(() => fetchAllPanes(evalFn), { interval: interval || 500, label: 'all-panes', _deps });
}
