import {
  activityBuildingForAction,
  activityBuildingForHero,
  awaitingBuildingForTheme,
  homeBuildingForTheme,
  completedBuildingForTheme,
  recoveryBuildingForTheme,
  type BuildingId,
  type HeroSnapshot,
} from '@agent-citadel/shared';
import type { ThemeDef } from '../theme/types';

/**
 * Punti di raccolta (3 per tema) in cui una nuova sessione spawna
 * prima di essere mandata a lavorare. Scelti da un hash STABILE del
 * nome del progetto, così le sessioni dello stesso progetto si
 * raggruppano nello stesso punto, e progetti diversi si distribuiscono
 * sulla mappa invece di ammucchiarsi davanti alla citadella.
 *
 * I 3 building per tema sono ordinati così che ognuno "ospiti" un
 * sottoinsieme diverso di progetti (hash % 3) — la suddivisione è
 * deterministica e non dipende dall'ordine di arrivo.
 */
const HOME_BUILDINGS: Record<string, BuildingId[]> = {
  fantasy: ['arena', 'tavern', 'garden', 'bar', 'shrine'],
  scifi: ['holodeck', 'mess', 'hydroponics', 'lounge', 'medbay'],
  cyberpunk: ['holodeck', 'mess', 'hydroponics', 'lounge', 'medbay'],
};

/** Budynek „poczekalni", do którego idzie bohater czekający na usera (awaiting-input).
 *  fantasy: kaplica (shrine); sci-fi: poczekalnia (lounge); fallback: citadel. */
const AWAITING_BY_THEME: Record<string, BuildingId> = { fantasy: 'shrine', scifi: 'lounge', cyberpunk: 'lounge' };
export function awaitingBuilding(themeId: string): BuildingId {
  return awaitingBuildingForTheme(themeId);
}

export function completedBuilding(themeId: string): BuildingId {
  return completedBuildingForTheme(themeId);
}

export function recoveryBuilding(themeId: string): BuildingId {
  return recoveryBuildingForTheme(themeId);
}

/**
 * Returns the building id where a NEW unit for this session should appear. If
 * the theme has no gathering points or the project is missing, fall back to the
 * citadel (the original destination).
 */
export function homeBuilding(theme: ThemeDef, hero: Pick<HeroSnapshot, 'sessionId' | 'projectName' | 'projectDir'>): BuildingId {
  return homeBuildingForTheme(theme.id, hero);
}

export { activityBuildingForAction, activityBuildingForHero };
