import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { BuildingDef, ThemeDef } from '../theme/types';
import type { Projection } from './projection';

/**
 * Programowe placeholdery w duchu pixel-art — gra działa i wygląda
 * spójnie zanim użytkownik pobierze paczki assetów (npm run assets).
 * Po wgraniu assetów te fabryki zostaną podmienione na spritesheety.
 */

export const TEAM_COLORS = [0xe24b4a, 0x378add, 0x1d9e75, 0xef9f27, 0xd4537e, 0x7f77dd, 0x5dcaa5, 0xf0997b];

export function teamColor(index: number): number {
  return TEAM_COLORS[index % TEAM_COLORS.length];
}

export const labelStyle = new TextStyle({
  fontFamily: 'monospace',
  fontSize: 11,
  fill: 0xf1efe8,
  stroke: { color: 0x1a1a17, width: 3 },
});

export function drawTerrain(theme: ThemeDef, projection: Projection): Graphics {
  const g = new Graphics();
  const { tile } = theme;
  for (let gy = 0; gy < theme.grid.h; gy++) {
    for (let gx = 0; gx < theme.grid.w; gx++) {
      const { x, y } = projection.toScreen(gx, gy);
      const color = (gx + gy) % 2 === 0 ? theme.terrain.base : theme.terrain.alt;
      g.rect(x, y, tile, tile).fill(color);
      if ((gx * 7 + gy * 13) % 11 === 0) {
        g.rect(x + tile * 0.3, y + tile * 0.4, 3, 3).fill(theme.terrain.alt + 0x0a140a);
      }
    }
  }
  return g;
}

export function drawRoads(theme: ThemeDef, projection: Projection, segments: [number, number, number, number][]): Graphics {
  const g = new Graphics();
  for (const [ax, ay, bx, by] of segments) {
    const a = projection.toScreen(ax, ay);
    const b = projection.toScreen(bx, by);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: theme.terrain.path, width: theme.tile * 0.35, cap: 'round' });
  }
  return g;
}

export function buildBuilding(def: BuildingDef, theme: ThemeDef, projection: Projection): Container {
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

  const label = new Text({ text: def.label, style: labelStyle });
  label.anchor.set(0.5, 0);
  label.position.set(w / 2, h + 4);

  container.addChild(g, label);
  container.position.set(origin.x, origin.y);
  container.zIndex = projection.depth(def.gx + def.w / 2, def.gy + def.h);
  return container;
}

export function buildUnitBody(color: number, isPeon: boolean): Container {
  const container = new Container();
  const scale = isPeon ? 0.72 : 1;
  const g = new Graphics();

  // pierścień drużyny pod stopami
  g.ellipse(0, 2, 11 * scale, 5 * scale).stroke({ color, width: 2 });
  // korpus
  g.rect(-6 * scale, -16 * scale, 12 * scale, 14 * scale).fill(isPeon ? 0x8a7a5a : 0x6a6a72);
  g.rect(-6 * scale, -16 * scale, 12 * scale, 14 * scale).stroke({ color: 0x1a1a17, width: 1.5 });
  // głowa
  g.circle(0, -21 * scale, 5.5 * scale).fill(0xeec39a);
  g.circle(0, -21 * scale, 5.5 * scale).stroke({ color: 0x1a1a17, width: 1.5 });
  // hełm/kaptur w kolorze drużyny
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
