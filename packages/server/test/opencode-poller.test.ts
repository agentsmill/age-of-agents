import { afterEach, describe, expect, it, vi } from 'vitest';
import type { World } from '../src/world.js';

describe('OpenCodePoller', () => {
  afterEach(() => {
    vi.doUnmock('better-sqlite3');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('does not log started when initial schema mismatch stops the poller', async () => {
    class SchemaMismatchDb {
      prepare(): { all(): never } {
        return {
          all() {
            throw new Error('no such table: session');
          },
        };
      }

      close(): void {}
    }

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.doMock('better-sqlite3', () => ({ default: SchemaMismatchDb }));

    const { OpenCodePoller } = await import('../src/sources/opencode-poller.js');
    const poller = new OpenCodePoller({} as World);

    await poller.start();

    expect(log).not.toHaveBeenCalledWith('[OpenCode] Poller started');
  });
});
