import { Container, Graphics, Sprite, Text, TextStyle, type Texture } from 'pixi.js';
import type { BuildingDef, ThemeDef } from '../theme/types';
import type { Projection } from './projection';
import { getBuildingSprite } from './building-sprites';
import { themeRoadCurves, type RoadPoint } from './roads';

/**
 * Programmatic pixel-art-style placeholders; the game works and looks coherent
 * before the user downloads asset packs (`npm run assets`). Once assets are
 * installed, these factories are replaced by spritesheets.
 */

export const TEAM_COLORS = [0xe24b4a, 0x378add, 0x1d9e75, 0xef9f27, 0xd4537e, 0x7f77dd, 0x5dcaa5, 0xf0997b];

export function teamColor(index: number): number {
  return TEAM_COLORS[index % TEAM_COLORS.length];
}

/** Team color as a CSS string (#rrggbb), for HUD dots in panels. */
export function teamColorHex(index: number): string {
  return `#${teamColor(index).toString(16).padStart(6, '0')}`;
}

export const labelStyle = new TextStyle({
  fontFamily: 'monospace',
  fontSize: 11,
  fill: 0xf1efe8,
  stroke: { color: 0x1a1a17, width: 3 },
});

export function drawTerrain(theme: ThemeDef, projection: Projection): Graphics {
  const g = new Graphics();
  // Tile as a polygon from four projected corners:
  // top-down daje kwadraty, izometria romby — jeden kod, obie projekcje.
  for (let gy = 0; gy < theme.grid.h; gy++) {
    for (let gx = 0; gx < theme.grid.w; gx++) {
      const a = projection.toScreen(gx, gy);
      const b = projection.toScreen(gx + 1, gy);
      const c = projection.toScreen(gx + 1, gy + 1);
      const d = projection.toScreen(gx, gy + 1);
      const color = (gx + gy) % 2 === 0 ? theme.terrain.base : theme.terrain.alt;
      g.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).fill(color);
      if ((gx * 7 + gy * 13) % 11 === 0) {
        const mid = projection.toScreen(gx + 0.4, gy + 0.5);
        g.rect(mid.x, mid.y, 3, 3).fill(theme.terrain.alt + 0x0a140a);
      }
    }
  }
  return g;
}

/**
 * Roads as organic variable-width ribbons along curves from roads.ts (the same
 * curves control the terrain 'dirt' band). Offset is computed in GRID space and
 * only then projected, which correctly captures isometric anisotropy.
 */
export function drawRoads(theme: ThemeDef, projection: Projection): Graphics {
  const g = new Graphics();
  const edge = darken(theme.terrain.path, 0.3);
  for (const curve of themeRoadCurves(theme)) {
    if (curve.length < 2) continue;
    const left: { x: number; y: number }[] = [];
    const right: { x: number; y: number }[] = [];
    for (let i = 0; i < curve.length; i++) {
      const p = curve[i];
      const { nx, ny } = gridNormal(curve, i);
      left.push(projection.toScreen(p.gx + nx * p.hw, p.gy + ny * p.hw));
      right.push(projection.toScreen(p.gx - nx * p.hw, p.gy - ny * p.hw));
    }
    const poly: number[] = [];
    for (const pt of left) poly.push(pt.x, pt.y);
    for (let i = right.length - 1; i >= 0; i--) poly.push(right[i].x, right[i].y);
    g.poly(poly).fill(theme.terrain.path);
    g.poly(poly).stroke({ color: edge, width: 1.5, alpha: 0.5 });
    // rounded ends so the road does not stop with a sharp cut
    drawCap(g, left[0], right[0], theme.terrain.path);
    drawCap(g, left[curve.length - 1], right[curve.length - 1], theme.terrain.path);
  }
  return g;
}

/** Unit normal to the road axis at point i (difference to neighbors). */
function gridNormal(curve: RoadPoint[], i: number): { nx: number; ny: number } {
  const a = curve[Math.max(0, i - 1)];
  const b = curve[Math.min(curve.length - 1, i + 1)];
  const tx = b.gx - a.gx;
  const ty = b.gy - a.gy;
  const len = Math.hypot(tx, ty) || 1;
  return { nx: -ty / len, ny: tx / len };
}

/**
 * Rounded road end. Radius = half the ribbon width AT THIS point (from projected
 * l/r rails), so the cap matches the ribbon for ANY road orientation. In
 * isometry, screen width depends on direction (anisotropy).
 */
function drawCap(g: Graphics, l: { x: number; y: number }, r: { x: number; y: number }, color: number): void {
  const cx = (l.x + r.x) / 2;
  const cy = (l.y + r.y) / 2;
  const rad = Math.hypot(l.x - r.x, l.y - r.y) / 2 || 4;
  g.circle(cx, cy, rad).fill(color);
}

export function buildBuilding(def: BuildingDef, theme: ThemeDef, projection: Projection, label = def.label): Container {
  const tex = getBuildingSprite(def.id);
  if (tex) return buildBuildingSprite(def, theme, projection, tex, label);
  return theme.style === 'iso'
    ? buildIsoBlock(def, theme, projection, label)
    : buildTopdownHouse(def, theme, projection, label);
}

/** Generated building sprite: anchor at footprint foot, scaled to tile width. */
function buildBuildingSprite(def: BuildingDef, theme: ThemeDef, projection: Projection, tex: Texture, labelText: string): Container {
  const container = new Container();
  const sprite = new Sprite(tex);
  sprite.anchor.set(0.5, 1); // foot = bottom center (PixelLab does not provide anchor metadata)
  sprite.scale.set((def.w * theme.tile) / tex.width);
  const foot = projection.toScreen(def.gx + def.w / 2, def.gy + def.h);
  sprite.position.set(foot.x, foot.y);
  const label = new Text({ text: labelText, style: labelStyle });
  label.anchor.set(0.5, 0);
  label.position.set(foot.x, foot.y + 4);
  container.addChild(sprite, label);
  container.zIndex = projection.depth(def.gx + def.w / 2, def.gy + def.h);
  return container;
}

function buildTopdownHouse(def: BuildingDef, theme: ThemeDef, projection: Projection, labelText: string): Container {
  const container = new Container();
  const { tile } = theme;
  const origin = projection.toScreen(def.gx, def.gy);
  const w = def.w * tile;
  const h = def.h * tile;

  const g = new Graphics();
  // korpus
  g.rect(0, h * 0.35, w, h * 0.65).fill(def.placeholderColor);
  g.rect(0, h * 0.35, w, h * 0.65).stroke({ color: 0x1a1a17, width: 2 });
  // dach
  g.poly([0, h * 0.35, w / 2, 0, w, h * 0.35]).fill(darken(def.placeholderColor, 0.35));
  g.poly([0, h * 0.35, w / 2, 0, w, h * 0.35]).stroke({ color: 0x1a1a17, width: 2 });
  // drzwi
  g.rect(w / 2 - tile * 0.18, h - tile * 0.5, tile * 0.36, tile * 0.5).fill(0x2c2c2a);

  const label = new Text({ text: labelText, style: labelStyle });
  label.anchor.set(0.5, 0);
  label.position.set(w / 2, h + 4);

  container.addChild(g, label);
  container.position.set(origin.x, origin.y);
  container.zIndex = projection.depth(def.gx + def.w / 2, def.gy + def.h);
  return container;
}

function buildIsoBlock(def: BuildingDef, theme: ThemeDef, projection: Projection, labelText: string): Container {
  const container = new Container();
  const lift = theme.tile * 0.9; // solid height in px

  const A = projection.toScreen(def.gx, def.gy);
  const B = projection.toScreen(def.gx + def.w, def.gy);
  const C = projection.toScreen(def.gx + def.w, def.gy + def.h);
  const D = projection.toScreen(def.gx, def.gy + def.h);
  const up = (p: { x: number; y: number }) => ({ x: p.x, y: p.y - lift });
  const At = up(A);
  const Bt = up(B);
  const Ct = up(C);
  const Dt = up(D);

  const g = new Graphics();
  // left wall (D-C) and right wall (B-C), adjacent to bottom corner C
  g.poly([Dt.x, Dt.y, Ct.x, Ct.y, C.x, C.y, D.x, D.y]).fill(darken(def.placeholderColor, 0.45));
  g.poly([Bt.x, Bt.y, Ct.x, Ct.y, C.x, C.y, B.x, B.y]).fill(darken(def.placeholderColor, 0.25));
  // dach
  g.poly([At.x, At.y, Bt.x, Bt.y, Ct.x, Ct.y, Dt.x, Dt.y]).fill(def.placeholderColor);
  g.poly([At.x, At.y, Bt.x, Bt.y, Ct.x, Ct.y, Dt.x, Dt.y]).stroke({ color: 0x1a1a17, width: 2 });
  // roof skylight
  const roofMid = projection.toScreen(def.gx + def.w / 2, def.gy + def.h / 2);
  g.circle(roofMid.x, roofMid.y - lift, theme.tile * 0.14).fill(lighten(def.placeholderColor, 0.4));
  // door near the bottom corner
  g.rect(C.x - 7, C.y - 20, 14, 20).fill(0x2c2c2a);

  const label = new Text({ text: labelText, style: labelStyle });
  label.anchor.set(0.5, 0);
  label.position.set(C.x, C.y + 6);

  container.addChild(g, label);
  container.zIndex = projection.depth(def.gx + def.w * 0.7, def.gy + def.h * 0.7);
  return container;
}

function lighten(color: number, amount: number): number {
  const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * (1 + amount)));
  const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * (1 + amount)));
  const b = Math.min(255, Math.floor((color & 0xff) * (1 + amount)));
  return (r << 16) | (g << 8) | b;
}

export function buildUnitBody(color: number, isPeon: boolean): Container {
  const container = new Container();
  const scale = isPeon ? 0.72 : 1;
  const g = new Graphics();

  // team ring under the feet
  g.ellipse(0, 2, 11 * scale, 5 * scale).stroke({ color, width: 2 });
  // korpus
  g.rect(-6 * scale, -16 * scale, 12 * scale, 14 * scale).fill(isPeon ? 0x8a7a5a : 0x6a6a72);
  g.rect(-6 * scale, -16 * scale, 12 * scale, 14 * scale).stroke({ color: 0x1a1a17, width: 1.5 });
  // head
  g.circle(0, -21 * scale, 5.5 * scale).fill(0xeec39a);
  g.circle(0, -21 * scale, 5.5 * scale).stroke({ color: 0x1a1a17, width: 1.5 });
  // helmet/hood in team color
  g.rect(-6 * scale, -27 * scale, 12 * scale, 5 * scale).fill(color);
  // proporczyk
  g.moveTo(7 * scale, -26 * scale).lineTo(7 * scale, -6 * scale).stroke({ color: 0x4a3a28, width: 1.5 });
  g.poly([7 * scale, -26 * scale, 15 * scale, -23 * scale, 7 * scale, -20 * scale]).fill(color);

  container.addChild(g);
  return container;
}

function darken(color: number, amount: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * (1 - amount));
  const g = Math.floor(((color >> 8) & 0xff) * (1 - amount));
  const b = Math.floor((color & 0xff) * (1 - amount));
  return (r << 16) | (g << 8) | b;
}
