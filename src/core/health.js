/**
 * Core health/discovery/launch/reconnect logic.
 */
import { getClient as _getClient, getTargetInfo as _getTargetInfo, evaluate as _evaluate, disconnect as _disconnect, CDP_PORT } from '../connection.js';
import { waitForChartReady as _waitForChartReady } from '../wait.js';

function _resolve(deps) {
  return {
    getClient: deps?.getClient || _getClient,
    getTargetInfo: deps?.getTargetInfo || _getTargetInfo,
    evaluate: deps?.evaluate || _evaluate,
    disconnect: deps?.disconnect || _disconnect,
    waitForChartReady: deps?.waitForChartReady || _waitForChartReady,
  };
}
import { existsSync, readFileSync } from 'fs';
import { execSync, execFileSync, spawn } from 'child_process';

// True when running on WSL2 — process.platform reports 'linux' but the
// actual TradingView install is on the Windows host, reachable via /mnt/c/
// for filesystem access and powershell.exe for process control.
function isWsl() {
  if (process.platform !== 'linux') return false;
  try {
    const v = readFileSync('/proc/version', 'utf8').toLowerCase();
    return v.includes('microsoft') || v.includes('wsl');
  } catch { return false; }
}

// Look up TradingView's MSIX install location on Windows via PowerShell.
// Get-AppxPackage returns the canonical InstallLocation regardless of the
// hashed package directory name (which changes per version). Returns the
// path to TradingView.exe, or null when the package is not installed or
// powershell.exe is unavailable.
function findMsixTradingView({ wsl = false } = {}) {
  try {
    const psBin = wsl ? 'powershell.exe' : 'powershell';
    // The MSIX package Name is publisher-prefixed (e.g.
    // "31178TradingViewInc.TradingView"), not the bare "TradingView.Desktop",
    // so an exact -Name match silently finds nothing on real Store installs.
    // Match on a "*TradingView*" wildcard instead. This can return multiple
    // InstallLocations — pick the first whose folder actually holds
    // TradingView.exe (done JS-side below). Deliberately no `$_` in the
    // PowerShell: under WSL this string is parsed by /bin/sh first, which
    // would expand `$_` before powershell.exe ever sees it.
    const out = execSync(
      `${psBin} -NoProfile -Command "Get-AppxPackage *TradingView* | Select-Object -ExpandProperty InstallLocation"`,
      { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString().trim();
    if (!out) return null;
    for (const dir of out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
      const winPath = `${dir}\\TradingView.exe`;
      if (!wsl) {
        if (existsSync(winPath)) return winPath;
        continue;
      }
      // WSL: convert C:\Foo\Bar to /mnt/c/Foo/Bar to verify existence.
      const linuxPath = winPath
        .replace(/^([A-Za-z]):/, (_m, d) => `/mnt/${d.toLowerCase()}`)
        .replace(/\\/g, '/');
      if (existsSync(linuxPath)) return winPath;
    }
    return null;
  } catch {
    return null;
  }
}

export async function healthCheck({ _deps } = {}) {
  const { getClient, getTargetInfo, evaluate } = _resolve(_deps);
  await getClient();
  const target = await getTargetInfo();

  const state = await evaluate(`
    (function() {
      var result = { url: window.location.href, title: document.title };
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        result.symbol = chart.symbol();
        result.resolution = chart.resolution();
        result.chartType = chart.chartType();
        result.apiAvailable = true;
      } catch(e) {
        result.symbol = 'unknown';
        result.resolution = 'unknown';
        result.chartType = null;
        result.apiAvailable = false;
        result.apiError = e.message;
      }
      return result;
    })()
  `);

  return {
    success: true,
    cdp_connected: true,
    target_id: target.id,
    target_url: target.url,
    target_title: target.title,
    chart_symbol: state?.symbol || 'unknown',
    chart_resolution: state?.resolution || 'unknown',
    chart_type: state?.chartType ?? null,
    api_available: state?.apiAvailable ?? false,
    ...(state?.apiError ? { api_error: state.apiError } : {}),
  };
}

export async function discover({ _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const paths = await evaluate(`
    (function() {
      var results = {};
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        var methods = [];
        for (var k in chart) { if (typeof chart[k] === 'function') methods.push(k); }
        results.chartApi = { available: true, path: 'window.TradingViewApi._activeChartWidgetWV.value()', methodCount: methods.length, methods: methods.slice(0, 50) };
      } catch(e) { results.chartApi = { available: false, error: e.message }; }
      try {
        var col = window.TradingViewApi._chartWidgetCollection;
        var colMethods = [];
        for (var k in col) { if (typeof col[k] === 'function') colMethods.push(k); }
        results.chartWidgetCollection = { available: !!col, path: 'window.TradingViewApi._chartWidgetCollection', methodCount: colMethods.length, methods: colMethods.slice(0, 30) };
      } catch(e) { results.chartWidgetCollection = { available: false, error: e.message }; }
      try {
        var ws = window.ChartApiInstance;
        var wsMethods = [];
        for (var k in ws) { if (typeof ws[k] === 'function') wsMethods.push(k); }
        results.chartApiInstance = { available: !!ws, path: 'window.ChartApiInstance', methodCount: wsMethods.length, methods: wsMethods.slice(0, 30) };
      } catch(e) { results.chartApiInstance = { available: false, error: e.message }; }
      try {
        var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
        var bwbMethods = [];
        if (bwb) { for (var k in bwb) { if (typeof bwb[k] === 'function') bwbMethods.push(k); } }
        results.bottomWidgetBar = { available: !!bwb, path: 'window.TradingView.bottomWidgetBar', methodCount: bwbMethods.length, methods: bwbMethods.slice(0, 20) };
      } catch(e) { results.bottomWidgetBar = { available: false, error: e.message }; }
      try {
        var replay = window.TradingViewApi._replayApi;
        results.replayApi = { available: !!replay, path: 'window.TradingViewApi._replayApi' };
      } catch(e) { results.replayApi = { available: false, error: e.message }; }
      try {
        var alerts = window.TradingViewApi._alertService;
        results.alertService = { available: !!alerts, path: 'window.TradingViewApi._alertService' };
      } catch(e) { results.alertService = { available: false, error: e.message }; }
      return results;
    })()
  `);

  const available = Object.values(paths).filter(v => v.available).length;
  const total = Object.keys(paths).length;

  return { success: true, apis_available: available, apis_total: total, apis: paths };
}

export async function uiState({ _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const state = await evaluate(`
    (function() {
      var ui = {};
      var bottom = document.querySelector('[class*="layout__area--bottom"]');
      ui.bottom_panel = { open: !!(bottom && bottom.offsetHeight > 50), height: bottom ? bottom.offsetHeight : 0 };
      var right = document.querySelector('[class*="layout__area--right"]');
      ui.right_panel = { open: !!(right && right.offsetWidth > 50), width: right ? right.offsetWidth : 0 };
      var monacoEl = document.querySelector('.monaco-editor.pine-editor-monaco');
      ui.pine_editor = { open: !!monacoEl, width: monacoEl ? monacoEl.offsetWidth : 0, height: monacoEl ? monacoEl.offsetHeight : 0 };
      var stratPanel = document.querySelector('[data-name="backtesting"]') || document.querySelector('[class*="strategyReport"]');
      ui.strategy_tester = { open: !!(stratPanel && stratPanel.offsetParent) };
      var widgetbar = document.querySelector('[data-name="widgetbar-wrap"]');
      ui.widgetbar = { open: !!(widgetbar && widgetbar.offsetWidth > 50) };
      ui.buttons = {};
      var btns = document.querySelectorAll('button');
      var seen = {};
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.offsetParent === null || b.offsetWidth < 15) continue;
        var text = b.textContent.trim();
        var aria = b.getAttribute('aria-label') || '';
        var dn = b.getAttribute('data-name') || '';
        var label = text || aria || dn;
        if (!label || label.length > 60) continue;
        var key = label.replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 40);
        if (seen[key]) continue;
        seen[key] = true;
        var rect = b.getBoundingClientRect();
        var region = 'other';
        if (rect.y < 50) region = 'top_bar';
        else if (rect.y < 90 && rect.x < 650) region = 'toolbar';
        else if (rect.x < 45) region = 'left_sidebar';
        else if (rect.x > 650 && rect.y < 100) region = 'pine_header';
        else if (rect.y > 750) region = 'bottom_bar';
        if (!ui.buttons[region]) ui.buttons[region] = [];
        ui.buttons[region].push({ label: label.substring(0, 40), disabled: b.disabled, x: Math.round(rect.x), y: Math.round(rect.y) });
      }
      ui.key_buttons = {};
      var keyLabels = {
        'add_to_chart': /add to chart/i, 'save_and_add': /save and add/i,
        'update_on_chart': /update on chart/i, 'save': /^Save(Save)?$/,
        'saved': /^Saved/, 'publish_script': /publish script/i,
        'compile_errors': /error/i, 'unsaved_version': /unsaved version/i,
      };
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.offsetParent === null) continue;
        var text = b.textContent.trim();
        for (var k in keyLabels) {
          if (keyLabels[k].test(text)) {
            ui.key_buttons[k] = { text: text.substring(0, 40), disabled: b.disabled, visible: b.offsetWidth > 0 };
          }
        }
      }
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        ui.chart = { symbol: chart.symbol(), resolution: chart.resolution(), chartType: chart.chartType(), study_count: chart.getAllStudies().length };
      } catch(e) { ui.chart = { error: e.message }; }
      try {
        var replay = window.TradingViewApi._replayApi;
        function unwrap(v) { return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; }
        ui.replay = { available: unwrap(replay.isReplayAvailable()), started: unwrap(replay.isReplayStarted()) };
      } catch(e) { ui.replay = { error: e.message }; }
      return ui;
    })()
  `);

  return { success: true, ...state };
}

export async function launch({ port, kill_existing } = {}) {
  const cdpPort = port || CDP_PORT;
  const portMismatch = port && port !== CDP_PORT;
  const killFirst = kill_existing !== false;
  const platform = process.platform;
  const wsl = isWsl();

  // Short-circuit: if CDP is already responding on the requested port, treat
  // the launch as successful. This covers the WSL case (TV runs on Windows,
  // we forward localhost) and the "user already launched TV manually" case.
  try {
    const http = await import('http');
    const alreadyUp = await new Promise((resolve) => {
      const req = http.get(`http://localhost:${cdpPort}/json/version`, { timeout: 1500 }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => resolve(data));
      });
      req.on('error', () => resolve(null));
      // Without this, the timeout option only emits the event; the socket
      // sits there indefinitely on a half-open TCP. Destroy and resolve.
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
    if (alreadyUp && !killFirst) {
      const info = JSON.parse(alreadyUp);
      return {
        success: true, platform: wsl ? 'wsl' : platform,
        binary: '(already running)', cdp_port: cdpPort,
        cdp_url: `http://localhost:${cdpPort}`,
        browser: info.Browser, user_agent: info['User-Agent'],
        already_running: true,
        ...(portMismatch ? { warning: `Launched on port ${cdpPort} but the MCP server's CDP client is bound to ${CDP_PORT}. Set TV_CDP_PORT=${cdpPort} and restart the server, or relaunch on ${CDP_PORT}.` } : {}),
      };
    }
  } catch { /* fall through to launch */ }

  const pathMap = {
    darwin: [
      '/Applications/TradingView.app/Contents/MacOS/TradingView',
      `${process.env.HOME}/Applications/TradingView.app/Contents/MacOS/TradingView`,
    ],
    win32: [
      `${process.env.LOCALAPPDATA}\\TradingView\\TradingView.exe`,
      `${process.env.PROGRAMFILES}\\TradingView\\TradingView.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\TradingView\\TradingView.exe`,
    ],
    linux: [
      '/opt/TradingView/tradingview',
      '/opt/TradingView/TradingView',
      `${process.env.HOME}/.local/share/TradingView/TradingView`,
      '/usr/bin/tradingview',
      '/snap/tradingview/current/tradingview',
    ],
  };

  let tvPath = null;
  const candidates = pathMap[platform] || pathMap.linux;
  for (const p of candidates) {
    if (p && existsSync(p)) { tvPath = p; break; }
  }

  if (!tvPath) {
    try {
      const cmd = platform === 'win32' ? 'where TradingView.exe' : 'which tradingview';
      tvPath = execSync(cmd, { timeout: 3000 }).toString().trim().split('\n')[0];
      if (tvPath && !existsSync(tvPath)) tvPath = null;
    } catch { /* ignore */ }
  }

  if (!tvPath && platform === 'darwin') {
    try {
      const found = execSync('mdfind "kMDItemFSName == TradingView.app" | head -1', { timeout: 5000 }).toString().trim();
      if (found) {
        const candidate = `${found}/Contents/MacOS/TradingView`;
        if (existsSync(candidate)) tvPath = candidate;
      }
    } catch { /* ignore */ }
  }

  // Windows MSIX (Microsoft Store) install detection. Static paths above
  // miss MSIX installs because they live under
  // C:\Program Files\WindowsApps\TradingView.Desktop_<hash>\ where <hash>
  // changes every version. Get-AppxPackage gives us the canonical path.
  if (!tvPath && (platform === 'win32' || wsl)) {
    tvPath = findMsixTradingView({ wsl });
  }

  if (!tvPath) {
    throw new Error(`TradingView not found on ${wsl ? 'wsl' : platform}. Searched: ${candidates.join(', ')}${(platform === 'win32' || wsl) ? ', plus MSIX (Get-AppxPackage *TradingView*)' : ''}. Launch manually with: /path/to/TradingView --remote-debugging-port=${cdpPort}`);
  }

  if (killFirst) {
    try {
      if (wsl) {
        execSync('powershell.exe -NoProfile -Command "Get-Process -Name TradingView -ErrorAction SilentlyContinue | Stop-Process -Force"', { timeout: 5000, stdio: 'ignore' });
      } else if (platform === 'win32') {
        execSync('taskkill /F /IM TradingView.exe', { timeout: 5000 });
      } else {
        // Match the resolved binary path, not the bare substring "TradingView":
        // `pkill -f TradingView` matches any process whose argv merely contains
        // that string (the launcher run from a TradingView* path, an editor, a
        // log tailer). argv form (execFileSync) also avoids shell interpolation.
        execFileSync('pkill', ['-f', tvPath], { timeout: 5000, stdio: 'ignore' });
      }
      await new Promise(r => setTimeout(r, 1500));
    } catch { /* may not be running */ }
  }

  // VS Code / Cursor extension hosts export ELECTRON_RUN_AS_NODE=1 into every
  // child process. TradingView Desktop is itself an Electron app, so inheriting
  // that var makes it boot headless-as-Node: no window opens and
  // --remote-debugging-port is ignored, so CDP never binds. Strip it (and its
  // console companion) from the launch env so the GUI comes up normally no
  // matter what spawned the MCP server.
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  delete launchEnv.ELECTRON_NO_ATTACH_CONSOLE;

  // WSL: launch via PowerShell from the Windows side. cmd.exe + UNC path
  // refuses to run when WSL's working dir is the cwd, so we shell into the
  // user's Windows home directory first. Start-Process detaches cleanly.
  let child;
  if (wsl) {
    // tvPath here is a Windows path (C:\...\TradingView.exe).
    // PowerShell single-quoted strings escape ' as '' — split-then-join
    // does the substitution; the source-audit reserves the regex-replace
    // form of single-quote escaping for safeString() use cases.
    const psQuoted = tvPath.split("'").join("''");
    const psCmd = `Set-Location $env:USERPROFILE; Start-Process -FilePath '${psQuoted}' -ArgumentList '--remote-debugging-port=${cdpPort}'`;
    child = spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], { detached: true, stdio: 'ignore', env: launchEnv });
    child.unref();
  } else {
    // Try direct spawn first. On TradingView v2.14.0+ (Electron 38 / Node 22),
    // direct invocation may reject --remote-debugging-port as an unknown CLI
    // flag before Chromium can process it. We watch stderr + exit for a short
    // window and fall back to a platform-specific path when that happens.
    child = spawn(tvPath, [`--remote-debugging-port=${cdpPort}`], { detached: true, stdio: ['ignore', 'ignore', 'pipe'], env: launchEnv });
    const spawnFailed = await new Promise((resolve) => {
      let settled = false;
      const settle = (val) => { if (!settled) { settled = true; resolve(val); } };
      try { child.stderr && child.stderr.on('data', () => {}); } catch {}
      child.on('error', () => { clearTimeout(timer); settle(true); });
      child.on('exit', (code) => {
        if (code !== null && code !== 0) { clearTimeout(timer); settle(true); }
      });
      const timer = setTimeout(() => {
        try { child.stderr && child.stderr.destroy(); } catch {}
        settle(false);
      }, 2000);
    });

    if (spawnFailed) {
      // Fallback path replaces the dead child with a new handle when possible
      // (bare spawn). open -a on macOS gives us no pid — we set child = null
      // and the result emits pid: null. Either way the CDP poll below is what
      // confirms readiness, not the pid value.
      child = null;
      if (platform === 'darwin') {
        // open -a only attaches args to a fresh launch — kill any running TV
        // first or it just reactivates the existing (no-CDP) window.
        try { execFileSync('pkill', ['-f', tvPath], { timeout: 5000, stdio: 'ignore' }); } catch {}
        await new Promise(r => setTimeout(r, 2000));
        const appMatch = tvPath.match(/^(.+\.app)\//);
        if (appMatch) {
          const appBundle = appMatch[1];
          try {
            // argv form: the bundle path goes straight to `open` without a
            // shell, so a path with spaces/metacharacters can't break out.
            execFileSync('open', ['-a', appBundle, '--args', `--remote-debugging-port=${cdpPort}`], { timeout: 5000, stdio: 'ignore' });
          } catch { /* open returns non-zero even on success sometimes */ }
        } else {
          child = spawn(tvPath, [], { detached: true, stdio: 'ignore', env: launchEnv });
          child.unref();
        }
      } else {
        // Linux / Windows fallback: env-var hint + bare launch in case TV
        // accepts the flag via env even when CLI parsing rejects it.
        child = spawn(tvPath, [`--remote-debugging-port=${cdpPort}`], {
          detached: true, stdio: 'ignore',
          env: { ...launchEnv, REMOTE_DEBUGGING_PORT: String(cdpPort) },
        });
        child.unref();
      }
    } else {
      child.unref();
    }
  }

  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const http = await import('http');
      const ready = await new Promise((resolve) => {
        const req = http.get(`http://localhost:${cdpPort}/json/version`, { timeout: 1500 }, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => resolve(data));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
      });
      if (ready) {
        const info = JSON.parse(ready);
        return {
          success: true, platform: wsl ? 'wsl' : platform, binary: tvPath, pid: child?.pid ?? null,
          cdp_port: cdpPort, cdp_url: `http://localhost:${cdpPort}`,
          browser: info.Browser, user_agent: info['User-Agent'],
          ...(portMismatch ? { warning: `Launched on port ${cdpPort} but the MCP server's CDP client is bound to ${CDP_PORT}. Set TV_CDP_PORT=${cdpPort} and restart the server, or relaunch on ${CDP_PORT}.` } : {}),
        };
      }
    } catch { /* retry */ }
  }

  return {
    success: false, platform: wsl ? 'wsl' : platform, binary: tvPath, pid: child?.pid ?? null, cdp_port: cdpPort, cdp_ready: false,
    warning: portMismatch
      ? `TradingView launched on port ${cdpPort} but CDP is not yet responding. Note: the MCP server's CDP client is bound to ${CDP_PORT} — set TV_CDP_PORT=${cdpPort} and restart the server to talk to this instance.`
      : 'TradingView launched but CDP not responding yet. It may still be loading. Try tv_health_check in a few seconds.',
  };
}

/**
 * Ensure TradingView Desktop is running with CDP enabled.
 * Idempotent: if CDP is already responding, returns immediately.
 * If TV is running without CDP, kills it and relaunches with the debug port.
 * If TV isn't running at all, launches it fresh.
 */
export async function ensureCDP({ _deps } = {}) {
  // The MCP server's CDP client is bound to CDP_HOST/CDP_PORT at module load
  // (configured via env vars TV_CDP_HOST/TV_CDP_PORT). ensureCDP can only
  // meaningfully manage the port the client is bound to — accepting a
  // per-call port would launch on it but leave subsequent calls talking to
  // the env-configured port instead. Use TV_CDP_PORT and restart the server
  // to point at a different instance.
  const cdpPort = CDP_PORT;
  const http = await import('http');

  // Step 1: Check if CDP is already responding
  const cdpAlive = await new Promise((resolve) => {
    const req = http.get(`http://localhost:${cdpPort}/json/version`, { timeout: 1500 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });

  if (cdpAlive) {
    try {
      const health = await healthCheck({ _deps });
      return {
        success: true,
        action: 'none',
        message: 'CDP already available',
        cdp_port: cdpPort,
        browser: cdpAlive.Browser,
        chart_symbol: health.chart_symbol,
        chart_resolution: health.chart_resolution,
        api_available: health.api_available,
      };
    } catch (err) {
      return {
        success: true,
        action: 'none',
        message: 'CDP responding but chart API not ready yet',
        cdp_port: cdpPort,
        browser: cdpAlive.Browser,
        warning: err.message,
      };
    }
  }

  // Step 2: CDP not responding — check if TV process is running without it
  const platform = process.platform;
  const wsl = isWsl();
  let tvRunning = false;
  try {
    if (wsl) {
      execSync('powershell.exe -NoProfile -Command "Get-Process -Name TradingView -ErrorAction SilentlyContinue | Select-Object -First 1"', { timeout: 3000, stdio: 'ignore' });
      tvRunning = true;
    } else if (platform === 'win32') {
      execSync('tasklist /FI "IMAGENAME eq TradingView.exe" | findstr TradingView', { timeout: 3000, stdio: 'ignore' });
      tvRunning = true;
    } else {
      // -ix (case-insensitive exact process name) not -f (full-cmdline
      // substring): -f would false-positive on the launcher/editor/log-tailer,
      // while a case-sensitive -x would miss lowercase Linux installs
      // (/opt/TradingView/tradingview, /usr/bin/tradingview).
      execSync('pgrep -ix TradingView', { timeout: 3000, stdio: 'ignore' });
      tvRunning = true;
    }
  } catch { /* not running */ }

  // Step 3: Launch (handles kill + relaunch + polling)
  const result = await launch({ kill_existing: tvRunning });
  return {
    ...result,
    action: tvRunning ? 'restarted' : 'launched',
    message: tvRunning
      ? 'TradingView was running without CDP — killed and relaunched with debug port'
      : 'TradingView was not running — launched with debug port',
  };
}

/**
 * Reconnect TradingView Desktop by reloading the page to re-establish
 * the backend WebSocket session. Use when the TV session was taken
 * over by a browser/phone and you've switched back to Desktop.
 */
export async function reconnect({ _deps } = {}) {
  const { getClient, evaluate, disconnect, waitForChartReady } = _resolve(_deps);
  let c;
  try {
    c = await getClient();
  } catch (err) {
    return {
      success: false,
      error: `CDP connection failed: ${err.message}`,
      hint: 'TradingView Desktop may not be running. Use tv_launch to start it.',
    };
  }

  let priorSymbol = 'unknown';
  let priorResolution = 'unknown';
  try {
    const state = await evaluate(`
      (function() {
        try {
          var chart = window.TradingViewApi._activeChartWidgetWV.value();
          return { symbol: chart.symbol(), resolution: chart.resolution() };
        } catch(e) { return { symbol: 'unknown', resolution: 'unknown' }; }
      })()
    `);
    priorSymbol = state?.symbol || 'unknown';
    priorResolution = state?.resolution || 'unknown';
  } catch { /* best effort */ }

  try {
    await c.Page.reload({ ignoreCache: true });
  } catch {
    // Page.reload may break the CDP connection; that's expected.
  }

  await disconnect();
  await new Promise(r => setTimeout(r, 3000));

  try {
    await getClient();
  } catch (err) {
    return {
      success: false,
      error: `CDP reconnect after reload failed: ${err.message}`,
      hint: 'TradingView may still be loading. Try tv_health_check in a few seconds.',
    };
  }

  const chartReady = await waitForChartReady(null, 20000);

  try {
    const health = await healthCheck({ _deps });
    return {
      success: true,
      reconnected: true,
      chart_ready: chartReady,
      prior_symbol: priorSymbol,
      prior_resolution: priorResolution,
      current_symbol: health.chart_symbol,
      current_resolution: health.chart_resolution,
      api_available: health.api_available,
    };
  } catch (err) {
    return {
      success: true,
      reconnected: true,
      chart_ready: chartReady,
      prior_symbol: priorSymbol,
      warning: `Page reloaded but health check failed: ${err.message}. Chart may still be loading.`,
    };
  }
}
