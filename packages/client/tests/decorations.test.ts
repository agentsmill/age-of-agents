import { describe, it, expect } from 'vitest';
import { cellHash, scatterDecorations } from '../src/game/decorations';
import { FANTASY } from '../src/theme/fantasy';
import { buildTerrainMap } from '../src/game/terrain-map';

describe('cellHash', () => {
  it('is deterministic', () => expect(cellHash(3, 4, 1)).toBe(cellHash(3, 4, 1)));
  it('differs for different cells', () => expect(cellHash(3, 4, 1)).not.toBe(cellHash(4, 3, 1)));
});

describe('scatterDecorations', () => {
  const map = buildTerrainMap(FANTASY);
  it('has deterministic distribution', () => {
    expect(scatterDecorations(FANTASY, map)).toEqual(scatterDecorations(FANTASY, map));
  });
  it('never appears in building footprint', () => {
    const props = scatterDecorations(FANTASY, map);
    for (const b of FANTASY.buildings)
      for (const p of props)
        expect(!(p.gx >= b.gx && p.gx < b.gx + b.w && p.gy >= b.gy && p.gy < b.gy + b.h)).toBe(true);
  });
  it('only on grass', () => {
    const props = scatterDecorations(FANTASY, map);
    for (const p of props) expect(map[Math.floor(p.gy)][Math.floor(p.gx)]).toBe('grass');
  });
});
