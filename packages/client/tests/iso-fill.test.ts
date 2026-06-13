import { describe, it, expect } from 'vitest';
import { invIso, isoFillRange } from '../src/game/iso-fill';

const tileW = 64;
const tileH = 32;
const toScreen = (gx: number, gy: number) => ({ x: ((gx - gy) * tileW) / 2, y: ((gx + gy) * tileH) / 2 });

describe('invIso', () => {
  it('jest odwrotnością projekcji izometrycznej', () => {
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
  it('zakres komórek pokrywa każdy punkt prostokąta świata', () => {
    const rect = { minX: -500, minY: -200, maxX: 900, maxY: 700 };
    const r = isoFillRange(tileW, tileH, rect);
    // Próbkujemy gęstą siatkę punktów WEWNĄTRZ prostokąta. Komórka pokrywająca
    // dany punkt (round po odwróconej projekcji) MUSI mieścić się w zakresie —
    // inaczej w tym miejscu ekranu byłaby dziura/czerń.
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

  it('działa dla prostokąta z dodatnim originem', () => {
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
