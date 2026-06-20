import type { GameEvent, HeroSnapshot } from '@agent-citadel/shared';

/** Waga powiadomienia — steruje ikoną, kolorem akcentu i czasem życia. */
export type NotifKind = 'alert' | 'error' | 'success';

/** Powód powiadomienia — mapuje się na etykietę i18n oraz na NotifKind. */
export type NotifReason = 'needs-you' | 'error' | 'mission-done' | 'new-session' | 'context-pressure';

export interface Notification {
  id: string;
  reason: NotifReason;
  kind: NotifKind;
  /** Gdy obecne → klik skacze do agenta (store.select). */
  sessionId?: string;
  /** Tekst-podmiot: nazwa bohatera lub prompt misji (komponent dokleja etykietę). */
  subject: string;
  /** Dodatkowy kontekst (np. gałąź gita). */
  branch?: string;
  createdAt: number;
  ttl: number;
}

export const ALERT_TTL = 12_000;
export const SUCCESS_TTL = 6_000;
/** Maks. widocznych toastów (najstarsze wypadają). */
export const MAX_VISIBLE = 5;
/**
 * Okno anty-burzy per waga: pomiń duplikat sessionId+reason młodszy niż to.
 * Alarmy mają DŁUŻSZE okno, bo serwer ustawia 'error' przy każdym błędnym wyniku
 * narzędzia (flash) — podczas debugowania potrafi błyskać raz za razem. 30 s
 * tnie sztorm do ~1 toastu/sesję; sukcesy zostają łagodniejsze.
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
  'context-pressure': 'alert',
};

/** Fabryka powiadomienia: wylicza kind/ttl z reason, składa stabilne id. */
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
 * Wykrywanie KRAWĘDZI: zamienia pojedyncze GameEvent na 0..1 powiadomień,
 * porównując poprzedni stan z nowym. Zwraca null, gdy nic nie wybijamy.
 *
 * Wykrywanie KRAWĘDZI (nie poziomu): alarm pada tylko w MOMENCIE wejścia w stan,
 * nie przy każdym ticku, gdy agent dalej czeka/błądzi. Częstotliwość alarmów
 * dodatkowo tnie okno dedup w store (patrz DEDUP_WINDOW) — istotne dla 'error',
 * które serwer „flashuje" przy każdym błędnym wyniku narzędzia.
 *
 * @param prev  poprzedni HeroSnapshot tej sesji (undefined = nieznany / mission)
 * @param event nadchodzące GameEvent
 * @param now   znacznik czasu (wstrzykiwany dla testowalności)
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
      // Alarm ma pierwszeństwo nad sukcesem-spawnu.
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

/** Próg „ciśnienia kontekstu" — ostrzeżenie, gdy okno modelu zapełnione w tym ułamku. */
export const CONTEXT_PRESSURE_THRESHOLD = 0.8;

/**
 * Wykrywanie KRAWĘDZI ciśnienia kontekstu: alarm pada raz, w momencie przekroczenia
 * progu w GÓRĘ (prev < próg ≤ teraz). contextWindow wstrzykiwany — czysta, testowalna
 * funkcja; store podaje okno z rejestru modeli. Brak danych → null.
 */
export function contextPressureNotification(
  prev: HeroSnapshot | undefined,
  hero: HeroSnapshot,
  contextWindow: number,
  now: number,
): Notification | null {
  if (!contextWindow || !hero.contextTokens) return null;
  const frac = hero.contextTokens / contextWindow;
  const prevFrac = prev?.contextTokens ? prev.contextTokens / contextWindow : 0;
  if (frac >= CONTEXT_PRESSURE_THRESHOLD && prevFrac < CONTEXT_PRESSURE_THRESHOLD) {
    return make('context-pressure', hero.sessionId, hero.title, hero.gitBranch, now);
  }
  return null;
}
