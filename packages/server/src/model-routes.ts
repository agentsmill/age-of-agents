import type { FastifyInstance } from 'fastify';
import { DEFAULT_MODEL_CONFIG, validateModelConfig, type ModelConfig } from '@agent-citadel/shared';
import { loadModelConfig, saveModelConfig } from './model-config.js';

export interface ModelRoutesOptions {
  /** true → PUT zapisuje na dysk; false (demo) → tylko waliduje i echo. */
  persist: boolean;
  /** File path when persistent. Defaults to ~/.age-of-agents/model-config.json. */
  modelConfigPath?: string;
}

/**
 * Registers GET/PUT /model-config. Twin of registerMappingRoutes, but WITHOUT
 * onSaved: context window is used only on the client, so the server has no cache
 * dependent on the registry. PUT simply saves.
 */
export function registerModelRoutes(app: FastifyInstance, opts: ModelRoutesOptions): void {
  app.get('/model-config', async () =>
    opts.persist ? loadModelConfig(opts.modelConfigPath) : DEFAULT_MODEL_CONFIG,
  );

  app.put('/model-config', async (request, reply) => {
    if (!opts.persist) {
      const res = validateModelConfig(request.body);
      if (!res.ok) return reply.code(400).send({ error: res.error });
      return res.config;
    }
    try {
      return await saveModelConfig(request.body as ModelConfig, opts.modelConfigPath);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'invalid config' });
    }
  });
}
