import { resolveProvider, type AgentKind } from '@agent-citadel/shared';

/**
 * Graficzne herby providerów (Faza 2) — theme-agnostic PNG-i w public/assets/emblems.
 * Warstwa PODSTAWOWA tożsamości providera; kolor z AGENT_PROVIDERS pozostaje fallbackiem,
 * gdy assetu brak (np. przyszły provider bez grafiki). Ścieżka liczona po stronie klienta
 * (render concern) — celowo NIE w shared.
 */
export const EMBLEM_BASE = '/assets/emblems';

/** Ścieżka PNG herba dla agenta. Claude/nieznany/undefined → brak widocznego herba. */
export function emblemSrc(agent: AgentKind | undefined): string | undefined {
  const provider = resolveProvider(agent);
  if (provider.color === null) return undefined;
  return `${EMBLEM_BASE}/${provider.kind}.png`;
}
