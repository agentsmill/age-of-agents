import { useMemo, useState } from 'react';
import type { PendingQuestion } from '@agent-citadel/shared';
import { useWorld } from '../store';
import { useUi } from '../i18n';
import { sendAnswer } from '../ws';
import { clip } from '../util';

/** Card shown in the side panel when the selected hero has an open question. */
export function PendingQuestionCard({ sessionId }: { sessionId: string }) {
  const pending = useWorld((s) => s.pending);
  const heroState = useWorld((s) => s.heroes[sessionId]?.state);
  const t = useUi();
  const question: PendingQuestion | undefined = useMemo(() => {
    const mine = Object.values(pending).filter((q) => q.sessionId === sessionId);
    // Prefer an actionable question (permission/plan) over a display-only one.
    return mine.find((q) => q.kind !== 'ask-user-question') ?? mine[0];
  }, [pending, sessionId]);
  if (!question) return null;

  // AskUserQuestion is display-only (hooks can't answer it). Show it only while
  // the agent is actually awaiting input; once answered in the terminal the hero
  // leaves awaiting-input and the stale card disappears.
  if (question.kind === 'ask-user-question' && heroState !== 'awaiting-input') return null;

  const title =
    question.kind === 'plan-approval' ? t.pqPlanTitle
    : question.kind === 'ask-user-question' ? t.pqQuestionTitle
    : t.pqPermissionTitle;

  const isQuestion = question.kind === 'ask-user-question';

  return (
    <div
      style={{
        background: '#ef9f2722',
        boxShadow: 'inset 2px 0 0 #ef9f27, inset 0 0 0 1px #00000022',
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>⚠️</span>
        <b style={{ color: '#ef9f27' }}>{title}</b>
      </div>

      {!isQuestion && (question.tool || question.detail) && (
        <div style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.9, wordBreak: 'break-word' }}>
          {question.tool ? <b>{question.tool}</b> : null}
          {question.detail ? <span> · {clip(question.detail, 120)}</span> : null}
        </div>
      )}

      {question.kind === 'tool-permission' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="ghost" onClick={() => sendAnswer({ id: question.id, decision: { type: 'allow', scope: 'once' } })}>{t.pqAllow}</button>
          <button className="ghost" onClick={() => sendAnswer({ id: question.id, decision: { type: 'allow', scope: 'always' } })}>{t.pqAllowAlways}</button>
          <button className="ghost" onClick={() => sendAnswer({ id: question.id, decision: { type: 'deny' } })}>{t.pqDeny}</button>
        </div>
      )}

      {question.kind === 'plan-approval' && question.source !== 'sdk' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="ghost" onClick={() => sendAnswer({ id: question.id, decision: { type: 'approve-plan' } })}>{t.pqApprovePlan}</button>
          <button className="ghost" onClick={() => sendAnswer({ id: question.id, decision: { type: 'reject-plan' } })}>{t.pqRejectPlan}</button>
        </div>
      )}

      {question.kind === 'plan-approval' && question.source === 'sdk' && (
        <PlanRejectControls id={question.id} t={t} />
      )}

      {isQuestion && (
        <button
          className="ghost"
          style={{ alignSelf: 'flex-start', color: '#ef9f27', fontWeight: 600 }}
          onClick={() => useWorld.getState().openQuestion(question.id)}
        >
          📣 {t.pqOpenQuestion}
        </button>
      )}
    </div>
  );
}

function PlanRejectControls({ id, t }: { id: string; t: ReturnType<typeof useUi> }) {
  const [reason, setReason] = useState('');
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <button className="ghost" onClick={() => sendAnswer({ id, decision: { type: 'approve-plan' } })}>{t.pqApprovePlan}</button>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.pqRejectReason} style={{ flex: 1, minWidth: 100 }} />
      <button className="ghost" onClick={() => sendAnswer({ id, decision: { type: 'reject-plan', reason: reason || undefined } })}>{t.pqRejectPlan}</button>
    </div>
  );
}
