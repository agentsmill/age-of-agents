import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)); // kończy się '/'
const outfile = `${root}dist/cli.js`;

await build({
  entryPoints: [`${root}packages/server/src/cli.ts`],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Shebang dla pliku `bin`; cli.ts NIE ma własnego shebanga, by nie zdublować.
  banner: { js: '#!/usr/bin/env node' },
  // Deps z natywnymi/dynamicznymi require — zostają w node_modules konsumenta.
  external: ['fastify', '@fastify/static', 'ws', 'chokidar', 'better-sqlite3'],
  logLevel: 'info',
});

await chmod(outfile, 0o755);
console.log('✓ Serwer + CLI zbundlowane do dist/cli.js');
