import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ArsenalAgent, ArsenalOrigin } from '@agent-citadel/shared';
import { parseFrontmatter } from '../frontmatter.js';

interface Opts { workingDir: string; homeDir: string; }

async function readDir(agentsDir: string, origin: ArsenalOrigin): Promise<ArsenalAgent[]> {
  let entries;
  try {
    entries = await fs.readdir(agentsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ArsenalAgent[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    try {
      const fm = parseFrontmatter(await fs.readFile(path.join(agentsDir, e.name), 'utf8'));
      out.push({ name: fm.name ?? e.name.replace(/\.md$/, ''), description: fm.description, origin });
    } catch {
      // skip
    }
  }
  return out;
}

/** Subagenci: projekt (.claude/agents) ∪ user (~/.claude/agents), dedup po nazwie (projekt > user). */
export async function readAgents({ workingDir, homeDir }: Opts): Promise<ArsenalAgent[]> {
  const [project, user] = await Promise.all([
    readDir(path.join(workingDir, '.claude', 'agents'), 'project'),
    readDir(path.join(homeDir, '.claude', 'agents'), 'user'),
  ]);
  const seen = new Set<string>();
  const out: ArsenalAgent[] = [];
  for (const a of [...project, ...user]) {
    if (seen.has(a.name)) continue;
    seen.add(a.name);
    out.push(a);
  }
  return out;
}
