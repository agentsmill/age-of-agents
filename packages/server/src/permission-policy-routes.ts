import type { FastifyInstance } from 'fastify';
import { DEFAULT_PERMISSION_POLICY, validatePermissionPolicy, type PermissionPolicy } from '@agent-citadel/shared';
import { loadPermissionPolicy, savePermissionPolicy } from './permission-policy.js';

export interface PermissionPolicyRoutesOptions {
  /** true -> PUT writes to disk (source of truth); false (demo) -> only validate and echo. */
  persist: boolean;
  /** File path when persistent. Defaults to ~/.age-of-agents/permission-policy.json. */
  policyPath?: string;
}

/**
 * Registers GET/PUT /permission-policy. Extracted from server.ts so the persistence
 * path (real mode) is testable through Fastify `inject` without starting the
 * full server (watchers, pollers).
 */
export function registerPermissionPolicyRoutes(app: FastifyInstance, opts: PermissionPolicyRoutesOptions): void {
  app.get('/permission-policy', async () =>
    opts.persist ? loadPermissionPolicy(opts.policyPath) : DEFAULT_PERMISSION_POLICY,
  );

  app.put('/permission-policy', async (request, reply) => {
    if (!opts.persist) {
      // Demo: validate and return (echo), without touching the user's disk.
      const res = validatePermissionPolicy(request.body);
      if (!res.ok) return reply.code(400).send({ error: res.error });
      return res.config;
    }
    try {
      return await savePermissionPolicy(request.body as PermissionPolicy, opts.policyPath);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'invalid policy' });
    }
  });
}
