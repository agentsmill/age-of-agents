/**
 * Projekcje: logiczna siatka kartezjańska (gx, gy) -> piksele ekranu.
 * Logika gry (ścieżki, ruch, pozycje) NIGDY nie działa na współrzędnych
 * ekranowych — tylko renderowanie przechodzi przez projekcję.
 */
export interface Projection {
  toScreen(gx: number, gy: number): { x: number; y: number };
  /** Wartość do sortowania głębokości (zIndex) jednostek/budynków. */
  depth(gx: number, gy: number): number;
}

export function topdown(tile: number): Projection {
  return {
    toScreen: (gx, gy) => ({ x: gx * tile, y: gy * tile }),
    depth: (_gx, gy) => gy,
  };
}

/** Klasyczny diament 2:1 (szerokość kafla 2× wysokość). */
export function isometric(tileW: number, tileH: number): Projection {
  return {
    toScreen: (gx, gy) => ({ x: ((gx - gy) * tileW) / 2, y: ((gx + gy) * tileH) / 2 }),
    depth: (gx, gy) => gx + gy,
  };
}
