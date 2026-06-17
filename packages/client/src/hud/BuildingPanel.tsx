import { useEffect, useState } from 'react';
import { resolveBuilding, type BuildingId, type BuildingStatsResponse, type BuildingWindowStats } from '@agent-citadel/shared';
import { useWorld } from '../store';
import { useMapping } from '../mapping-store';
import { useSettings } from '../settings';
import { useUi, buildingText } from '../i18n';
import { clip, formatK, relTime } from '../util';
import { teamColorHex } from '../game/placeholders';
import { StatTile } from './StatTile';

const EMPTY: BuildingWindowStats = { today: 0, week: 0, month: 0 };

/** Panel budynku: opis (co reprezentuje) + ile teraz pracuje + tokeny dziś/7d/30d. */
export function BuildingPanel() {
  const buildingId = useWorld((s) => s.selectedBuildingId);
  const heroes = useWorld((s) => s.heroes);
  const peons = useWorld((s) => s.peons);
  const select = useWorld((s) => s.selectBuilding);
  const themeId = useSettings((s) => s.themeId);
  const lang = useSettings((s) => s.lang);
  const mapping = useMapping((s) => s.mapping); // re-render gdy user przemapuje narzędzia
  const t = useUi();
  const [stats, setStats] = useState<BuildingStatsResponse | undefined>();
  const [loading, setLoading] = useState(false);

  // Statystyki historyczne: skan transkryptów po stronie serwera (cache 60 s).
  // Odświeżamy przy otwarciu i co 60 s, dopóki panel jest widoczny.
  useEffect(() => {
    if (!buildingId) return;
    let alive = true;
    const load = () => {
      setLoading(true);
      fetch('/building-stats')
        .then((r) => r.json())
        .then((d: BuildingStatsResponse) => alive && setStats(d))
        .catch(() => {})
        .finally(() => alive && setLoading(false));
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [buildingId]);

  if (!buildingId) return null;

  const bt = buildingText(themeId, buildingId as BuildingId, lang);
  const win = stats?.buildings[buildingId as keyof typeof stats.buildings] ?? EMPTY;

  // "Teraz pracuje" — na żywo ze stanu świata (bohaterowie + peony przy tym budynku).
  const workerHeroes = Object.values(heroes).filter(
    (h) => h.state === 'working' && resolveBuilding(h.currentTool, h.toolDetail, mapping) === buildingId,
  );
  const workerPeons = Object.values(peons).filter(
    (p) => p.state === 'working' && resolveBuilding(p.currentTool, undefined, mapping) === buildingId,
  );
  const workingNow = workerHeroes.length + workerPeons.length;

  // Lista „co się tu działo" — ostatnie akcje WSZYSTKICH bohaterów odfiltrowane do
  // tego budynku (z bufora recentActions), najnowsze pierwsze.
  const now = Date.now();
  const activity = Object.values(heroes)
    .flatMap((h) => (h.recentActions ?? []).map((a) => ({ a, hero: h })))
    .filter(({ a }) => resolveBuilding(a.tool, a.detail, mapping) === buildingId)
    .sort((x, y) => y.a.ts.localeCompare(x.a.ts))
    .slice(0, 8);

  return (
    <div className="hud-panel sidepanel" style={{ overflowY: 'auto' }}>
      <div className="head">
        <div>
          <strong className="px" style={{ fontSize: 15, color: '#fac775' }}>{bt.label}</strong>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>{bt.desc}</div>
          <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>
            {t.workingNow}: <b>{workingNow}</b>
            {workingNow > 0 ? ` (${workerHeroes.length} ${t.sessions}, ${workerPeons.length} ${t.peons})` : ''}
          </div>
        </div>
        <button className="ghost" onClick={() => select(undefined)}>
          ✕
        </button>
      </div>

      {workingNow > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {workerHeroes.map((h) => (
            <div key={h.sessionId} className="line assistant" style={{ alignSelf: 'stretch', maxWidth: '100%' }}>
              🦸 {clip(h.title, 40)} · {h.toolDetail ? clip(h.toolDetail, 30) : h.currentTool}
            </div>
          ))}
          {workerPeons.map((p) => (
            <div key={p.agentId} className="line assistant" style={{ alignSelf: 'stretch', maxWidth: '100%' }}>
              ⛏️ {clip(p.description ?? 'peon', 40)}
            </div>
          ))}
        </div>
      )}

      {activity.length > 0 && (
        <div style={{ borderTop: '1px solid #33332f', paddingTop: 8 }}>
          <div className="px" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.6, marginBottom: 6 }}>
            {t.recentActions}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
            {activity.map(({ a, hero }, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 8, height: 8, background: teamColorHex(hero.teamColor), flex: 'none' }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {clip(hero.title, 22)}
                  {a.detail ? <span style={{ opacity: 0.65 }}> · {a.detail}</span> : null}
                </span>
                <span style={{ opacity: 0.45, fontSize: 11, flex: 'none' }}>{relTime(a.ts, now, t.now)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ borderTop: '1px solid #33332f', paddingTop: 8 }}>
        <div className="px" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.7, marginBottom: 6 }}>
          {t.tokenUsage}
          {loading ? ' …' : ''}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          <StatTile label={t.today} value={formatK(win.today)} />
          <StatTile label={t.week} value={formatK(win.week)} />
          <StatTile label={t.month} value={formatK(win.month)} />
        </div>
        <div style={{ fontSize: 10, opacity: 0.5, marginTop: 6 }}>{t.attribution}</div>
      </div>
    </div>
  );
}

