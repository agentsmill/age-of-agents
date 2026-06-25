import type { Projection } from '../game/projection';
import type { BuildingId } from '@agent-citadel/shared';

// BuildingId is canonical in @agent-citadel/shared (the server needs it too).
export type { BuildingId };

export interface BuildingDef {
  id: BuildingId;
  /** Display name in a given theme (for example Forge / Drone Factory). */
  label: string;
  /** Position on the logical grid (top-left corner). */
  gx: number;
  gy: number;
  /** Size in grid tiles. */
  w: number;
  h: number;
  /** Path graph node at the building entrance. */
  door: { gx: number; gy: number };
  /** Placeholder color before assets are installed. */
  placeholderColor: number;
}

export interface WaypointNode {
  id: string;
  gx: number;
  gy: number;
}

/**
 * Paleta/styl „neon-glass" (#cyberpunk). Gdy ThemeDef.neon jest obecne, renderer
 * placeholderów rysuje przezroczyste, świecące bryły i abstrakcyjne awatary
 * zamiast standardowych domków/bloków — w pełni proceduralnie, bez assetów.
 */
export interface NeonStyle {
  /** Główny neon (dachy bryły, rdzeń awatara). */
  primary: number;
  /** Drugi neon (ściany alt, halo). */
  secondary: number;
  /** Akcent (rzadkie iskry/wierzchołki). */
  tertiary: number;
  /** Jasny kontur (świecące krawędzie). */
  edge: number;
  /** Ciemne wypełnienie kafla podłogi. */
  floor: number;
  /** Linie siatki podłogi (neon, niska alfa). */
  grid: number;
}

export interface ThemeDef {
  id: 'fantasy' | 'scifi' | 'cyberpunk';
  name: string;
  /** Placeholder drawing style: top-down house vs isometric block. */
  style: 'topdown' | 'iso';
  projection: Projection;
  /** Tile size in px (for terrain and unit scale). */
  tile: number;
  /**
   * Hero sprite calibration, depending on the PixelLab generation source
   * (fantasy = standard 68px, sci-fi = v3 92px). `scale` scales the canvas to
   * unit size; `footAnchor` (0..1) places the foot at the unit position.
   * User tuning point.
   */
  heroSprite: { scale: number; footAnchor: number };
  grid: { w: number; h: number };
  buildings: BuildingDef[];
  /** Additional crossing nodes; building doors are added automatically. */
  crossroads: WaypointNode[];
  /** Path graph edges: pairs of node ids ('door:citadel', 'x1', ...). */
  edges: [string, string][];
  terrain: { base: number; alt: number; path: number };
  /** Gdy obecne → renderer rysuje neonowo-szklane bryły i abstrakcyjne awatary. */
  neon?: NeonStyle;
}
