import { describe, expect, it } from 'vitest';
import { parseUploadedModelConfig } from '../src/hud/model-io';
import { DEFAULT_MODEL_CONFIG } from '../src/theme/models';

describe('parseUploadedModelConfig', () => {
  it('valid config -> ok', () => {
    const res = parseUploadedModelConfig(JSON.stringify(DEFAULT_MODEL_CONFIG));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.config.windows.length).toBe(DEFAULT_MODEL_CONFIG.windows.length);
  });
  it('invalid JSON -> error', () => {
    expect(parseUploadedModelConfig('{ not json').ok).toBe(false);
  });
  it('valid JSON, bad structure -> error', () => {
    expect(parseUploadedModelConfig('{"foo":1}').ok).toBe(false);
  });
});
