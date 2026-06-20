import { Assets, type Texture } from 'pixi.js';
import type { AgentKind } from '@agent-citadel/shared';
import { emblemSrc } from '../theme/emblems';

/**
 * Preład graficznych herbów providerów do tekstur Pixi. Theme-agnostic, ładowane raz.
 * buildAgentBadge (synchroniczne, w konstruktorze Unit) używa getEmblemTexture od ręki;
 * brak tekstury → fallback proceduralny (kółko + litera).
 */
const KINDS: AgentKind[] = ['claude', 'codex', 'opencode', 'koda'];
const textures = new Map<AgentKind, Texture>();
let loaded = false;

export async function loadEmblems(): Promise<void> {
  if (loaded) return; // theme-agnostic — ładujemy tylko raz
  loaded = true;
  await Promise.all(
    KINDS.map(async (kind) => {
      const src = emblemSrc(kind);
      if (!src) return;
      try {
        const tex = await Assets.load<Texture>({ alias: `emblem/${kind}`, src });
        if (tex) textures.set(kind, tex);
      } catch (err) {
        console.warn(`[emblems] nie wczytano ${kind}:`, err);
      }
    }),
  );
}

/** Tekstura herba dla danego (już rozwiązanego) providera, jeśli wczytana. */
export function getEmblemTexture(kind: AgentKind): Texture | undefined {
  return textures.get(kind);
}
