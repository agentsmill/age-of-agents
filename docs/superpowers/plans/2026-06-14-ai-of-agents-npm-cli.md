# AI of Agents — pakiet CLI na npm — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opublikować dzisiejsze monorepo jako jeden pakiet npm `ai-of-agents`, uruchamiany jedną komendą `npx ai-of-agents` (alias `aioa`), która startuje serwer, sam serwuje klienta i wypisuje URL.

**Architecture:** Refaktor serwera tak, by jego logika żyła w funkcji `startServer(opts)` zamiast wykonywać się przy imporcie. Nowy entry CLI (`cli.ts`) parsuje flagi, wylicza katalog ze zbudowanym klientem względem własnej lokalizacji (`import.meta.url`) i woła `startServer`. Build: `vite build` → `dist/web/`, `esbuild` zbija serwer+CLI+`shared` w jeden `dist/cli.js` (czysty JS, deps runtime zostają external). Publikowany jest tylko root z polami `bin`/`files`.

**Tech Stack:** Node 22 (ESM), Fastify 5 + `@fastify/static` 9, `ws` 8, `chokidar` 4, Vite 6, esbuild 0.28, Vitest 3, TypeScript 5.7.

**Spec:** `docs/superpowers/specs/2026-06-14-ai-of-agents-npm-cli-design.md`

---

## File Structure

| Plik | Rola | Akcja |
|---|---|---|
| `packages/server/src/server.ts` | Funkcja `startServer(opts)` — cała logika HTTP/WS/static (wyciągnięta z `index.ts`) | Create |
| `packages/server/src/index.ts` | Cienki **dev** entry: parsuje `--demo`, woła `startServer` na stałym porcie (klienta w dev serwuje Vite) | Modify |
| `packages/server/src/cli-args.ts` | `parseArgs(argv)` — parser flag CLI (czysta funkcja, testowalna bez sieci) | Create |
| `packages/server/src/cli.ts` | **Publikowany** entry (`bin`): flagi → `startServer` z `webRoot`, wypis URL, `--open`, fallback portu | Create |
| `packages/server/tests/server.test.ts` | Testy `startServer` (health + serwowanie klienta z `webRoot`) | Create |
| `packages/server/tests/cli-args.test.ts` | Testy `parseArgs` | Create |
| `packages/client/vite.config.ts` | `build.outDir` → `../../dist/web` | Modify |
| `scripts/build-server.mjs` | Skrypt esbuild: bundluje `cli.ts` → `dist/cli.js` | Create |
| `package.json` (root) | `name`, `bin`, `files`, `license`, skrypty `build*`/`prepublishOnly`, deps runtime, zdjęte `private` | Modify |
| `packages/server/package.json` | dodać `@fastify/static`; (esbuild w root devDeps) | Modify |
| `LICENSE` | Tekst licencji MIT | Create |
| `README.md` | Sekcja „Instalacja przez npm" | Modify |

Uwaga o WS i fetchach klienta: `packages/client/src/ws.ts` już łączy się przez `location.host` + `WS_PATH`, a HUD pobiera `/building-stats` itd. ścieżkami względnymi → po zserwowaniu klienta z tego samego origin **nie trzeba zmieniać klienta**. Proxy Vite zostaje tylko na potrzeby `npm run dev`.

---

## Task 1: Wyciągnięcie logiki serwera do `startServer()`

Dziś `packages/server/src/index.ts` wykonuje się przy imporcie (top-level `await app.listen(...)`), więc nie da się go ponownie użyć z CLI ani przetestować. Przenosimy logikę do funkcji `startServer(opts)` zwracającej uchwyt z `close()`, a `index.ts` staje się cienkim dev-entry.

**Files:**
- Create: `packages/server/src/server.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/tests/server.test.ts`

- [ ] **Step 1: Napisz failing test**

Create `packages/server/tests/server.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { startServer, type RunningServer } from '../src/server.js';

let running: RunningServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe('startServer', () => {
  it('serwuje /health w trybie demo i zwraca realny port', async () => {
    running = await startServer({ port: 0, demo: true });
    expect(running.port).toBeGreaterThan(0);
    const res = await fetch(`http://localhost:${running.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, demo: true });
  });
});
```

- [ ] **Step 2: Uruchom test — ma się wywalić**

Run: `npm run test -w @agent-citadel/server -- server.test.ts`
Expected: FAIL — `Failed to resolve import '../src/server.js'` (plik jeszcze nie istnieje).

- [ ] **Step 3: Utwórz `packages/server/src/server.ts`**

```ts
import Fastify from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
import { WS_PATH, type GameEvent } from '@agent-citadel/shared';
import { World } from './world.js';

export interface StartServerOptions {
  /** Port HTTP. Podaj 0, by system wybrał wolny (przydatne w testach). */
  port: number;
  host?: string;
  /** Tryb demo: sztuczne dane zamiast podglądu ~/.claude/projects. */
  demo: boolean;
  /** Katalog ze zbudowanym klientem (dist/web). Gdy podany — serwer serwuje SPA. */
  webRoot?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  const host = opts.host ?? '127.0.0.1';
  const app = Fastify({ logger: { level: 'info' } });
  const world = new World();

  app.get('/health', async () => ({ ok: true, demo: opts.demo }));

  if (opts.demo) {
    // No-op trasy, by zainstalowane hooki nie sypały 404 w trybie demo.
    app.post('/hooks', async () => ({ ok: true }));
    app.get('/hooks/status', async () => ({ installed: false, demo: true }));
    app.get('/building-stats', async () => ({ updatedAt: new Date().toISOString(), buildings: {} }));
  } else {
    const { TranscriptWatcher } = await import('./watcher.js');
    const { translateHook, hooksInstalled, installHooks, uninstallHooks } = await import('./hooks.js');
    const { getBuildingStats } = await import('./building-stats.js');
    const watcher = new TranscriptWatcher(world);

    app.get('/building-stats', async () => getBuildingStats());
    app.post('/hooks', async (request) => {
      const translated = translateHook((request.body ?? {}) as never);
      if (translated) watcher.applyExternalFacts(translated.sessionId, translated.projectDir, translated.facts);
      return { ok: true };
    });
    app.get('/hooks/status', async () => ({ installed: await hooksInstalled() }));
    app.post('/hooks/install', async () => {
      await installHooks();
      return { ok: true, installed: true };
    });
    app.post('/hooks/uninstall', async () => {
      await uninstallHooks();
      return { ok: true, installed: false };
    });

    app.addHook('onReady', async () => {
      watcher.start();
    });
  }

  // Serwowanie zbudowanego klienta — tylko w dystrybucji; w dev robi to Vite.
  if (opts.webRoot) {
    const fastifyStatic = (await import('@fastify/static')).default;
    await app.register(fastifyStatic, { root: opts.webRoot, wildcard: false });
    // SPA fallback: nieznana trasa GET → index.html (trasy API są zarejestrowane,
    // więc tu nie trafią).
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET') return reply.sendFile('index.html');
      reply.code(404).send({ error: 'not found' });
    });
  }

  await app.listen({ port: opts.port, host });

  const address = app.server.address();
  const actualPort = typeof address === 'object' && address ? address.port : opts.port;

  const wss = new WebSocketServer({ server: app.server, path: WS_PATH });

  const send = (socket: WebSocket, event: GameEvent): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  };

  wss.on('connection', (socket) => {
    send(socket, { type: 'snapshot', ...world.snapshot() });
  });
  world.onEvent((event) => {
    for (const socket of wss.clients) send(socket, event);
  });

  if (opts.demo) {
    const { startDemo } = await import('./demo/scenario.js');
    startDemo(world);
  }

  const url = `http://localhost:${actualPort}`;
  return {
    url,
    port: actualPort,
    close: async () => {
      wss.close();
      await app.close();
    },
  };
}
```

- [ ] **Step 4: Uruchom test — ma przejść**

Run: `npm run test -w @agent-citadel/server -- server.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Przepisz `packages/server/src/index.ts` na cienki dev-entry**

Zastąp **całą** zawartość pliku:

```ts
// Dev-entry: w trybie deweloperskim klienta serwuje Vite (proxy na /ws, /hooks...).
// Dystrybucja npm używa src/cli.ts (z webRoot). Tu NIE podajemy webRoot.
import { SERVER_PORT } from '@agent-citadel/shared';
import { startServer } from './server.js';

const demo = process.argv.includes('--demo');
const server = await startServer({ port: SERVER_PORT, host: '127.0.0.1', demo });
console.log(`Agent Citadel server (dev): ${server.url} (ws: /ws)`);
if (demo) console.log('Tryb demo: generator scenariuszy uruchomiony');
```

- [ ] **Step 6: Sanity dev-entry (uruchamia się, odpowiada, zamyka)**

Run: `timeout 4 npm run dev -w @agent-citadel/server -- --demo & sleep 2 && curl -s http://127.0.0.1:8123/health; echo`
Expected: wypis zawiera `{"ok":true,"demo":true}` (proces sam zniknie po `timeout`).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/server.ts packages/server/src/index.ts packages/server/tests/server.test.ts
git commit -m "refactor(server): logika w startServer() + cienki dev-entry"
```

---

## Task 2: Serwowanie zbudowanego klienta z `webRoot`

`startServer` już rejestruje `@fastify/static` gdy `webRoot` jest podany (Task 1, Step 3). Teraz instalujemy zależność i pokrywamy to testem.

**Files:**
- Modify: `packages/server/package.json` (dodaj `@fastify/static`)
- Test: `packages/server/tests/server.test.ts` (dopisz przypadek)

- [ ] **Step 1: Zainstaluj `@fastify/static`**

Run: `npm install @fastify/static@^9.1.0 -w @agent-citadel/server`
Expected: dodane do `packages/server/package.json` → `dependencies`.

- [ ] **Step 2: Dopisz failing test serwowania klienta**

W `packages/server/tests/server.test.ts` dodaj importy na górze i nowy test w bloku `describe`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

```ts
  it('serwuje index.html klienta z webRoot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aioa-web-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>AIOA-TEST</title>');
    running = await startServer({ port: 0, demo: true, webRoot: dir });

    const root = await fetch(`http://localhost:${running.port}/`);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain('AIOA-TEST');

    // SPA fallback: nieznana trasa też zwraca index.html.
    const spa = await fetch(`http://localhost:${running.port}/jakas/trasa`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('AIOA-TEST');
  });
```

- [ ] **Step 3: Uruchom testy — mają przejść**

Run: `npm run test -w @agent-citadel/server -- server.test.ts`
Expected: PASS (2 testy). Jeśli FAIL na imporcie `@fastify/static` — wróć do Step 1.

- [ ] **Step 4: Commit**

```bash
git add packages/server/package.json packages/server/tests/server.test.ts package-lock.json
git commit -m "feat(server): serwowanie zbudowanego klienta (@fastify/static, SPA fallback)"
```

---

## Task 3: Parser flag CLI i entry `cli.ts`

Czysty parser flag (`cli-args.ts`) testujemy bez sieci. `cli.ts` to publikowany `bin`: liczy `webRoot` względem siebie, woła `startServer`, wypisuje URL, obsługuje `--open` i fallback portu.

**Files:**
- Create: `packages/server/src/cli-args.ts`
- Create: `packages/server/src/cli.ts`
- Test: `packages/server/tests/cli-args.test.ts`

- [ ] **Step 1: Napisz failing test parsera**

Create `packages/server/tests/cli-args.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli-args.js';

describe('parseArgs', () => {
  it('domyślnie: realny tryb, port 8123, bez open/help', () => {
    expect(parseArgs([])).toEqual({ port: 8123, demo: false, open: false, help: false });
  });

  it('obsługuje --demo --open --port <n>', () => {
    expect(parseArgs(['--demo', '--open', '--port', '9000'])).toEqual({
      port: 9000, demo: true, open: true, help: false,
    });
  });

  it('obsługuje --port=9001 i -p 9002', () => {
    expect(parseArgs(['--port=9001']).port).toBe(9001);
    expect(parseArgs(['-p', '9002']).port).toBe(9002);
  });

  it('obsługuje -h / --help', () => {
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it('rzuca na nieprawidłowy port', () => {
    expect(() => parseArgs(['--port', 'abc'])).toThrow();
    expect(() => parseArgs(['--port', '99999'])).toThrow();
  });
});
```

- [ ] **Step 2: Uruchom test — ma się wywalić**

Run: `npm run test -w @agent-citadel/server -- cli-args.test.ts`
Expected: FAIL — `Failed to resolve import '../src/cli-args.js'`.

- [ ] **Step 3: Utwórz `packages/server/src/cli-args.ts`**

```ts
import { SERVER_PORT } from '@agent-citadel/shared';

export interface CliOptions {
  port: number;
  demo: boolean;
  open: boolean;
  help: boolean;
}

function parsePort(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`Nieprawidłowy port: ${value ?? '(brak)'}`);
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
```

- [ ] **Step 4: Uruchom test — ma przejść**

Run: `npm run test -w @agent-citadel/server -- cli-args.test.ts`
Expected: PASS (5 testów).

- [ ] **Step 5: Utwórz `packages/server/src/cli.ts`**

(Bez linijki shebang — doda ją esbuild w Task 4. W dev ten plik nie jest uruchamiany.)

```ts
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from './server.js';
import { parseArgs } from './cli-args.js';

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
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
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
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/cli-args.ts packages/server/src/cli.ts packages/server/tests/cli-args.test.ts
git commit -m "feat(cli): parser flag i entry cli.ts (URL, --open, fallback portu)"
```

---

## Task 4: Pipeline build (Vite → dist/web, esbuild → dist/cli.js)

Domknięcie luki: dziś `build` to tylko typecheck. Konfigurujemy `vite build` na `dist/web` i piszemy skrypt esbuild bundlujący `cli.ts` do `dist/cli.js` z deps runtime jako external.

**Files:**
- Modify: `packages/client/vite.config.ts`
- Create: `scripts/build-server.mjs`
- Modify: `package.json` (root) — skrypty + esbuild w devDeps

- [ ] **Step 1: Skieruj wyjście Vite do `dist/web`**

W `packages/client/vite.config.ts` dodaj import i blok `build`, zostawiając `server.proxy` bez zmian:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  build: {
    // Wspólny katalog dystrybucji w korzeniu repo (root/dist/web).
    outDir: fileURLToPath(new URL('../../dist/web', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8123', ws: true },
      '/hooks': 'http://127.0.0.1:8123',
      '/health': 'http://127.0.0.1:8123',
      '/building-stats': 'http://127.0.0.1:8123',
    },
  },
});
```

- [ ] **Step 2: Zainstaluj esbuild w root devDeps**

Run: `npm install esbuild@^0.28.0 --save-dev -w .`
Expected: `esbuild` w root `package.json` → `devDependencies`.

- [ ] **Step 3: Utwórz `scripts/build-server.mjs`**

```js
import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)); // kończy się '/'
const outfile = `${root}dist/cli.js`;

await build({
  entryPoints: [`${root}packages/server/src/cli.ts`],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Shebang dla pliku `bin`; cli.ts NIE ma własnego shebanga, by nie zdublować.
  banner: { js: '#!/usr/bin/env node' },
  // Deps z natywnymi/dynamicznymi require — zostają w node_modules konsumenta.
  external: ['fastify', '@fastify/static', 'ws', 'chokidar'],
  logLevel: 'info',
});

await chmod(outfile, 0o755);
console.log('✓ Serwer + CLI zbundlowane do dist/cli.js');
```

- [ ] **Step 4: Dodaj skrypty build w root `package.json`**

Zamień blok `"scripts"` w root `package.json`, dodając `build:web`/`build:server`/`prepublishOnly` i przepinając `build`:

```json
  "scripts": {
    "dev": "concurrently -n server,client -c blue,green \"npm run dev -w @agent-citadel/server\" \"npm run dev -w @agent-citadel/client\"",
    "demo": "concurrently -n server,client -c blue,green \"npm run dev -w @agent-citadel/server -- --demo\" \"npm run dev -w @agent-citadel/client\"",
    "assets": "node scripts/download-assets.mjs",
    "test": "npm run test -w @agent-citadel/server && npm run test -w @agent-citadel/client",
    "build:web": "npm run build -w @agent-citadel/client",
    "build:server": "node scripts/build-server.mjs",
    "build": "npm run build:web && npm run build:server",
    "prepublishOnly": "npm run build && npm test"
  },
```

- [ ] **Step 5: Zbuduj i zweryfikuj artefakty**

Run: `npm run build && ls -la dist && ls dist/web | head`
Expected: `dist/cli.js` istnieje i jest wykonywalny (`-rwxr-xr-x`); `dist/web/index.html` oraz `dist/web/assets/` istnieją.

- [ ] **Step 6: Uruchom zbundlowane CLI w trybie demo (smoke test)**

Run: `node dist/cli.js --demo --port 8131 & sleep 2 && curl -s http://localhost:8131/health; echo; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8131/; kill %1`
Expected: `/health` → `{"ok":true,"demo":true}`; `/` → `200` (serwowany `index.html`).

- [ ] **Step 7: Commit**

```bash
git add packages/client/vite.config.ts scripts/build-server.mjs package.json package-lock.json
git commit -m "build: vite->dist/web + esbuild bundle cli.js, skrypty build"
```

---

## Task 5: Metadane do publikacji, LICENSE, README

Robimy z roota publikowalny pakiet `ai-of-agents`: `bin`, `files`, `license`, zdjęte `private`, deps runtime potrzebne zbundlowanemu `cli.js`. Walidacja przez `npm pack --dry-run` (bez realnej publikacji).

**Files:**
- Modify: `package.json` (root)
- Create: `LICENSE`
- Modify: `README.md`

- [ ] **Step 1: Utwórz `LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 Mateusz Pawelczuk

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Zaktualizuj root `package.json` — tożsamość, bin, files, deps**

Zastąp początek pliku (od `name` do `engines`) tak, by pola wyglądały jak niżej. Kluczowe zmiany: `name` → `ai-of-agents`, **usunięte** `"private": true`, dodane `license`/`bin`/`files`/`keywords`, `flyctl` przeniesiony do devDeps, runtime-deps (external bundla) dodane do `dependencies`:

```json
{
  "name": "ai-of-agents",
  "version": "0.1.0",
  "description": "AI of Agents — wizualizacja sesji Claude Code jako gra RTS w pixel-arcie",
  "type": "module",
  "license": "MIT",
  "bin": {
    "ai-of-agents": "dist/cli.js",
    "aioa": "dist/cli.js"
  },
  "files": [
    "dist",
    "LICENSE",
    "README.md"
  ],
  "keywords": [
    "claude-code",
    "rts",
    "visualization",
    "pixel-art",
    "cli"
  ],
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "dev": "concurrently -n server,client -c blue,green \"npm run dev -w @agent-citadel/server\" \"npm run dev -w @agent-citadel/client\"",
    "demo": "concurrently -n server,client -c blue,green \"npm run dev -w @agent-citadel/server -- --demo\" \"npm run dev -w @agent-citadel/client\"",
    "assets": "node scripts/download-assets.mjs",
    "test": "npm run test -w @agent-citadel/server && npm run test -w @agent-citadel/client",
    "build:web": "npm run build -w @agent-citadel/client",
    "build:server": "node scripts/build-server.mjs",
    "build": "npm run build:web && npm run build:server",
    "prepublishOnly": "npm run build && npm test"
  },
  "devDependencies": {
    "concurrently": "^9.1.0",
    "esbuild": "^0.28.0",
    "flyctl": "^1.2.8",
    "pngjs": "^7.0.0"
  },
  "engines": {
    "node": ">=22"
  },
  "dependencies": {
    "@fastify/static": "^9.1.0",
    "chokidar": "^4.0.0",
    "fastify": "^5.2.0",
    "ws": "^8.18.0"
  }
}
```

Uwaga: pola `repository`/`homepage`/`bugs` są opcjonalne — dodaj je dopiero, gdy projekt ma zdalne repo (dziś `git remote` jest puste). npm opublikuje pakiet bez nich.

- [ ] **Step 3: Dodaj sekcję instalacji do `README.md`**

Wstaw po nagłówku „# Agent Citadel" (przed „## Szybki start"):

```markdown
## Instalacja przez npm

Po publikacji pakiet uruchamia się bez instalacji:

```bash
npx ai-of-agents          # podgląda sesje z ~/.claude/projects, wypisuje URL
npx ai-of-agents --demo   # tryb demo (sztuczne dane)
npx ai-of-agents --open   # dodatkowo otwiera przeglądarkę
```

Albo globalnie (komendy `ai-of-agents` i krótszy alias `aioa`):

```bash
npm i -g ai-of-agents
aioa --open
```
```

- [ ] **Step 4: Weryfikacja zawartości tarballa (bez publikacji)**

Run: `npm run build && npm pack --dry-run 2>&1 | grep -E "dist/|LICENSE|README" | head -40`
Expected: lista zawiera `dist/cli.js`, `dist/web/index.html`, `dist/web/assets/...`, `LICENSE`, `README.md` — i **nie** zawiera `packages/`, `docs/`, `scripts/`, `node_modules`.

- [ ] **Step 5: Weryfikacja, że pakiet nie ciągnie `@agent-citadel/*`**

Run: `node -e "const p=require('./package.json'); const d={...p.dependencies}; console.log(Object.keys(d).some(k=>k.startsWith('@agent-citadel'))?'BŁĄD: wewn. dep w dependencies':'OK: brak wewn. deps')"`
Expected: `OK: brak wewn. deps` (bundlujemy `shared` do `dist/cli.js`).

- [ ] **Step 6: Commit**

```bash
git add package.json LICENSE README.md package-lock.json
git commit -m "chore(publish): metadane ai-of-agents, bin/files, MIT, README"
```

---

## Publikacja (operacyjne — poza kodem, robi użytkownik)

Te kroki wymagają konta npm i NIE są częścią automatycznego wykonania planu (zwłaszcza `npm publish` jest nieodwracalny):

1. `npm login` (dziś `npm whoami` → brak auth).
2. `npm publish --access public` (odpali `prepublishOnly` = build + testy).
3. Weryfikacja: `npm view ai-of-agents` oraz w czystym katalogu `npx ai-of-agents@latest --demo --port 8150`.

---

## Self-Review (wykonane przy pisaniu planu)

**Pokrycie specu:**
- Kształt pakietu (1 pakiet, `shared` bundlowany, brak `@agent-citadel/*` w deps) → Task 5, Step 5.
- Build (Vite→dist/web, esbuild→cli.js, external 4 deps) → Task 4.
- Runtime/komenda (`bin` ×2, flagi `--demo/--port/--open/--help`, URL, fallback portu, static na jednym porcie) → Task 1 (static), Task 3 (CLI), Task 4 (bundle).
- Metadane (name, zdjęte private, license MIT, files, prepublishOnly, flyctl→devDeps) → Task 5.
- Ryzyka ze specu: dynamiczne `import()` (zachowane w `server.ts`, bundlowane przez esbuild — smoke test Task 4 Step 6); ścieżki względem `import.meta.url` (Task 3, `webRoot`); `chokidar`/`@fastify/static`/`ws`/`fastify` jako external (Task 4 Step 3); SPA fallback (Task 1 + test Task 2).

**Placeholdery:** brak — `repository` świadomie pominięte (puste `git remote`), nie jako TODO lecz jako pole opcjonalne z notą.

**Spójność typów/nazw:** `startServer(StartServerOptions) → RunningServer{url,port,close}` używane identycznie w `index.ts`, `cli.ts` i testach. `parseArgs → CliOptions{port,demo,open,help}` zgodne z użyciem w `cli.ts` i testach. Stała portu jedna (`SERVER_PORT` z `shared`) — bez duplikatów.
