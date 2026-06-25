import { describe, expect, it } from 'vitest';
import { isSubstantialPrompt, cleanTitle } from '../src/transcript/title.js';

describe('isSubstantialPrompt', () => {
  it('rejects pure acknowledgements / commands without content', () => {
    for (const t of ['ok', 'OK', 'Tak', 'tak.', 'nie', 'yes', 'no', 'dawaj', 'realizuj', 'realizuj plan', 'dalej', 'spoko', 'dzięki', 'kontynuuj']) {
      expect(isSubstantialPrompt(t), t).toBe(false);
    }
  });

  it('accepts task descriptions (including two-word prompts with content)', () => {
    for (const t of ['Napraw zoom mapy', 'Napraw zoom', 'Dodaj rate-limit do panelu pośrednika', 'zaimplementuj nazwy sesji jak w grze']) {
      expect(isSubstantialPrompt(t), t).toBe(true);
    }
  });

  it('empty / whitespace -> false', () => {
    expect(isSubstantialPrompt('')).toBe(false);
    expect(isSubstantialPrompt('   ')).toBe(false);
  });
});

describe('cleanTitle', () => {
  it('takes the first non-empty line', () => {
    expect(cleanTitle('\n\nNapraw zoom\nszczegóły poniżej...')).toBe('Napraw zoom');
  });

  it('removes leading markdown markers and the Zadanie: label', () => {
    expect(cleanTitle('# Zadanie: Napraw zoom')).toBe('Napraw zoom');
    expect(cleanTitle('- punkt listy')).toBe('punkt listy');
  });

  it('collapses whitespace', () => {
    expect(cleanTitle('napraw    zoom   mapy')).toBe('napraw zoom mapy');
  });

  it('truncates long titles with an ellipsis (<= 40 characters)', () => {
    const out = cleanTitle('W związku z tym, że mam dostęp do sieci sprzedawców i taryf URE');
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('…')).toBe(true);
  });

  it('leaves short titles unchanged', () => {
    expect(cleanTitle('Dodaj logowanie')).toBe('Dodaj logowanie');
  });
});
