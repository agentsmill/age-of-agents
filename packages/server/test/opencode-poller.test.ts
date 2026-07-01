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

  it('retries with backoff when the database file does not exist yet', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    class MissingThenPresentDb {
      constructor() {
        attempts++;
        if (attempts < 3) {
          const err = new Error('unable to open database file') as Error & { code: string };
          err.code = 'SQLITE_CANTOPEN';
          throw err;
        }
      }

      prepare(): { all(): unknown[] } {
        return { all: () => [] };
      }

      close(): void {}
    }

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.doMock('better-sqlite3', () => ({ default: MissingThenPresentDb }));

    const { OpenCodePoller } = await import('../src/sources/opencode-poller.js');
    const poller = new OpenCodePoller({} as World);

    await poller.start();
    expect(attempts).toBe(1);
    expect(warn).not.toHaveBeenCalled();
    expect(log.mock.calls.filter(([m]) => String(m).includes('Database not found'))).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5_000); // 2nd attempt: still missing (no repeat log)
    expect(attempts).toBe(2);
    expect(log.mock.calls.filter(([m]) => String(m).includes('Database not found'))).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(10_000); // 3rd attempt: file appeared
    expect(attempts).toBe(3);
    expect(log).toHaveBeenCalledWith('[OpenCode] Poller started');

    await poller.stop();
    vi.useRealTimers();
  });

  it('stops retrying once stop() is called while waiting for the database', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    class AlwaysMissingDb {
      constructor() {
        attempts++;
        const err = new Error('unable to open database file') as Error & { code: string };
        err.code = 'SQLITE_CANTOPEN';
        throw err;
      }
    }

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.doMock('better-sqlite3', () => ({ default: AlwaysMissingDb }));

    const { OpenCodePoller } = await import('../src/sources/opencode-poller.js');
    const poller = new OpenCodePoller({} as World);

    await poller.start();
    await poller.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(attempts).toBe(1);

    vi.useRealTimers();
  });

  it('reports better-sqlite3 as the problem only when the module is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.doMock('better-sqlite3', () => {
      throw new Error("Cannot find module 'better-sqlite3'");
    });

    const { OpenCodePoller } = await import('../src/sources/opencode-poller.js');
    const poller = new OpenCodePoller({} as World);

    await poller.start();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('better-sqlite3 unavailable'),
      expect.anything(),
    );
  });

  it('does not blame better-sqlite3 for a non-recoverable open error', async () => {
    class UnreadableDb {
      constructor() {
        const err = new Error('database disk image is malformed') as Error & { code: string };
        err.code = 'SQLITE_CORRUPT';
        throw err;
      }
    }

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.doMock('better-sqlite3', () => ({ default: UnreadableDb }));

    const { OpenCodePoller } = await import('../src/sources/opencode-poller.js');
    const poller = new OpenCodePoller({} as World);

    await poller.start();

    expect(warn).toHaveBeenCalledWith('[OpenCode] Could not open database:', 'database disk image is malformed');
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('npm install better-sqlite3'));
  });
});
