import { describe, it, expect } from 'vitest';
import { buildTerrainMap, TERRAINS } from '../src/game/terrain-map';
import { FANTASY } from '../src/theme/fantasy';

describe('buildTerrainMap', () => {
  it('dimensions = grid', () => {
    const m = buildTerrainMap(FANTASY);
    expect(m.length).toBe(FANTASY.grid.h);
    expect(m[0].length).toBe(FANTASY.grid.w);
  });
  it('only known terrains', () => {
    const m = buildTerrainMap(FANTASY);
    for (const row of m) for (const t of row) expect(TERRAINS).toContain(t);
  });
  it('is deterministic (same world between calls)', () => {
    expect(buildTerrainMap(FANTASY)).toEqual(buildTerrainMap(FANTASY));
  });
  it('base dominates (most cells are grass)', () => {
    const m = buildTerrainMap(FANTASY);
    const grass = m.flat().filter((t) => t === 'grass').length;
    expect(grass).toBeGreaterThan(m.flat().length * 0.5);
  });
});
