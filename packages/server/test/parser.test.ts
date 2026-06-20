import { describe, expect, it } from 'vitest';
import { interpretLine, isHumanPrompt } from '../src/transcript/parser.js';

describe('interpretLine', () => {
  it('converts enqueue into a prompt fact', () => {
    const line = JSON.stringify({
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: '2026-06-13T10:00:00.000Z',
      sessionId: 'abc',
      content: 'Napraw testy auth',
    });
    expect(interpretLine(line)).toEqual([
      { kind: 'prompt', text: 'Napraw testy auth', ts: '2026-06-13T10:00:00.000Z' },
    ]);
  });

  it('extracts tool-start with detail, usage, and model from an assistant record', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-06-13T10:00:01.000Z',
      gitBranch: 'main',
      message: {
        id: 'msg_01',
        model: 'claude-fable-5',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 42 },
        content: [
          { type: 'tool_use', id: 'toolu_01', name: 'Bash', input: { command: 'npm test', description: 'Uruchom testy' } },
        ],
      },
    });
    const facts = interpretLine(line);
    expect(facts).toContainEqual({
      kind: 'tool-start',
      tool: 'Bash',
      detail: 'Uruchom testy',
      messageId: 'msg_01',
      ts: '2026-06-13T10:00:01.000Z',
    });
    expect(facts).toContainEqual({ kind: 'usage', messageId: 'msg_01', input: 100, output: 42, context: 100 });
    expect(facts).toContainEqual({ kind: 'meta', model: 'claude-fable-5', gitBranch: 'main', cwd: undefined });
  });

  it('end_turn emits turn-end and assistant text', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-06-13T10:00:02.000Z',
      message: {
        id: 'msg_02',
        model: 'claude-fable-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Gotowe, testy przechodzą.' }],
      },
    });
    const kinds = interpretLine(line).map((f) => f.kind);
    expect(kinds).toContain('turn-end');
    expect(kinds).toContain('assistant-text');
  });

  it('tool_result with is_error emits an error fact', () => {
    const line = JSON.stringify({
      type: 'user',
      timestamp: '2026-06-13T10:00:03.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01', is_error: true, content: 'boom' }] },
      toolUseResult: 'Error: boom',
    });
    expect(interpretLine(line)).toContainEqual({
      kind: 'tool-result',
      isError: true,
      ts: '2026-06-13T10:00:03.000Z',
    });
  });

  it('explicit title (custom/ai) becomes a title fact; last-prompt is ignored', () => {
    expect(interpretLine(JSON.stringify({ type: 'custom-title', customTitle: 'Refactor API' }))).toEqual([
      { kind: 'title', title: 'Refactor API' },
    ]);
    expect(interpretLine(JSON.stringify({ type: 'ai-title', aiTitle: 'Naprawa auth' }))).toEqual([
      { kind: 'title', title: 'Naprawa auth' },
    ]);
    // last-prompt no longer names the hero (the name changed on every turn).
    expect(interpretLine(JSON.stringify({ type: 'last-prompt', lastPrompt: 'Refactor API' }))).toEqual([]);
    expect(interpretLine('to nie jest json{')).toEqual([]);
    expect(interpretLine(JSON.stringify({ type: 'file-history-snapshot' }))).toEqual([]);
  });

  it('filters synthetic turns from prompts (interrupted, system-reminder, skills, commands)', () => {
    const user = (text: string) =>
      interpretLine(JSON.stringify({ type: 'user', timestamp: '2026-06-13T10:00:00.000Z', message: { role: 'user', content: text } }));
    // Garbage -> no prompt fact.
    expect(user('[Request interrupted by user]')).toEqual([]);
    expect(user('<system-reminder>uważaj</system-reminder>')).toEqual([]);
    expect(user('<command-name>/compact</command-name>')).toEqual([]);
    expect(user('Base directory for this skill: /Users/x/.claude/plugins/...')).toEqual([]);
    expect(user('Caveat: The messages below were generated...')).toEqual([]);
    // Real prompts (including markdown and short prompts) are preserved.
    expect(user('# Zadanie: zrób lead z bota')).toContainEqual({ kind: 'prompt', text: '# Zadanie: zrób lead z bota', ts: '2026-06-13T10:00:00.000Z' });
    expect(user('tak deploy')).toContainEqual({ kind: 'prompt', text: 'tak deploy', ts: '2026-06-13T10:00:00.000Z' });
  });

  it('wykrywa /clear z serializowanej komendy Claude i emituje cleared zamiast promptu', () => {
    const line = JSON.stringify({
      type: 'user',
      timestamp: '2026-06-19T02:20:00.000Z',
      message: {
        role: 'user',
        content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>',
      },
    });
    expect(interpretLine(line)).toContainEqual({ kind: 'cleared', ts: '2026-06-19T02:20:00.000Z' });
    expect(interpretLine(line).find((fact) => fact.kind === 'prompt')).toBeUndefined();
  });

  it('isHumanPrompt: human prompt heuristic', () => {
    expect(isHumanPrompt('napraw testy')).toBe(true);
    expect(isHumanPrompt('# nagłówek markdown')).toBe(true);
    expect(isHumanPrompt('   ')).toBe(false);
    expect(isHumanPrompt('[Request interrupted by user]')).toBe(false);
    expect(isHumanPrompt('<system-reminder>x</system-reminder>')).toBe(false);
  });

  it('extracts skill/plugin/mcp attribution from an assistant record', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-06-17T10:00:00.000Z',
      attributionSkill: 'superpowers:brainstorming',
      attributionPlugin: 'superpowers',
      attributionMcpServer: 'visualize',
      message: { id: 'm1', content: [] },
    });
    const facts = interpretLine(line);
    expect(facts).toContainEqual({
      kind: 'attribution', skill: 'superpowers:brainstorming', plugin: 'superpowers', mcpServer: 'visualize',
    });
  });

  it('calculates context from usage (input + cache_read + cache_creation)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-06-17T10:00:00.000Z',
      message: {
        id: 'mctx',
        usage: { input_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 900, output_tokens: 50 },
        content: [],
      },
    });
    const usage = interpretLine(line).find((f) => f.kind === 'usage');
    expect(usage).toMatchObject({ kind: 'usage', input: 5100, output: 50, context: 6000 });
  });

  it('truncates very long prompts', () => {
    const line = JSON.stringify({
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: '2026-06-13T10:00:00.000Z',
      content: 'x'.repeat(1000),
    });
    const [fact] = interpretLine(line);
    expect(fact.kind).toBe('prompt');
    if (fact.kind === 'prompt') expect(fact.text.length).toBeLessThanOrEqual(240);
  });
});
