import { describe, it, expect } from 'vitest';
import {
  resolveBuilding,
  DEFAULT_MAPPING,
  validateMapping,
  BUILDING_IDS,
  type MappingConfig,
} from '../src/theme/mapping';

/**
 * resolveBuilding is the configurable successor to toolToBuilding: same logic,
 * but the table is DATA (MappingConfig), not code. DEFAULT_MAPPING must
 * reproduce the existing behavior 1:1 (see mapping.test.ts).
 */
describe('resolveBuilding with DEFAULT_MAPPING', () => {
  const r = (tool?: string, detail?: string) => resolveBuilding(tool, detail, DEFAULT_MAPPING);

  it('exact: tools map to their buildings', () => {
    expect(r('Edit')).toBe('forge');
    expect(r('Write')).toBe('forge');
    expect(r('Read')).toBe('library');
    expect(r('Grep')).toBe('library');
    expect(r('Bash')).toBe('mine');
    expect(r('Task')).toBe('barracks');
    expect(r('WebSearch')).toBe('tower');
    expect(r('StructuredOutput')).toBe('barracks');
    expect(r('ToolSearch')).toBe('library');
    expect(r('KillShell')).toBe('mine');
  });

  it('detail: Bash + git -> market (beats exact Bash->mine)', () => {
    expect(r('Bash', 'git commit -m "x"')).toBe('market');
    expect(r('Bash', 'git push origin main')).toBe('market');
  });

  it('detail: Bash without git -> mine', () => {
    expect(r('Bash', 'ls -la')).toBe('mine');
    expect(r('Bash', 'echo git is mentioned')).toBe('mine');
  });

  it('prefix: mcp__* -> guild', () => {
    expect(r('mcp__pixellab__get_balance')).toBe('guild');
    expect(r('mcp__whatever')).toBe('guild');
  });

  it('fallback: unknown / missing -> citadel', () => {
    expect(r('TotallyUnknownTool')).toBe('citadel');
    expect(r(undefined)).toBe('citadel');
  });
});

describe('resolveBuilding with custom config', () => {
  it('honors exact remapping (Edit->library)', () => {
    const cfg: MappingConfig = { rules: [{ kind: 'exact', tool: 'Edit', building: 'library' }], fallback: 'citadel' };
    expect(resolveBuilding('Edit', undefined, cfg)).toBe('library');
  });

  it('detail condition is editable (different regex)', () => {
    const cfg: MappingConfig = {
      rules: [
        { kind: 'detail', tool: 'Bash', pattern: 'docker\\s+build', building: 'forge' },
        { kind: 'exact', tool: 'Bash', building: 'mine' },
      ],
      fallback: 'citadel',
    };
    expect(resolveBuilding('Bash', 'docker build .', cfg)).toBe('forge');
    expect(resolveBuilding('Bash', 'ls', cfg)).toBe('mine');
  });

  it('precedence: detail > prefix > exact > fallback', () => {
    const cfg: MappingConfig = {
      rules: [
        { kind: 'exact', tool: 'mcp__x', building: 'forge' },
        { kind: 'prefix', prefix: 'mcp__', building: 'guild' },
      ],
      fallback: 'citadel',
    };
    // prefix beats exact in this implementation (specificity: prefix > exact)
    expect(resolveBuilding('mcp__x', undefined, cfg)).toBe('guild');
  });

  it('with many prefixes, the longest wins', () => {
    const cfg: MappingConfig = {
      rules: [
        { kind: 'prefix', prefix: 'mcp__', building: 'guild' },
        { kind: 'prefix', prefix: 'mcp__slack__', building: 'market' },
      ],
      fallback: 'citadel',
    };
    expect(resolveBuilding('mcp__slack__send', undefined, cfg)).toBe('market');
    expect(resolveBuilding('mcp__other', undefined, cfg)).toBe('guild');
  });

  it('invalid regex in detail does not crash - skips the rule', () => {
    const cfg: MappingConfig = {
      rules: [
        { kind: 'detail', tool: 'Bash', pattern: '(', building: 'forge' },
        { kind: 'exact', tool: 'Bash', building: 'mine' },
      ],
      fallback: 'citadel',
    };
    expect(resolveBuilding('Bash', 'anything (', cfg)).toBe('mine');
  });
});

describe('validateMapping', () => {
  it('accepts DEFAULT_MAPPING', () => {
    const res = validateMapping(DEFAULT_MAPPING);
    expect(res.ok).toBe(true);
  });

  it('accepts valid JSON config', () => {
    const res = validateMapping({ rules: [{ kind: 'exact', tool: 'Edit', building: 'forge' }], fallback: 'citadel' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.config.rules).toHaveLength(1);
  });

  it('rejects unknown BuildingId', () => {
    const res = validateMapping({ rules: [{ kind: 'exact', tool: 'Edit', building: 'nope' }], fallback: 'citadel' });
    expect(res.ok).toBe(false);
  });

  it('rejects unknown fallback', () => {
    const res = validateMapping({ rules: [], fallback: 'nope' });
    expect(res.ok).toBe(false);
  });

  it('rejects bad shape (missing rules)', () => {
    expect(validateMapping({ fallback: 'citadel' }).ok).toBe(false);
    expect(validateMapping(null).ok).toBe(false);
    expect(validateMapping('xxx').ok).toBe(false);
  });

  it('rejects invalid regex in detail rule', () => {
    const res = validateMapping({ rules: [{ kind: 'detail', tool: 'Bash', pattern: '(', building: 'market' }], fallback: 'citadel' });
    expect(res.ok).toBe(false);
  });

  it('rejects rule with unknown kind', () => {
    const res = validateMapping({ rules: [{ kind: 'weird', tool: 'Edit', building: 'forge' }], fallback: 'citadel' });
    expect(res.ok).toBe(false);
  });

  it('rejects empty pattern in detail (otherwise it would be a silent catch-all)', () => {
    const res = validateMapping({ rules: [{ kind: 'detail', tool: 'Bash', pattern: '', building: 'market' }], fallback: 'citadel' });
    expect(res.ok).toBe(false);
  });

  it('sanitizes: removes unknown fields from rules and config', () => {
    const res = validateMapping({
      extra: 1,
      rules: [{ kind: 'exact', tool: 'Edit', building: 'forge', foo: 9, pattern: '(' }],
      fallback: 'citadel',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.config.rules[0]).toEqual({ kind: 'exact', tool: 'Edit', building: 'forge' });
      expect(Object.keys(res.config).sort()).toEqual(['fallback', 'rules']);
    }
  });
});

describe('BUILDING_IDS', () => {
  it('contains canonical buildings and has no duplicates', () => {
    expect(BUILDING_IDS).toContain('citadel');
    expect(BUILDING_IDS).toContain('forge');
    expect(BUILDING_IDS).toContain('guild');
    expect(new Set(BUILDING_IDS).size).toBe(BUILDING_IDS.length);
  });
});
