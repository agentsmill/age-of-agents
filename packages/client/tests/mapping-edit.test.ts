import { describe, it, expect } from 'vitest';
import { parseTriggers } from '../src/mapping-edit';

describe('parseTriggers', () => {
  it('splits by comma and semicolon', () => {
    expect(parseTriggers('a, b ; c')).toEqual(['a', 'b', 'c']);
  });

  it('trims and rejects empty segments', () => {
    expect(parseTriggers(' a ,, ; b ')).toEqual(['a', 'b']);
  });

  it('single value', () => {
    expect(parseTriggers('Edit')).toEqual(['Edit']);
  });

  it('empty / only separators -> []', () => {
    expect(parseTriggers('')).toEqual([]);
    expect(parseTriggers('  ,; ')).toEqual([]);
  });
});
