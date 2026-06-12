import { useWorld } from '../store';

/** Pasek zasobów: suma tokenów wszystkich bohaterów = "złoto" twierdzy. */
export function ResourceBar() {
  const heroes = useWorld((s) => s.heroes);
  const connected = useWorld((s) => s.connected);

  const totals = Object.values(heroes).reduce(
    (acc, hero) => ({ input: acc.input + hero.tokens.input, output: acc.output + hero.tokens.output }),
    { input: 0, output: 0 },
  );

  return (
    <div className="hud-panel resources">
      <span title="Tokeny wyjściowe (praca wykonana)">🪙 {formatK(totals.output)}</span>
      <span title="Tokeny wejściowe (kontekst)" style={{ opacity: 0.7 }}>
        📜 {formatK(totals.input)}
      </span>
      <span style={{ opacity: 0.7 }}>{connected ? '●' : '○ łączenie…'}</span>
    </div>
  );
}

function formatK(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}
