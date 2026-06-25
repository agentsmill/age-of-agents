import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { DEFAULT_MAPPING, validateMapping, type MappingConfig } from '@agent-citadel/shared';

/**
 * Persistence for the editable tool-to-building map. The local server is the
 * source of truth: a file on the user's disk (`~/.age-of-agents/tool-mapping.json`).
 * Missing or damaged files fall back to DEFAULT_MAPPING so the server never crashes.
 * Token attribution (building-stats) reads the same source, so stats honor user edits.
 *
 * Cache is keyed by path, so tests using separate temp files do not overlap, and
 * `saveMappingConfig` refreshes the cache for its path immediately.
 */

export function defaultMappingPath(): string {
  return join(homedir(), '.age-of-agents', 'tool-mapping.json');
}

const cache = new Map<string, MappingConfig>();

export function invalidateMappingCache(): void {
  cache.clear();
}

export async function loadMappingConfig(path = defaultMappingPath()): Promise<MappingConfig> {
  const hit = cache.get(path);
  if (hit) return hit;

  let config: MappingConfig = DEFAULT_MAPPING;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const res = validateMapping(parsed);
    if (res.ok) config = res.config;
  } catch {
    /* missing file / bad JSON -> DEFAULT_MAPPING */
  }
  cache.set(path, config);
  return config;
}

export async function saveMappingConfig(
  config: MappingConfig,
  path = defaultMappingPath(),
): Promise<MappingConfig> {
  const res = validateMapping(config);
  if (!res.ok) throw new Error(res.error);

  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(res.config, null, 2), 'utf8');
  await rename(tmp, path); // atomic write: rename does not leave a partial file
  cache.set(path, res.config);
  return res.config;
}
