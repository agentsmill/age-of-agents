import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { DEFAULT_MODEL_CONFIG, upgradeModelConfig, validateModelConfig, type ModelConfig } from '@agent-citadel/shared';

/**
 * Persistence for the editable model registry. The local server is the source of
 * truth: `~/.age-of-agents/model-config.json`. Missing or damaged files fall back
 * to DEFAULT so the server never crashes. Sibling to mapping-config.ts. Cache is
 * keyed by path.
 */
export function defaultModelConfigPath(): string {
  return join(homedir(), '.age-of-agents', 'model-config.json');
}

const cache = new Map<string, ModelConfig>();

export function invalidateModelConfigCache(): void {
  cache.clear();
}

export async function loadModelConfig(path = defaultModelConfigPath()): Promise<ModelConfig> {
  const hit = cache.get(path);
  if (hit) return hit;

  let config: ModelConfig = DEFAULT_MODEL_CONFIG;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const res = validateModelConfig(parsed);
    if (res.ok) config = upgradeModelConfig(res.config);
  } catch {
    /* missing file / bad JSON -> DEFAULT */
  }
  cache.set(path, config);
  return config;
}

export async function saveModelConfig(
  config: ModelConfig,
  path = defaultModelConfigPath(),
): Promise<ModelConfig> {
  const res = validateModelConfig(config);
  if (!res.ok) throw new Error(res.error);

  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(res.config, null, 2), 'utf8');
  await rename(tmp, path); // atomic write
  cache.set(path, res.config);
  return res.config;
}
