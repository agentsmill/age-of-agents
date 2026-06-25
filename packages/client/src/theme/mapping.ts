/**
 * Maps agent activity to the target building: the heart of the game metaphor.
 * The canonical implementation lives in @agent-citadel/shared because the
 * server uses it to attribute tokens to buildings (statistics). This file only
 * re-exports it so existing client imports ('../theme/mapping') keep working.
 */
export {
  toolToBuilding,
  resolveBuilding,
  DEFAULT_MAPPING,
  validateMapping,
  isBuildingId,
  BUILDING_IDS,
} from '@agent-citadel/shared';
export type { MappingConfig, MappingRule, BuildingId } from '@agent-citadel/shared';
