/**
 * Scattered peon (minion) spawn around Hangar/Barracks doors.
 *
 * All peons are recruited from one building; without scatter they would spawn at
 * ONE point (the door), so 8 sprites overlap and look like "2 instead of 8"
 * (short-lived subagents do not have time to spread out). FNV-1a gives even
 * scatter EVEN for sequential ids (agent-1, agent-2, ...); a weak hash would map
 * them to neighboring angles (tight arc). Radius 0.9-1.8 tiles: near the door,
 * but visually distinct.
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

/**
 * Scattered hero spawn around the "home" building door.
 *
 * As with peons: heroes for one project go to the same gathering point (5
 * buildings per theme, djb2 choice by projectName), but many agents from the
 * same project WITHOUT scatter overlap and look like one. Radius 0.5-1.4 tiles,
 * closer than peons because heroes are larger.
 */
export function heroSpawnScatter(id: string): { dx: number; dy: number } {
  let h = 2166136261 >>> 0; // FNV-1a 32-bit
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const angle = ((h % 1000) / 1000) * Math.PI * 2;
  const radius = 0.5 + ((Math.floor(h / 1000) % 100) / 100) * 0.9; // 0.5–1.39
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
}
