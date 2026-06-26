import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Fact } from '../transcript/facts.js';
import type { AgentSource, ClassifiedFile } from './types.js';
import { interpretOpencodePart } from './opencode.js';

/**
 * MiMo Code source (https://mimo.xiaomi.com/mimocode):
 * SQLite database at ~/.local/share/mimocode/mimocode.db
 *
 * MiMo Code is a fork of OpenCode. The SQLite schema (session, message, part)
 * and part data format (type, callID, tool, state) are identical to OpenCode.
 * We reuse interpretOpencodePart() directly.
 *
 * Key difference from OpenCode: the session table does NOT have model or
 * tokens_* columns. Model info is in message.data.model; tokens are extracted
 * from part data by the poller.
 */

/** Path to MiMo Code database. */
export function getMimoCodeDbPath(): string {
  return join(homedir(), '.local', 'share', 'mimocode', 'mimocode.db');
}

/**
 * MiMo Code source: compatible with AgentSource, but used only for parseLine
 * (not file watching, because MiMo Code uses SQLite).
 */
export const mimocodeSource: AgentSource = {
  id: 'mimocode',
  roots: () => [], // No file watching — SQLite polling.
  depth: 0,
  classify(_path: string, _root: string): ClassifiedFile {
    return { kind: 'other' }; // MiMo Code does not use classify.
  },
  parseLine(line: string): Fact[] {
    // Delegate to OpenCode parser — identical part data format.
    try {
      const data = JSON.parse(line);
      const ts = new Date().toISOString();
      return interpretOpencodePart(data, ts);
    } catch {
      return [];
    }
  },
};
