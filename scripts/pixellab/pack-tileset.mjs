#!/usr/bin/env node
/**
 * Packer tilesetu PixelLab (Wang dual-grid) → atlas Pixi z klatkami t_0..t_15
 * ułożonymi wg MOJEJ maski narożników (NW=1,NE=2,SW=4,SE=8, bit=upper).
 * Czyta corners z metadanych → liczy moją maskę → wycina wg bounding_box.
 * Dzięki temu DUAL_GRID_LOOKUP w autotile.ts zostaje tożsamościowy.
 *
 * Wejście:  downloads/tilesets/<pair>.{json,png}
 * Wyjście:  packages/client/public/assets/<theme>/tilemap/<pair>.{png,json} + index.json
 * Użycie:   node scripts/pixellab/pack-tileset.mjs <theme> <pair...>
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const theme = process.argv[2] ?? 'fantasy';
const pairs = process.argv.slice(3);
const inDir = join(root, 'downloads/tilesets');
const outDir = join(root, `packages/client/public/assets/${theme}/tilemap`);
const T = 32;

const maskFromCorners = (c) =>
  (c.NW === 'upper' ? 1 : 0) + (c.NE === 'upper' ? 2 : 0) + (c.SW === 'upper' ? 4 : 0) + (c.SE === 'upper' ? 8 : 0);

function blit(src, sx, sy, sw, sh, dst, dw, dx, dy) {
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      const si = ((sy + y) * src.width + (sx + x)) * 4;
      const di = ((dy + y) * dw + (dx + x)) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
}

mkdirSync(outDir, { recursive: true });
for (const pair of pairs) {
  const meta = JSON.parse(readFileSync(join(inDir, `${pair}.json`), 'utf8'));
  const src = PNG.sync.read(readFileSync(join(inDir, `${pair}.png`)));
  const tiles = meta.tileset_data.tiles;
  const sheet = new PNG({ width: T * 16, height: T, fill: true });
  const seen = new Set();
  for (const tile of tiles) {
    const m = maskFromCorners(tile.corners);
    const bb = tile.bounding_box;
    blit(src, bb.x, bb.y, T, T, sheet, sheet.width, m * T, 0);
    seen.add(m);
  }
  if (seen.size !== 16) throw new Error(`${pair}: pokryto ${seen.size}/16 masek — sprawdź corners w metadanych`);
  const frames = {};
  for (let m = 0; m < 16; m++)
    frames[`t_${m}`] = { frame: { x: m * T, y: 0, w: T, h: T }, sourceSize: { w: T, h: T }, spriteSourceSize: { x: 0, y: 0, w: T, h: T } };
  writeFileSync(join(outDir, `${pair}.png`), PNG.sync.write(sheet));
  writeFileSync(
    join(outDir, `${pair}.json`),
    JSON.stringify({ frames, meta: { image: `${pair}.png`, format: 'RGBA8888', size: { w: T * 16, h: T }, scale: '1' } }, null, 2),
  );
  console.log(`${pair}: 16 kafli (maski 0-15) ✓`);
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify({ pairs, tile: T }, null, 2));
console.log('index.json →', pairs.join(', '));
