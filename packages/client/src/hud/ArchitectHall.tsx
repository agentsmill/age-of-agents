import { useMemo, useState, type ReactNode } from 'react';
import type { ArsenalAgent, ArsenalConnector, ArsenalHook, ArsenalSkill, ProjectArsenal } from '@agent-citadel/shared';
import { useWorld } from '../store';
import { useUi } from '../i18n';
import { relTime } from '../util';
import { aggregateWielded } from './arsenal-select';

/**
 * Arsenal: side panel showing the effective agent equipment for the selected city:
 * skills, MCP connectors, hooks, subagents (project union user union plugin, with
 * source tag), highlighting what heroes REALLY pulled in this session (wielded).
 */
export function ArchitectHall() {
  const selected = useWorld((s) => s.selectedProjectDir);
  const arsenal = useWorld((s) => (selected ? s.arsenal[selected] : undefined));
  const heroes = useWorld((s) => s.heroes);
  const t = useUi();

  const wielded = useMemo(() => aggregateWielded(heroes, selected ?? ''), [heroes, selected]);
  const sessionCount = useMemo(
    () => (selected ? Object.values(heroes).filter((h) => h.projectDir === selected).length : 0),
    [heroes, selected],
  );

  if (!selected) return null;

  return (
    <div
      className="hud-panel px"
      style={{ position: 'absolute', top: 60, right: 16, width: 360, maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column', zIndex: 9, overflow: 'hidden' }}
    >
      <Header arsenal={arsenal} projectDir={selected} sessionCount={sessionCount} t={t} />
      {arsenal ? <Body arsenal={arsenal} wielded={wielded} t={t} /> : <EmptyBody t={t} />}
    </div>
  );
}

function Header({ arsenal, projectDir, sessionCount, t }: { arsenal: ProjectArsenal | undefined; projectDir: string; sessionCount: number; t: Ui }) {
  const name = arsenal?.projectName ?? projectDir.split(/[\\/]/).pop() ?? projectDir;
  const refreshed = arsenal ? relTime(new Date(arsenal.refreshedAt).toISOString(), Date.now(), 'now') : '—';
  return (
    <div style={{ padding: '10px 12px', borderBottom: '2px solid #3a3a36', background: '#2a2926', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 16, color: '#f1efe8', textShadow: '1px 1px 0 #000' }}>🏛️ {name}</span>
        <span style={{ fontSize: 10, color: '#a8a69d' }}>{t.arsenal} · {refreshed}</span>
      </div>
      <div style={{ fontSize: 11, color: '#a8a69d' }}>👥 {sessionCount} {t.active.toLowerCase()}</div>
    </div>
  );
}

function EmptyBody({ t }: { t: Ui }) {
  return (
    <div style={{ padding: 16, fontSize: 12, color: '#a8a69d', textAlign: 'center' }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
      {t.scanningProject}
      <div style={{ fontSize: 10, marginTop: 8, color: '#6b6a63' }}>
        {t.skills} · {t.connectors} · {t.hooks} · {t.subagents}
      </div>
    </div>
  );
}

const ORIGIN_LABEL: Record<string, string> = { project: 'P', user: 'U', plugin: '⧉' };
const ORIGIN_COLOR: Record<string, string> = { project: '#5dcaa5', user: '#85b7eb', plugin: '#f0b56e' };

type Wielded = ReturnType<typeof aggregateWielded>;
type Ui = ReturnType<typeof useUi>;

function Body({ arsenal, wielded, t }: { arsenal: ProjectArsenal; wielded: Wielded; t: Ui }) {
  const usedSkills = new Set(wielded.skills);
  const usedConnectors = new Set(wielded.connectors);
  return (
    <div className="arsenal-scroll" style={{ overflowY: 'auto', flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Section icon="🪄" label={t.skills} count={arsenal.skills.length}>
        {arsenal.skills.map((s: ArsenalSkill) => (
          <Row key={`sk-${s.id}`} name={s.id} sub={s.description} origin={s.origin} used={usedSkills.has(s.id)} usedLabel={t.usedThisSession} />
        ))}
      </Section>
      <Section icon="🔌" label={t.connectors} count={arsenal.connectors.length}>
        {arsenal.connectors.map((c: ArsenalConnector) => (
          <Row key={`co-${c.name}`} name={c.name} sub={c.transport} origin={c.origin} used={usedConnectors.has(c.name)} usedLabel={t.usedThisSession} />
        ))}
      </Section>
      <Section icon="🪝" label={t.hooks} count={arsenal.hooks.length}>
        {arsenal.hooks.map((h: ArsenalHook, i) => (
          <Row key={`hk-${h.event}-${i}`} name={h.event} sub={h.command.split(/[\\/]/).pop()} origin={h.origin} used={false} usedLabel={t.usedThisSession} />
        ))}
      </Section>
      <Section icon="🤖" label={t.subagents} count={arsenal.agents.length}>
        {arsenal.agents.map((a: ArsenalAgent) => (
          <Row key={`ag-${a.name}`} name={a.name} sub={a.description} origin={a.origin} used={false} usedLabel={t.usedThisSession} />
        ))}
      </Section>
    </div>
  );
}

function Section({ icon, label, count, children }: { icon: string; label: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ position: 'sticky', top: 0, zIndex: 1, width: '100%', display: 'flex', alignItems: 'center', gap: 6, background: '#45443f', color: '#f1efe8', border: 'none', padding: '6px 8px', fontSize: 12, cursor: 'pointer', fontFamily: 'Pixelify Sans, system-ui, sans-serif', textShadow: '1px 1px 0 #000' }}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>{icon} {label}</span>
        <span style={{ marginLeft: 'auto', background: '#2a2926', color: '#a8a69d', padding: '0 5px', fontSize: 10 }}>{count}</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 3 }}>
          {count === 0 ? <div style={{ fontSize: 10, color: '#6b6a63', padding: '4px 8px' }}>—</div> : children}
        </div>
      )}
    </div>
  );
}

function Row({ name, sub, origin, used, usedLabel }: { name: string; sub?: string; origin: string; used: boolean; usedLabel: string }) {
  return (
    <div style={{ background: '#2a2926', boxShadow: 'inset 1px 1px 0 #45443f, inset -1px -1px 0 #15140f', padding: '5px 8px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <span title={origin} style={{ background: ORIGIN_COLOR[origin] ?? '#888780', color: '#15140f', padding: '0 4px', fontSize: 9, fontWeight: 700 }}>
        {ORIGIN_LABEL[origin] ?? '?'}
      </span>
      <span style={{ color: '#f1efe8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: sub ? 140 : 260 }}>{name}</span>
      {sub && <span style={{ color: '#6b6a63', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{sub}</span>}
      {used && <span style={{ marginLeft: 'auto', color: '#5dcaa5', fontSize: 9 }}>● {usedLabel}</span>}
    </div>
  );
}
