import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readHooks } from '../src/arsenal/readers/hooks.js';

describe('readHooks', () => {
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

  it('flattens project hooks (event+command, origin)', async () => {
    await fs.mkdir(path.join(wd, '.claude'), { recursive: true });
    await fs.writeFile(path.join(wd, '.claude', 'settings.json'), JSON.stringify({
      hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'bd prime' }] }] },
    }));
    const hooks = await readHooks({ workingDir: wd, homeDir: home });
    expect(hooks).toEqual([{ event: 'SessionStart', command: 'bd prime', origin: 'project' }]);
  });

  it('returns an empty list when settings are missing', async () => {
    expect(await readHooks({ workingDir: wd, homeDir: home })).toEqual([]);
  });
});
