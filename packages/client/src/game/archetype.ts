import type { HeroSnapshot, HeroStateKind } from '@agent-citadel/shared';
import { SPRITE_IDS, type SpriteId } from '@agent-citadel/shared';

/** Animation tracks generated for each character (1 direction = south + mirroring). */
export type AnimationName = 'idle' | 'walk' | 'work';

/** Atlas key used when model x mode is unknown or the asset is missing. */
export const ARCHETYPE_FALLBACK = 'sonnet-default';

// Model list = sprite pool (single source of truth in shared).
export const MODELS = SPRITE_IDS;
export const MODES = ['default', 'plan', 'acceptEdits', 'bypassPermissions'] as const;

/**
 * USER CONTRIBUTION (learning): sibling of toolToBuilding (theme/mapping.ts).
 * Maps HeroSnapshot.model x HeroSnapshot.permissionMode to an atlas key
 * '<model>-<mode>'. Raw strings can be undefined or a full model id.
 * (for example 'claude-opus-4-8[1m]'); normalize to one of MODELS / MODES.
 * Unknown -> ARCHETYPE_FALLBACK. Does NOT generate, only selects.
 */
export function sessionToArchetypeKey(hero: HeroSnapshot, spriteOverride?: SpriteId): string {
  // Model registry override takes precedence; otherwise match by name fragment.
  const model: SpriteId | undefined =
    spriteOverride ?? MODELS.find((m) => (hero.model ?? '').toLowerCase().includes(m));
  if (!model) return ARCHETYPE_FALLBACK; // unknown/missing model -> whole key falls back
  const mode = (MODES as readonly string[]).includes(hero.permissionMode ?? '')
    ? (hero.permissionMode as string)
    : 'default';
  return `${model}-${mode}`;
}

/**
 * Atlas search order for an archetype key: exact -> `<model>-default` variant
 * -> global fallback. Mode variants (plan/acceptEdits/bypassPermissions) are Phase 2;
 * for now only `<model>-default` atlases exist, so without this degradation a hero
 * in non-default mode would fall to the placeholder. This keeps ITS model sprite.
 */
export function archetypeKeyChain(key: string): string[] {
  const model = key.split('-')[0];
  return [...new Set([key, `${model}-default`, ARCHETYPE_FALLBACK])]; // dedup, preserve order
}

/**
 * USER CONTRIBUTION (learning): which animation track to play.
 * working -> 'work'; moving unit or state 'returning' -> 'walk';
 * idle/thinking/awaiting-input/error/sleeping -> 'idle'.
 * `moving` is a separate argument because waypoint movement is NOT encoded
 * in HeroStateKind (a unit can be walking while 'idle' or 'working').
 */
export function stateToAnimation(state: HeroStateKind, moving: boolean): AnimationName {
  if (moving) return 'walk'; // movement wins: walk to the building before starting work
  if (state === 'working') return 'work';
  if (state === 'returning') return 'walk';
  return 'idle';
}
