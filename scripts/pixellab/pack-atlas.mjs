#!/usr/bin/env node
/**
 * Packer offline: downloads/frames/<key>/<anim>/*.png -> atlas Pixi.
 * Result: public/assets/<theme>/heroes/<key>.png + <key>.json (frames+animations+meta)
 * and index.json with the key list. No PixelLab/MCP dependency.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const theme = process.argv[2] ?? 'fantasy';
const framesRoot = join(root, 'downloads/frames');
const outDir = join(root, `packages/client/public/assets/${theme}/heroes`);
const ANIMS = ['idle', 'walk', 'work'];

const loadPng = (p) => PNG.sync.read(readFileSync(p));

/** Manual RGBA blit: copies src (sw x sh) to dst (width dw) at (ox,oy). */
function blit(src, sw, sh, dst, dw, ox, oy) {
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const si = (y * sw + x) * 4;
      const di = ((oy + y) * dw + (ox + x)) * 4;
      dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
    }
  }
}

function packCharacter(key) {
  const sources = {}; // anim -> [PNG,...]
  let fw = 0, fh = 0;
  for (const anim of ANIMS) {
    const dir = join(framesRoot, key, anim);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    if (!files.length) continue;
    sources[anim] = files.map((f) => loadPng(join(dir, f)));
    for (const png of sources[anim]) { fw = Math.max(fw, png.width); fh = Math.max(fh, png.height); }
  }
  // Frame names MUST be globally unique; Pixi caches textures globally by name,
  // so frames from later atlases collide without the key prefix.
  const all = Object.entries(sources).flatMap(([anim, pngs]) =>
    pngs.map((png, i) => ({ name: `${key}__${anim}_${String(i).padStart(2, '0')}`, anim, png })));
  if (!all.length) return null;

  const cols = Math.ceil(Math.sqrt(all.length));
  const rows = Math.ceil(all.length / cols);
  const sheet = new PNG({ width: cols * fw, height: rows * fh, fill: true });
  const frames = {};
  const animations = {};
  all.forEach((e, idx) => {
    const cx = (idx % cols) * fw, cy = Math.floor(idx / cols) * fh;
    const ox = cx + Math.floor((fw - e.png.width) / 2), oy = cy + Math.floor((fh - e.png.height) / 2);
    blit(e.png.data, e.png.width, e.png.height, sheet.data, sheet.width, ox, oy);
    frames[e.name] = { frame: { x: cx, y: cy, w: fw, h: fh }, rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: fw, h: fh }, sourceSize: { w: fw, h: fh } };
    (animations[e.anim] ??= []).push(e.name);
  });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${key}.png`), PNG.sync.write(sheet));
  writeFileSync(join(outDir, `${key}.json`), JSON.stringify({
    frames, animations,
    meta: { image: `${key}.png`, format: 'RGBA8888', size: { w: sheet.width, h: sheet.height }, scale: '1' },
  }, null, 2));
  return key;
}

const keys = existsSync(framesRoot)
  ? readdirSync(framesRoot).filter((k) => existsSync(join(framesRoot, k)))
  : [];
const packed = keys.map(packCharacter).filter(Boolean);
mkdirSync(outDir, { recursive: true });

// Non-destructive: merge freshly packed keys with whatever index.json already lists,
// so packing one new character never drops the existing atlases (their frames are not
// in downloads/frames). Idempotent: re-running with the same frames is a no-op union.
const idxPath = join(outDir, 'index.json');
let existing = [];
if (existsSync(idxPath)) {
  try { existing = JSON.parse(readFileSync(idxPath, 'utf8')).keys ?? []; } catch { existing = []; }
}
const merged = [...new Set([...existing, ...packed])].sort();
writeFileSync(idxPath, JSON.stringify({ keys: merged }, null, 2));
console.log(`Packed ${packed.length} atlas(es); index.json now lists ${merged.length}:`, merged.join(', '));
