import { useEffect, useRef, useState } from 'react';
import type { ReplayTimeline } from '@agent-citadel/shared';
import { useWorld } from '../store';
import { foldReplay } from '../replay-fold';
import { reconnectWorld } from '../ws';

type Win = 'today' | 'week';
const PLAY_SECONDS = 45; // pełne okno gra ~45 s przy 1×
const SPEEDS = [1, 2, 4];
const TICK_MS = 50;

/**
 * #7 Chronicle — replay dnia jako time-lapse. Pobiera /replay, wchodzi w tryb
 * replay (store gasi żywe eventy), a play/scrub składa świat na chwilę T przez
 * foldReplay i wpycha go do store przez setReplayWorld — reużywa całego renderu.
 */
export function Chronicle() {
  const [open, setOpen] = useState(false);
  const [timeline, setTimeline] = useState<ReplayTimeline | null>(null);
  const [win, setWin] = useState<Win>('today');
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(false);
  const enterReplay = useWorld((s) => s.enterReplay);
  const exitReplay = useWorld((s) => s.exitReplay);
  const setReplayWorld = useWorld((s) => s.setReplayWorld);
  const tRef = useRef(0); // bieżący czas bez wyścigu render/setState (świat aktualizujemy poza renderem)

  const applyAt = (tl: ReplayTimeline | null, time: number): void => {
    if (!tl) return;
    const w = foldReplay(tl.frames, time);
    setReplayWorld(w.heroes, w.peons, w.missions);
  };

  // Pobierz oś czasu przy otwarciu / zmianie okna.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setPlaying(false);
    fetch(`/replay?window=${win}`)
      .then((r) => r.json())
      .then((tl: ReplayTimeline) => {
        setTimeline(tl);
        tRef.current = tl.startMs;
        setT(tl.startMs);
        applyAt(tl, tl.startMs);
        if (tl.frames.length > 0) setPlaying(true);
      })
      .catch(() => setTimeline({ startMs: 0, endMs: 0, frames: [] }))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, win]);

  // Pętla odtwarzania.
  useEffect(() => {
    if (!open || !playing || !timeline) return;
    const dur = timeline.endMs - timeline.startMs;
    if (dur <= 0) return;
    const ratePerMs = dur / (PLAY_SECONDS * 1000);
    const id = setInterval(() => {
      const next = tRef.current + ratePerMs * TICK_MS * speed;
      if (next >= timeline.endMs) {
        tRef.current = timeline.endMs;
        applyAt(timeline, timeline.endMs);
        setT(timeline.endMs);
        setPlaying(false);
        return;
      }
      tRef.current = next;
      applyAt(timeline, next);
      setT(next);
    }, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, playing, timeline, speed]);

  const start = (): void => {
    setOpen(true);
    enterReplay();
  };
  const stop = (): void => {
    setOpen(false);
    setPlaying(false);
    exitReplay();
    reconnectWorld(); // świeży snapshot live
  };
  const scrub = (v: number): void => {
    setPlaying(false);
    tRef.current = v;
    setT(v);
    applyAt(timeline, v);
  };

  if (!open) {
    return (
      <button
        className="hud-panel px"
        onClick={start}
        style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', cursor: 'pointer', fontSize: 12, padding: '6px 12px' }}
        title="Replay your day as a time-lapse kingdom"
      >
        🎬 Chronicle
      </button>
    );
  }

  const dur = timeline ? timeline.endMs - timeline.startMs : 0;
  const empty = !loading && (!timeline || timeline.frames.length === 0);
  const label = timeline && dur > 0 ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div
      className="hud-panel px"
      style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', width: 'min(620px, 94vw)', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <strong style={{ color: '#fac775', fontSize: 13 }}>🎬 Chronicle</strong>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['today', 'week'] as Win[]).map((w) => (
            <button key={w} className={`settings-tab${win === w ? ' active' : ''}`} onClick={() => setWin(w)} style={{ fontSize: 10, padding: '2px 8px' }}>
              {w}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', opacity: 0.75, fontSize: 11 }}>
          {loading ? 'building…' : empty ? 'nothing to replay in this window' : label}
        </span>
        <button className="ghost" onClick={stop} aria-label="Close">✕</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          className="ghost"
          disabled={empty}
          onClick={() => {
            if (timeline && t >= timeline.endMs) {
              tRef.current = timeline.startMs;
              setT(timeline.startMs);
              applyAt(timeline, timeline.startMs);
            }
            setPlaying((p) => !p);
          }}
          style={{ fontSize: 14 }}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range"
          min={timeline?.startMs ?? 0}
          max={timeline?.endMs ?? 1}
          value={t}
          disabled={empty}
          onChange={(e) => scrub(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ fontSize: 11 }}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>{s}×</option>
          ))}
        </select>
      </div>
    </div>
  );
}
