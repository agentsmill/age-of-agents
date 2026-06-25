/** Predicate: whether logical cell (gx,gy) belongs to the pair's "upper" terrain. */
export type IsUpper = (gx: number, gy: number) => boolean;

/**
 * 4-corner mask for display-grid render tile (dx,dy).
 * Bits: NW=1, NE=2, SW=4, SE=8. Outside grid = base (false).
 * The render tile lies at the junction of 4 logical cells shifted by -1 in NW.
 */
export function cornerMask(dx: number, dy: number, isUpper: IsUpper): number {
  const nw = isUpper(dx - 1, dy - 1) ? 1 : 0;
  const ne = isUpper(dx, dy - 1) ? 2 : 0;
  const sw = isUpper(dx - 1, dy) ? 4 : 0;
  const se = isUpper(dx, dy) ? 8 : 0;
  return nw + ne + sw + se;
}

/**
 * Lookup maska(0..15) → indeks klatki w atlasie tilesetu.
 * Identity by DEFAULT (frame == mask), assuming an atlas arranged by mask.
 * Po wygenerowaniu prawdziwego tilesetu PixelLab (Task 6) podmieniany na
 * realne mapowanie i ZAMYKANY testem na faktycznym sheecie.
 */
export const DUAL_GRID_LOOKUP: readonly number[] = Object.freeze(
  Array.from({ length: 16 }, (_, m) => m),
);

export function frameForMask(mask: number): number {
  return DUAL_GRID_LOOKUP[mask] ?? 0;
}
