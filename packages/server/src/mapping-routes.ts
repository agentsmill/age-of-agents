import type { FastifyInstance } from 'fastify';
import { DEFAULT_MAPPING, validateMapping, type MappingConfig } from '@agent-citadel/shared';
import { loadMappingConfig, saveMappingConfig } from './mapping-config.js';

export interface MappingRoutesOptions {
  /** true → PUT zapisuje na dysk (źródło prawdy); false (demo) → tylko waliduje i echo. */
  persist: boolean;
  /** Ścieżka pliku gdy persist. Domyślnie ~/.age-of-agents/tool-mapping.json. */
  mappingPath?: string;
  /** Wołane po udanym zapisie (np. invalidacja cache statystyk). */
  onSaved?: () => void;
}

/**
 * Rejestruje GET/PUT /tool-mapping. Wydzielone z server.ts, by ścieżka
 * persystencji (realny tryb) była testowalna przez Fastify `inject` bez
 * uruchamiania pełnego serwera (watchery, pollery).
 */
export function registerMappingRoutes(app: FastifyInstance, opts: MappingRoutesOptions): void {
  app.get('/tool-mapping', async () =>
    opts.persist ? loadMappingConfig(opts.mappingPath) : DEFAULT_MAPPING,
  );

  app.put('/tool-mapping', async (request, reply) => {
    if (!opts.persist) {
      // Demo: waliduj i zwróć (echo), bez dotykania dysku usera.
      const res = validateMapping(request.body);
      if (!res.ok) return reply.code(400).send({ error: res.error });
      return res.config;
    }
    try {
      const saved = await saveMappingConfig(request.body as MappingConfig, opts.mappingPath);
      opts.onSaved?.(); // statystyki niech nadążą za nową mapą
      return saved;
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'niepoprawny config' });
    }
  });
}
