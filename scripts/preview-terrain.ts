// Preview the logical biome map as PNG (offline, no browser).
// Run: npx tsx scripts/preview-terrain.ts
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildTerrainMap, type TerrainId } from '../packages/client/src/game/terrain-map.ts';
import { FANTASY } from '../packages/client/src/theme/fantasy.ts';

const C: Record<TerrainId, [number, number, number]> = {
  grass: [79, 122, 58],
  dirt: [154, 112, 56],
  water: [47, 111, 154],
  rock: [125, 122, 115],
};
const CELL = 10;
const map = buildTerrainMap(FANTASY);
const { w, h } = FANTASY.grid;
const png = new PNG({ width: w * CELL, height: h * CELL, fill: true });
function set(x: number, y: number, c: [number, number, number]) {
  const i = (y * png.width + x) * 4;
  png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]; png.data[i + 3] = 255;
}
for (let gy = 0; gy < h; gy++)
  for (let gx = 0; gx < w; gx++) {
    const col = C[map[gy][gx]];
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) set(gx * CELL + x, gy * CELL + y, col);
  }
// buildings: dark footprint rectangle + white door dot
for (const b of FANTASY.buildings) {
  for (let y = 0; y < b.h * CELL; y++)
    for (let x = 0; x < b.w * CELL; x++) {
      const px = Math.round(b.gx * CELL) + x, py = Math.round(b.gy * CELL) + y;
      const edge = x < 2 || y < 2 || x >= b.w * CELL - 2 || y >= b.h * CELL - 2;
      if (edge && px >= 0 && py >= 0 && px < png.width && py < png.height) set(px, py, [20, 16, 12]);
    }
  const dxp = Math.round(b.door.gx * CELL), dyp = Math.round(b.door.gy * CELL);
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
    const px = dxp + x, py = dyp + y;
    if (px >= 0 && py >= 0 && px < png.width && py < png.height) set(px, py, [240, 230, 210]);
  }
}
mkdirSync('downloads', { recursive: true });
writeFileSync('downloads/terrain-preview.png', PNG.sync.write(png));
const flat = map.flat();
const pct = (t: TerrainId) => Math.round((flat.filter((x) => x === t).length / flat.length) * 100);
console.log(`terrain-preview.png ${png.width}x${png.height} | grass ${pct('grass')}% dirt ${pct('dirt')}% water ${pct('water')}% rock ${pct('rock')}%`);
