import { formatK } from '../util';
import { contextPct, contextColor } from './context-bar';

const SEGMENTS = 24;

/** Segmented pixel context-window fill bar (per hero). Pure: receives a resolved window. */
export function ContextBar({ tokens, windowSize, label }: { tokens: number; windowSize: number; label: string }) {
  const pct = contextPct(tokens, windowSize);
  const c = contextColor(pct);
  const filled = Math.round((SEGMENTS * pct) / 100);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.7, marginBottom: 5 }}>
        <span className="px" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        <span>
          <span style={{ color: c }}>{pct}%</span> · {formatK(tokens)} / {formatK(windowSize)}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 12,
              background: i < filled ? c : '#2a2926',
              boxShadow: 'inset 1px 1px 0 #ffffff22, inset -1px -1px 0 #00000055',
            }}
          />
        ))}
      </div>
    </div>
  );
}
