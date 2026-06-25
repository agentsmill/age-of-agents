/**
 * Projections: logical Cartesian grid (gx, gy) -> screen pixels.
 * Game logic (paths, movement, positions) NEVER works in screen coordinates;
 * only rendering goes through projection.
 */
export interface Projection {
  toScreen(gx: number, gy: number): { x: number; y: number };
  /** Value for depth-sorting (zIndex) units/buildings. */
  depth(gx: number, gy: number): number;
}

export function topdown(tile: number): Projection {
  return {
    toScreen: (gx, gy) => ({ x: gx * tile, y: gy * tile }),
    depth: (_gx, gy) => gy,
  };
}

/** Classic 2:1 diamond (tile width 2x height). */
export function isometric(tileW: number, tileH: number): Projection {
  return {
    toScreen: (gx, gy) => ({ x: ((gx - gy) * tileW) / 2, y: ((gx + gy) * tileH) / 2 }),
    depth: (gx, gy) => gx + gy,
  };
}
