import { describe, expect, it } from 'vitest';
import { resolveModel, DEFAULT_MODEL_CONFIG } from '@agent-citadel/shared';

describe('local model family sprites', () => {
  it('gives common local families a non-fallback identity', () => {
    expect(resolveModel('qwen3-embedding:latest', DEFAULT_MODEL_CONFIG).displayName).toBeDefined();
    expect(resolveModel('SpeakLeash/bielik-11b-v3.0-instruct:Q4_K_M', DEFAULT_MODEL_CONFIG).displayName).toBeDefined();
  });

  it('resolves llama models to Llama', () => {
    expect(resolveModel('llama3.2:latest', DEFAULT_MODEL_CONFIG).displayName).toBe('Llama');
  });

  it('resolves qwen models to Qwen', () => {
    expect(resolveModel('qwen3-embedding:latest', DEFAULT_MODEL_CONFIG).displayName).toBe('Qwen');
  });

  it('resolves mistral models to Mistral', () => {
    expect(resolveModel('mistral:7b', DEFAULT_MODEL_CONFIG).displayName).toBe('Mistral');
  });

  it('resolves ministral models to Ministral (not just Mistral)', () => {
    expect(resolveModel('ministral:8b', DEFAULT_MODEL_CONFIG).displayName).toBe('Ministral');
  });

  it('resolves gemma models to Gemma', () => {
    expect(resolveModel('gemma3:12b', DEFAULT_MODEL_CONFIG).displayName).toBe('Gemma');
  });

  it('resolves phi models to Phi', () => {
    expect(resolveModel('phi4:latest', DEFAULT_MODEL_CONFIG).displayName).toBe('Phi');
  });

  it('resolves bielik models to Bielik', () => {
    expect(resolveModel('SpeakLeash/bielik-11b-v3.0-instruct:Q4_K_M', DEFAULT_MODEL_CONFIG).displayName).toBe('Bielik');
  });

  it('resolves gpt-oss models to GPT-OSS (not GPT)', () => {
    expect(resolveModel('gpt-oss:20b', DEFAULT_MODEL_CONFIG).displayName).toBe('GPT-OSS');
  });

  it('resolves glm models to GLM', () => {
    expect(resolveModel('glm-4:9b', DEFAULT_MODEL_CONFIG).displayName).toBe('GLM');
  });

  it('resolves lfm models to LFM', () => {
    expect(resolveModel('lfm-40b:latest', DEFAULT_MODEL_CONFIG).displayName).toBe('LFM');
  });
});
