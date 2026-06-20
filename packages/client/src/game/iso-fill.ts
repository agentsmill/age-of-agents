/**
 * Filling a rectangular screen area with isometric tiles.
 *
 * Projekcja izo (toScreen): sx = (gx−gy)·tileW/2, sy = (gx+gy)·tileH/2.
 * A grid-index rectangle projects to a DIAMOND, and an index diamond projects to
 * a RECTANGLE. To cover a rectangular viewport with tiles, render a diamond
 * range of cells (including some negative/excess indices).
 */

export interface WorldRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CellRange {
  gxMin: number;
  gxMax: number;
  gyMin: number;
  gyMax: number;
}

/** Inverse of isometric projection: screen pixel -> grid coordinate (float). */
export function invIso(tileW: number, tileH: number, sx: number, sy: number): { gx: number; gy: number } {
  return { gx: sx / tileW + sy / tileH, gy: sy / tileH - sx / tileW };
}

/**
 * Cell index range (with +/-1 padding) guaranteeing that rendering every cell
 * in this range covers the whole world rectangle. Invert the projection for the
 * rectangle's 4 corners; gx/gy extrema (linear functions) are at the corners, so
 * min/max over corners is exact. Padding protects the jagged tessellation edge.
 */
export function isoFillRange(tileW: number, tileH: number, rect: WorldRect): CellRange {
  const corners = [
    invIso(tileW, tileH, rect.minX, rect.minY),
    invIso(tileW, tileH, rect.maxX, rect.minY),
    invIso(tileW, tileH, rect.minX, rect.maxY),
    invIso(tileW, tileH, rect.maxX, rect.maxY),
  ];
  const gxs = corners.map((c) => c.gx);
  const gys = corners.map((c) => c.gy);
  return {
    gxMin: Math.floor(Math.min(...gxs)) - 1,
    gxMax: Math.ceil(Math.max(...gxs)) + 1,
    gyMin: Math.floor(Math.min(...gys)) - 1,
    gyMax: Math.ceil(Math.max(...gys)) + 1,
  };
}
