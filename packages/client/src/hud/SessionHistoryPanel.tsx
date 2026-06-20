import { useEffect, useState } from 'react';
import type { SessionSummary, BuildingId } from '@agent-citadel/shared';
import { useSettings } from '../settings';
import { useWorld } from '../store';
import { buildingText } from '../i18n';
import { BUILDING_FX } from '../game/building-fx';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtTok(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

/**
 * #4 Session Autopsy — trwały rejestr zakończonych sesji (czyta /session-history).
 * Każdy wpis: czas trwania, tokeny, błędy i pasek podziału pracy po budynkach.
 * Trigger (przycisk) + modal; reużywa stylów .hud-panel/.settings-overlay.
 */
export function SessionHistoryPanel() {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<SessionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const themeId = useSettings((s) => s.themeId);
  const lang = useSettings((s) => s.lang);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/session-history')
      .then((r) => r.json())
      .then((d: SessionSummary[]) => setLog(Array.isArray(d) ? d : []))
      .catch(() => setLog([]))
      .finally(() => setLoading(false));
  }, [open]);

  const replayMode = useWorld((s) => s.replayMode);
  if (replayMode) return null; // ukryj trigger podczas Chronicle

  if (!open) {
    return (
      <button
        className="hud-panel px"
        onClick={() => setOpen(true)}
        style={{ position: 'fixed', bottom: 46, left: '50%', transform: 'translateX(-50%)', cursor: 'pointer', fontSize: 12, padding: '6px 12px' }}
        title="Past sessions: what each run cost and where the work went"
      >
        📜 Session log
      </button>
    );
  }

  return (
    <div className="settings-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="hud-panel" style={{ width: 'min(560px, 92vw)', maxHeight: '85vh', overflow: 'auto' }} role="dialog" aria-modal="true" aria-label="Session log">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <strong className="px" style={{ fontSize: 16, color: '#fac775' }}>📜 Session log</strong>
          <button className="ghost" onClick={() => setOpen(false)} aria-label="Close">✕</button>
        </div>
        <div className="px" style={{ fontSize: 11, opacity: 0.7, marginBottom: 10 }}>
          Each finished session, newest first — duration, tokens, errors, and where the work went.
        </div>
        {loading ? (
          <div className="px" style={{ fontSize: 12, opacity: 0.7, padding: 20 }}>Loading…</div>
        ) : !log || log.length === 0 ? (
          <div className="px" style={{ fontSize: 12, opacity: 0.7, padding: 20 }}>
            No finished sessions logged yet. A session is recorded when it goes idle and leaves the realm.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {log.map((s) => {
              const segs = (Object.entries(s.perBuilding) as [BuildingId, number][])
                .filter(([, v]) => v > 0)
                .sort((a, b) => b[1] - a[1]);
              const total = segs.reduce((a, [, v]) => a + v, 0) || 1;
              return (
                <div key={s.sessionId} className="px" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                    <span style={{ opacity: 0.6, flexShrink: 0 }}>{fmtDuration(s.durationMs)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 10, fontSize: 10, opacity: 0.65, margin: '2px 0 4px' }}>
                    {s.projectName && <span>{s.projectName}</span>}
                    <span>↓{fmtTok(s.tokens.input)} ↑{fmtTok(s.tokens.output)}</span>
                    {s.errorCount > 0 && <span style={{ color: '#e24b4a' }}>⚠ {s.errorCount}</span>}
                    {s.agent !== 'claude' && <span style={{ opacity: 0.8 }}>{s.agent}</span>}
                  </div>
                  {/* Pasek podziału pracy po budynkach (kolory z BUILDING_FX). */}
                  <div style={{ display: 'flex', height: 8, borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
                    {segs.map(([b, v]) => (
                      <div
                        key={b}
                        title={`${buildingText(themeId, b, lang).label} — ${fmtTok(v)}`}
                        style={{ width: `${(v / total) * 100}%`, background: hex(BUILDING_FX[b].color) }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
