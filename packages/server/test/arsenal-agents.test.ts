import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAgents } from '../src/arsenal/readers/agents.js';

describe('readAgents', () => {
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

  it('czyta agentów z .claude/agents (projekt) i frontmatter', async () => {
    await fs.mkdir(path.join(wd, '.claude', 'agents'), { recursive: true });
    await fs.writeFile(path.join(wd, '.claude', 'agents', 'reviewer.md'), `---\nname: code-reviewer\ndescription: Recenzuje\n---\n# x`);
    const agents = await readAgents({ workingDir: wd, homeDir: home });
    expect(agents).toEqual([{ name: 'code-reviewer', description: 'Recenzuje', origin: 'project' }]);
  });

  it('fallback nazwy = plik bez .md gdy brak frontmattera', async () => {
    await fs.mkdir(path.join(home, '.claude', 'agents'), { recursive: true });
    await fs.writeFile(path.join(home, '.claude', 'agents', 'planner.md'), `# bez frontmattera`);
    const agents = await readAgents({ workingDir: wd, homeDir: home });
    expect(agents).toEqual([{ name: 'planner', description: undefined, origin: 'user' }]);
  });
});
