import { join } from 'node:path';
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { getOpencodeDbPath } from '../src/sources/opencode.js';

describe('getOpencodeDbPath', () => {
  it('defaults to ~/.local/share/opencode/opencode.db (OpenCode xdg-basedir fallback)', () => {
    expect(getOpencodeDbPath({})).toBe(join(homedir(), '.local', 'share', 'opencode', 'opencode.db'));
  });

  it('honors XDG_DATA_HOME like OpenCode itself does', () => {
    expect(getOpencodeDbPath({ XDG_DATA_HOME: '/custom/data' })).toBe(
      join('/custom/data', 'opencode', 'opencode.db'),
    );
  });

  it('ignores a blank XDG_DATA_HOME', () => {
    expect(getOpencodeDbPath({ XDG_DATA_HOME: '  ' })).toBe(
      join(homedir(), '.local', 'share', 'opencode', 'opencode.db'),
    );
  });
});
