import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from './server.js';
import { parseArgs } from './cli-args.js';

// Siatka bezpieczeństwa: po starcie pojedynczy nieobsłużony błąd nie może wygasić
// serwera wizualizacji. Błędy startu i tak lecą do main().catch poniżej.
process.on('unhandledRejection', (reason) => {
  console.error('Nieobsłużone odrzucenie obietnicy — serwer działa dalej:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Nieobsłużony wyjątek — serwer działa dalej:', err);
});

const HELP = `AI of Agents — wizualizacja sesji Claude Code jako gra RTS.

Użycie:
  ai-of-agents [opcje]
  aioa [opcje]

Opcje:
  --demo           Tryb demo (sztuczne dane), bez podglądu ~/.claude/projects
  --port, -p <n>   Port HTTP (domyślnie 8123)
  --open           Otwórz przeglądarkę po starcie
  --help, -h       Ta pomoc
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
      process.stdout.write(
        `\n  ▸ AI of Agents działa: ${server.url}\n    (Ctrl+C aby zatrzymać)\n\n`,
      );
      if (opts.open) openBrowser(server.url);
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
  console.error(`Błąd: ${(err as Error).message}`);
  process.exitCode = 1;
});
