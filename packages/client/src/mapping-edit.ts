/**
 * Czyste helpery edycji mapy narzędzie→budynek (wydzielone z komponentu, by
 * były testowalne — patrz spec §Granice jednostek).
 */

/** Rozbij wpis usera po `,` lub `;` na osobne, oczyszczone nazwy narzędzi. */
export function parseTriggers(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
