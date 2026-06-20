/**
 * Fakt = znormalizowane zdarzenie semantyczne wyciągnięte z transkryptu
 * lub (w etapie 6) z hooka HTTP. Maszyna stanów konsumuje wyłącznie Fakty —
 * nie zna formatu JSONL, więc zmiany formatu CLI dotykają tylko parsera.
 */
export type Fact =
  | { kind: 'prompt'; text: string; ts: string }
  | { kind: 'title'; title: string; ts?: string }
  | { kind: 'meta'; model?: string; gitBranch?: string; permissionMode?: string; cwd?: string; ts?: string }
  | { kind: 'thinking'; ts: string }
  | { kind: 'assistant-text'; text: string; ts: string }
  | { kind: 'tool-start'; tool: string; detail?: string; messageId: string; ts: string }
  | { kind: 'usage'; messageId: string; input: number; output: number; context?: number; contextWindow?: number }
  | { kind: 'usage-total'; input: number; output: number; context?: number; contextWindow?: number }
  | { kind: 'turn-end'; ts: string }
  | { kind: 'tool-result'; isError: boolean; ts: string }
  | { kind: 'attribution'; skill?: string; plugin?: string; mcpServer?: string }
  | { kind: 'cleared'; ts: string }
  | { kind: 'awaiting'; ts: string };
