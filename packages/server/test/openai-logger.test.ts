import { describe, expect, it } from 'vitest';
import { fingerprint, accumulateSse } from '../src/proxy/openai-logger.js';

describe('fingerprint', () => {
  it('is stable for the same anchor message and differs across conversations', () => {
    const a = [{ role: 'system', content: 'A' }, { role: 'user', content: 'x' }];
    const a2 = [{ role: 'system', content: 'A' }, { role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }];
    const b = [{ role: 'system', content: 'B' }];
    expect(fingerprint(a)).toBe(fingerprint(a2));
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('returns a defined value for an empty array and differs from a non-empty array', () => {
    expect(fingerprint([])).toBeDefined();
    expect(fingerprint([])).not.toBe(fingerprint([{ role: 'user', content: 'x' }]));
  });
});

describe('accumulateSse', () => {
  it('joins streamed content deltas and tool-call fragments', () => {
    const lines = [
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }),
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'lo' } }] }),
      'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: 'sh', arguments: '{"a":' } }] } }] }),
      'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] } }] }),
      'data: [DONE]',
    ];
    const { content, toolCalls } = accumulateSse(lines);
    expect(content).toBe('Hello');
    expect(toolCalls[0].function.name).toBe('sh');
    expect(toolCalls[0].function.arguments).toBe('{"a":1}');
  });

  it('captures usage from the final SSE chunk', () => {
    const lines = [
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] }),
      'data: ' + JSON.stringify({ usage: { prompt_tokens: 12, completion_tokens: 5 }, choices: [{ delta: {} }] }),
      'data: [DONE]',
    ];
    const { usage } = accumulateSse(lines);
    expect(usage?.prompt_tokens).toBe(12);
    expect(usage?.completion_tokens).toBe(5);
  });
});
