import { describe, expect, it } from 'vitest';
import { interpretCodexLine, codexSource, isCodexHumanPrompt, codexToolToCanonical } from '../src/sources/codex.js';

const line = (obj: unknown) => JSON.stringify(obj);

describe('interpretCodexLine', () => {
  it('session_meta daje meta z cwd', () => {
    const facts = interpretCodexLine(
      line({ type: 'session_meta', timestamp: '2026-06-14T10:00:00.000Z', payload: { cwd: '/Users/x/proj', model_provider: 'openai' } }),
    );
    expect(facts).toContainEqual({ kind: 'meta', cwd: '/Users/x/proj', model: 'openai' });
  });

  it('prawdziwy prompt usera → fakt prompt; wstrzyknięcia → nic', () => {
    const userMsg = (text: string) =>
      interpretCodexLine(line({ type: 'response_item', timestamp: '2026-06-14T10:00:00.000Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }));
    expect(userMsg('Dodaj endpoint /health')).toContainEqual({ kind: 'prompt', text: 'Dodaj endpoint /health', ts: '2026-06-14T10:00:00.000Z' });
    expect(userMsg('<environment_context>\n  <cwd>/x</cwd>\n</environment_context>')).toEqual([]);
    expect(userMsg('# AGENTS.md instructions for /x')).toEqual([]);
    // rola developer (instrukcje permissions) → nie prompt
    expect(interpretCodexLine(line({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'normalny tekst' }] } }))).toEqual([]);
  });

  it('reasoning → thinking; assistant output_text → assistant-text', () => {
    expect(interpretCodexLine(line({ type: 'response_item', timestamp: '2026-06-14T10:00:01.000Z', payload: { type: 'reasoning', summary: [] } })))
      .toContainEqual({ kind: 'thinking', ts: '2026-06-14T10:00:01.000Z' });
    expect(interpretCodexLine(line({ type: 'response_item', timestamp: '2026-06-14T10:00:02.000Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Zrobione.' }] } })))
      .toContainEqual({ kind: 'assistant-text', text: 'Zrobione.', ts: '2026-06-14T10:00:02.000Z' });
  });

  it('function_call shell/apply_patch/web_search → tool-start z nazwą kanoniczną i detalem', () => {
    const shell = interpretCodexLine(line({ type: 'response_item', timestamp: '2026-06-14T10:00:03.000Z', payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }) } }));
    expect(shell).toContainEqual({ kind: 'tool-start', tool: 'Bash', detail: 'npm test', messageId: 'c1', ts: '2026-06-14T10:00:03.000Z' });

    const patch = interpretCodexLine(line({ type: 'response_item', timestamp: '2026-06-14T10:00:04.000Z', payload: { type: 'function_call', name: 'apply_patch', call_id: 'c2', arguments: JSON.stringify({ input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n-x\n+y\n*** End Patch' }) } }));
    expect(patch.find((f) => f.kind === 'tool-start')).toMatchObject({ kind: 'tool-start', tool: 'Edit' });

    const web = interpretCodexLine(line({ type: 'response_item', payload: { type: 'function_call', name: 'web_search', call_id: 'c3', arguments: JSON.stringify({ query: 'rust async' }) } }));
    expect(web.find((f) => f.kind === 'tool-start')).toMatchObject({ kind: 'tool-start', tool: 'WebSearch', detail: 'rust async' });
  });

  it('token_count → usage-total with current context when present; task_complete → turn-end', () => {
    expect(interpretCodexLine(line({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 1200, output_tokens: 300 },
          last_token_usage: { input_tokens: 700, output_tokens: 40, total_tokens: 740 },
          model_context_window: 258400,
        },
      },
    })))
      .toContainEqual({ kind: 'usage-total', input: 1200, output: 300, context: 740, contextWindow: 258400 });
    expect(interpretCodexLine(line({ type: 'event_msg', timestamp: '2026-06-14T10:05:00.000Z', payload: { type: 'task_complete' } })))
      .toContainEqual({ kind: 'turn-end', ts: '2026-06-14T10:05:00.000Z' });
  });

  it('śmieci i nieznane rekordy → pusta lista / poprawny tool-result', () => {
    expect(interpretCodexLine('to nie json{')).toEqual([]);
    expect(interpretCodexLine(line({ type: 'response_item', payload: { type: 'function_call_output', output: { exit_code: 0 } } }))).toContainEqual({ kind: 'tool-result', isError: false, ts: expect.any(String) });
    expect(interpretCodexLine(line({ type: 'totally_unknown' }))).toEqual([]);
  });
});

describe('helpery (punkty dostrojenia)', () => {
  it('isCodexHumanPrompt: prawda dla zadania, fałsz dla wstrzyknięć/roli', () => {
    expect(isCodexHumanPrompt('Napraw bug', 'user')).toBe(true);
    expect(isCodexHumanPrompt('<environment_context></environment_context>', 'user')).toBe(false);
    expect(isCodexHumanPrompt('Napraw bug', 'developer')).toBe(false);
  });
  it('codexToolToCanonical: mapuje narzędzia Codeksa na nazwy gry', () => {
    expect(codexToolToCanonical('shell')).toBe('Bash');
    expect(codexToolToCanonical('apply_patch')).toBe('Edit');
    expect(codexToolToCanonical('read_file')).toBe('Read');
    expect(codexToolToCanonical('web_search')).toBe('WebSearch');
    expect(codexToolToCanonical('pencil__draw')).toBe('mcp__pencil__draw');
  });
});

describe('codexSource.classify', () => {
  const root = '/Users/x/.codex/sessions';
  it('rollout → sesja z sessionId z UUID nazwy', () => {
    const p = `${root}/2026/02/07/rollout-2026-02-07T01-14-55-019c3573-9d33-7fc2-8fc8-56cebffe1d6b.jsonl`;
    expect(codexSource.classify(p, root)).toEqual({ kind: 'session', sessionId: '019c3573-9d33-7fc2-8fc8-56cebffe1d6b', projectDir: '' });
  });
  it('plik nie-rollout → other', () => {
    expect(codexSource.classify(`${root}/2026/02/07/notes.jsonl`, root).kind).toBe('other');
  });
});
