import { useEffect, useMemo, useRef, useState } from 'react';
import { toolToBuilding, type AgentKind, type BuildingId, type HeroStateKind, type TranscriptLine } from '@agent-citadel/shared';
import { useWorld } from '../store';
import { useSettings } from '../settings';
import { useUi, buildingText } from '../i18n';
import { teamColorHex } from '../game/placeholders';
import { getGameView } from '../game/view';
import { clip, formatK, relTime } from '../util';
import { StatTile } from './StatTile';
import { ContextBar } from './ContextBar';

// Stała referencja — selektor zwracający świeże [] przy każdym wywołaniu
// wprawiłby useSyncExternalStore w nieskończoną pętlę renderów.
const NO_LINES: TranscriptLine[] = [];

/** Kolor + emoji per stan (karta pionka — od razu widać „co robi"). */
const STATE_STYLE: Record<HeroStateKind, { color: string; emoji: string }> = {
  working: { color: '#5dcaa5', emoji: '⚙️' },
  thinking: { color: '#85b7eb', emoji: '💭' },
  'awaiting-input': { color: '#ef9f27', emoji: '✋' },
  error: { color: '#f09595', emoji: '⚠️' },
  idle: { color: '#b4b2a9', emoji: '⏸️' },
  sleeping: { color: '#888780', emoji: '💤' },
  returning: { color: '#97c459', emoji: '🚶' },
};

/** Emoji budynku (dekoracyjne, wspólne dla obu motywów). */
const BUILDING_EMOJI: Record<BuildingId, string> = {
  citadel: '🏛️',
  tower: '🔭',
  forge: '🔨',
  library: '📚',
  mine: '⛏️',
  barracks: '👥',
  market: '📦',
  guild: '🔌',
  // Punti di raccolta (vengono mostrati solo nei rispettivi temi)
  arena: '⚔️',
  tavern: '🍺',
  garden: '🌿',
  bar: '🍷',
  shrine: '⛩',
  holodeck: '🎮',
  mess: '🍽️',
  hydroponics: '🌱',
  lounge: '🛋',
  medbay: '⚕️',
};

/** Etykieta + kolor odznaki agenta w panelu. */
const AGENT_BADGE: Record<AgentKind, { label: string; color: string } | undefined> = {
  claude: undefined, // domyślny agent — bez odznaki, żeby nie zaśmiecać
  codex: { label: 'Codex', color: '#10a37f' },
  opencode: { label: 'OpenCode', color: '#f59e0b' }, // amber-500
  koda: { label: 'Koda', color: '#8b5cf6' }, // violet-500
};

/** Panel wybranej sesji: karta pionka (stan, statystyki, zadanie, ostatnie akcje) + transkrypt. */
export function SidePanel() {
  const selected = useWorld((s) => s.selectedSessionId);
  const hero = useWorld((s) => (selected ? s.heroes[selected] : undefined));
  const peonsMap = useWorld((s) => s.peons);
  const missionsMap = useWorld((s) => s.missions);
  const lines = useWorld((s) => (selected ? s.transcripts[selected] ?? NO_LINES : NO_LINES));
  const select = useWorld((s) => s.select);
  const autofollow = useWorld((s) => s.autofollow);
  const setAutofollow = useWorld((s) => s.setAutofollow);
  const themeId = useSettings((s) => s.themeId);
  const lang = useSettings((s) => s.lang);
  const t = useUi();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Lekki tick — odświeża czasy względne ("aktywny 12 min", "5m temu"), gdy nic
  // innego nie zmienia stanu (sesja bezczynna). Reszta i tak re-renderuje przy zdarzeniach.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!selected) return; // przy zamkniętym panelu nie tykaj (brak zbędnych re-renderów)
    const id = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, [selected]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines.length, selected]);

  // Derywacje z całych map — memo, by tick (co 10s) nie przeliczał ich bez zmiany danych.
  const helpers = useMemo(
    () => Object.values(peonsMap).filter((p) => p.parentSessionId === selected).length,
    [peonsMap, selected],
  );
  const mission = useMemo(
    () => Object.values(missionsMap).find((m) => m.sessionId === selected && m.status === 'active'),
    [missionsMap, selected],
  );

  if (!selected || !hero) return null;

  const now = Date.now();
  const st = STATE_STYLE[hero.state];
  const job = hero.state === 'working' ? hero.toolDetail ?? hero.currentTool : undefined;
  // Destynacja: dokąd jednostka zmierza na mapie (praca → budynek narzędzia; powrót → Twierdza).
  const destId: BuildingId | undefined =
    hero.state === 'working'
      ? toolToBuilding(hero.currentTool, hero.toolDetail)
      : hero.state === 'returning'
        ? 'citadel'
        : undefined;
  const destination = destId ? buildingText(themeId, destId, lang).label : undefined;

  return (
    <div className="hud-panel sidepanel">
      <div className="head" style={{ boxShadow: `inset 3px 0 0 ${teamColorHex(hero.teamColor)}` }}>
        <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: teamColorHex(hero.teamColor), border: '1px solid rgba(0,0,0,.4)', marginTop: 3, flex: 'none' }} />
          <div style={{ minWidth: 0 }}>
            <strong className="px" style={{ fontSize: 15, color: '#fac775' }}>{hero.title}</strong>
            {(() => {
              const badge = AGENT_BADGE[hero.agent ?? 'claude'];
              return badge ? (
                <span
                  className="px"
                  style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 4, background: `${badge.color}33`, color: badge.color, border: `1px solid ${badge.color}66`, verticalAlign: 'middle' }}
                >
                  {badge.label}
                </span>
              ) : null;
            })()}
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              {hero.model ?? t.modelUnknown}
              {hero.gitBranch ? ` · ⎇ ${hero.gitBranch}` : ''}
              {hero.permissionMode ? ` · ${hero.permissionMode}` : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flex: 'none' }}>
          <button className="ghost" onClick={() => select(undefined)}>
            ✕
          </button>
          <label
            className="px"
            title={t.autofollowHint}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', opacity: 0.85, whiteSpace: 'nowrap' }}
          >
            <input
              type="checkbox"
              checked={autofollow}
              onChange={(e) => {
                const next = e.target.checked;
                setAutofollow(next);
                if (next && selected) getGameView()?.focusOnUnit(selected);
              }}
            />
            {t.autofollow}
          </label>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: `${st.color}29`,
          boxShadow: `inset 2px 0 0 ${st.color}, inset 0 0 0 1px #00000022`,
          padding: '8px 10px',
          fontSize: 13,
        }}
      >
        <span style={{ fontSize: 16 }}>{st.emoji}</span>
        <span>
          <b style={{ color: st.color }}>{t.states[hero.state]}</b>
          {job ? <span style={{ opacity: 0.85 }}> · {clip(job, 44)}</span> : null}
          {destination ? <span style={{ opacity: 0.6 }}> → {destination}</span> : null}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <StatTile label={t.produced} value={formatK(hero.tokens.output)} />
        <StatTile label={t.read} value={formatK(hero.tokens.input)} />
        <StatTile label={t.active} value={fmtDuration(hero.startedAt, now)} />
        <StatTile label={t.peons} value={String(helpers)} />
      </div>

      {typeof hero.contextTokens === 'number' && (
        <ContextBar tokens={hero.contextTokens} model={hero.model} label={t.context} />
      )}

      {mission && (
        <div>
          <Label text={t.currentTask} />
          <div style={{ fontSize: 12, lineHeight: 1.45, opacity: 0.9 }}>{clip(mission.prompt, 160)}</div>
        </div>
      )}

      {hero.recentActions && hero.recentActions.length > 0 && (
        <div>
          <Label text={t.recentActions} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            {hero.recentActions.map((a, i) => {
              const b = toolToBuilding(a.tool, a.detail);
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 18, textAlign: 'center', flex: 'none' }}>{BUILDING_EMOJI[b]}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {buildingText(themeId, b, lang).label}
                    {a.detail ? <span style={{ opacity: 0.65 }}> · {a.detail}</span> : null}
                  </span>
                  <span style={{ opacity: 0.45, fontSize: 11, flex: 'none' }}>{relTime(a.ts, now, t.now)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="transcript" ref={scrollRef}>
        {lines.length === 0 && <div style={{ opacity: 0.5, fontSize: 12 }}>{t.transcriptHint}</div>}
        {lines.map((line, i) => (
          <div key={i} className={`line ${line.role}`}>
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function Label({ text }: { text: string }) {
  return (
    <div className="px" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.55, marginBottom: 5 }}>
      {text}
    </div>
  );
}

/** Czas trwania od startu sesji, np. "12 min" / "1h 5m". */
function fmtDuration(startedAt: string, now: number): string {
  const m = (now - Date.parse(startedAt)) / 60_000;
  if (!isFinite(m) || m < 1) return '<1 min';
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${Math.round(m % 60)}m`;
}

