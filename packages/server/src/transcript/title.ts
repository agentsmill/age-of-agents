/**
 * Session (hero) naming heuristic. No AI: purely local rules so the game works
 * out of the box for everyone (goal: npm/CLI install, zero machine dependencies).
 * Claude's "Recents" title is NOT locally available, so derive it from the first
 * MEANINGFUL human prompt.
 */

/**
 * Confirmation/command phrases without own content are poor session names.
 * Compare after normalization (lowercase, no edge punctuation/whitespace).
 *
 * USER CONTRIBUTION (learning): tuning point for YOUR conversational habits.
 * Add/remove phrases you use at the start of a turn ("no to lecimy", etc.).
 * The list is intentionally conservative: catches only explicit "okay" and meta commands.
 */
const STOPWORDS = new Set<string>([
  'ok', 'oki', 'okej', 'okay', 'k', 'spoko', 'git', 'gites',
  'tak', 'nie', 'no', 'yes', 'y', 'n', 'jasne', 'pewnie',
  'dawaj', 'działaj', 'dzialaj', 'rób', 'rob', 'zrób to', 'zrob to', 'zróbmy', 'leć', 'lec', 'lecimy', 'no to lecimy',
  'realizuj', 'realizuj plan', 'kontynuuj', 'dalej', 'next', 'go', 'go on', 'start', 'zaczynaj',
  'dobra', 'no dobra', 'super', 'super dzięki', 'dzięki', 'dzieki', 'dziękuję', 'dziekuje', 'thanks', 'thx',
  'commit', 'commituj', 'zacommituj', 'push', 'merge', 'deploy',
]);

/** Normalization for comparing with stop list: lowercase, no edge punctuation. */
function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!?…,;:]+$/u, '') // trailing punctuation
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Czy prompt to opis ZADANIA, a nie samo „ok"/„dawaj"/„realizuj plan".
 * Rule: reject exact stop-list phrases and single very short words; treat the
 * rest (for example "Napraw zoom") as a meaningful task.
 */
export function isSubstantialPrompt(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;
  if (STOPWORDS.has(n)) return false;
  // single short word without content (for example typo, emoji-word)
  if (!n.includes(' ') && n.length < 8) return false;
  return true;
}

/**
 * Cleans text for title role: first non-empty line, without leading markdown
 * markers and "Zadanie:/Task:" labels, collapsed whitespace, clipped to `max`.
 */
export function cleanTitle(text: string, max = 40): string {
  let s = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  s = s.replace(/^[#>\-*]+\s*/u, ''); // list/quote/header markers
  s = s.replace(/^(zadanie|task)\s*:\s*/iu, ''); // etykieta zadania
  s = s.replace(/\s+/gu, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
