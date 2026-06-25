import type { FastifyInstance } from 'fastify';
import { validateLaunchRequest } from '@agent-citadel/shared';
import type { LiveSessionRegistry } from './sdk/sessions.js';

export interface SessionRoutesOptions { sessions: LiveSessionRegistry; }

/** Whether the server's env carries a credential the Agent SDK can authenticate with.
 *  The SDK does NOT read the interactive Claude Code login (Keychain / credentials
 *  file) — only these env vars. Without one, launches fail at first inference (401). */
function authConfigured(): boolean {
  const e = process.env;
  return !!(e.CLAUDE_CODE_OAUTH_TOKEN || e.ANTHROPIC_API_KEY || e.ANTHROPIC_AUTH_TOKEN || e.CLAUDE_CODE_USE_BEDROCK || e.CLAUDE_CODE_USE_VERTEX);
}

export function registerSessionRoutes(app: FastifyInstance, opts: SessionRoutesOptions): void {
  app.get('/sessions', async () => ({ available: await opts.sessions.available(), authConfigured: authConfigured(), sessions: opts.sessions.list() }));

  app.post('/sessions/launch', async (request, reply) => {
    const res = validateLaunchRequest(request.body);
    if (!res.ok) return reply.code(400).send({ error: res.error });
    if (!(await opts.sessions.available())) return reply.code(501).send({ error: 'Claude Agent SDK not installed' });
    try {
      return await opts.sessions.launch(res.value);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'launch failed' });
    }
  });

  app.post<{ Params: { id: string }; Body: { text?: string } }>('/sessions/:id/message', async (request, reply) => {
    const text = request.body?.text;
    if (typeof text !== 'string' || !text.trim()) return reply.code(400).send({ error: 'text required' });
    if (!opts.sessions.pushText(request.params.id, text)) return reply.code(404).send({ error: 'unknown session' });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/stop', async (request, reply) => {
    if (!(await opts.sessions.stop(request.params.id))) return reply.code(404).send({ error: 'unknown session' });
    return { ok: true };
  });
}
