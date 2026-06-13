import { describe, expect, it } from 'vitest';
import { isSubstantialPrompt, cleanTitle } from '../src/transcript/title.js';

describe('isSubstantialPrompt', () => {
  it('odrzuca czyste potwierdzenia / rozkazy bez treści', () => {
    for (const t of ['ok', 'OK', 'Tak', 'tak.', 'nie', 'yes', 'no', 'dawaj', 'realizuj', 'realizuj plan', 'dalej', 'spoko', 'dzięki', 'kontynuuj']) {
      expect(isSubstantialPrompt(t), t).toBe(false);
    }
  });

  it('przyjmuje opisy zadań (też dwuwyrazowe z treścią)', () => {
    for (const t of ['Napraw zoom mapy', 'Napraw zoom', 'Dodaj rate-limit do panelu pośrednika', 'zaimplementuj nazwy sesji jak w grze']) {
      expect(isSubstantialPrompt(t), t).toBe(true);
    }
  });

  it('pusty / whitespace → false', () => {
    expect(isSubstantialPrompt('')).toBe(false);
    expect(isSubstantialPrompt('   ')).toBe(false);
  });
});

describe('cleanTitle', () => {
  it('bierze pierwszą niepustą linię', () => {
    expect(cleanTitle('\n\nNapraw zoom\nszczegóły poniżej...')).toBe('Napraw zoom');
  });

  it('zdejmuje wiodące markery markdown i etykietę Zadanie:', () => {
    expect(cleanTitle('# Zadanie: Napraw zoom')).toBe('Napraw zoom');
    expect(cleanTitle('- punkt listy')).toBe('punkt listy');
  });

  it('zwija białe znaki', () => {
    expect(cleanTitle('napraw    zoom   mapy')).toBe('napraw zoom mapy');
  });

  it('ucina długie z wielokropkiem (≤ 40 znaków)', () => {
    const out = cleanTitle('W związku z tym, że mam dostęp do sieci sprzedawców i taryf URE');
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('…')).toBe(true);
  });

  it('krótki zostaje bez zmian', () => {
    expect(cleanTitle('Dodaj logowanie')).toBe('Dodaj logowanie');
  });
});
