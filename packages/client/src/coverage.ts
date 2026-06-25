import type { BuildingId, MappingConfig, MappingRule } from './theme/mapping';

/**
 * "How well is this covered" - pure map analysis against tools actually seen
 * in live logs (`seenTools`). No I/O, fully testable.
 */
export interface Coverage {
  /** Buildings targeted by at least one rule ("working" buildings). */
  workingBuildings: BuildingId[];
  coveredCount: number;
  /** Seen tools that no rule catches -> they fall back to the default target. */
  uncoveredTools: string[];
  /** Conflicting rules: the same trigger (tier+key) points to DIFFERENT buildings. */
  conflicts: { label: string; buildings: BuildingId[] }[];
}

/** Whether a rule catches the tool name (detail = by tool name, without evaluating the regex). */
function ruleMatchesTool(rule: MappingRule, tool: string): boolean {
  if (rule.kind === 'exact') return rule.tool === tool;
  if (rule.kind === 'detail') return rule.tool === tool;
  return tool.startsWith(rule.prefix); // prefix
}

/**
 * Trigger identity key within a tier. Count conflicts ONLY between rules with
 * the same key, because precedence (detail > prefix > exact) deterministically
 * resolves rules across different tiers (for example Bash detail->market vs
 * Bash exact->mine is design, not a conflict).
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
  // coveredCount includes WORKING buildings that have a rule; if a working set
  // is provided, skip social buildings (the bar says "working buildings covered").
  const coveredCount = workingSet
    ? workingBuildings.filter((b) => workingSet.includes(b)).length
    : workingBuildings.length;

  // Unassigned: seen tools that no rule catches (by name).
  const uncoveredTools = [...new Set(seenTools)].filter(
    (tool) => !config.rules.some((rule) => ruleMatchesTool(rule, tool)),
  );

  // Conflicts: the same trigger key leads to more than one distinct building.
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
