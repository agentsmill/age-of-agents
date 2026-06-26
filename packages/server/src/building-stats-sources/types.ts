import type { AgentKind } from '@agent-citadel/shared';

export interface BuildingStatsTool {
  tool: string;
  detail?: string;
}

export type BuildingStatsEvent =
  | { kind: 'tool'; ts: number; tool: string; detail?: string }
  | { kind: 'output'; ts: number; output: number; tools?: BuildingStatsTool[] }
  | { kind: 'turn-end'; ts: number }
  | { kind: 'turn-aborted'; ts: number };

export type BuildingStatsExtractor = (line: string) => BuildingStatsEvent[];

export interface BuildingStatsSource {
  id: AgentKind;
  roots(): string[];
  createExtractor(): BuildingStatsExtractor;
}
