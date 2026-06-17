import type { BuildingId, MappingConfig, MappingRule } from './theme/mapping';

/**
 * „Jak to jest pokryte" — czysta analiza mapy względem narzędzi faktycznie
 * widzianych w żywych logach (`seenTools`). Bez I/O, w pełni testowalna.
 */
export interface Coverage {
  /** Budynki będące celem ≥1 reguły (budynki „robocze"). */
  workingBuildings: BuildingId[];
  coveredCount: number;
  /** Widziane narzędzia, których żadna reguła nie łapie → spadają do fallbacku. */
  uncoveredTools: string[];
  /** Sprzeczne reguły: ten sam wyzwalacz (tier+klucz) wskazuje RÓŻNE budynki. */
  conflicts: { label: string; buildings: BuildingId[] }[];
}

/** Czy reguła łapie nazwę narzędzia (detail — po nazwie narzędzia, bez ewaluacji regexu). */
function ruleMatchesTool(rule: MappingRule, tool: string): boolean {
  if (rule.kind === 'exact') return rule.tool === tool;
  if (rule.kind === 'detail') return rule.tool === tool;
  return tool.startsWith(rule.prefix); // prefix
}

/**
 * Klucz tożsamości wyzwalacza w obrębie tieru. Konflikt liczymy TYLKO między
 * regułami tego samego klucza — bo precedencja (detail > prefix > exact)
 * deterministycznie rozstrzyga reguły różnych tierów (np. Bash detail→market
 * vs Bash exact→mine to projekt, nie sprzeczność).
 */
function ruleKey(rule: MappingRule): string {
  if (rule.kind === 'exact') return `exact:${rule.tool}`;
  if (rule.kind === 'prefix') return `prefix:${rule.prefix}`;
  return `detail:${rule.tool}:${rule.pattern}`;
}

export function computeCoverage(
  config: MappingConfig,
  seenTools: string[],
  workingSet?: readonly BuildingId[],
): Coverage {
  const workingBuildings = [...new Set(config.rules.map((r) => r.building))];
  // coveredCount liczy budynki ROBOCZE z regułą — jeśli podano zbiór roboczy,
  // pomija budynki socjalne (etykieta paska mówi „budynki robocze pokryte").
  const coveredCount = workingSet
    ? workingBuildings.filter((b) => workingSet.includes(b)).length
    : workingBuildings.length;

  // Nieprzypisane: widziane narzędzia, których żadna reguła nie łapie (po nazwie).
  const uncoveredTools = [...new Set(seenTools)].filter(
    (tool) => !config.rules.some((rule) => ruleMatchesTool(rule, tool)),
  );

  // Konflikty: ten sam klucz wyzwalacza prowadzi do >1 różnego budynku.
  const byKey = new Map<string, Set<BuildingId>>();
  for (const rule of config.rules) {
    const key = ruleKey(rule);
    (byKey.get(key) ?? byKey.set(key, new Set()).get(key)!).add(rule.building);
  }
  const conflicts = [...byKey.entries()]
    .filter(([, buildings]) => buildings.size > 1)
    .map(([label, buildings]) => ({ label, buildings: [...buildings] }));

  return {
    workingBuildings,
    coveredCount,
    uncoveredTools,
    conflicts,
  };
}
