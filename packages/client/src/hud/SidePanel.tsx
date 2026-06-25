import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveBuilding, type BuildingId, type HeroStateKind, type TranscriptLine } from '@agent-citadel/shared';
import { useWorld } from '../store';
import { useMapping } from '../mapping-store';
import { useModels } from '../model-store';
import { resolveSprite, resolveContextWindow } from '../theme/models';
import { ProviderEmblem } from './ProviderEmblem';
import { containerLabel } from './container-badge';
import { useSettings } from '../settings';
import { useUi, buildingText } from '../i18n';
import { teamColorHex } from '../game/placeholders';
import { getGameView } from '../game/view';
import { clip, formatK, relTime } from '../util';
import { StatTile } from './StatTile';
import { ContextBar } from './ContextBar';
import { PendingQuestionCard } from './PendingQuestionCard';
import { sendSessionMessage, stopSession } from '../sessions';

// Stable reference: a selector returning fresh [] on every call would put
// useSyncExternalStore into an infinite render loop.
const NO_LINES: TranscriptLine[] = [];

/** Color + emoji per state (pawn card: immediately shows "what it is doing"). */
const STATE_STYLE: Record<HeroStateKind, { color: string; emoji: string }> = {
  working: { color: '#5dcaa5', emoji: '⚙️' },
  thinking: { color: '#85b7eb', emoji: '💭' },
  'awaiting-input': { color: '#ef9f27', emoji: '✋' },
  error: { color: '#f09595', emoji: '⚠️' },
  recovering: { color: '#e48aa2', emoji: '⚕️' },
  idle: { color: '#b4b2a9', emoji: '⏸️' },
  sleeping: { color: '#888780', emoji: '💤' },
  returning: { color: '#97c459', emoji: '🚶' },
};

/** Building emoji (decorative, shared by both themes). */
const BUILDING_EMOJI: Record<BuildingId, string> = {
  citadel: '🏛️',
  tower: '🔭',
  forge: '🔨',
  library: '📚',
  mine: '⛏️',
  barracks: '👥',
  market: '📦',
  guild: '🔌',
  // Gathering points (shown only in their respective themes).
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

/** Selected session panel: pawn card (state, stats, task, recent actions) + transcript. */
export function SidePanel() {
  const selected = useWorld((s) => s.selectedSessionId);
  const hero = useWorld((s) => (selected ? s.heroes[selected] : undefined));
  const isSdk = useWorld((s) => (selected ? !!s.sdkSessionIds[selected] : false));
  const peonsMap = useWorld((s) => s.peons);
  const missionsMap = useWorld((s) => s.missions);
  const lines = useWorld((s) => (selected ? s.transcripts[selected] ?? NO_LINES : NO_LINES));
  const select = useWorld((s) => s.select);
  const autofollow = useWorld((s) => s.autofollow);
  const setAutofollow = useWorld((s) => s.setAutofollow);
  const themeId = useSettings((s) => s.themeId);
  const lang = useSettings((s) => s.lang);
  const mapping = useMapping((s) => s.mapping); // re-render when user remaps tools
  const models = useModels((s) => s.models);
  const t = useUi();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Lightweight tick: refreshes relative times ("active 12 min", "5m ago") when
  // nothing else changes state (idle session). Events re-render everything else anyway.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!selected) return; // with panel closed, do nothing (no unnecessary re-renders)
    const id = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, [selected]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines.length, selected]);

  // Derivations from whole maps: memoized so the 10s tick does not recompute them without data changes.
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
  // Destination: where the unit is heading on the map (work -> tool building; return -> Citadel).
  const destId: BuildingId | undefined =
    hero.state === 'working'
      ? resolveBuilding(hero.currentTool, hero.toolDetail, mapping)
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
            <ProviderEmblem agent={hero.agent} variant="pill" />
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              {resolveSprite(hero.model, models).displayName ?? hero.model ?? t.modelUnknown}
              {hero.gitBranch ? ` · ⎇ ${hero.gitBranch}` : ''}
              {hero.permissionMode ? ` · ${hero.permissionMode}` : ''}
            </div>
            {hero.container && (
              <div
                className="px"
                title={hero.container.id}
                style={{ fontSize: 11, marginTop: 3, color: '#7fc7e8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {containerLabel(hero.container)}
              </div>
            )}
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

      <PendingQuestionCard sessionId={selected} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <StatTile label={t.produced} value={formatK(hero.tokens.output)} />
        <StatTile label={t.read} value={formatK(hero.tokens.input)} />
        <StatTile label={t.active} value={fmtDuration(hero.startedAt, now)} />
        <StatTile label={t.peons} value={String(helpers)} />
      </div>

      {typeof hero.contextTokens === 'number' && (
        <ContextBar
          tokens={hero.contextTokens}
          windowSize={hero.contextWindowTokens ?? resolveContextWindow(hero.model, models)}
          label={t.context}
        />
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
              const b = resolveBuilding(a.tool, a.detail, mapping);
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
      {isSdk && selected && <SdkSessionFooter sessionId={selected} />}
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

function SdkSessionFooter({ sessionId }: { sessionId: string }) {
  const t = useUi();
  const [text, setText] = useState('');
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t.pqSendPlaceholder} style={{ flex: 1 }} />
      <button className="ghost" disabled={!text.trim()} onClick={() => { void sendSessionMessage(sessionId, text); setText(''); }}>{t.pqSend}</button>
      <button className="ghost" onClick={() => void stopSession(sessionId)}>{t.pqStop}</button>
    </div>
  );
}

/** Duration since session start, for example "12 min" / "1h 5m". */
function fmtDuration(startedAt: string, now: number): string {
  const m = (now - Date.parse(startedAt)) / 60_000;
  if (!isFinite(m) || m < 1) return '<1 min';
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${Math.round(m % 60)}m`;
}
