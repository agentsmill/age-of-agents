import { homedir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { interpretLine } from '../transcript/parser.js';
import { rootIfExists } from './config.js';
import type { AgentSource, ClassifiedFile } from './types.js';

/**
 * Claude Code source: ~/.claude/projects/<project>/<uuid>.jsonl (heroes)
 * and <session>/subagents/**​/agent-<id>.jsonl (peons).
 */
export const claudeSource: AgentSource = {
  id: 'claude',
  roots: () => rootIfExists(join(homedir(), '.claude', 'projects')),
  depth: 6,
  classify(path: string, root: string): ClassifiedFile {
    const rel = path.slice(root.length + 1);
    const parts = rel.split(sep);
    const file = basename(path, '.jsonl');
    if (parts.length === 2) {
      return { kind: 'session', sessionId: file, projectDir: parts[0] };
    }
    if (parts.includes('subagents') && basename(path).startsWith('agent-')) {
      return { kind: 'subagent', agentId: file.replace(/^agent-/, ''), parentSessionId: parts[1] };
    }
    return { kind: 'other' };
  },
  parseLine: interpretLine,
};
