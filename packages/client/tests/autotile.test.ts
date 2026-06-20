import { describe, it, expect } from 'vitest';
import { cornerMask, DUAL_GRID_LOOKUP, frameForMask } from '../src/game/autotile';

// isUpper(gx,gy): whether the logical cell belongs to the pair's "upper" terrain.
// Display grid has size (w+1)x(h+1); render tile (dx,dy) looks at
// 4 logical cells: (dx-1,dy-1)=NW, (dx,dy-1)=NE, (dx-1,dy)=SW, (dx,dy)=SE.
describe('cornerMask', () => {
  const allLower = () => false;
  const allUpper = () => true;
  it('base only -> 0', () => expect(cornerMask(2, 2, allLower)).toBe(0));
  it('upper only -> 15', () => expect(cornerMask(2, 2, allUpper)).toBe(15));
  it('only SE upper -> 8', () => {
    const f = (gx: number, gy: number) => gx === 2 && gy === 2;
    expect(cornerMask(2, 2, f)).toBe(8);
  });
  it('only NW upper -> 1', () => {
    const f = (gx: number, gy: number) => gx === 1 && gy === 1;
    expect(cornerMask(2, 2, f)).toBe(1);
  });
  it('outside the grid is counted as base', () => {
    // render tile (0,0): NW(-1,-1),NE(0,-1),SW(-1,0) outside grid, SE(0,0) upper
    const f = (gx: number, gy: number) => gx === 0 && gy === 0;
    expect(cornerMask(0, 0, f)).toBe(8);
  });
});

describe('DUAL_GRID_LOOKUP', () => {
  // Packer (pack-tileset.mjs) lays out frames t_0..t_15 directly by corner mask,
  // so lookup is identity and covers all 16 masks without duplicates.
  it('covers 16 masks without duplicates', () => {
    expect(DUAL_GRID_LOOKUP).toHaveLength(16);
    expect(new Set(DUAL_GRID_LOOKUP).size).toBe(16);
  });
  it('frameForMask is identity for 0..15', () => {
    for (let m = 0; m < 16; m++) expect(frameForMask(m)).toBe(m);
  });
});
