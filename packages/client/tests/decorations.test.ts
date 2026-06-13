import { describe, it, expect } from 'vitest';
import { cellHash, scatterDecorations } from '../src/game/decorations';
import { FANTASY } from '../src/theme/fantasy';
import { buildTerrainMap } from '../src/game/terrain-map';

describe('cellHash', () => {
  it('deterministyczny', () => expect(cellHash(3, 4, 1)).toBe(cellHash(3, 4, 1)));
  it('różny dla różnych komórek', () => expect(cellHash(3, 4, 1)).not.toBe(cellHash(4, 3, 1)));
});

describe('scatterDecorations', () => {
  const map = buildTerrainMap(FANTASY);
  it('deterministyczny rozkład', () => {
    expect(scatterDecorations(FANTASY, map)).toEqual(scatterDecorations(FANTASY, map));
  });
  it('nigdy w obrysie budynku', () => {
    const props = scatterDecorations(FANTASY, map);
    for (const b of FANTASY.buildings)
      for (const p of props)
        expect(!(p.gx >= b.gx && p.gx < b.gx + b.w && p.gy >= b.gy && p.gy < b.gy + b.h)).toBe(true);
  });
  it('tylko na trawie', () => {
    const props = scatterDecorations(FANTASY, map);
    for (const p of props) expect(map[Math.floor(p.gy)][Math.floor(p.gx)]).toBe('grass');
  });
});
