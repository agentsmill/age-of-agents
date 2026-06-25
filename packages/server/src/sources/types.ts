import type { AgentKind } from '@agent-citadel/shared';
import type { Fact } from '../transcript/facts.js';

export type { AgentKind };
export type SourceId = AgentKind;

/** Result of source file classification: session (hero), subagent (peon), or irrelevant. */
export interface ClassifiedFile {
  kind: 'session' | 'subagent' | 'other';
  sessionId?: string;
  projectDir?: string;
  agentId?: string; // subagent
  parentSessionId?: string; // subagent
}

/**
 * Adapter for one CLI (Claude/Codex). Watcher is generic; all location and
 * format knowledge lives in the source. parseLine is a PURE function (testable).
 */
export interface AgentSource {
  id: AgentKind;
  /** Katalog(i) do obserwacji, np. ~/.claude/projects lub ~/.codex/sessions. */
  roots(): string[];
  /** chokidar depth (default 6). */
  depth?: number;
  classify(path: string, root: string): ClassifiedFile;
  parseLine(line: string): Fact[];
}
