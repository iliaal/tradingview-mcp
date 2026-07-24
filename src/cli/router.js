/**
 * CLI command router using node:util parseArgs.
 * Zero dependencies — uses only Node.js built-ins.
 */
import { parseArgs } from 'node:util';
import { disconnect } from '../connection.js';

/**
 * Exit the CLI cleanly. process.exit() abruptly races libuv's async handle
 * teardown on Windows — undici (Node's fetch, used by `pine check`) and the
 * CDP WebSocket both trip
 *   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c
 * crashing with a nonzero code even after the command already reported its
 * result. Set the exit code, close CDP, and let the loop drain naturally; an
 * unref'd timer force-exits only if some handle genuinely hangs. Mirrors the
 * success path (execute), which already drains instead of calling exit().
 */
async function exit(code) {
  process.exitCode = code;
  try { await disconnect(); } catch { /* already closed */ }
  const t = setTimeout(() => process.exit(code), 3000);
  t.unref();
}

/** @type {Map<string, { description: string, options?: object, handler: Function, subcommands?: Map<string, object> }>} */
const commands = new Map();

export function register(name, config) {
  commands.set(name, config);
}

function printHelp() {
  console.log('Usage: tv <command> [options]\n');
  console.log('Commands:');
  const maxLen = Math.max(...[...commands.keys()].map(k => k.length));
  for (const [name, cmd] of commands) {
    if (cmd.subcommands) {
      const subs = [...cmd.subcommands.keys()].join(', ');
      console.log(`  ${name.padEnd(maxLen + 2)}${cmd.description}  [${subs}]`);
    } else {
      console.log(`  ${name.padEnd(maxLen + 2)}${cmd.description}`);
    }
  }
  console.log('\nRun "tv <command> --help" for command-specific options.');
  console.log('\nDISCLAIMER');
  console.log('  Not affiliated with TradingView Inc. or Anthropic, PBC.');
  console.log('  Use subject to TradingView\'s Terms of Use: tradingview.com/policies');
}

function printCommandHelp(name, cmd) {
  if (cmd.subcommands) {
    console.log(`Usage: tv ${name} <subcommand> [options]\n`);
    console.log('Subcommands:');
    for (const [sub, subConf] of cmd.subcommands) {
      console.log(`  ${sub.padEnd(12)}${subConf.description}`);
    }
  } else {
    console.log(`Usage: tv ${name} [options]\n`);
    console.log(cmd.description);
  }
  const opts = cmd.options || {};
  if (Object.keys(opts).length > 0) {
    console.log('\nOptions:');
    for (const [k, v] of Object.entries(opts)) {
      const flag = v.short ? `-${v.short}, --${k}` : `    --${k}`;
      console.log(`  ${flag.padEnd(20)}${v.description || ''}`);
    }
  }
}

/**
 * Shield leading-hyphen-digit positionals (e.g. indicator names like
 * "-4 CB Model Indicator") from parseArgs, which would parse `-4` as a
 * short flag. Inserts `--` before the first such arg unless the caller
 * already supplied one. Safe because no command defines a `-N` flag —
 * all our short options are `-<letter>`.
 */
export function shieldNegativePositionals(args) {
  if (args.includes('--')) return args;
  // Skip when the leading-hyphen-digit arg is the VALUE of a preceding
  // short flag (e.g. `tv replay start -d -7d` — here `-7d` is the date,
  // not a positional). Without this carve-out, inserting `--` between
  // `-d` and `-7d` decays `-d` into a boolean flag and loses the value.
  // We can't tell from here whether the short flag expects a value, so
  // be conservative: any bare `-<letter>` immediately before defers.
  const idx = args.findIndex((a, i) => {
    if (!/^-\d/.test(a)) return false;
    const prev = args[i - 1];
    if (prev && /^-[a-zA-Z]$/.test(prev)) return false;
    return true;
  });
  if (idx === -1) return args;
  return [...args.slice(0, idx), '--', ...args.slice(idx)];
}

/**
 * Execute a single command and return its result (no process.exit, no
 * stdout JSON write). Used by `tv repl` so one CDP client can be reused
 * across many commands without per-invocation reconnect overhead — the
 * IDEAS line 211-219 batch-sweep speedup.
 *
 * Throws on parse errors / handler errors; caller is responsible for
 * formatting + writing.
 */
export async function runOnce(rawArgs) {
  const args = shieldNegativePositionals(rawArgs);
  if (args.length === 0) throw new Error('Empty command');

  const cmdName = args[0];
  const cmd = commands.get(cmdName);
  if (!cmd) throw new Error(`Unknown command: ${cmdName}`);

  if (cmd.subcommands) {
    const subName = args[1];
    if (!subName) throw new Error(`Subcommand required for ${cmdName}`);
    const sub = cmd.subcommands.get(subName);
    if (!sub) throw new Error(`Unknown subcommand: ${cmdName} ${subName}`);
    const { values, positionals } = parseArgs({
      args: args.slice(2),
      options: { help: { type: 'boolean', short: 'h' }, ...(sub.options || {}) },
      allowPositionals: true,
      strict: false,
    });
    return await sub.handler(values, positionals);
  }

  const { values, positionals } = parseArgs({
    args: args.slice(1),
    options: { help: { type: 'boolean', short: 'h' }, ...(cmd.options || {}) },
    allowPositionals: true,
    strict: false,
  });
  return await cmd.handler(values, positionals);
}

export async function run(argv) {
  const args = shieldNegativePositionals(argv.slice(2));

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const cmdName = args[0];
  const cmd = commands.get(cmdName);

  if (!cmd) {
    console.error(`Unknown command: ${cmdName}`);
    console.error('Run "tv --help" for a list of commands.');
    process.exit(1);
  }

  // Handle subcommands (e.g., tv pine get)
  let handler, options;
  if (cmd.subcommands) {
    const subName = args[1];
    if (!subName || subName === '--help' || subName === '-h') {
      printCommandHelp(cmdName, cmd);
      process.exit(0);
    }
    const sub = cmd.subcommands.get(subName);
    if (!sub) {
      console.error(`Unknown subcommand: ${cmdName} ${subName}`);
      printCommandHelp(cmdName, cmd);
      process.exit(1);
    }
    handler = sub.handler;
    options = sub.options || {};
    // Parse remaining args after command + subcommand
    try {
      const { values, positionals } = parseArgs({
        args: args.slice(2),
        options: { help: { type: 'boolean', short: 'h' }, ...options },
        allowPositionals: true,
        strict: false,
      });
      if (values.help) {
        console.log(`Usage: tv ${cmdName} ${subName} [options]\n`);
        console.log(sub.description);
        if (Object.keys(options).length > 0) {
          console.log('\nOptions:');
          for (const [k, v] of Object.entries(options)) {
            const flag = v.short ? `-${v.short}, --${k}` : `    --${k}`;
            console.log(`  ${flag.padEnd(20)}${v.description || ''}`);
          }
        }
        process.exit(0);
      }
      await execute(handler, values, positionals);
    } catch (err) {
      await handleError(err);
    }
  } else {
    handler = cmd.handler;
    options = cmd.options || {};
    try {
      const { values, positionals } = parseArgs({
        args: args.slice(1),
        options: { help: { type: 'boolean', short: 'h' }, ...options },
        allowPositionals: true,
        strict: false,
      });
      if (values.help) {
        printCommandHelp(cmdName, cmd);
        process.exit(0);
      }
      await execute(handler, values, positionals);
    } catch (err) {
      await handleError(err);
    }
  }
}

async function execute(handler, values, positionals) {
  try {
    const result = await handler(values, positionals);
    console.log(JSON.stringify(result, null, 2));
    // Let the event loop drain instead of process.exit() — avoids a Windows
    // libuv double-close assertion when undici's fetch keepalive socket is
    // still open at exit time.
    process.exitCode = 0;
  } catch (err) {
    await handleError(err);
  }
}

async function handleError(err) {
  const message = err.message || String(err);
  // Connection failures get exit code 2
  if (/CDP|connection|ECONNREFUSED|not running/i.test(message)) {
    console.error(JSON.stringify({ success: false, error: message }, null, 2));
    await exit(2);
    return;
  }
  console.error(JSON.stringify({ success: false, error: message }, null, 2));
  await exit(1);
}
