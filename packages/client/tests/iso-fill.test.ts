import { describe, it, expect } from 'vitest';
import { invIso, isoFillRange } from '../src/game/iso-fill';

const tileW = 64;
const tileH = 32;
const toScreen = (gx: number, gy: number) => ({ x: ((gx - gy) * tileW) / 2, y: ((gx + gy) * tileH) / 2 });

describe('invIso', () => {
  it('is the inverse of isometric projection', () => {
    for (const [gx, gy] of [
      [0, 0],
      [5, 3],
      [-2, 7],
      [40, 26],
      [-10, -4],
    ]) {
      const s = toScreen(gx, gy);
      const inv = invIso(tileW, tileH, s.x, s.y);
      expect(inv.gx).toBeCloseTo(gx, 6);
      expect(inv.gy).toBeCloseTo(gy, 6);
    }
  });
});

describe('isoFillRange', () => {
  it('cell range covers every point of the world rectangle', () => {
    const rect = { minX: -500, minY: -200, maxX: 900, maxY: 700 };
    const r = isoFillRange(tileW, tileH, rect);
    // Sample a dense grid of points INSIDE the rectangle. The cell covering
    // a given point (round after inverse projection) MUST fit in range,
    // otherwise there would be a hole/black area on screen there.
    for (let x = rect.minX; x <= rect.maxX; x += 17) {
      for (let y = rect.minY; y <= rect.maxY; y += 13) {
        const inv = invIso(tileW, tileH, x, y);
        const cgx = Math.round(inv.gx);
        const cgy = Math.round(inv.gy);
        expect(cgx).toBeGreaterThanOrEqual(r.gxMin);
        expect(cgx).toBeLessThanOrEqual(r.gxMax);
        expect(cgy).toBeGreaterThanOrEqual(r.gyMin);
        expect(cgy).toBeLessThanOrEqual(r.gyMax);
      }
    }
  });

  it('works for a rectangle with positive origin', () => {
    const rect = { minX: 100, minY: 50, maxX: 1200, maxY: 900 };
    const r = isoFillRange(tileW, tileH, rect);
    expect(r.gxMax).toBeGreaterThan(r.gxMin);
    expect(r.gyMax).toBeGreaterThan(r.gyMin);
    for (let x = rect.minX; x <= rect.maxX; x += 23) {
      for (let y = rect.minY; y <= rect.maxY; y += 19) {
        const inv = invIso(tileW, tileH, x, y);
        expect(Math.round(inv.gx)).toBeGreaterThanOrEqual(r.gxMin);
        expect(Math.round(inv.gx)).toBeLessThanOrEqual(r.gxMax);
        expect(Math.round(inv.gy)).toBeGreaterThanOrEqual(r.gyMin);
        expect(Math.round(inv.gy)).toBeLessThanOrEqual(r.gyMax);
      }
    }
  });
});
