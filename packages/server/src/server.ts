import Fastify from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
import { WS_PATH, type GameEvent } from '@agent-citadel/shared';
import { World } from './world.js';
import { registerMappingRoutes } from './mapping-routes.js';
import { registerModelRoutes } from './model-routes.js';
import { OpenCodePoller } from './sources/opencode-poller.js';
import { DockerPoller } from './sources/docker-poller.js';
import { CliDockerClient } from './sources/docker-client.js';
import { ArsenalPoller } from './arsenal/arsenal-poller.js';

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
    // Mapa narzędzie→budynek: w demo nie persystujemy (PUT tylko waliduje, GET = domyślna).
    registerMappingRoutes(app, { persist: false });
    registerModelRoutes(app, { persist: false });
  } else {
    const { SourceWatcher } = await import('./watcher.js');
    const { SOURCES } = await import('./sources/index.js');
    const { translateHook, hooksInstalled, installHooks, uninstallHooks } = await import('./hooks.js');
    const { getBuildingStats, invalidateBuildingStatsCache } = await import('./building-stats.js');
    const watchers = SOURCES.map((source) => new SourceWatcher(world, source));
    // Hooki HTTP są kanałem Claude → kierujemy je do watchera Claude.
    const claudeWatcher = watchers.find((w) => w.id === 'claude') ?? watchers[0];
    
    // OpenCode używa SQLite zamiast JSONL - uruchom poller
    const opencodePoller = new OpenCodePoller(world);
    // Kontenery Docker: poller czyta pliki sesji przez `docker exec` (pull).
    const dockerPoller = new DockerPoller(world, new CliDockerClient());

    app.get('/building-stats', async () => getBuildingStats());
    // Mapa narzędzie→budynek: lokalny serwer = źródło prawdy (plik na dysku usera);
    // zapis invaliduje cache statystyk, by liczby nadążały za nową mapą.
    registerMappingRoutes(app, { persist: true, onSaved: invalidateBuildingStatsCache });
    registerModelRoutes(app, { persist: true });
    app.post('/hooks', async (request) => {
      const translated = translateHook((request.body ?? {}) as never);
      if (translated) claudeWatcher.applyExternalFacts(translated.sessionId, translated.projectDir, translated.facts, translated.cwd);
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
      for (const w of watchers) w.start();
      await opencodePoller.start();
      // Świadomie `void` — start pollera nie może opóźniać gotowości serwera;
      // poller sam jest odporny na brak Dockera.
      void dockerPoller.start();
      // `arsenal-updated` event do klienta (panel Arsenału).
      new ArsenalPoller(world).start();
      app.log.info(`Source watchers active: ${watchers.map((w) => w.id).join(', ')}`);
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
    if (socket.readyState !== WebSocket.OPEN) return;
    // Klient mógł zniknąć w trakcie broadcastu — jego awaria nie może przerwać
    // dostawy do pozostałych.
    try {
      socket.send(JSON.stringify(event));
    } catch (err) {
      app.log.warn({ err }, 'WS send failed — skipping this client');
    }
  };

  wss.on('connection', (socket) => {
    send(socket, { type: 'snapshot', ...world.snapshot() });
  });
  const offEvent = world.onEvent((event) => {
    for (const socket of wss.clients) send(socket, event);
  });

  if (opts.demo) {
    const { startDemo } = await import('./demo/scenario.js');
    startDemo(world);
  }

  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}`;
  return {
    url,
    port: actualPort,
    close: async () => {
      offEvent();
      await new Promise<void>((resolve, reject) =>
        wss.close((err) => (err ? reject(err) : resolve())),
      );
      await app.close();
    },
  };
}
