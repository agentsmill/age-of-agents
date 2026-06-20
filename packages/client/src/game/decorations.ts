import type { ThemeDef } from '../theme/types';
import type { TerrainId } from './terrain-map';

export type DecoKind = 'tree' | 'rock' | 'bush' | 'flower';
export interface DecoPlacement { gx: number; gy: number; kind: DecoKind; }

/** Deterministic cell hash (spotJitter style, no Math.random). */
export function cellHash(gx: number, gy: number, salt: number): number {
  let h = ((salt * 2654435761) ^ (gx * 73856093) ^ (gy * 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Cell in any building outline (+1 padding), so trees do not stick to walls. */
function inBuilding(theme: ThemeDef, gx: number, gy: number): boolean {
  return theme.buildings.some(
    (b) => gx >= b.gx - 1 && gx < b.gx + b.w + 1 && gy >= b.gy - 1 && gy < b.gy + b.h + 1,
  );
}

/**
 * USER CONTRIBUTION (learning): decoration scatter rule for one cell.
 * Returns { place, kind }. Determinism: use cellHash(gx,gy,salt) (NOT Math.random).
 * Aesthetic ideas: trees in groves (check neighbors / low threshold + coherent noise),
 * frequent but tiny flowers, rare rocks/bushes. Called only for 'grass' cells
 * outside buildings (scatterDecorations filters the rest).
 */
export function decoRule(gx: number, gy: number): { place: boolean; kind: DecoKind } {
  const grove = cellHash(gx >> 2, gy >> 2, 11) / 4294967296; // coarse 4x4 grid -> coherent groves
  const r = cellHash(gx, gy, 0) / 4294967296;
  if (grove > 0.7) {
    // forest terrain: tree cluster with some bushes
    if (r < 0.35) return { place: true, kind: 'tree' };
    if (r < 0.42) return { place: true, kind: 'bush' };
  } else if (r < 0.06) {
    // open meadow: sparse flowers
    return { place: true, kind: 'flower' };
  }
  if (r > 0.99) return { place: true, kind: 'rock' }; // very rare boulders everywhere
  return { place: false, kind: 'tree' };
}

/** Scatters decorations over 'grass' cells outside buildings, with sub-cell jitter. */
export function scatterDecorations(theme: ThemeDef, terrain: TerrainId[][]): DecoPlacement[] {
  const out: DecoPlacement[] = [];
  for (let gy = 0; gy < theme.grid.h; gy++) {
    for (let gx = 0; gx < theme.grid.w; gx++) {
      if (terrain[gy][gx] !== 'grass') continue;
      if (inBuilding(theme, gx, gy)) continue;
      const { place, kind } = decoRule(gx, gy);
      if (!place) continue;
      const jx = (cellHash(gx, gy, 2) % 100) / 100 - 0.5;
      const jy = (cellHash(gx, gy, 3) % 100) / 100 - 0.5;
      out.push({ gx: gx + 0.5 + jx * 0.6, gy: gy + 0.5 + jy * 0.6, kind });
    }
  }
  return out;
}
