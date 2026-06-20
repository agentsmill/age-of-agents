import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ArsenalSkill, ArsenalOrigin } from '@agent-citadel/shared';
import { parseFrontmatter } from '../frontmatter.js';

interface Opts { workingDir: string; homeDir: string; }

/** Plugin name from SKILL.md path: segment just before `/skills/`; if that is a
 *  version (for example '5.1.0'), use the previous segment. */
export function pluginNameFromPath(filePath: string): string {
  const parts = filePath.split(path.sep).filter(Boolean);
  const si = parts.lastIndexOf('skills');
  if (si <= 0) return 'plugin';
  let i = si - 1;
  if (/^\d+\.\d+/.test(parts[i] ?? '')) i -= 1;
  return parts[i] ?? 'plugin';
}

/** Skille z jednego katalogu „skills/<name>/SKILL.md" (jeden poziom). */
async function readOneLevel(skillsDir: string, origin: ArsenalOrigin): Promise<ArsenalSkill[]> {
  let entries;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ArsenalSkill[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(skillsDir, e.name, 'SKILL.md');
    try {
      const fm = parseFrontmatter(await fs.readFile(file, 'utf8'));
      out.push({ id: fm.name ?? e.name, description: fm.description, origin });
    } catch {
      // no SKILL.md in this subdirectory: skip
    }
  }
  return out;
}

/** Skills from plugin tree (recursively search for SKILL.md files). */
async function readPlugins(pluginsRoot: string): Promise<ArsenalSkill[]> {
  let files: string[] = [];
  try {
    const dirents = await fs.readdir(pluginsRoot, { recursive: true, withFileTypes: true });
    files = dirents
      .filter((d) => d.isFile() && d.name === 'SKILL.md' && !d.parentPath.includes(`${path.sep}node_modules${path.sep}`))
      .map((d) => path.join(d.parentPath, d.name));
  } catch {
    return [];
  }
  const out: ArsenalSkill[] = [];
  for (const file of files) {
    try {
      const fm = parseFrontmatter(await fs.readFile(file, 'utf8'));
      out.push({
        id: fm.name ?? path.basename(path.dirname(file)),
        description: fm.description,
        origin: 'plugin',
        pluginName: pluginNameFromPath(file),
      });
    } catch {
      // skip broken file
    }
  }
  return out;
}

/** Effective skill set: project + user + plugin, deduped by id (project > user > plugin). */
export async function readSkills({ workingDir, homeDir }: Opts): Promise<ArsenalSkill[]> {
  const [project, user, plugin] = await Promise.all([
    readOneLevel(path.join(workingDir, '.claude', 'skills'), 'project'),
    readOneLevel(path.join(homeDir, '.claude', 'skills'), 'user'),
    readPlugins(path.join(homeDir, '.claude', 'plugins')),
  ]);
  const seen = new Set<string>();
  const out: ArsenalSkill[] = [];
  for (const s of [...project, ...user, ...plugin]) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}
