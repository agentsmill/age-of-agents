import type { GameEvent, HeroSnapshot } from '@agent-citadel/shared';

/** Notification severity; controls icon, accent color, and lifetime. */
export type NotifKind = 'alert' | 'error' | 'success';

/** Notification reason; maps to the i18n label and NotifKind. */
export type NotifReason = 'needs-you' | 'error' | 'mission-done' | 'new-session';

export interface Notification {
  id: string;
  reason: NotifReason;
  kind: NotifKind;
  /** When present, clicking jumps to the agent (store.select). */
  sessionId?: string;
  /** Subject text: hero name or mission prompt (the component appends the label). */
  subject: string;
  /** Additional context (for example the git branch). */
  branch?: string;
  createdAt: number;
  ttl: number;
}

export const ALERT_TTL = 12_000;
export const SUCCESS_TTL = 6_000;
/** Maximum visible toasts (oldest ones are dropped). */
export const MAX_VISIBLE = 5;
/**
 * Per-severity storm guard: skip duplicate sessionId+reason entries younger than this.
 * Alerts use a LONGER window because the server sets 'error' for every failing tool
 * result (flash), which can blink repeatedly during debugging. 30s cuts the storm
 * to about one toast per session; successes stay gentler.
 */
export const DEDUP_WINDOW: Record<NotifKind, number> = {
  alert: 30_000,
  error: 30_000,
  success: 10_000,
};

export const REASON_KIND: Record<NotifReason, NotifKind> = {
  'needs-you': 'alert',
  error: 'error',
  'mission-done': 'success',
  'new-session': 'success',
};

/** Notification factory: derives kind/ttl from reason and builds a stable id. */
export function make(
  reason: NotifReason,
  sessionId: string | undefined,
  subject: string,
  branch: string | undefined,
  now: number,
): Notification {
  const kind = REASON_KIND[reason];
  return {
    id: `${sessionId ?? 'x'}:${reason}:${now}`,
    reason,
    kind,
    sessionId,
    subject,
    branch,
    createdAt: now,
    ttl: kind === 'success' ? SUCCESS_TTL : ALERT_TTL,
  };
}

/**
 * EDGE detection: converts a single GameEvent to 0..1 notifications by comparing
 * previous state with new state. Returns null when nothing should pop.
 *
 * EDGE detection (not level detection): the alert fires only at the MOMENT the
 * state is entered, not on every tick while the agent keeps waiting/errored.
 * The dedup window in the store additionally cuts alert frequency (see
 * DEDUP_WINDOW), which matters for 'error' events that the server flashes for
 * every failing tool result.
 *
 * @param prev  previous HeroSnapshot for this session (undefined = unknown / mission)
 * @param event incoming GameEvent
 * @param now   timestamp injected for testability
 */
export function deriveNotification(
  prev: HeroSnapshot | undefined,
  event: GameEvent,
  now: number,
): Notification | null {
  switch (event.type) {
    case 'hero-spawned':
    case 'hero-updated': {
      const hero = event.hero;
      const entered = prev?.state !== hero.state;
      // Alert takes precedence over spawn success.
      if (entered && hero.state === 'awaiting-input')
        return make('needs-you', hero.sessionId, hero.title, hero.gitBranch, now);
      if (entered && hero.state === 'error')
        return make('error', hero.sessionId, hero.title, hero.gitBranch, now);
      if (event.type === 'hero-spawned')
        return make('new-session', hero.sessionId, hero.title, hero.gitBranch, now);
      return null;
    }
    case 'mission-completed':
      return event.mission.status === 'completed'
        ? make('mission-done', event.mission.sessionId, event.mission.prompt, undefined, now)
        : null;
    default:
      return null;
  }
}
