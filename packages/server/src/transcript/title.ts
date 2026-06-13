/**
 * Heurystyka nazwy sesji (bohatera). Bez AI — czysto lokalne reguły, żeby gra
 * działała out-of-the-box u każdego (cel: instalacja przez npm/CLI, zero
 * zależności od maszyny). Tytuł z „Recents" Claude'a NIE jest dostępny lokalnie,
 * więc wyprowadzamy go z pierwszego SENSOWNEGO promptu człowieka.
 */

/**
 * Frazy-potwierdzenia/rozkazy bez własnej treści — kiepskie jako nazwa sesji.
 * Porównanie po normalizacji (lowercase, bez interpunkcji/białych znaków z brzegu).
 *
 * WKŁAD USERA (learning): to punkt strojenia pod TWOJE nawyki konwersacyjne.
 * Dopisz/usuń frazy, których używasz na starcie tury („no to lecimy", „ japiernicze”…).
 * Lista jest celowo zachowawcza — łapie tylko jawne „okejki" i meta-rozkazy.
 */
const STOPWORDS = new Set<string>([
  'ok', 'oki', 'okej', 'okay', 'k', 'spoko', 'git', 'gites',
  'tak', 'nie', 'no', 'yes', 'y', 'n', 'jasne', 'pewnie',
  'dawaj', 'działaj', 'dzialaj', 'rób', 'rob', 'zrób to', 'zrob to', 'zróbmy', 'leć', 'lec', 'lecimy', 'no to lecimy',
  'realizuj', 'realizuj plan', 'kontynuuj', 'dalej', 'next', 'go', 'go on', 'start', 'zaczynaj',
  'dobra', 'no dobra', 'super', 'super dzięki', 'dzięki', 'dzieki', 'dziękuję', 'dziekuje', 'thanks', 'thx',
  'commit', 'commituj', 'zacommituj', 'push', 'merge', 'deploy',
]);

/** Normalizacja do porównania z listą-stop: lowercase, bez interpunkcji brzegowej. */
function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!?…,;:]+$/u, '') // końcowa interpunkcja
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Czy prompt to opis ZADANIA, a nie samo „ok"/„dawaj"/„realizuj plan".
 * Reguła: odrzuć dokładne frazy z listy-stop oraz pojedyncze, bardzo krótkie
 * słowa; resztę (np. „Napraw zoom") traktuj jak sensowne zadanie.
 */
export function isSubstantialPrompt(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;
  if (STOPWORDS.has(n)) return false;
  // pojedyncze krótkie słowo bez treści (np. literówka, emotka-słowo)
  if (!n.includes(' ') && n.length < 8) return false;
  return true;
}

/**
 * Czyści tekst do roli nazwy: pierwsza niepusta linia, bez wiodących markerów
 * markdown i etykiety „Zadanie:/Task:", zwinięte białe znaki, ucięte do `max`.
 */
export function cleanTitle(text: string, max = 40): string {
  let s = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  s = s.replace(/^[#>\-*]+\s*/u, ''); // markery list/cytatów/nagłówków
  s = s.replace(/^(zadanie|task)\s*:\s*/iu, ''); // etykieta zadania
  s = s.replace(/\s+/gu, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
