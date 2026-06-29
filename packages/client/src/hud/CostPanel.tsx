import { useEffect, useState } from 'react';
import { estimateCost, formatCost, resolveProvider } from '@agent-citadel/shared';
import { useWorld } from '../store';
import { useUi } from '../i18n';

/**
 * Cost dashboard panel: shows estimated USD cost per active session
 * and a total across all sessions.
 */
export function CostPanel({ onClose }: { onClose: () => void }) {
  const heroes = useWorld((s) => s.heroes);
  const t = useUi();
  const [, setTick] = useState(0);

  // Refresh relative times periodically.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const sessions = Object.values(heroes).map((h) => ({
    sessionId: h.sessionId,
    title: h.title,
    model: h.model,
    agent: h.agent,
    inputTokens: h.tokens.input,
    outputTokens: h.tokens.output,
    estimatedCost: estimateCost(h.tokens.input, h.tokens.output, h.model),
  }));

  const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCost, 0);
  const sorted = sessions.sort((a, b) => b.estimatedCost - a.estimatedCost);

  return (
    <div className="hud-panel cost-panel">
      <div className="head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>💰 Cost Dashboard</strong>
        <button className="ghost" onClick={onClose}>
          ✕
        </button>
      </div>

      <div style={{ textAlign: 'center', padding: '12px 0' }}>
        <div style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Total Estimated Cost
        </div>
        <div style={{ fontSize: 24, color: '#fac775', fontWeight: 700, marginTop: 4 }}>
          {formatCost(totalCost)}
        </div>
        <div style={{ fontSize: 11, opacity: 0.4, marginTop: 2 }}>
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div style={{ borderTop: '1px solid #ffffff11', paddingTop: 8 }}>
        {sorted.length === 0 && (
          <div style={{ opacity: 0.5, fontSize: 12, textAlign: 'center', padding: 12 }}>
            No active sessions.
          </div>
        )}
        {sorted.map((s) => {
          const provider = resolveProvider(s.agent);
          return (
            <div
              key={s.sessionId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 0',
                borderBottom: '1px solid #ffffff08',
                fontSize: 12,
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  background: provider.color ?? '#555',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 8,
                  fontWeight: 700,
                  color: '#000',
                  flex: 'none',
                }}
              >
                {provider.labelShort}
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.title}
              </span>
              <span style={{ opacity: 0.5, fontSize: 10, flex: 'none' }}>
                {formatK(s.inputTokens)}→{formatK(s.outputTokens)}
              </span>
              <span style={{ color: '#fac775', fontWeight: 600, flex: 'none', minWidth: 48, textAlign: 'right' }}>
                {formatCost(s.estimatedCost)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
