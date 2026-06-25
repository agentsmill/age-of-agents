import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { interpretLocalLlmLine, localLlmSessionsDir, localLlmToolToCanonical, localLlmSource } from '../src/sources/local-llm.js';

describe('interpretLocalLlmLine', () => {
  it('maps a session record to a meta fact with model + context window', () => {
    const facts = interpretLocalLlmLine(
      JSON.stringify({ type: 'session', ts: '2026-06-22T00:00:00Z', cwd: '/tmp', model: 'bielik:Q4', contextWindow: 8192 }),
    );
    expect(facts).toContainEqual({ kind: 'meta', model: 'bielik:Q4', cwd: '/tmp' });
    expect(facts).toContainEqual(
      expect.objectContaining({ kind: 'usage', contextWindow: 8192 }),
    );
  });

  it('maps a user message to a prompt fact', () => {
    const facts = interpretLocalLlmLine(JSON.stringify({ type: 'message', ts: 't', role: 'user', content: 'hi' }));
    expect(facts).toEqual([{ kind: 'prompt', text: 'hi', ts: 't' }]);
  });

  it('maps an assistant message + tool call to assistant-text + tool-start', () => {
    const facts = interpretLocalLlmLine(
      JSON.stringify({
        type: 'message',
        ts: 't',
        role: 'assistant',
        content: 'running',
        tool_calls: [{ id: 'c1', function: { name: 'shell', arguments: '{"command":"ls"}' } }],
      }),
    );
    expect(facts).toContainEqual({ kind: 'assistant-text', text: 'running', ts: 't' });
    expect(facts).toContainEqual(
      expect.objectContaining({ kind: 'tool-start', tool: 'Bash', detail: 'ls', messageId: 'c1' }),
    );
  });

  it('maps usage and turn_complete', () => {
    expect(interpretLocalLlmLine(JSON.stringify({ type: 'usage', input: 5, output: 7 }))).toContainEqual(
      expect.objectContaining({ kind: 'usage-total', input: 5, output: 7 }),
    );
    expect(interpretLocalLlmLine(JSON.stringify({ type: 'turn_complete', ts: 't' }))).toEqual([
      { kind: 'turn-end', ts: 't' },
    ]);
  });

  it('returns [] for malformed JSON instead of throwing', () => {
    expect(interpretLocalLlmLine('not json')).toEqual([]);
  });

  it('returns [] for a usage record with no numeric fields', () => {
    expect(interpretLocalLlmLine(JSON.stringify({ type: 'usage' }))).toEqual([]);
  });
});

describe('localLlmToolToCanonical', () => {
  it('canonicalizes common names', () => {
    expect(localLlmToolToCanonical('exec')).toBe('Bash');
    expect(localLlmToolToCanonical('read_file')).toBe('Read');
    expect(localLlmToolToCanonical('my.custom.tool')).toBe('mcp__my__custom__tool');
  });

  it('returns already-prefixed mcp__ names unchanged (no double prefix)', () => {
    expect(localLlmToolToCanonical('mcp__slack__send_message')).toBe('mcp__slack__send_message');
  });
});

describe('localLlmSessionsDir', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.LOCAL_LLM_SESSIONS_DIR;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LOCAL_LLM_SESSIONS_DIR;
    } else {
      process.env.LOCAL_LLM_SESSIONS_DIR = originalEnv;
    }
  });

  it('returns LOCAL_LLM_SESSIONS_DIR env var when set', () => {
    process.env.LOCAL_LLM_SESSIONS_DIR = '/custom/sessions/path';
    expect(localLlmSessionsDir()).toBe('/custom/sessions/path');
  });

  it('returns default ~/.age-of-agents/local-llm/sessions path when env var is unset', () => {
    delete process.env.LOCAL_LLM_SESSIONS_DIR;
    const result = localLlmSessionsDir();
    expect(result).toMatch(/\.age-of-agents[/\\]local-llm[/\\]sessions$/);
  });
});

describe('localLlmSource.classify', () => {
  it('classifies a uuid .jsonl at root as a session', () => {
    const root = '/sessions';
    const c = localLlmSource.classify(`${root}/123e4567-e89b-12d3-a456-426614174000.jsonl`, root);
    expect(c).toEqual({ kind: 'session', sessionId: '123e4567-e89b-12d3-a456-426614174000', projectDir: '' });
  });
  it('ignores non-jsonl and nested files', () => {
    const root = '/sessions';
    expect(localLlmSource.classify(`${root}/notes.txt`, root).kind).toBe('other');
    expect(localLlmSource.classify(`${root}/sub/123e4567-e89b-12d3-a456-426614174000.jsonl`, root).kind).toBe('other');
  });
});
