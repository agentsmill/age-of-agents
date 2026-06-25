import { describe, expect, it } from 'vitest';
import { AGENT_PROVIDERS, resolveProvider } from '@agent-citadel/shared';

describe('local-llm provider', () => {
  it('is registered in AGENT_PROVIDERS', () => {
    expect(AGENT_PROVIDERS['local-llm']).toBeDefined();
    expect(AGENT_PROVIDERS['local-llm'].label).toBe('Local LLM');
    expect(AGENT_PROVIDERS['local-llm'].labelShort).toBe('L');
  });

  it('resolves by string', () => {
    expect(resolveProvider('local-llm').kind).toBe('local-llm');
  });
});
