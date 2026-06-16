import type { HeroSnapshot, WieldedArsenal } from '@agent-citadel/shared';

/** Goła nazwa skilla (ucina namespace pluginu: 'superpowers:brainstorming' → 'brainstorming'). */
export function bareName(id: string): string {
  return id.split(':').pop() ?? id;
}

/** Unia `wielded` bohaterów danego miasta. Skille znormalizowane do gołej nazwy
 *  (pasują do ArsenalSkill.id z frontmattera). Konektory/pluginy 1:1. */
export function aggregateWielded(heroes: Record<string, HeroSnapshot>, projectDir: string): WieldedArsenal {
  const skills = new Set<string>();
  const connectors = new Set<string>();
  const plugins = new Set<string>();
  for (const h of Object.values(heroes)) {
    if (h.projectDir !== projectDir || !h.wielded) continue;
    h.wielded.skills.forEach((s) => skills.add(bareName(s)));
    h.wielded.connectors.forEach((c) => connectors.add(c));
    h.wielded.plugins.forEach((p) => plugins.add(p));
  }
  return { skills: [...skills], connectors: [...connectors], plugins: [...plugins] };
}
