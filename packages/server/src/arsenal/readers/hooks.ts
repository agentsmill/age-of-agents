import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ArsenalHook, ArsenalOrigin } from '@agent-citadel/shared';

interface Opts { workingDir: string; homeDir: string; }

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function flattenHooks(settings: Record<string, unknown> | null, origin: ArsenalOrigin): ArsenalHook[] {
  const hooks = settings?.hooks;
  if (!hooks || typeof hooks !== 'object') return [];
  const out: ArsenalHook[] = [];
  for (const [event, groups] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const inner = (group as { hooks?: unknown })?.hooks;
      if (!Array.isArray(inner)) continue;
      for (const h of inner) {
        const command = (h as { command?: unknown })?.command;
        if (typeof command === 'string' && command.trim()) out.push({ event, command, origin });
      }
    }
  }
  return out;
}

/** Hooki: projekt (settings.json + settings.local.json) ∪ user (~/.claude/settings.json),
 *  dedup po event+command. */
export async function readHooks({ workingDir, homeDir }: Opts): Promise<ArsenalHook[]> {
  const [proj, projLocal, user] = await Promise.all([
    readJson(path.join(workingDir, '.claude', 'settings.json')),
    readJson(path.join(workingDir, '.claude', 'settings.local.json')),
    readJson(path.join(homeDir, '.claude', 'settings.json')),
  ]);
  const all = [
    ...flattenHooks(proj, 'project'),
    ...flattenHooks(projLocal, 'project'),
    ...flattenHooks(user, 'user'),
  ];
  const seen = new Set<string>();
  const out: ArsenalHook[] = [];
  for (const h of all) {
    const key = `${h.event} ${h.command}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}
