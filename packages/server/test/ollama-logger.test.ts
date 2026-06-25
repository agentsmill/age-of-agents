import { describe, expect, it } from 'vitest';
import { parseOllamaContextWindow, teeOllamaChat, teeOllamaGenerate } from '../src/proxy/ollama-logger.js';

describe('parseOllamaContextWindow', () => {
  it('reads the *.context_length key from model_info', () => {
    const show = { model_info: { 'llama.context_length': 8192, 'general.architecture': 'llama' } };
    expect(parseOllamaContextWindow(show)).toBe(8192);
  });
  it('returns undefined when absent', () => {
    expect(parseOllamaContextWindow({})).toBeUndefined();
    expect(parseOllamaContextWindow(null)).toBeUndefined();
  });
});

describe('teeOllamaChat', () => {
  it('logs new request messages, the accumulated assistant reply, usage, and turn_complete', () => {
    const reqMessages = [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hello' },
    ];
    const ndjson = [
      JSON.stringify({ message: { role: 'assistant', content: 'hi' }, done: false }),
      JSON.stringify({ message: { role: 'assistant', content: ' there' }, done: false }),
      JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 12, eval_count: 4 }),
    ];
    const records = teeOllamaChat(reqMessages, ndjson);
    expect(records).toContainEqual(expect.objectContaining({ type: 'message', role: 'user', content: 'hello' }));
    expect(records).toContainEqual(expect.objectContaining({ type: 'message', role: 'assistant', content: 'hi there' }));
    expect(records).toContainEqual(expect.objectContaining({ type: 'usage', input: 12, output: 4 }));
    expect(records).toContainEqual(expect.objectContaining({ type: 'turn_complete' }));
  });

  it('captures tool calls from the final assistant message', () => {
    const ndjson = [
      JSON.stringify({
        message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'shell', arguments: { command: 'ls' } } }] },
        done: true,
        prompt_eval_count: 1,
        eval_count: 1,
      }),
    ];
    const records = teeOllamaChat([{ role: 'user', content: 'run ls' }], ndjson);
    const assistant = records.find((r) => r.type === 'message' && r.role === 'assistant') as any;
    expect(assistant.tool_calls?.[0]?.function?.name).toBe('shell');
  });
});

describe('teeOllamaGenerate', () => {
  it('logs user prompt, accumulated assistant response, usage, and turn_complete', () => {
    const reqBody = { model: 'lfm2.5-thinking:latest', prompt: 'say hi in exactly one word', stream: true };
    const ndjson = [
      JSON.stringify({ model: 'lfm2.5-thinking:latest', created_at: '2026-06-22T00:00:00Z', response: 'Hi', done: false }),
      JSON.stringify({ model: 'lfm2.5-thinking:latest', created_at: '2026-06-22T00:00:01Z', response: '', done: true, done_reason: 'stop', context: [1, 2, 3], prompt_eval_count: 14, eval_count: 2 }),
    ];
    const records = teeOllamaGenerate(reqBody, ndjson);
    expect(records).toContainEqual(expect.objectContaining({ type: 'message', role: 'user', content: 'say hi in exactly one word' }));
    expect(records).toContainEqual(expect.objectContaining({ type: 'message', role: 'assistant', content: 'Hi' }));
    expect(records).toContainEqual(expect.objectContaining({ type: 'usage', input: 14, output: 2 }));
    expect(records).toContainEqual(expect.objectContaining({ type: 'turn_complete' }));
  });

  it('skips unparseable lines and still produces records for valid ones', () => {
    const reqBody = { model: 'lfm2.5-thinking:latest', prompt: 'hello', stream: true };
    const ndjson = [
      'not valid json{{{',
      JSON.stringify({ response: 'Hello', done: false }),
      'also bad',
      JSON.stringify({ response: '', done: true, prompt_eval_count: 5, eval_count: 10 }),
    ];
    const records = teeOllamaGenerate(reqBody, ndjson);
    expect(records).toContainEqual(expect.objectContaining({ type: 'message', role: 'user', content: 'hello' }));
    expect(records).toContainEqual(expect.objectContaining({ type: 'message', role: 'assistant', content: 'Hello' }));
    expect(records).toContainEqual(expect.objectContaining({ type: 'usage', input: 5, output: 10 }));
    expect(records).toContainEqual(expect.objectContaining({ type: 'turn_complete' }));
  });

  it('returns only the user message when no done line is present', () => {
    const reqBody = { prompt: 'incomplete' };
    const ndjson = [
      JSON.stringify({ response: 'partial', done: false }),
    ];
    const records = teeOllamaGenerate(reqBody, ndjson);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ type: 'message', role: 'user', content: 'incomplete' });
  });
});
