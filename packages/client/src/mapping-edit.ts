/**
 * Pure helpers for editing the tool->building map (extracted from the component
 * so they are testable; see spec section "Unit boundaries").
 */

/** Split user input by `,` or `;` into separate, trimmed tool names. */
export function parseTriggers(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
