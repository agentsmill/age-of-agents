import { useEffect, useRef } from 'react';
import type { TranscriptLine } from '@agent-citadel/shared';
import { useWorld } from '../store';

// Stała referencja — selektor zwracający świeże [] przy każdym wywołaniu
// wprawiłby useSyncExternalStore w nieskończoną pętlę renderów.
const NO_LINES: TranscriptLine[] = [];

/** Panel wybranej sesji: szczegóły bohatera + transkrypt read-only. */
export function SidePanel() {
  const selected = useWorld((s) => s.selectedSessionId);
  const hero = useWorld((s) => (selected ? s.heroes[selected] : undefined));
  const lines = useWorld((s) => (selected ? s.transcripts[selected] ?? NO_LINES : NO_LINES));
  const select = useWorld((s) => s.select);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines.length, selected]);

  if (!selected || !hero) return null;

  return (
    <div className="hud-panel sidepanel">
      <div className="head">
        <div>
          <strong>{hero.title}</strong>
          <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>
            {hero.model ?? 'model?'} · {hero.gitBranch ? `⎇ ${hero.gitBranch}` : ''} ·{' '}
            {Math.round(hero.tokens.output / 1000)}k tok
          </div>
        </div>
        <button className="ghost" onClick={() => select(undefined)}>
          ✕
        </button>
      </div>
      <div className="transcript" ref={scrollRef}>
        {lines.length === 0 && (
          <div style={{ opacity: 0.5, fontSize: 12 }}>
            Transkrypt pojawi się przy nowej aktywności sesji.
          </div>
        )}
        {lines.map((line, i) => (
          <div key={i} className={`line ${line.role}`}>
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}
