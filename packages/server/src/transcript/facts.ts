/**
 * Fact = normalized semantic event extracted from transcript or (in stage 6)
 * from an HTTP hook. The state machine consumes only Facts; it does not know
 * JSONL format, so CLI format changes touch only the parser.
 */
export type Fact =
  | { kind: 'prompt'; text: string; ts: string }
  | { kind: 'title'; title: string; ts?: string }
  | { kind: 'meta'; model?: string; gitBranch?: string; permissionMode?: string; cwd?: string; ts?: string }
  | { kind: 'subagent-meta'; agentId: string; parentSessionId: string; description?: string }
  | { kind: 'thinking'; ts: string }
  | { kind: 'assistant-text'; text: string; ts: string }
  | { kind: 'tool-start'; tool: string; detail?: string; messageId: string; ts: string }
  | { kind: 'usage'; messageId: string; input: number; output: number; context?: number; contextWindow?: number }
  | {
      kind: 'usage-total';
      input: number;
      output: number;
      context?: number;
      contextWindow?: number;
      cachedInput?: number;
      reasoningOutput?: number;
      last?: { input: number; output: number; cachedInput?: number; reasoningOutput?: number };
    }
  | { kind: 'turn-end'; ts: string }
  | { kind: 'turn-aborted'; ts: string }
  | { kind: 'tool-result'; isError: boolean; ts: string }
  | { kind: 'attribution'; skill?: string; plugin?: string; mcpServer?: string }
  | { kind: 'cleared'; ts: string }
  | { kind: 'awaiting'; ts: string };
