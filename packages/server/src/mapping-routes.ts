import type { FastifyInstance } from 'fastify';
import { DEFAULT_MAPPING, validateMapping, type MappingConfig } from '@agent-citadel/shared';
import { loadMappingConfig, saveMappingConfig } from './mapping-config.js';

export interface MappingRoutesOptions {
  /** true -> PUT writes to disk (source of truth); false (demo) -> only validate and echo. */
  persist: boolean;
  /** File path when persistent. Defaults to ~/.age-of-agents/tool-mapping.json. */
  mappingPath?: string;
  /** Called after a successful save (for example stats cache invalidation). */
  onSaved?: () => void;
}

/**
 * Registers GET/PUT /tool-mapping. Extracted from server.ts so the persistence
 * path (real mode) is testable through Fastify `inject` without starting the
 * full server (watchers, pollers).
 */
export function registerMappingRoutes(app: FastifyInstance, opts: MappingRoutesOptions): void {
  app.get('/tool-mapping', async () =>
    opts.persist ? loadMappingConfig(opts.mappingPath) : DEFAULT_MAPPING,
  );

  app.put('/tool-mapping', async (request, reply) => {
    if (!opts.persist) {
      // Demo: validate and return (echo), without touching the user's disk.
      const res = validateMapping(request.body);
      if (!res.ok) return reply.code(400).send({ error: res.error });
      return res.config;
    }
    try {
      const saved = await saveMappingConfig(request.body as MappingConfig, opts.mappingPath);
      opts.onSaved?.(); // let stats keep up with the new map
      return saved;
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'invalid config' });
    }
  });
}
