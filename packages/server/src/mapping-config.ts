import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { DEFAULT_MAPPING, validateMapping, type MappingConfig } from '@agent-citadel/shared';

/**
 * Trwałość edytowalnej mapy narzędzie→budynek. Lokalny serwer = źródło prawdy:
 * plik na dysku usera (`~/.age-of-agents/tool-mapping.json`). Brak/uszkodzony plik
 * → DEFAULT_MAPPING (serwer nigdy się nie wywala). Atrybucja tokenów
 * (building-stats) czyta TO SAMO źródło, więc statystyki honorują zmiany usera.
 *
 * Cache keyowany ścieżką — testy z osobnymi tmp-plikami się nie zazębiają, a
 * `saveMappingConfig` od razu odświeża cache dla swojej ścieżki.
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
    /* brak pliku / zły JSON → DEFAULT_MAPPING */
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
  await rename(tmp, path); // zapis atomowy: rename nie zostawia połowicznego pliku
  cache.set(path, res.config);
  return res.config;
}
