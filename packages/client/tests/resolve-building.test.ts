import { describe, it, expect } from 'vitest';
import {
  resolveBuilding,
  DEFAULT_MAPPING,
  validateMapping,
  BUILDING_IDS,
  type MappingConfig,
} from '../src/theme/mapping';

/**
 * resolveBuilding to konfigurowalny następca toolToBuilding: ta sama logika,
 * ale tabela jest DANYMI (MappingConfig), nie kodem. DEFAULT_MAPPING musi
 * odtwarzać 1:1 dotychczasowe zachowanie (patrz mapping.test.ts).
 */
describe('resolveBuilding z DEFAULT_MAPPING', () => {
  const r = (tool?: string, detail?: string) => resolveBuilding(tool, detail, DEFAULT_MAPPING);

  it('exact: narzędzia mapują na swoje budynki', () => {
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

  it('detail: Bash + git → market (bije exact Bash→mine)', () => {
    expect(r('Bash', 'git commit -m "x"')).toBe('market');
    expect(r('Bash', 'git push origin main')).toBe('market');
  });

  it('detail: Bash bez git → mine', () => {
    expect(r('Bash', 'ls -la')).toBe('mine');
    expect(r('Bash', 'echo git is mentioned')).toBe('mine');
  });

  it('prefix: mcp__* → guild', () => {
    expect(r('mcp__pixellab__get_balance')).toBe('guild');
    expect(r('mcp__whatever')).toBe('guild');
  });

  it('fallback: nieznane / brak → citadel', () => {
    expect(r('TotallyUnknownTool')).toBe('citadel');
    expect(r(undefined)).toBe('citadel');
  });
});

describe('resolveBuilding z customowym configiem', () => {
  it('honoruje przemapowanie exact (Edit→library)', () => {
    const cfg: MappingConfig = { rules: [{ kind: 'exact', tool: 'Edit', building: 'library' }], fallback: 'citadel' };
    expect(resolveBuilding('Edit', undefined, cfg)).toBe('library');
  });

  it('warunek detail jest edytowalny (inny regex)', () => {
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

  it('precedencja: detail > prefix > exact > fallback', () => {
    const cfg: MappingConfig = {
      rules: [
        { kind: 'exact', tool: 'mcp__x', building: 'forge' },
        { kind: 'prefix', prefix: 'mcp__', building: 'guild' },
      ],
      fallback: 'citadel',
    };
    // prefix bije exact w tej implementacji (specyficzność: prefix > exact)
    expect(resolveBuilding('mcp__x', undefined, cfg)).toBe('guild');
  });

  it('przy wielu prefiksach wygrywa najdłuższy', () => {
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

  it('niepoprawny regex w detail nie wywala — pomija regułę', () => {
    const cfg: MappingConfig = {
      rules: [
        { kind: 'detail', tool: 'Bash', pattern: '(', building: 'forge' },
        { kind: 'exact', tool: 'Bash', building: 'mine' },
      ],
      fallback: 'citadel',
    };
    expect(resolveBuilding('Bash', 'cokolwiek (', cfg)).toBe('mine');
  });
});

describe('validateMapping', () => {
  it('akceptuje DEFAULT_MAPPING', () => {
    const res = validateMapping(DEFAULT_MAPPING);
    expect(res.ok).toBe(true);
  });

  it('akceptuje poprawny JSON-config', () => {
    const res = validateMapping({ rules: [{ kind: 'exact', tool: 'Edit', building: 'forge' }], fallback: 'citadel' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.config.rules).toHaveLength(1);
  });

  it('odrzuca nieznany BuildingId', () => {
    const res = validateMapping({ rules: [{ kind: 'exact', tool: 'Edit', building: 'nope' }], fallback: 'citadel' });
    expect(res.ok).toBe(false);
  });

  it('odrzuca nieznany fallback', () => {
    const res = validateMapping({ rules: [], fallback: 'nope' });
    expect(res.ok).toBe(false);
  });

  it('odrzuca zły kształt (brak rules)', () => {
    expect(validateMapping({ fallback: 'citadel' }).ok).toBe(false);
    expect(validateMapping(null).ok).toBe(false);
    expect(validateMapping('xxx').ok).toBe(false);
  });

  it('odrzuca niepoprawny regex w regule detail', () => {
    const res = validateMapping({ rules: [{ kind: 'detail', tool: 'Bash', pattern: '(', building: 'market' }], fallback: 'citadel' });
    expect(res.ok).toBe(false);
  });

  it('odrzuca regułę o nieznanym kind', () => {
    const res = validateMapping({ rules: [{ kind: 'weird', tool: 'Edit', building: 'forge' }], fallback: 'citadel' });
    expect(res.ok).toBe(false);
  });

  it('odrzuca pusty pattern w detail (inaczej byłby cichym catch-all)', () => {
    const res = validateMapping({ rules: [{ kind: 'detail', tool: 'Bash', pattern: '', building: 'market' }], fallback: 'citadel' });
    expect(res.ok).toBe(false);
  });

  it('sanityzuje: usuwa nieznane pola z reguł i z configu', () => {
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
  it('zawiera kanoniczne budynki i nie ma duplikatów', () => {
    expect(BUILDING_IDS).toContain('citadel');
    expect(BUILDING_IDS).toContain('forge');
    expect(BUILDING_IDS).toContain('guild');
    expect(new Set(BUILDING_IDS).size).toBe(BUILDING_IDS.length);
  });
});
