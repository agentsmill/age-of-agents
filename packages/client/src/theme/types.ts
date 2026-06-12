import type { Projection } from '../game/projection';

export type BuildingId =
  | 'citadel'
  | 'tower'
  | 'forge'
  | 'library'
  | 'mine'
  | 'barracks'
  | 'market'
  | 'guild';

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

export interface ThemeDef {
  id: 'fantasy' | 'scifi';
  name: string;
  projection: Projection;
  /** Rozmiar kafla w px (do terenu i skali jednostek). */
  tile: number;
  grid: { w: number; h: number };
  buildings: BuildingDef[];
  /** Dodatkowe węzły-skrzyżowania; drzwi budynków dochodzą automatycznie. */
  crossroads: WaypointNode[];
  /** Krawędzie grafu ścieżek: pary id węzłów ('door:citadel', 'x1', ...). */
  edges: [string, string][];
  terrain: { base: number; alt: number; path: number };
}
