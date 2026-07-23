import type { HeroStateKind } from '@agent-citadel/shared';

export function shouldClearPathForSteer(state: HeroStateKind | string, isPeon: boolean): boolean {
  return state === 'thinking' && !isPeon;
}
