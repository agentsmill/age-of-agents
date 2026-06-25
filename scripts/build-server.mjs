import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)); // ends with '/'
const outfile = `${root}dist/cli.js`;

await build({
  entryPoints: [`${root}packages/server/src/cli.ts`],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Shebang for the `bin` file; cli.ts has no own shebang to avoid duplication.
  banner: { js: '#!/usr/bin/env node' },
  // Dependencies with native/dynamic require stay in the consumer's node_modules.
  // The Claude Agent SDK is an OPTIONAL dependency loaded via dynamic import — keep
  // it external so it is not inlined; without it installed, launch degrades to 501.
  external: ['fastify', '@fastify/static', 'ws', 'chokidar', 'better-sqlite3', '@anthropic-ai/claude-agent-sdk'],
  logLevel: 'info',
});

await chmod(outfile, 0o755);
console.log('✓ Server + CLI bundled to dist/cli.js');
