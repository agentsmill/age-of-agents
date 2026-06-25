import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from './server.js';
import { parseArgs, shouldOpenBrowser, parseSubcommand } from './cli-args.js';
import { startOllamaLoggerProxy } from './proxy/ollama-logger.js';
import { startOpenAiLoggerProxy } from './proxy/openai-logger.js';

// Safety net: after startup, a single unhandled error must not shut down the
// visualization server. Startup errors still go to main().catch below.
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
  aoa local <model> [args]   Run \`ollama run <model>\` and log it as a hero
  aoa local-proxy            OpenAI /v1 logging proxy (llama.cpp/vLLM/oMLX)

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
    // ENOENT (missing `open`/`xdg-open`, e.g. headless Linux) arrives as async event
    // 'error', not exception; without this handler the process would crash after startup.
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser / GUI-less environment: ignore, the URL is printed anyway.
  }
}

async function runLocal(rest: string[]): Promise<number> {
  const model = rest[0];
  if (!model) {
    process.stderr.write('Usage: aoa local <model> [ollama run args…]\n');
    return 1;
  }
  const proxy = await startOllamaLoggerProxy();
  // `ollama` reads OLLAMA_HOST as "host:port" (no scheme).
  const ollamaHost = proxy.url.replace(/^https?:\/\//, '');
  process.stdout.write(`  ▸ Logging this session to Age of Agents (proxy ${proxy.url})\n\n`);
  const child = spawn('ollama', ['run', ...rest], {
    stdio: 'inherit',
    env: { ...process.env, OLLAMA_HOST: ollamaHost },
  });
  return await new Promise<number>((resolve) => {
    child.on('error', (err) => {
      process.stderr.write(`Failed to run 'ollama' — is it installed and on PATH? (${(err as Error).message})\n`);
      void proxy.close().then(() => resolve(127));
    });
    child.on('exit', (code) => {
      void proxy.close().then(() => resolve(code ?? 0));
    });
  });
}

async function runLocalProxy(): Promise<number> {
  const proxy = await startOpenAiLoggerProxy();
  const backend = process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1';
  process.stdout.write(
    `\n  ▸ Local LLM proxy running: ${proxy.url}\n` +
      `    Forwarding to: ${backend}  (override with LLM_BASE_URL / LLM_MODEL / LLM_API_KEY)\n` +
      `    Point your OpenAI-compatible client's base URL here.\n    (Ctrl+C to stop)\n\n`,
  );
  return await new Promise<number>(() => {
    // Stays up until the user Ctrl+C's the process.
  });
}

async function main(): Promise<void> {
  const { command, rest } = parseSubcommand(process.argv.slice(2));
  if (command === 'local') {
    process.exitCode = await runLocal(rest);
    return;
  }
  if (command === 'local-proxy') {
    process.exitCode = await runLocalProxy();
    return;
  }

  const opts = parseArgs(rest);
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }

  // cli.js lives in dist/ next to dist/web/: compute client directory relative
  // to it, not cwd (npx may be run from any directory).
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), 'web');

  let port = opts.port;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const server = await startServer({ port, demo: opts.demo, webRoot });
      process.stdout.write(
        `\n  ▸ Age of Agents is running: ${server.url}\n    (Ctrl+C to stop)\n\n`,
      );
      const open = shouldOpenBrowser(opts.open, {
        ci: Boolean(process.env.CI),
        isTTY: Boolean(process.stdout.isTTY),
      });
      if (open) openBrowser(server.url);
      return;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      // Try up to 10 ports: if the tenth (attempt === 9) is also busy, throw.
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
