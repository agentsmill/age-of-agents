import type { HeroSnapshot, HeroStateKind } from '@agent-citadel/shared';

/** Tory animacji generowane dla każdej postaci (1 kierunek = south + odbicie). */
export type AnimationName = 'idle' | 'walk' | 'work';

/** Klucz atlasu, gdy kombinacja model×mode jest nieznana lub assetu brak. */
export const ARCHETYPE_FALLBACK = 'sonnet-default';

export const MODELS = ['opus', 'sonnet', 'haiku', 'fable'] as const;
export const MODES = ['default', 'plan', 'acceptEdits', 'bypassPermissions'] as const;

/**
 * WKŁAD USERA (learning) — siostra toolToBuilding (theme/mapping.ts).
 * Mapuje HeroSnapshot.model × HeroSnapshot.permissionMode na klucz atlasu
 * '<model>-<mode>'. Surowe stringi bywają undefined albo pełnym id modelu
 * (np. 'claude-opus-4-8[1m]') — znormalizuj do jednego z MODELS / MODES.
 * Nieznane → ARCHETYPE_FALLBACK. NIE generuje — tylko wybiera.
 */
export function sessionToArchetypeKey(hero: HeroSnapshot): string {
  // Model: dopasowanie po fragmencie, by łapać pełne id ('claude-opus-4-8[1m]' → opus).
  const raw = (hero.model ?? '').toLowerCase();
  const model = MODELS.find((m) => raw.includes(m));
  if (!model) return ARCHETYPE_FALLBACK; // nieznany/brak modelu → cały klucz na fallback
  // Tryb: tylko znana wartość, inaczej 'default' (model nadal decyduje o wyglądzie).
  const mode = (MODES as readonly string[]).includes(hero.permissionMode ?? '')
    ? (hero.permissionMode as string)
    : 'default';
  return `${model}-${mode}`;
}

/**
 * WKŁAD USERA (learning) — który tor animacji odtwarzać.
 * working → 'work'; jednostka w ruchu lub state 'returning' → 'walk';
 * idle/thinking/awaiting-input/error/sleeping → 'idle'.
 * `moving` jest osobnym argumentem, bo ruch po waypointach NIE jest zakodowany
 * w HeroStateKind (jednostka może iść będąc 'idle' albo 'working').
 */
export function stateToAnimation(state: HeroStateKind, moving: boolean): AnimationName {
  if (moving) return 'walk'; // ruch wygrywa: marsz do budynku zanim zacznie pracę
  if (state === 'working') return 'work';
  if (state === 'returning') return 'walk';
  return 'idle';
}
