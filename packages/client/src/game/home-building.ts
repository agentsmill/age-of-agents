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

/** "Waiting room" building where a hero awaiting user input goes (awaiting-input).
 *  fantasy: chapel (shrine); sci-fi: waiting room (lounge); fallback: citadel. */
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
