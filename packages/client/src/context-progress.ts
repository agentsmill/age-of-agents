/** Procent zapełnienia okna kontekstu, 0..100 (zaokrąglony, clamp). */
export function contextPct(tokens: number, windowSize: number): number {
  if (!Number.isFinite(tokens) || !Number.isFinite(windowSize) || tokens <= 0 || windowSize <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((tokens / windowSize) * 100)));
}

/** Kolor wypełnienia wg %: green <=60 -> yellow <=80 -> red. */
export function contextColor(pct: number): string {
  if (pct <= 60) return '#5dcaa5';
  if (pct <= 80) return '#f0d76e';
  return '#e24b4a';
}
