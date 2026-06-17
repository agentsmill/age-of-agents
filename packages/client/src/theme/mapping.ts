/**
 * Mapowanie aktywności agenta na budynek-cel — serce metafory gry.
 * Kanoniczna implementacja żyje w @agent-citadel/shared, bo serwer używa jej
 * do atrybucji tokenów do budynków (statystyki). Tu tylko re-eksport, żeby
 * istniejące importy klienta ('../theme/mapping') działały bez zmian.
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
