import { describe, it, expect } from 'vitest';
import { computeCoverage } from '../src/coverage';
import { DEFAULT_MAPPING, type MappingConfig } from '../src/theme/mapping';

describe('computeCoverage', () => {
  it('liczy budynki robocze (z regułą) dla DEFAULT', () => {
    const cov = computeCoverage(DEFAULT_MAPPING, []);
    expect(cov.coveredCount).toBe(cov.workingBuildings.length);
    expect(cov.workingBuildings).toContain('forge');
    expect(cov.workingBuildings).toContain('guild');
    expect(cov.workingBuildings).toContain('market');
    // citadel to fallback (kosz), nie cel reguły → nie liczony jako „roboczy"
    expect(cov.workingBuildings).not.toContain('citadel');
  });

  it('coveredCount liczy tylko budynki z podanego zbioru roboczego (socjalne pomija)', () => {
    const cfg: MappingConfig = {
      rules: [
        { kind: 'exact', tool: 'X', building: 'forge' },
        { kind: 'exact', tool: 'Y', building: 'tavern' }, // socjalny — poza zbiorem
      ],
      fallback: 'citadel',
    };
    const working = ['tower', 'forge', 'library', 'mine', 'barracks', 'market', 'guild', 'citadel'] as const;
    const cov = computeCoverage(cfg, [], working);
    expect(cov.coveredCount).toBe(1); // tylko forge; tavern nie liczony mimo reguły
  });

  it('uncoveredTools: narzędzia spadające do fallback', () => {
    const cov = computeCoverage(DEFAULT_MAPPING, ['Edit', 'TodoWrite', 'ExitPlanMode']);
    expect(cov.uncoveredTools).toContain('TodoWrite');
    expect(cov.uncoveredTools).toContain('ExitPlanMode');
    expect(cov.uncoveredTools).not.toContain('Edit');
  });

  it('uncoveredTools deduplikuje', () => {
    const cov = computeCoverage(DEFAULT_MAPPING, ['Foo', 'Foo']);
    expect(cov.uncoveredTools.filter((t) => t === 'Foo')).toHaveLength(1);
  });

  it('prefix mcp__* uznaje narzędzia mcp za pokryte', () => {
    const cov = computeCoverage(DEFAULT_MAPPING, ['mcp__slack__send']);
    expect(cov.uncoveredTools).not.toContain('mcp__slack__send');
  });

  it('detail-regułę dla narzędzia traktuje jako pokrycie (po nazwie)', () => {
    const cov = computeCoverage(DEFAULT_MAPPING, ['Bash']);
    expect(cov.uncoveredTools).not.toContain('Bash');
  });

  it('detail+exact dla tego samego narzędzia to NIE konflikt (różne tiery, precedencja)', () => {
    // DEFAULT ma Bash: detail→market ORAZ exact→mine — to projekt, nie sprzeczność.
    expect(computeCoverage(DEFAULT_MAPPING, ['Bash']).conflicts).toHaveLength(0);
  });

  it('wykrywa konflikt: dwie reguły exact tego samego narzędzia → różne budynki', () => {
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

  it('wykrywa konflikt: ten sam prefiks → różne budynki', () => {
    const cfg: MappingConfig = {
      rules: [
        { kind: 'prefix', prefix: 'mcp__', building: 'guild' },
        { kind: 'prefix', prefix: 'mcp__', building: 'market' },
      ],
      fallback: 'citadel',
    };
    expect(computeCoverage(cfg, []).conflicts).toHaveLength(1);
  });

  it('duplikat tej samej reguły na ten sam budynek to NIE konflikt', () => {
    const cfg: MappingConfig = {
      rules: [
        { kind: 'exact', tool: 'Edit', building: 'forge' },
        { kind: 'exact', tool: 'Edit', building: 'forge' },
      ],
      fallback: 'citadel',
    };
    expect(computeCoverage(cfg, []).conflicts).toHaveLength(0);
  });

  it('konflikty nie zależą od seenTools (sprzeczność tkwi w configu)', () => {
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
