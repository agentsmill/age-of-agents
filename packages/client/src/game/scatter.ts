/**
 * Rozsianie spawnu peonów (minionów) wokół drzwi Hangaru/Koszar.
 *
 * Wszystkie peony rekrutują się z jednego budynku — bez rozrzutu spawnowałyby się
 * w JEDNYM punkcie (drzwi), więc 8 sprite'ów stoi na sobie i wygląda jak „2 zamiast 8"
 * (krótkożyciowi subagenci nie zdążą się rozejść). Hash FNV-1a daje równy rozrzut
 * NAWET dla sekwencyjnych id (agent-1, agent-2, …) — słaby hash mapowałby je na
 * sąsiednie kąty (ciasny łuk). Promień 0.9–1.8 kafla: blisko drzwi, ale rozróżnialnie.
 */
export function peonSpawnScatter(id: string): { dx: number; dy: number } {
  let h = 2166136261 >>> 0; // FNV-1a 32-bit
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const angle = ((h % 1000) / 1000) * Math.PI * 2;
  const radius = 0.9 + ((Math.floor(h / 1000) % 100) / 100) * 0.9; // 0.9–1.79
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
}
