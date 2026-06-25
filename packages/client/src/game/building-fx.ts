import type { BuildingId } from '../theme/types';

/**
 * Building activity FX (Task 3): when at least one unit works NEAR a building,
 * the building gets glow + floating particles in a role-specific style.
 *
 * Machinery (emitters, lifecycle) is in view.ts. Subjective and tunable pieces
 * live HERE: activity THRESHOLD and FX LOOK per building. This is a natural
 * contribution point (learning); values below are working defaults to tune.
 */
export interface BuildingFxStyle {
  /** Main particle + glow color. */
  color: number;
  /** Accent (some particles), for example a brighter spark. */
  spark: number;
  /** Particles per second at full intensity. */
  rate: number;
  /** Upward rise speed (px/s). */
  rise: number;
  /** Horizontal spread of the particle source (px). */
  spread: number;
  /** Base glow opacity (0-1). */
  glow: number;
}

/**
 * USER CONTRIBUTION (learning): FX palette/character per building. BuildingId is
 * shared by both themes, so colors are chosen "by role" (forge=sparks,
 * archive=cool glow, etc.). Adjust freely to fit each world's mood.
 */
export const BUILDING_FX: Record<BuildingId, BuildingFxStyle> = {
  citadel: { color: 0xf0e6c8, spark: 0xffffff, rate: 5, rise: 26, spread: 16, glow: 0.16 },
  tower: { color: 0x9a7fff, spark: 0xd6c7ff, rate: 8, rise: 34, spread: 10, glow: 0.22 },
  forge: { color: 0xffa53a, spark: 0xfff0b0, rate: 12, rise: 40, spread: 10, glow: 0.24 },
  library: { color: 0x6fd0e0, spark: 0xc4f2f8, rate: 6, rise: 24, spread: 12, glow: 0.18 },
  mine: { color: 0xb09878, spark: 0xd8c6a6, rate: 9, rise: 22, spread: 12, glow: 0.16 },
  barracks: { color: 0x5fd08a, spark: 0xb6f0cf, rate: 7, rise: 28, spread: 12, glow: 0.18 },
  market: { color: 0xf0c050, spark: 0xfff0c0, rate: 8, rise: 26, spread: 14, glow: 0.20 },
  guild: { color: 0xd86fae, spark: 0xf6c8e2, rate: 8, rise: 30, spread: 10, glow: 0.20 },
  // Gathering points (fantasy): arena = combat dust, tavern = hearth smoke,
  // garden = fireflies.
  arena: { color: 0xe9b860, spark: 0xfff1c2, rate: 9, rise: 30, spread: 14, glow: 0.20 },
  tavern: { color: 0xc88a3a, spark: 0xf3d9a0, rate: 6, rise: 22, spread: 12, glow: 0.16 },
  garden: { color: 0x9be07a, spark: 0xe2f7c1, rate: 5, rise: 18, spread: 14, glow: 0.14 },
  // Additional gathering points (fantasy): bar = glass sparks, shrine = floating
  // lanterns. Together with arena/tavern/garden: 5 gathering spots.
  bar: { color: 0xe08aac, spark: 0xffd0e0, rate: 7, rise: 26, spread: 12, glow: 0.18 },
  shrine: { color: 0xc0a8e0, spark: 0xe8d8ff, rate: 4, rise: 16, spread: 10, glow: 0.14 },
  // Gathering points (sci-fi): holodeck = electric discharge, mess = cafeteria
  // steam, hydroponics = nutrient-solution bubbles.
  holodeck: { color: 0x6fc1ff, spark: 0xd6ecff, rate: 10, rise: 32, spread: 12, glow: 0.22 },
  mess: { color: 0xd9b27a, spark: 0xf2dcaa, rate: 5, rise: 20, spread: 14, glow: 0.14 },
  hydroponics: { color: 0x7be0a0, spark: 0xc2f1d2, rate: 6, rise: 18, spread: 12, glow: 0.16 },
  // Additional gathering points (sci-fi): lounge = soft lights, medbay = medical
  // monitor glow. Together with holodeck/mess/hydroponics: 5 gathering spots.
  lounge: { color: 0xd070c0, spark: 0xf0b8e0, rate: 6, rise: 22, spread: 12, glow: 0.16 },
  medbay: { color: 0xe06080, spark: 0xffc0d0, rate: 8, rise: 24, spread: 10, glow: 0.20 },
};

/** How close to the door (in tiles) a working unit must be to count as "near the building". */
export const FX_ACTIVE_RADIUS = 2.4;

export interface WorkerSample {
  buildingId: BuildingId;
  /** Unit distance from the building door (tiles). */
  distToDoor: number;
  working: boolean;
}

/**
 * Pure: set of buildings currently "working": at least one unit is in working
 * state and close enough to the door. Testable without a scene.
 */
export function collectActiveBuildings(
  workers: Iterable<WorkerSample>,
  radius = FX_ACTIVE_RADIUS,
): Set<BuildingId> {
  const out = new Set<BuildingId>();
  for (const w of workers) if (w.working && w.distToDoor <= radius) out.add(w.buildingId);
  return out;
}
