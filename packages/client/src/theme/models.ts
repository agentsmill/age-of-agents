/**
 * Re-export the model registry from shared (twin of theme/mapping.ts). Keeps
 * client imports on one path, '../theme/models'.
 */
export {
  SPRITE_IDS,
  isSpriteId,
  matchModel,
  resolveSprite,
  resolveContextWindow,
  resolveModel,
  DEFAULT_MODEL_CONFIG,
  upgradeModelConfig,
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
