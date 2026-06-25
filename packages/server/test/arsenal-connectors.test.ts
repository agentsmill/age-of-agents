import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConnectors } from '../src/arsenal/readers/connectors.js';

describe('readConnectors', () => {
  let home: string;
  let wd: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'ars-home-'));
    wd = await fs.mkdtemp(path.join(os.tmpdir(), 'ars-wd-'));
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });

  it('combines .mcp.json (project), global, and per-project entries from ~/.claude.json', async () => {
    await fs.writeFile(path.join(wd, '.mcp.json'), JSON.stringify({
      mcpServers: { localmcp: { command: 'node', args: ['s.js'] } },
    }));
    await fs.writeFile(path.join(home, '.claude.json'), JSON.stringify({
      mcpServers: { globalmcp: { type: 'http', url: 'https://x' } },
      projects: { [wd]: { mcpServers: { projmcp: { command: 'docker' } } } },
    }));

    const conns = await readConnectors({ workingDir: wd, homeDir: home });
    const byName = Object.fromEntries(conns.map((c) => [c.name, c]));
    expect(byName['localmcp']).toEqual({ name: 'localmcp', origin: 'project', transport: 'stdio' });
    expect(byName['globalmcp']).toEqual({ name: 'globalmcp', origin: 'user', transport: 'http' });
    expect(byName['projmcp']).toEqual({ name: 'projmcp', origin: 'project', transport: 'stdio' });
  });

  it('returns an empty list when configs are missing', async () => {
    expect(await readConnectors({ workingDir: wd, homeDir: home })).toEqual([]);
  });
});
