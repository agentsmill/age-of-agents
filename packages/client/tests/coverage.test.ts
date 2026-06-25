import { describe, it, expect } from 'vitest';
import { computeCoverage } from '../src/coverage';
import { DEFAULT_MAPPING, type MappingConfig } from '../src/theme/mapping';

describe('computeCoverage', () => {
  it('counts working buildings (with a rule) for DEFAULT', () => {
    const cov = computeCoverage(DEFAULT_MAPPING, []);
    expect(cov.coveredCount).toBe(cov.workingBuildings.length);
    expect(cov.workingBuildings).toContain('forge');
    expect(cov.workingBuildings).toContain('guild');
    expect(cov.workingBuildings).toContain('market');
    // citadel is fallback (bucket), not a rule target -> not counted as "working"
    expect(cov.workingBuildings).not.toContain('citadel');
  });

  it('coveredCount counts only buildings from the provided working set (skips social)', () => {
    const cfg: MappingConfig = {
      rules: [
        { kind: 'exact', tool: 'X', building: 'forge' },
        { kind: 'exact', tool: 'Y', building: 'tavern' }, // social - outside the set
      ],
      fallback: 'citadel',
    };
    const working = ['tower', 'forge', 'library', 'mine', 'barracks', 'market', 'guild', 'citadel'] as const;
    const cov = computeCoverage(cfg, [], working);
    expect(cov.coveredCount).toBe(1); // only forge; tavern is not counted despite the rule
  });

  it('uncoveredTools: tools falling to fallback', () => {
    const cov = computeCoverage(DEFAULT_MAPPING, ['Edit', 'TodoWrite', 'ExitPlanMode']);
    expect(cov.uncoveredTools).toContain('TodoWrite');
    expect(cov.uncoveredTools).toContain('ExitPlanMode');
    expect(cov.uncoveredTools).not.toContain('Edit');
  });

  it('uncoveredTools deduplicates', () => {
    const cov = computeCoverage(DEFAULT_MAPPING, ['Foo', 'Foo']);
    expect(cov.uncoveredTools.filter((t) => t === 'Foo')).toHaveLength(1);
  });

  it('prefix mcp__* treats mcp tools as covered', () => {
    const cov = computeCoverage(DEFAULT_MAPPING, ['mcp__slack__send']);
    expect(cov.uncoveredTools).not.toContain('mcp__slack__send');
  });

  it('detail rule for a tool counts as coverage (by name)', () => {
    const cov = computeCoverage(DEFAULT_MAPPING, ['Bash']);
    expect(cov.uncoveredTools).not.toContain('Bash');
  });

  it('detail+exact for the same tool is NOT a conflict (different tiers, precedence)', () => {
    // DEFAULT has Bash: detail->market AND exact->mine - that is design, not a conflict.
    expect(computeCoverage(DEFAULT_MAPPING, ['Bash']).conflicts).toHaveLength(0);
  });

  it('detects conflict: two exact rules for the same tool -> different buildings', () => {
    const cfg: MappingConfig = {
      rules: [
        { kind: 'exact', tool: 'Edit', building: 'forge' },
        { kind: 'exact', tool: 'Edit', building: 'library' },
      ],
      fallback: 'citadel',
    };
    const cov = computeCoverage(cfg, []);
    expect(cov.conflicts).toHaveLength(1);
    expect([...cov.conflicts[0].buildings].sort()).toEqual(['forge', 'library']);
  });

  it('detects conflict: same prefix -> different buildings', () => {
    const cfg: MappingConfig = {
      rules: [
        { kind: 'prefix', prefix: 'mcp__', building: 'guild' },
        { kind: 'prefix', prefix: 'mcp__', building: 'market' },
      ],
      fallback: 'citadel',
    };
    expect(computeCoverage(cfg, []).conflicts).toHaveLength(1);
  });

  it('duplicate of the same rule for the same building is NOT a conflict', () => {
    const cfg: MappingConfig = {
      rules: [
        { kind: 'exact', tool: 'Edit', building: 'forge' },
        { kind: 'exact', tool: 'Edit', building: 'forge' },
      ],
      fallback: 'citadel',
    };
    expect(computeCoverage(cfg, []).conflicts).toHaveLength(0);
  });

  it('conflicts do not depend on seenTools (contradiction is in config)', () => {
    const cfg: MappingConfig = {
      rules: [
        { kind: 'exact', tool: 'Edit', building: 'forge' },
        { kind: 'exact', tool: 'Edit', building: 'mine' },
      ],
      fallback: 'citadel',
    };
    expect(computeCoverage(cfg, []).conflicts).toHaveLength(1);
  });
});
