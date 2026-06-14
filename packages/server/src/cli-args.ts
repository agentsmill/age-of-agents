import { SERVER_PORT } from '@agent-citadel/shared';

export interface CliOptions {
  port: number;
  demo: boolean;
  open: boolean;
  help: boolean;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') {
    throw new Error(`Nieprawidłowy port: ${value === undefined ? '(brak)' : '(pusty)'}`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`Nieprawidłowy port: ${value}`);
  }
  return n;
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { port: SERVER_PORT, demo: false, open: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--demo') opts.demo = true;
    else if (arg === '--open') opts.open = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--port' || arg === '-p') opts.port = parsePort(argv[++i]);
    else if (arg.startsWith('--port=')) opts.port = parsePort(arg.slice('--port='.length));
    else throw new Error(`Nieznana opcja: ${arg}`);
  }
  return opts;
}
