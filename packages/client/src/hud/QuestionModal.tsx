import { useEffect } from 'react';
import type { PendingQuestion } from '@agent-citadel/shared';
import { useWorld } from '../store';
import { useUi } from '../i18n';
import { sendAnswer } from '../ws';

/** Centered modal showing one AskUserQuestion (opened from the hero panel trigger). */
export function QuestionModal() {
  const openId = useWorld((s) => s.openQuestionId);
  const pending = useWorld((s) => s.pending);
  const heroes = useWorld((s) => s.heroes);
  const t = useUi();
  const close = () => useWorld.getState().openQuestion(undefined);
  const q: PendingQuestion | undefined = openId ? pending[openId] : undefined;

  useEffect(() => {
    if (!q) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [q]);

  if (!q || q.kind !== 'ask-user-question') return null;
  const heroName = heroes[q.sessionId]?.title ?? '';
  const answer = (label: string) => { sendAnswer({ id: q.id, decision: { type: 'select', optionLabels: [label] } }); close(); };

  return (
    <div onClick={close} style={{ position: 'fixed', inset: 0, background: '#000a', display: 'grid', placeItems: 'center', zIndex: 100 }}>
      <div onClick={(e) => e.stopPropagation()} className="hud-panel" style={{ width: 520, maxWidth: '92vw', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 0 0 2px #ef9f27, 0 12px 40px #000a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>📣</span>
          <div style={{ flex: 1 }}>
            <div className="px" style={{ fontSize: 15, color: '#fac775' }}>{t.pqQuestionTitle}</div>
            {heroName && <div style={{ fontSize: 12, opacity: 0.7 }}>{heroName}</div>}
          </div>
          <button className="ghost" onClick={close}>{t.pqClose}</button>
        </div>
        {q.detail && <div style={{ fontSize: 15, lineHeight: 1.5 }}>{q.detail}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(q.options ?? []).map((o, i) =>
            q.source === 'sdk' ? (
              <button key={i} className="ghost" style={{ textAlign: 'left', padding: '8px 10px' }} onClick={() => answer(o.label)}>
                <b>{o.label}</b>{o.description ? <span style={{ opacity: 0.7 }}> — {o.description}</span> : null}
              </button>
            ) : (
              <div key={i} style={{ padding: '8px 10px', border: '1px solid #ffffff14' }}>
                <b>{o.label}</b>{o.description ? <span style={{ opacity: 0.7 }}> — {o.description}</span> : null}
              </div>
            ),
          )}
        </div>
        {q.source !== 'sdk' && <div style={{ opacity: 0.7, fontSize: 12 }}>{t.pqAnswerInTerminal}</div>}
      </div>
    </div>
  );
}
