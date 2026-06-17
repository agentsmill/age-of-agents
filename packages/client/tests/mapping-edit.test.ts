import { describe, it, expect } from 'vitest';
import { parseTriggers } from '../src/mapping-edit';

describe('parseTriggers', () => {
  it('rozbija po przecinku i średniku', () => {
    expect(parseTriggers('a, b ; c')).toEqual(['a', 'b', 'c']);
  });

  it('trimuje i odrzuca puste segmenty', () => {
    expect(parseTriggers(' a ,, ; b ')).toEqual(['a', 'b']);
  });

  it('pojedyncza wartość', () => {
    expect(parseTriggers('Edit')).toEqual(['Edit']);
  });

  it('pusty / sam separator → []', () => {
    expect(parseTriggers('')).toEqual([]);
    expect(parseTriggers('  ,; ')).toEqual([]);
  });
});
