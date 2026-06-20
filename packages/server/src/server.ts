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
import type { SourceWatcher } from './watcher.js';

export interface StartServerOptions {
  /** HTTP port. Pass 0 so the system picks a free one (useful in tests). */
  port: number;
  host?: string;
  /** Demo mode: synthetic data instead of watching ~/.claude/projects. */
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
  let watchers: SourceWatcher[] = [];
  let opencodePoller: OpenCodePoller | undefined;
  let dockerPoller: DockerPoller | undefined;
  let arsenalPoller: ArsenalPoller | undefined;

  app.get('/health', async () => ({ ok: true, demo: opts.demo }));

  if (opts.demo) {
    // No-op routes so installed hooks do not emit 404s in demo mode.
    app.post('/hooks', async () => ({ ok: true }));
    app.get('/hooks/status', async () => ({ installed: false, demo: true }));
    app.get('/building-stats', async () => ({ updatedAt: new Date().toISOString(), buildings: {} }));
    // Tool->building map: demo does not persist (PUT only validates, GET = default).
    registerMappingRoutes(app, { persist: false });
    registerModelRoutes(app, { persist: false });
  } else {
    const { SourceWatcher } = await import('./watcher.js');
    const { activeSources } = await import('./sources/index.js');
    const { translateHook, hooksInstalled, installHooks, uninstallHooks } = await import('./hooks.js');
    const { getBuildingStats, invalidateBuildingStatsCache } = await import('./building-stats.js');
    const sources = activeSources(process.env.AOA_SOURCES);
    watchers = sources.map((source) => new SourceWatcher(world, source));
    // HTTP hooks are the Claude channel; route them to the Claude watcher.
    const claudeWatcher = watchers.find((w) => w.id === 'claude');
    
    // OpenCode uses SQLite instead of JSONL: start poller.
    const opencodeEnabled = sources.some((source) => source.id === 'opencode');
    opencodePoller = opencodeEnabled ? new OpenCodePoller(world) : undefined;
    // Containerized Claude sessions are controlled by the Claude source filter.
    const dockerEnabled = sources.some((source) => source.id === 'claude');
    dockerPoller = dockerEnabled ? new DockerPoller(world, new CliDockerClient()) : undefined;

    app.get('/building-stats', async () => getBuildingStats());
    // Tool->building map: local server = source of truth (file on user's disk);
    // saving invalidates stats cache so numbers keep up with the new map.
    registerMappingRoutes(app, { persist: true, onSaved: invalidateBuildingStatsCache });
    registerModelRoutes(app, { persist: true });
    app.post('/hooks', async (request, reply) => {
      const translated = translateHook((request.body ?? {}) as never);
      if (translated) {
        if (!claudeWatcher) return reply.code(409).send({ ok: false, error: 'claude source disabled' });
        claudeWatcher.applyExternalFacts(translated.sessionId, translated.projectDir, translated.facts, translated.cwd);
      }
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
      await opencodePoller?.start();
      // Fire-and-forget: Docker unavailability must not delay server readiness.
      void dockerPoller?.start();
      // `arsenal-updated` event to client (Arsenal panel).
      arsenalPoller = new ArsenalPoller(world);
      arsenalPoller.start();
      app.log.info(`Source watchers active: ${watchers.map((w) => w.id).join(', ')}`);
    });
  }

  // Serwowanie zbudowanego klienta — tylko w dystrybucji; w dev robi to Vite.
  if (opts.webRoot) {
    const fastifyStatic = (await import('@fastify/static')).default;
    await app.register(fastifyStatic, { root: opts.webRoot, wildcard: false });
    // SPA fallback: unknown GET route -> index.html (API routes are registered,
    // so they will not land here).
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
    // Client may disappear during broadcast; its failure must not interrupt
    // delivery to the others.
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
      await opencodePoller?.stop();
      dockerPoller?.stop();
      await Promise.all(watchers.map((w) => w.stop()));
      arsenalPoller?.stop();
      await new Promise<void>((resolve, reject) =>
        wss.close((err) => (err ? reject(err) : resolve())),
      );
      await app.close();
    },
  };
}
