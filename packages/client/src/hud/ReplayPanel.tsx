import { useEffect, useRef, useState } from 'react';
import type { TranscriptLine } from '@agent-citadel/shared';

/**
 * Replay panel: fetches persisted transcript lines from the server
 * and displays them as a chronological chat history.
 */
export function ReplayPanel({ sessionId }: { sessionId: string }) {
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/sessions/${sessionId}/transcript?limit=500`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: TranscriptLine[]) => setLines(data))
      .catch(() => setLines([]))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines.length]);

  if (loading) {
    return <div style={{ opacity: 0.5, fontSize: 12, padding: 8 }}>Loading history…</div>;
  }

  if (lines.length === 0) {
    return <div style={{ opacity: 0.5, fontSize: 12, padding: 8 }}>No history recorded yet.</div>;
  }

  return (
    <div className="transcript replay" ref={scrollRef} style={{ maxHeight: 300, overflowY: 'auto' }}>
      {lines.map((line, i) => (
        <div key={i} className={`line ${line.role}`}>
          <span style={{ opacity: 0.35, fontSize: 9, marginRight: 6 }}>
            {fmtTime(line.ts)}
          </span>
          {line.text}
        </div>
      ))}
    </div>
  );
}

function fmtTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}
