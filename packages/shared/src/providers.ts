import type { AgentKind } from './index.js';

/** Wizualny „herb" providera — jedno źródło prawdy dla mapy (Pixi) i paneli (React/CSS). */
export interface ProviderInfo {
  /** Klucz providera (= AgentKind). */
  kind: AgentKind;
  /** Pełna nazwa marki do paneli, np. 'Codex'. Nazwa własna — nie tłumaczona. */
  label: string;
  /** Skrót 1-literowy do mapy i kompaktowych chipów, np. 'C'. */
  labelShort: string;
  /** Kolor herba w formacie CSS '#rrggbb'. null = brak herba (Claude = provider domyślny). */
  color: string | null;
}

/**
 * Tablica providerów — jedyna definicja agent→herb w całym repo.
 * Kolory są ZGODNE z dotychczasowymi odznakami (unit.ts / SidePanel / ProjectSwitcher),
 * więc konsolidacja nie zmienia wyglądu. Claude celowo bez herba (color: null) —
 * to provider domyślny/większościowy, herb oznacza „kto inny niż Claude".
 */
export const AGENT_PROVIDERS: Record<AgentKind, ProviderInfo> = {
  claude: { kind: 'claude', label: 'Claude', labelShort: 'C', color: null },
  codex: { kind: 'codex', label: 'Codex', labelShort: 'C', color: '#10a37f' }, // zielony OpenAI
  opencode: { kind: 'opencode', label: 'OpenCode', labelShort: 'O', color: '#f59e0b' }, // amber-500
  koda: { kind: 'koda', label: 'Koda', labelShort: 'K', color: '#8b5cf6' }, // violet-500
  'local-llm': { kind: 'local-llm', label: 'Local LLM', labelShort: 'L', color: '#22d3ee' }, // cyan-400
};

/**
 * Metadane providera dla danego agenta. Nieznany/undefined → claude
 * (zgodność wsteczna z HeroSnapshot.agent? + bezpieczna degradacja korupcji danych).
 */
export function resolveProvider(agent: unknown): ProviderInfo {
  if (typeof agent === 'string' && Object.hasOwn(AGENT_PROVIDERS, agent)) {
    return AGENT_PROVIDERS[agent as AgentKind];
  }
  return AGENT_PROVIDERS.claude;
}
