import { describe, expect, it } from 'vitest';
import { interpretLocalLlmLine, localLlmSource, localLlmToolToCanonical } from '../src/sources/local-llm.js';

const line = (obj: unknown) => JSON.stringify(obj);

describe('interpretLocalLlmLine', () => {
  it('session daje meta z cwd i modelem', () => {
    const facts = interpretLocalLlmLine(line({ type: 'session', ts: '2026-06-14T10:00:00.000Z', cwd: '/repo', model: 'qwen2.5-coder' }));
    expect(facts).toContainEqual({ kind: 'meta', cwd: '/repo', model: 'qwen2.5-coder' });
  });

  it('message user → prompt; assistant → assistant-text', () => {
    expect(interpretLocalLlmLine(line({ type: 'message', ts: '2026-06-14T10:00:01.000Z', role: 'user', content: 'Add a /health endpoint' })))
      .toContainEqual({ kind: 'prompt', text: 'Add a /health endpoint', ts: '2026-06-14T10:00:01.000Z' });
    expect(interpretLocalLlmLine(line({ type: 'message', ts: '2026-06-14T10:00:02.000Z', role: 'assistant', content: 'Done.' })))
      .toContainEqual({ kind: 'assistant-text', text: 'Done.', ts: '2026-06-14T10:00:02.000Z' });
  });

  it('assistant tool_calls → tool-start z nazwą kanoniczną i detalem', () => {
    const facts = interpretLocalLlmLine(
      line({
        type: 'message',
        ts: '2026-06-14T10:00:03.000Z',
        role: 'assistant',
        tool_calls: [{ id: 'call_1', function: { name: 'bash', arguments: JSON.stringify({ command: 'npm test' }) } }],
      }),
    );
    expect(facts).toContainEqual({ kind: 'tool-start', tool: 'Bash', detail: 'npm test', messageId: 'call_1', ts: '2026-06-14T10:00:03.000Z' });
  });

  it('message tool → tool-result; turn_complete → turn-end; usage → usage-total', () => {
    expect(interpretLocalLlmLine(line({ type: 'message', ts: '2026-06-14T10:00:04.000Z', role: 'tool', content: 'Error: file not found' })))
      .toContainEqual({ kind: 'tool-result', isError: true, ts: '2026-06-14T10:00:04.000Z' });
    expect(interpretLocalLlmLine(line({ type: 'turn_complete', ts: '2026-06-14T10:00:05.000Z' })))
      .toContainEqual({ kind: 'turn-end', ts: '2026-06-14T10:00:05.000Z' });
    expect(interpretLocalLlmLine(line({ type: 'usage', input: 120, output: 40 })))
      .toContainEqual({ kind: 'usage-total', input: 120, output: 40 });
  });

  it('śmieci i nieznane rekordy → pusta lista', () => {
    expect(interpretLocalLlmLine('not json{')).toEqual([]);
    expect(interpretLocalLlmLine(line({ type: 'totally_unknown' }))).toEqual([]);
  });
});

describe('localLlmToolToCanonical', () => {
  it('mapuje znane narzędzia, MCP i fallback', () => {
    expect(localLlmToolToCanonical('bash')).toBe('Bash');
    expect(localLlmToolToCanonical('read_file')).toBe('Read');
    expect(localLlmToolToCanonical('server__do_thing')).toBe('mcp__server__do_thing');
    expect(localLlmToolToCanonical('weird_tool')).toBe('weird_tool');
  });
});

describe('localLlmSource.classify', () => {
  it('rozpoznaje sesję po pliku <uuid>.jsonl w katalogu sesji', () => {
    const root = '/home/u/.age-of-agents/local-llm/sessions';
    const file = `${root}/3fa85f64-5717-4562-b3fc-2c963f66afa6.jsonl`;
    expect(localLlmSource.classify(file, root)).toEqual({
      kind: 'session',
      sessionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      projectDir: '',
    });
    expect(localLlmSource.classify(`${root}/notes.txt`, root)).toEqual({ kind: 'other' });
  });
});
