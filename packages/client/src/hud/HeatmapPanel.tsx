import { useEffect, useState } from 'react';
import type { BuildingHeatmapResponse, BuildingId } from '@agent-citadel/shared';
import { useSettings } from '../settings';
import { useWorld } from '../store';
import { buildingText } from '../i18n';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Liniowa skala aktywności: prawie-puste → zielony → bursztyn (hot). */
function heat(t: number): string {
  if (t <= 0) return 'rgba(255,255,255,0.04)';
  const lerp = (a: number, b: number, k: number) => Math.round(a + (b - a) * k);
  if (t < 0.6) {
    const k = t / 0.6;
    return `rgb(${lerp(40, 110, k)},${lerp(60, 155, k)},${lerp(38, 70, k)})`;
  }
  const k = (t - 0.6) / 0.4;
  return `rgb(${lerp(110, 250, k)},${lerp(155, 199, k)},${lerp(70, 117, k)})`;
}

/**
 * #6 Tool Streak Heatmap — „rytm dnia": kafelki budynek × godzina doby, jasność
 * = wolumen tokenów wyjściowych (ostatnie 30 dni). Czyta /building-heatmap na żądanie.
 * Trigger (mały przycisk) + modal SVG; reużywa stylów .hud-panel/.settings-overlay.
 */
export function HeatmapPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<BuildingHeatmapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const themeId = useSettings((s) => s.themeId);
  const lang = useSettings((s) => s.lang);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/building-heatmap')
      .then((r) => r.json())
      .then((d: BuildingHeatmapResponse) => setData(d))
      .catch(() => setData({ updatedAt: '', buildings: {} }))
      .finally(() => setLoading(false));
  }, [open]);

  const replayMode = useWorld((s) => s.replayMode);
  if (replayMode) return null; // ukryj trigger podczas Chronicle

  if (!open) {
    return (
      <button
        className="hud-panel px"
        onClick={() => setOpen(true)}
        style={{ position: 'fixed', bottom: 12, left: '50%', transform: 'translateX(-50%)', cursor: 'pointer', fontSize: 12, padding: '6px 12px' }}
        title="When your agents do their work, by hour of day"
      >
        📊 Daily rhythm
      </button>
    );
  }

  const entries = data
    ? (Object.entries(data.buildings) as [BuildingId, number[]][])
        .map(([id, hours]) => ({ id, hours, total: hours.reduce((a, b) => a + b, 0) }))
        .filter((e) => e.total > 0)
        .sort((a, b) => b.total - a.total)
    : [];
  const max = entries.reduce((m, e) => Math.max(m, ...e.hours), 0);

  const CELL = 13, GAP = 1, LABEL_W = 104, ROW_H = CELL + GAP;
  const svgW = LABEL_W + 24 * (CELL + GAP) + 8;
  const svgH = entries.length * ROW_H + 26;

  return (
    <div className="settings-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="hud-panel" style={{ maxWidth: '92vw', maxHeight: '85vh', overflow: 'auto' }} role="dialog" aria-modal="true" aria-label="Daily rhythm">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <strong className="px" style={{ fontSize: 16, color: '#fac775' }}>📊 Daily rhythm</strong>
          <button className="ghost" onClick={() => setOpen(false)} aria-label="Close">✕</button>
        </div>
        <div className="px" style={{ fontSize: 11, opacity: 0.7, marginBottom: 10 }}>
          Output by hour of day (last 30 days) — which buildings your agents work in, and when.
        </div>
        {loading ? (
          <div className="px" style={{ fontSize: 12, opacity: 0.7, padding: 20 }}>Scanning…</div>
        ) : entries.length === 0 ? (
          <div className="px" style={{ fontSize: 12, opacity: 0.7, padding: 20 }}>No recorded activity yet.</div>
        ) : (
          <svg width={svgW} height={svgH} style={{ display: 'block' }}>
            {entries.map((e, r) => (
              <g key={e.id} transform={`translate(0,${r * ROW_H})`}>
                <text x={LABEL_W - 6} y={CELL - 2} textAnchor="end" fontSize={10} fill="#cfcbc0" fontFamily="monospace">
                  {buildingText(themeId, e.id, lang).label}
                </text>
                {HOURS.map((h) => (
                  <rect
                    key={h}
                    x={LABEL_W + h * (CELL + GAP)}
                    y={0}
                    width={CELL}
                    height={CELL}
                    rx={2}
                    fill={heat(max > 0 ? e.hours[h] / max : 0)}
                  >
                    <title>{`${buildingText(themeId, e.id, lang).label} · ${h}:00 — ${e.hours[h].toLocaleString()} tok`}</title>
                  </rect>
                ))}
              </g>
            ))}
            {[0, 6, 12, 18, 23].map((h) => (
              <text
                key={h}
                x={LABEL_W + h * (CELL + GAP) + CELL / 2}
                y={entries.length * ROW_H + 12}
                textAnchor="middle"
                fontSize={9}
                fill="#8a877e"
                fontFamily="monospace"
              >
                {h}
              </text>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
