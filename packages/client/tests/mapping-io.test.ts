import { describe, expect, it } from 'vitest';
import { parseUploadedMapping } from '../src/hud/mapping-io';
import { DEFAULT_MAPPING } from '../src/theme/mapping';

describe('parseUploadedMapping', () => {
  it('valid config -> ok', () => {
    const res = parseUploadedMapping(JSON.stringify(DEFAULT_MAPPING));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.config.rules.length).toBe(DEFAULT_MAPPING.rules.length);
  });
  it('invalid JSON -> error', () => {
    expect(parseUploadedMapping('{ not json').ok).toBe(false);
  });
  it('valid JSON, bad structure -> error', () => {
    expect(parseUploadedMapping('{"foo":1}').ok).toBe(false);
  });
});
