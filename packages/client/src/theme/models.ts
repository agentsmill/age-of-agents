/**
 * Re-eksport rejestru modeli z shared (bliźniak theme/mapping.ts). Trzyma importy
 * klienta przy jednej ścieżce '../theme/models'.
 */
export {
  SPRITE_IDS,
  isSpriteId,
  matchModel,
  resolveSprite,
  resolveContextWindow,
  resolveModel,
  DEFAULT_MODEL_CONFIG,
  validateModelConfig,
} from '@agent-citadel/shared';
export type {
  SpriteId,
  ModelMatch,
  SpriteRule,
  WindowRule,
  ModelConfig,
  ResolvedModel,
} from '@agent-citadel/shared';
