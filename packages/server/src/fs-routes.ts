import type { FastifyInstance } from 'fastify';
import { readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';

/** Lists immediate subdirectories of an absolute path (folder picker). Local-only server. */
export function registerFsRoutes(app: FastifyInstance): void {
  app.get('/fs/list', async (request, reply) => {
    const raw = (request.query as { dir?: string }).dir;
    const dir = raw && isAbsolute(raw) ? raw : homedir();
    try {
      const dirents = await readdir(dir, { withFileTypes: true });
      const entries = dirents
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => ({ name: d.name, path: join(dir, d.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { dir, parent: dir === '/' ? null : join(dir, '..'), entries };
    } catch {
      return reply.code(400).send({ error: 'cannot read directory' });
    }
  });
}
