import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ArsenalConnector, ArsenalOrigin } from '@agent-citadel/shared';

interface Opts { workingDir: string; homeDir: string; }

function inferTransport(cfg: unknown): ArsenalConnector['transport'] {
  if (!cfg || typeof cfg !== 'object') return undefined;
  const c = cfg as Record<string, unknown>;
  if (c.type === 'http' || c.type === 'sse') return c.type;
  if (typeof c.url === 'string') return 'http';
  if (typeof c.command === 'string') return 'stdio';
  return undefined;
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toConnectors(map: unknown, origin: ArsenalOrigin): ArsenalConnector[] {
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map as Record<string, unknown>).map(([name, cfg]) => ({
    name,
    origin,
    transport: inferTransport(cfg),
  }));
}

/** Effective connector set: .mcp.json (project) + ~/.claude.json (global=user, per-project=project),
 *  dedup by name with origin 'project' preferred. */
export async function readConnectors({ workingDir, homeDir }: Opts): Promise<ArsenalConnector[]> {
  const projectMcp = await readJson(path.join(workingDir, '.mcp.json'));
  const userJson = await readJson(path.join(homeDir, '.claude.json'));

  const fromProjectFile = toConnectors(projectMcp?.mcpServers, 'project');
  const fromGlobal = toConnectors(userJson?.mcpServers, 'user');
  const projects = (userJson?.projects as Record<string, { mcpServers?: unknown }> | undefined) ?? {};
  const fromPerProject = toConnectors(projects[workingDir]?.mcpServers, 'project');

  const seen = new Set<string>();
  const out: ArsenalConnector[] = [];
  // Order = origin preference: project first (file + per-project), then global.
  for (const c of [...fromProjectFile, ...fromPerProject, ...fromGlobal]) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    out.push(c);
  }
  return out;
}
