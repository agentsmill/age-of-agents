import Fastify from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
import { WS_PATH, type GameEvent, validateQuestionAnswer } from '@agent-citadel/shared';
import { World } from './world.js';
import { registerMappingRoutes } from './mapping-routes.js';
import { registerModelRoutes } from './model-routes.js';
import { OpenCodePoller } from './sources/opencode-poller.js';
import { MimoCodePoller } from './sources/mimocode-poller.js';
import { AuggiePoller } from './sources/auggie-poller.js';
import { DockerPoller } from './sources/docker-poller.js';
import { CliDockerClient } from './sources/docker-client.js';
import { ArsenalPoller } from './arsenal/arsenal-poller.js';
import type { SourceWatcher } from './watcher.js';
import { PendingRegistry } from './pending-registry.js';
import { registerPermissionPolicyRoutes } from './permission-policy-routes.js';
import { LiveSessionRegistry } from './sdk/sessions.js';
import { registerSessionRoutes } from './session-routes.js';
import { registerFsRoutes } from './fs-routes.js';
import { loadOrCreateToken } from './security/token.js';
import { registerSecurityGuard, verifyWsClient } from './security/guard.js';
import { TranscriptStore } from './transcript/store.js';

export interface StartServerOptions {
  /** HTTP port. Pass 0 so the system picks a free one (useful in tests). */
  port: number;
  host?: string;
  /** Demo mode: synthetic data instead of watching ~/.claude/projects. */
  demo: boolean;
  /** Katalog ze zbudowanym klientem (dist/web). Gdy podany — serwer serwuje SPA. */
  webRoot?: string;
  /** Override permission-policy file path (tests). Defaults to ~/.age-of-agents. */
  policyPath?: string;
  /** Override session-token file path (tests). Defaults to ~/.age-of-agents/session-token. */
  tokenPath?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  token: string;
  close: () => Promise<void>;
}

export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  const host = opts.host ?? '127.0.0.1';
  const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
  if (!LOOPBACK.has(host) && process.env.AOA_ALLOW_REMOTE !== '1') {
    throw new Error(
      `Refusing to bind to non-loopback host "${host}": the server has no transport ` +
      `encryption and is meant for local use. Set AOA_ALLOW_REMOTE=1 to override.`,
    );
  }
  const app = Fastify({ logger: { level: 'info' } });
  if (!LOOPBACK.has(host)) app.log.warn(`Binding to non-loopback host ${host} (AOA_ALLOW_REMOTE=1)`);
  const token = await loadOrCreateToken(opts.tokenPath);
  let resolvedPort = opts.port;
  registerSecurityGuard(app, { getPort: () => resolvedPort, token });
  const world = new World();
  const pendingRegistry = new PendingRegistry(world);
  // Transcript persistence (optional — requires better-sqlite3).
  const transcriptStore = new TranscriptStore();
  world.transcriptStore = transcriptStore;
  world.onEvent((event) => {
    if (event.type === 'hero-removed') pendingRegistry.cancelForSession(event.sessionId);
  });
  let watchers: SourceWatcher[] = [];
  let opencodePoller: OpenCodePoller | undefined;
  let mimocodePoller: MimoCodePoller | undefined;
  let auggiePoller: AuggiePoller | undefined;
  let dockerPoller: DockerPoller | undefined;
  let arsenalPoller: ArsenalPoller | undefined;
  let liveSessions: LiveSessionRegistry | undefined;

  app.get('/health', async () => ({ ok: true, demo: opts.demo }));

  // Transcript replay API — returns persisted transcript lines for a session.
  app.get('/sessions/:id/transcript', async (request) => {
    const { id } = request.params as { id: string };
    const limit = Number((request.query as Record<string, string>).limit) || 500;
    return transcriptStore.query(id, limit);
  });

  if (opts.demo) {
    // No-op routes so installed hooks do not emit 404s in demo mode.
    app.post('/hooks', async () => ({ ok: true }));
    app.get('/hooks/status', async () => ({ installed: false, demo: true }));
    app.get('/building-stats', async () => ({ updatedAt: new Date().toISOString(), buildings: {} }));
    // Tool->building map: demo does not persist (PUT only validates, GET = default).
    registerMappingRoutes(app, { persist: false });
    registerModelRoutes(app, { persist: false });
    app.post('/hooks/decide', async () => ({}));
    registerPermissionPolicyRoutes(app, { persist: false });
    const { FakeSdkRunner } = await import('./sdk/fake-runner.js');
    liveSessions = new LiveSessionRegistry(new FakeSdkRunner(), (sessionId) => world.emitCustom({ type: 'sdk-session-started', sessionId }));
    registerSessionRoutes(app, { sessions: liveSessions });
    registerFsRoutes(app);
  } else {
    const { SourceWatcher } = await import('./watcher.js');
    const { activeSources } = await import('./sources/index.js');
    const { translateHook, hooksStatus, installHooks, uninstallHooks, DECIDE_TIMEOUT_SEC } = await import('./hooks.js');
    const { getBuildingStats, invalidateBuildingStatsCache } = await import('./building-stats.js');
    const sources = activeSources(process.env.AOA_SOURCES);
    watchers = sources.map((source) => new SourceWatcher(world, source));
    // HTTP hooks are the Claude channel; route them to the Claude watcher.
    const claudeWatcher = watchers.find((w) => w.id === 'claude');
    
    // OpenCode uses SQLite instead of JSONL: start poller.
    const opencodeEnabled = sources.some((source) => source.id === 'opencode');
    opencodePoller = opencodeEnabled ? new OpenCodePoller(world) : undefined;
    // MiMo Code (OpenCode fork) also uses SQLite: start poller.
    const mimocodeEnabled = sources.some((source) => source.id === 'mimocode');
    mimocodePoller = mimocodeEnabled ? new MimoCodePoller(world) : undefined;
    // Auggie uses JSON files: start file watcher poller.
    const auggieEnabled = sources.some((source) => source.id === 'auggie');
    auggiePoller = auggieEnabled ? new AuggiePoller(world) : undefined;
    // Containerized Claude sessions are controlled by the Claude source filter.
    const dockerEnabled = sources.some((source) => source.id === 'claude');
    dockerPoller = dockerEnabled ? new DockerPoller(world, new CliDockerClient()) : undefined;

    app.get('/building-stats', async () => getBuildingStats());
    // Tool->building map: local server = source of truth (file on user's disk);
    // saving invalidates stats cache so numbers keep up with the new map.
    registerMappingRoutes(app, { persist: true, onSaved: invalidateBuildingStatsCache });
    registerModelRoutes(app, { persist: true });
    const { decideHook } = await import('./hook-decide.js');
    const { loadPermissionPolicy, addPolicyRule } = await import('./permission-policy.js');
    registerPermissionPolicyRoutes(app, { persist: true, policyPath: opts.policyPath });
    const { RealSdkRunner } = await import('./sdk/real-runner.js');
    liveSessions = new LiveSessionRegistry(new RealSdkRunner(pendingRegistry, (DECIDE_TIMEOUT_SEC - 10) * 1000), (sessionId) => world.emitCustom({ type: 'sdk-session-started', sessionId }));
    registerSessionRoutes(app, { sessions: liveSessions });
    registerFsRoutes(app);

    app.post('/hooks/decide', async (request) => {
      const body = (request.body ?? {}) as never;
      // Animate the tool like the regular /hooks channel does.
      const translated = translateHook(body);
      if (translated && claudeWatcher) {
        claudeWatcher.applyExternalFacts(translated.sessionId, translated.projectDir, translated.facts, translated.cwd);
      }
      const policy = await loadPermissionPolicy(opts.policyPath);
      return decideHook(body, {
        policy,
        registry: pendingRegistry,
        timeoutMs: (DECIDE_TIMEOUT_SEC - 10) * 1000,
        onAlwaysRule: async (rule) => { await addPolicyRule(rule, opts.policyPath); },
      });
    });
    app.post('/hooks', async (request, reply) => {
      const translated = translateHook((request.body ?? {}) as never);
      if (translated) {
        if (!claudeWatcher) return reply.code(409).send({ ok: false, error: 'claude source disabled' });
        claudeWatcher.applyExternalFacts(translated.sessionId, translated.projectDir, translated.facts, translated.cwd);
      }
      return { ok: true };
    });
    app.get('/hooks/status', async () => hooksStatus());
    app.post('/hooks/install', async () => {
      await installHooks();
      return { ok: true, installed: true };
    });
    app.post('/hooks/uninstall', async () => {
      await uninstallHooks();
      return { ok: true, installed: false };
    });

    app.addHook('onReady', async () => {
      await transcriptStore.open();
      for (const w of watchers) w.start();
      await opencodePoller?.start();
      await mimocodePoller?.start();
      void auggiePoller?.start();
      // Fire-and-forget: Docker unavailability must not delay server readiness.
      void dockerPoller?.start();
      // `arsenal-updated` event to client (Arsenal panel).
      arsenalPoller = new ArsenalPoller(world);
      arsenalPoller.start();
      app.log.info(`Source watchers active: ${watchers.map((w) => w.id).join(', ')}`);
    });
  }

  // Issued only to allowlisted origins (the guard rejects foreign Origins first).
  app.get('/session-token', async () => ({ token }));

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
  resolvedPort = actualPort;

  const wss = new WebSocketServer({
    server: app.server,
    path: WS_PATH,
    verifyClient: (info) =>
      verifyWsClient({ origin: info.origin, reqUrl: info.req.url }, resolvedPort, token),
  });

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
    for (const q of pendingRegistry.open()) send(socket, { type: 'pending-question', question: q });
    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as { type?: string; payload?: unknown };
        if (msg.type === 'answer') {
          const res = validateQuestionAnswer(msg.payload);
          if (res.ok) pendingRegistry.resolve(res.answer);
        }
      } catch {
        /* ignore malformed client messages */
      }
    });
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
    token,
    close: async () => {
      offEvent();
      await liveSessions?.stopAll();
      transcriptStore.close();
      await opencodePoller?.stop();
      await mimocodePoller?.stop();
      await auggiePoller?.stop();
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
