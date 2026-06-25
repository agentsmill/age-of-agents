import type { FastifyInstance } from 'fastify';
import { readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

/** True when `target` is the root or nested inside it (after resolving `..`). */
function isWithin(root: string, target: string): boolean {
  const r = resolve(root);
  const t = resolve(target);
  return t === r || t.startsWith(r + sep);
}

/**
 * Lists immediate subdirectories of an absolute path (folder picker). Confined
 * to `allowedRoot` (the home subtree by default) so it cannot enumerate the
 * whole filesystem. Local-only server.
 */
export function registerFsRoutes(app: FastifyInstance, opts: { allowedRoot?: string } = {}): void {
  const root = resolve(opts.allowedRoot ?? homedir());
  app.get('/fs/list', async (request, reply) => {
    const raw = (request.query as { dir?: string }).dir;
    const dir = raw && isAbsolute(raw) ? resolve(raw) : root;
    if (!isWithin(root, dir)) return reply.code(400).send({ error: 'path outside allowed root' });
    try {
      const dirents = await readdir(dir, { withFileTypes: true });
      const entries = dirents
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => ({ name: d.name, path: join(dir, d.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { dir, parent: dir === root ? null : join(dir, '..'), entries };
    } catch {
      return reply.code(400).send({ error: 'cannot read directory' });
    }
  });
}
