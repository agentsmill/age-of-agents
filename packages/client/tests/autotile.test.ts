import { describe, it, expect } from 'vitest';
import { cornerMask, DUAL_GRID_LOOKUP, frameForMask } from '../src/game/autotile';

// isUpper(gx,gy): czy komórka logiczna należy do terenu "upper" pary.
// Siatka display ma wymiar (w+1)x(h+1); render-kafel (dx,dy) patrzy na
// 4 komórki logiczne: (dx-1,dy-1)=NW, (dx,dy-1)=NE, (dx-1,dy)=SW, (dx,dy)=SE.
describe('cornerMask', () => {
  const allLower = () => false;
  const allUpper = () => true;
  it('sama baza → 0', () => expect(cornerMask(2, 2, allLower)).toBe(0));
  it('sam upper → 15', () => expect(cornerMask(2, 2, allUpper)).toBe(15));
  it('tylko SE upper → 8', () => {
    const f = (gx: number, gy: number) => gx === 2 && gy === 2;
    expect(cornerMask(2, 2, f)).toBe(8);
  });
  it('tylko NW upper → 1', () => {
    const f = (gx: number, gy: number) => gx === 1 && gy === 1;
    expect(cornerMask(2, 2, f)).toBe(1);
  });
  it('poza siatką liczone jako baza', () => {
    // render-kafel (0,0): NW(-1,-1),NE(0,-1),SW(-1,0) poza siatką, SE(0,0) upper
    const f = (gx: number, gy: number) => gx === 0 && gy === 0;
    expect(cornerMask(0, 0, f)).toBe(8);
  });
});

describe('DUAL_GRID_LOOKUP', () => {
  // Packer (pack-tileset.mjs) układa klatki t_0..t_15 wprost wg maski narożników,
  // więc lookup jest tożsamościowy i pokrywa wszystkie 16 masek bez duplikatów.
  it('pokrywa 16 masek bez duplikatów', () => {
    expect(DUAL_GRID_LOOKUP).toHaveLength(16);
    expect(new Set(DUAL_GRID_LOOKUP).size).toBe(16);
  });
  it('frameForMask tożsamościowy dla 0..15', () => {
    for (let m = 0; m < 16; m++) expect(frameForMask(m)).toBe(m);
  });
});
