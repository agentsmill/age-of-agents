import type { Projection } from '../game/projection';
import type { BuildingId } from '@agent-citadel/shared';

// BuildingId jest kanoniczny w @agent-citadel/shared (serwer też go potrzebuje).
export type { BuildingId };

export interface BuildingDef {
  id: BuildingId;
  /** Nazwa wyświetlana w danym motywie (np. Kuźnia / Fabryka dronów). */
  label: string;
  /** Pozycja na siatce logicznej (lewy-górny róg). */
  gx: number;
  gy: number;
  /** Rozmiar w kaflach siatki. */
  w: number;
  h: number;
  /** Węzeł grafu ścieżek przy wejściu budynku. */
  door: { gx: number; gy: number };
  /** Kolor placeholdera (zanim wgrasz assety). */
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
  /** Styl rysowania placeholderów: domek top-down vs blok izometryczny. */
  style: 'topdown' | 'iso';
  projection: Projection;
  /** Rozmiar kafla w px (do terenu i skali jednostek). */
  tile: number;
  /**
   * Kalibracja sprite'ów bohaterów, zależna od źródła generacji PixelLab
   * (fantasy = standard 68px, sci-fi = v3 92px). `scale` skaluje canvas do
   * rozmiaru jednostki; `footAnchor` (0..1) ustawia stopę na pozycji jednostki.
   * Punkt strojenia usera.
   */
  heroSprite: { scale: number; footAnchor: number };
  grid: { w: number; h: number };
  buildings: BuildingDef[];
  /** Dodatkowe węzły-skrzyżowania; drzwi budynków dochodzą automatycznie. */
  crossroads: WaypointNode[];
  /** Krawędzie grafu ścieżek: pary id węzłów ('door:citadel', 'x1', ...). */
  edges: [string, string][];
  terrain: { base: number; alt: number; path: number };
  /** Gdy obecne → renderer rysuje neonowo-szklane bryły i abstrakcyjne awatary. */
  neon?: NeonStyle;
}
