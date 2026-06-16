import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSkills, pluginNameFromPath } from '../src/arsenal/readers/skills.js';

async function writeSkill(dir: string, name: string, description: string) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}`);
}

describe('readSkills', () => {
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

  it('czyta skille z projektu, usera i pluginu z tagiem origin', async () => {
    await writeSkill(path.join(wd, '.claude', 'skills', 'local-skill'), 'local-skill', 'projektowy');
    await writeSkill(path.join(home, '.claude', 'skills', 'user-skill'), 'user-skill', 'userowy');
    await writeSkill(path.join(home, '.claude', 'plugins', 'cache', 'mkt', 'superpowers', '5.1.0', 'skills', 'brainstorming'), 'brainstorming', 'pluginowy');

    const skills = await readSkills({ workingDir: wd, homeDir: home });
    const byId = Object.fromEntries(skills.map((s) => [s.id, s]));
    expect(byId['local-skill'].origin).toBe('project');
    expect(byId['user-skill'].origin).toBe('user');
    expect(byId['brainstorming'].origin).toBe('plugin');
    expect(byId['brainstorming'].pluginName).toBe('superpowers');
    expect(byId['user-skill'].description).toBe('userowy');
  });

  it('zwraca pustą listę gdy nic nie ma', async () => {
    expect(await readSkills({ workingDir: wd, homeDir: home })).toEqual([]);
  });

  it('pluginNameFromPath pomija segment wersji', () => {
    expect(pluginNameFromPath('/x/plugins/cache/mkt/superpowers/5.1.0/skills/foo/SKILL.md')).toBe('superpowers');
    expect(pluginNameFromPath('/x/plugins/frontend-design/skills/foo/SKILL.md')).toBe('frontend-design');
  });
});
