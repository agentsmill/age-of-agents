/**
 * Wypełnianie prostokątnego obszaru ekranu kaflami izometrycznymi.
 *
 * Projekcja izo (toScreen): sx = (gx−gy)·tileW/2, sy = (gx+gy)·tileH/2.
 * Prostokąt indeksów siatki rzutuje się na DIAMENT, a diament indeksów — na
 * PROSTOKĄT. Żeby pokryć prostokątny viewport kaflami, trzeba więc renderować
 * diamentowy zakres komórek (część o ujemnych/nadmiarowych indeksach).
 */

export interface WorldRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CellRange {
  gxMin: number;
  gxMax: number;
  gyMin: number;
  gyMax: number;
}

/** Odwrotność projekcji izometrycznej: piksel ekranu → współrzędna siatki (float). */
export function invIso(tileW: number, tileH: number, sx: number, sy: number): { gx: number; gy: number } {
  return { gx: sx / tileW + sy / tileH, gy: sy / tileH - sx / tileW };
}

/**
 * Zakres indeksów komórek (z paddingiem ±1) gwarantujący, że renderowanie
 * każdej komórki z tego zakresu pokryje cały prostokąt świata. Odwracamy
 * projekcję dla 4 rogów prostokąta; ekstrema gx/gy (funkcja liniowa) leżą w
 * rogach, więc min/max po rogach jest dokładne. Padding zabezpiecza poszarpaną
 * krawędź teselacji.
 */
export function isoFillRange(tileW: number, tileH: number, rect: WorldRect): CellRange {
  const corners = [
    invIso(tileW, tileH, rect.minX, rect.minY),
    invIso(tileW, tileH, rect.maxX, rect.minY),
    invIso(tileW, tileH, rect.minX, rect.maxY),
    invIso(tileW, tileH, rect.maxX, rect.maxY),
  ];
  const gxs = corners.map((c) => c.gx);
  const gys = corners.map((c) => c.gy);
  return {
    gxMin: Math.floor(Math.min(...gxs)) - 1,
    gxMax: Math.ceil(Math.max(...gxs)) + 1,
    gyMin: Math.floor(Math.min(...gys)) - 1,
    gyMax: Math.ceil(Math.max(...gys)) + 1,
  };
}
