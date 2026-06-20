import { SERVER_PORT } from '@agent-citadel/shared';

/**
 * Browser opening mode:
 *  - 'auto'   default: open if launch is interactive (not CI, has TTY)
 *  - 'always' force opening (--open flag), even in CI / without TTY
 *  - 'never'  — nie otwieraj (flaga --no-open)
 */
export type OpenMode = 'auto' | 'always' | 'never';

export interface CliOptions {
  port: number;
  demo: boolean;
  open: OpenMode;
  help: boolean;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') {
    throw new Error(`Invalid port: ${value === undefined ? '(missing)' : '(empty)'}`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return n;
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { port: SERVER_PORT, demo: false, open: 'auto', help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--demo') opts.demo = true;
    else if (arg === '--open') opts.open = 'always';
    else if (arg === '--no-open') opts.open = 'never';
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--port' || arg === '-p') opts.port = parsePort(argv[++i]);
    else if (arg.startsWith('--port=')) opts.port = parsePort(arg.slice('--port='.length));
    else throw new Error(`Unknown option: ${arg}`);
  }
  return opts;
}

/**
 * Whether to actually open the browser. Pure decision (no side effects):
 * environment (CI / TTY) is injected so this is easy to test.
 *
 * 'auto' opens only interactively: skips CI and non-terminal output
 * (script/pipe/headless), so automation is not surprised. --open forces it.
 * --no-open blokuje.
 */
export function shouldOpenBrowser(mode: OpenMode, env: { ci: boolean; isTTY: boolean }): boolean {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  return !env.ci && env.isTTY;
}
