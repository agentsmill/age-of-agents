import { claudeBuildingStatsSource } from './claude.js';
import { codexBuildingStatsSource } from './codex.js';
import type { BuildingStatsSource } from './types.js';

export type {
  BuildingStatsEvent,
  BuildingStatsExtractor,
  BuildingStatsSource,
  BuildingStatsTool,
} from './types.js';

export const DEFAULT_BUILDING_STATS_SOURCES: BuildingStatsSource[] = [
  claudeBuildingStatsSource,
  codexBuildingStatsSource,
];
