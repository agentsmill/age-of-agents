import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from './server.js';
import { parseArgs, shouldOpenBrowser } from './cli-args.js';

// Siatka bezpieczeństwa: po starcie pojedynczy nieobsłużony błąd nie może wygasić
// serwera wizualizacji. Błędy startu i tak lecą do main().catch poniżej.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection — server keeps running:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception — server keeps running:', err);
});

const HELP = `Age of Agents — visualize Claude Code sessions as an RTS game.

Usage:
  age-of-agents [options]
  aoa [options]

By default opens the browser on the game view after startup (skipped in CI / without a TTY).

Options:
  --demo           Demo mode (fake data), without watching ~/.claude/projects
  --port, -p <n>   HTTP port (default 8123)
  --open           Force opening the browser (even in CI / without a TTY)
  --no-open        Do not open the browser
  --help, -h       This help
`;

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    // ENOENT (brak `open`/`xdg-open`, np. headless Linux) leci jako async event
    // 'error', nie wyjątek — bez tego handlera proces by się wywalił po starcie.
    child.on('error', () => {});
    child.unref();
  } catch {
    // Brak przeglądarki / środowisko bez GUI — ignorujemy, URL i tak jest wypisany.
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }

  // cli.js leży w dist/ obok dist/web/ → katalog klienta liczymy względem siebie,
  // nie względem cwd (npx może być odpalony z dowolnego katalogu).
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), 'web');

  let port = opts.port;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const server = await startServer({ port, demo: opts.demo, webRoot });
      const proxyLine = server.localLlmProxyUrl
        ? `  ▸ Local LLM proxy (Ollama/oMLX): ${server.localLlmProxyUrl}\n`
        : '';
      process.stdout.write(
        `\n  ▸ Age of Agents is running: ${server.url}\n${proxyLine}    (Ctrl+C to stop)\n\n`,
      );
      const open = shouldOpenBrowser(opts.open, {
        ci: Boolean(process.env.CI),
        isTTY: Boolean(process.stdout.isTTY),
      });
      if (open) openBrowser(server.url);
      return;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      // Próbujemy do 10 portów: gdy dziesiąty (attempt === 9) też zajęty, rzucamy błąd.
      if (e.code === 'EADDRINUSE' && attempt < 9) {
        port += 1;
        continue;
      }
      throw err;
    }
  }
}

main().catch((err: unknown) => {
  console.error(`Error: ${(err as Error).message}`);
  process.exitCode = 1;
});
