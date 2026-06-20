import { describe, it, expect } from 'vitest';
import { AGENT_PROVIDERS, resolveProvider, type ProviderInfo } from '../src/theme/providers';
import type { AgentKind } from '@agent-citadel/shared';

/**
 * Jedno źródło prawdy o providerach: tablica AGENT_PROVIDERS (agent → herb)
 * + resolveProvider (degradacja nieznanego/undefined do claude = brak herba).
 * Kolory MUSZĄ odtwarzać 1:1 dotychczasowe odznaki (unit.ts / SidePanel / ProjectSwitcher),
 * żeby konsolidacja nic nie zmieniła wizualnie poza dodaniem herbów w „Widzianych modelach".
 */
describe('AGENT_PROVIDERS', () => {
  it('pokrywa wszystkie warianty AgentKind', () => {
    const kinds: AgentKind[] = ['claude', 'codex', 'opencode', 'koda'];
    for (const k of kinds) {
      expect(AGENT_PROVIDERS[k]).toBeDefined();
      expect(AGENT_PROVIDERS[k].kind).toBe(k);
    }
  });

  it('claude = brak herba (color === null)', () => {
    expect(AGENT_PROVIDERS.claude.color).toBeNull();
  });

  it('kolory i etykiety odtwarzają dzisiejsze odznaki 1:1', () => {
    expect(AGENT_PROVIDERS.codex).toMatchObject({ label: 'Codex', labelShort: 'C', color: '#10a37f' });
    expect(AGENT_PROVIDERS.opencode).toMatchObject({ label: 'OpenCode', labelShort: 'O', color: '#f59e0b' });
    expect(AGENT_PROVIDERS.koda).toMatchObject({ label: 'Koda', labelShort: 'K', color: '#8b5cf6' });
  });

  it('kolory nie-claude to poprawny zapis CSS #rrggbb', () => {
    for (const info of Object.values(AGENT_PROVIDERS) as ProviderInfo[]) {
      if (info.color !== null) expect(info.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('resolveProvider', () => {
  it('znany agent → jego metadane', () => {
    expect(resolveProvider('codex')).toBe(AGENT_PROVIDERS.codex);
    expect(resolveProvider('opencode')).toBe(AGENT_PROVIDERS.opencode);
    expect(resolveProvider('koda')).toBe(AGENT_PROVIDERS.koda);
  });

  it('undefined → claude (zgodność wsteczna z HeroSnapshot.agent?)', () => {
    expect(resolveProvider(undefined)).toBe(AGENT_PROVIDERS.claude);
  });

  it('nieznany string (korupcja danych) → degraduje do claude, nie wybucha', () => {
    expect(resolveProvider('gemini' as AgentKind)).toBe(AGENT_PROVIDERS.claude);
  });

  it('nazwy odziedziczonych właściwości obiektu → degraduje do claude', () => {
    expect(resolveProvider('toString' as AgentKind)).toBe(AGENT_PROVIDERS.claude);
    expect(resolveProvider('__proto__' as AgentKind)).toBe(AGENT_PROVIDERS.claude);
  });
});
