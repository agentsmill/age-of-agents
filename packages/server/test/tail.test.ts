import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TailRegistry } from '../src/transcript/tail.js';

describe('TailRegistry', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'citadel-tail-'));
    file = join(dir, 'session.jsonl');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('delivers only complete lines and keeps partial line in buffer', async () => {
    const tails = new TailRegistry();
    await writeFile(file, '{"a":1}\n{"b":2}\n{"c":');
    expect(await tails.readNewLines(file)).toEqual(['{"a":1}', '{"b":2}']);

    await appendFile(file, '3}\n');
    expect(await tails.readNewLines(file)).toEqual(['{"c":3}']);
    expect(await tails.readNewLines(file)).toEqual([]);
  });

  it('registerAtEnd skips history', async () => {
    const tails = new TailRegistry();
    await writeFile(file, '{"old":1}\n');
    await tails.registerAtEnd(file);
    expect(await tails.readNewLines(file)).toEqual([]);
    await appendFile(file, '{"new":2}\n');
    expect(await tails.readNewLines(file)).toEqual(['{"new":2}']);
  });

  it('detects file truncation and starts from zero', async () => {
    const tails = new TailRegistry();
    await writeFile(file, '{"a":1}\n{"b":2}\n');
    await tails.readNewLines(file);
    await writeFile(file, '{"od-nowa":1}\n');
    expect(await tails.readNewLines(file)).toEqual(['{"od-nowa":1}']);
  });
});
