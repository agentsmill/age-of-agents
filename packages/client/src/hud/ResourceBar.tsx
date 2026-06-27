import { useWorld } from '../store';
import { useUi } from '../i18n';
import { formatK } from '../util';

/** Resource bar: total tokens of all heroes = citadel "gold". */
export function ResourceBar({ onCostClick }: { onCostClick?: () => void }) {
  const heroes = useWorld((s) => s.heroes);
  const connected = useWorld((s) => s.connected);
  const t = useUi();

  const totals = Object.values(heroes).reduce(
    (acc, hero) => ({ input: acc.input + hero.tokens.input, output: acc.output + hero.tokens.output }),
    { input: 0, output: 0 },
  );

  return (
    <div className="hud-panel resources">
      <span className="px" title={t.tokensOut}>🪙 {formatK(totals.output)}</span>
      <span className="px" title={t.tokensIn} style={{ opacity: 0.7 }}>
        📜 {formatK(totals.input)}
      </span>
      {onCostClick && (
        <button
          className="ghost"
          onClick={onCostClick}
          title="Cost Dashboard"
          style={{ fontSize: 12, cursor: 'pointer', padding: '0 4px' }}
        >
          💰
        </button>
      )}
      <span style={{ opacity: 0.7 }}>{connected ? '●' : t.connecting}</span>
    </div>
  );
}
