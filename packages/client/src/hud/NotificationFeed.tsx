import { useEffect, useRef, useState } from 'react';
import { useWorld } from '../store';
import { useUi } from '../i18n';
import { clip } from '../util';
import type { Notification, NotifKind } from '../notifications';

const ICON: Record<NotifKind, string> = { alert: '⚠', error: '✖', success: '✔' };
const FADE_MS = 400;

function NotifCard({ n }: { n: Notification }) {
  const dismiss = useWorld((s) => s.dismissNotification);
  const select = useWorld((s) => s.select);
  const t = useUi();
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const remaining = useRef(n.ttl);
  const startedAt = useRef(0);

  const beginLeave = () => {
    setLeaving(true);
    setTimeout(() => dismiss(n.id), FADE_MS);
  };
  const arm = (delay: number) => {
    startedAt.current = Date.now();
    timer.current = setTimeout(beginLeave, Math.max(0, delay));
  };

  useEffect(() => {
    arm(n.ttl);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hover pauses countdown (and bar), giving time to read/click.
  const pause = () => {
    if (leaving) return;
    clearTimeout(timer.current);
    remaining.current -= Date.now() - startedAt.current;
    setPaused(true);
  };
  const resume = () => {
    if (leaving) return;
    setPaused(false);
    arm(remaining.current);
  };

  const clickable = Boolean(n.sessionId);
  const jump = () => {
    if (!n.sessionId) return;
    select(n.sessionId);
    dismiss(n.id);
  };

  const meta = [n.branch ? `⎇ ${n.branch}` : null, clickable ? t.notifJump : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className={`hud-panel notif notif--${n.kind}${leaving ? ' leaving' : ''}${paused ? ' paused' : ''}`}
      style={{ cursor: clickable ? 'pointer' : 'default' }}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onClick={clickable ? jump : undefined}
      role="status"
    >
      <div className="notif-head">
        <span className="notif-tag px">
          {ICON[n.kind]} {t.notif[n.reason]}
        </span>
        <button
          type="button"
          className="notif-x"
          aria-label={t.notifClose}
          onClick={(e) => {
            e.stopPropagation();
            clearTimeout(timer.current);
            dismiss(n.id);
          }}
        >
          ✕
        </button>
      </div>
      <div className="notif-title">{clip(n.subject, 70)}</div>
      {meta && <div className="notif-meta">{meta}</div>}
      <div className="notif-bar" style={{ animationDuration: `${n.ttl}ms` }} />
    </div>
  );
}

/** Ephemeral notification stack in the top-left corner. */
export function NotificationFeed() {
  const notifications = useWorld((s) => s.notifications);
  if (notifications.length === 0) return null;
  return (
    <div className="notif-feed" aria-live="polite">
      {notifications.map((n) => (
        <NotifCard key={n.id} n={n} />
      ))}
    </div>
  );
}
