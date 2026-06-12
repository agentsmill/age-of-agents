import type { BuildingId } from './types';

/**
 * Mapowanie aktywności agenta na budynek-cel — serce metafory gry
 * (zatwierdzona tabela z projektu). Serwer wysyła samą nazwę narzędzia,
 * klient decyduje dokąd jednostka maszeruje.
 */
const TOOL_BUILDING: Record<string, BuildingId> = {
  WebSearch: 'tower',
  WebFetch: 'tower',
  Edit: 'forge',
  Write: 'forge',
  MultiEdit: 'forge',
  NotebookEdit: 'forge',
  Read: 'library',
  Grep: 'library',
  Glob: 'library',
  LSP: 'library',
  Bash: 'mine',
  BashOutput: 'mine',
  Task: 'barracks',
  Agent: 'barracks',
  Workflow: 'barracks',
};

/** Polecenia gitowe w Bash kierujemy na targ (karawana z towarem). */
const GIT_RE = /\bgit\s+(commit|push|pull|merge|rebase)\b/;

export function toolToBuilding(tool: string | undefined, detail?: string): BuildingId {
  if (!tool) return 'citadel';
  if (tool === 'Bash' && detail && GIT_RE.test(detail)) return 'market';
  if (tool.startsWith('mcp__')) return 'guild';
  return TOOL_BUILDING[tool] ?? 'citadel';
}
