import { useMemo, useState } from 'react';
import type { BeadsIssue, GraphifySummary, ProjectIntel } from '@agent-citadel/shared';
import { useWorld } from '../store';
import { useSettings } from '../settings';
import { useUi } from '../i18n';
import { relTime } from '../util';

/**
 * Salon Architekta: panel boczny pokazujący beads issues i graphify stats
 * dla wybranego miasta (projectDir). Wzorowany na SidePanel (karta RTS,
 * ten sam styl HUD).
 *
 * Wyświetla się w 3 trybach:
 *  1. Nic nie wybrane (selectedProjectDir === undefined) → "Wybierz miasto".
 *  2. Wybrane miasto, brak danych beads/graphify → "Brak intelu" + status.
 *  3. Wybrane miasto, pełen widok: header + 2 zakładki (beads / graphify).
 */
export function ArchitectHall() {
  const selected = useWorld((s) => s.selectedProjectDir);
  const intel = useWorld((s) => (selected ? s.projectIntel[selected] : undefined));
  const heroes = useWorld((s) => s.heroes);
  const t = useUi();
  const themeId = useSettings((s) => s.themeId);

  // Wybrany projekt pokazujemy nawet bez intelu (serwer jeszcze nie odpytał).
  // Wtedy header = "nazwa projektu" + liczba aktywnych agentów.
  const heroesInProject = useMemo(() => {
    if (!selected) return [];
    return Object.values(heroes).filter((h) => h.projectDir === selected);
  }, [heroes, selected]);

  if (!selected) return null; // pokaż panel dopiero po wybraniu miasta

  return (
    <div
      className="hud-panel px"
      style={{
        position: 'absolute',
        top: 60,
        right: 16,
        width: 360,
        maxHeight: 'calc(100vh - 80px)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 9,
        overflow: 'hidden',
      }}
    >
      <Header intel={intel} projectDir={selected} sessionCount={heroesInProject.length} />
      {intel ? <Body intel={intel} themeId={themeId} /> : <EmptyBody />}
    </div>
  );
}

function Header({
  intel,
  projectDir,
  sessionCount,
}: {
  intel: ProjectIntel | undefined;
  projectDir: string;
  sessionCount: number;
}) {
  const name = intel?.projectName ?? projectDir.split(/[\\/]/).pop() ?? projectDir;
  const refreshed = intel ? relTime(new Date(intel.refreshedAt).toISOString(), Date.now(), 'now') : '—';
  return (
    <div
      style={{
        padding: '10px 12px',
        borderBottom: '2px solid #3a3a36',
        background: '#2a2926',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 16, color: '#f1efe8', textShadow: '1px 1px 0 #000' }}>🏛️ {name}</span>
        <span style={{ fontSize: 10, color: '#a8a69d' }}>refreshed {refreshed}</span>
      </div>
      <div style={{ fontSize: 11, color: '#a8a69d', display: 'flex', gap: 12 }}>
        <span>👥 {sessionCount} active</span>
        {intel && intel.activeAgents.length > 0 && <span>🤖 {intel.activeAgents.join(' · ')}</span>}
      </div>
      {intel && (
        <div style={{ fontSize: 10, color: '#6b6a63', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {intel.projectDir}
        </div>
      )}
    </div>
  );
}

function EmptyBody() {
  return (
    <div style={{ padding: 16, fontSize: 12, color: '#a8a69d', textAlign: 'center' }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
      Scanning project…
      <div style={{ fontSize: 10, marginTop: 8, color: '#6b6a63' }}>
        Reading <code>.beads/issues.jsonl</code> and <code>graphify-out/graph.json</code>
      </div>
    </div>
  );
}

type Tab = 'beads' | 'graphify';

function Body({ intel, themeId }: { intel: ProjectIntel; themeId: string }) {
  const [tab, setTab] = useState<Tab>('beads');
  return (
    <>
      <div style={{ display: 'flex', borderBottom: '2px solid #3a3a36' }}>
        <TabButton active={tab === 'beads'} onClick={() => setTab('beads')} label="📜 Beads" count={intel.beads.issues.length} available={intel.beads.available} />
        <TabButton active={tab === 'graphify'} onClick={() => setTab('graphify')} label="🌳 Graph" count={intel.graphify.summary?.nodeCount ?? 0} available={intel.graphify.available} />
      </div>
      <div style={{ overflowY: 'auto', flex: 1, padding: 8 }}>
        {tab === 'beads' ? <BeadsView beads={intel.beads} /> : <GraphifyView g={intel.graphify} />}
      </div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
  available,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  available: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        background: active ? '#45443f' : 'transparent',
        color: active ? '#f1efe8' : '#a8a69d',
        border: 'none',
        borderRight: '2px solid #3a3a36',
        padding: '8px 4px',
        fontSize: 12,
        cursor: 'pointer',
        fontFamily: 'Pixelify Sans, system-ui, sans-serif',
        textShadow: '1px 1px 0 #000',
      }}
    >
      {label}{' '}
      <span
        style={{
          background: available ? (active ? '#5dcaa5' : '#3a3a36') : '#5a2c2c',
          color: available ? (active ? '#15140f' : '#a8a69d') : '#f09595',
          padding: '1px 5px',
          fontSize: 10,
        }}
      >
        {available ? count : 'off'}
      </span>
    </button>
  );
}

const PRIORITY_LABEL: Record<number, string> = {
  0: 'P0',
  1: 'P1',
  2: 'P2',
  3: 'P3',
  4: 'P4',
};
const PRIORITY_COLOR: Record<number, string> = {
  0: '#f09595', // critical - red
  1: '#f0b56e', // high - orange
  2: '#f0d76e', // medium - yellow
  3: '#85b7eb', // low - blue
  4: '#888780', // backlog - gray
};
const STATUS_COLOR: Record<string, string> = {
  open: '#85b7eb',
  in_progress: '#5dcaa5',
  closed: '#888780',
  deferred: '#f0d76e',
};
const ISSUE_TYPE_ICON: Record<string, string> = {
  bug: '🐛',
  feature: '✨',
  task: '📋',
  epic: '🏔',
  chore: '🧹',
};

function BeadsView({ beads }: { beads: ProjectIntel['beads'] }) {
  if (!beads.available) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: '#a8a69d' }}>
        <div style={{ fontSize: 20, marginBottom: 4 }}>📜</div>
        <div style={{ color: '#f09595' }}>Beads not initialized</div>
        <div style={{ fontSize: 10, marginTop: 4, color: '#6b6a63' }}>{beads.error}</div>
        <pre style={{ fontSize: 10, color: '#6b6a63', marginTop: 8, whiteSpace: 'pre-wrap' }}>
          {`Run in this project:\n  cd ${beads.error ? '…' : ''}\n  bd init`}
        </pre>
      </div>
    );
  }
  if (beads.issues.length === 0) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: '#a8a69d', textAlign: 'center' }}>
        <div style={{ fontSize: 20 }}>✅</div>
        <div style={{ color: '#5dcaa5' }}>Beads initialized</div>
        <div style={{ fontSize: 10, marginTop: 4 }}>No open tasks</div>
        <div style={{ fontSize: 10, color: '#6b6a63', marginTop: 4 }}>Create one with <code>bd create …</code></div>
      </div>
    );
  }
  // Sortuj: otwarte najpierw, potem wg priority (0 = critical)
  const sorted = [...beads.issues].sort((a, b) => {
    const aOpen = a.status === 'open' || a.status === 'in_progress' ? 0 : 1;
    const bOpen = b.status === 'open' || b.status === 'in_progress' ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return a.priority - b.priority;
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {sorted.map((issue) => <IssueRow key={issue.id} issue={issue} />)}
    </div>
  );
}

function IssueRow({ issue }: { issue: BeadsIssue }) {
  return (
    <div
      style={{
        background: '#2a2926',
        boxShadow: 'inset 1px 1px 0 #45443f, inset -1px -1px 0 #15140f',
        padding: '6px 8px',
        fontSize: 11,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        opacity: issue.status === 'closed' ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            background: PRIORITY_COLOR[issue.priority] ?? '#888780',
            color: '#15140f',
            padding: '0 4px',
            fontSize: 9,
            fontWeight: 700,
          }}
        >
          {PRIORITY_LABEL[issue.priority] ?? `P${issue.priority}`}
        </span>
        <span style={{ color: STATUS_COLOR[issue.status] ?? '#a8a69d', fontSize: 10 }}>
          {ISSUE_TYPE_ICON[issue.issueType] ?? '·'} {issue.id}
        </span>
        {issue.blockedByCount > 0 && (
          <span style={{ fontSize: 9, color: '#f0b56e' }} title="blocked by">
            ⛔ {issue.blockedByCount}
          </span>
        )}
      </div>
      <div style={{ color: '#f1efe8', fontSize: 11, lineHeight: 1.3 }}>{issue.title}</div>
      <div style={{ display: 'flex', gap: 8, fontSize: 9, color: '#6b6a63' }}>
        <span>{issue.status}</span>
        {issue.assignee && <span>@{issue.assignee}</span>}
        {issue.updatedAt && <span>{relTime(new Date(issue.updatedAt).toISOString(), Date.now(), 'now')}</span>}
      </div>
    </div>
  );
}

function GraphifyView({ g }: { g: ProjectIntel['graphify'] }) {
  if (!g.available || !g.summary) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: '#a8a69d' }}>
        <div style={{ fontSize: 20, marginBottom: 4 }}>🌳</div>
        <div style={{ color: '#f09595' }}>Graphify not initialized</div>
        <div style={{ fontSize: 10, marginTop: 4, color: '#6b6a63' }}>{g.error}</div>
        <pre style={{ fontSize: 10, color: '#6b6a63', marginTop: 8, whiteSpace: 'pre-wrap' }}>
          {`Run in this project:\n  graphify update .`}
        </pre>
      </div>
    );
  }
  const s: GraphifySummary = g.summary;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11, color: '#f1efe8' }}>
      <Stat label="Symbols" value={s.nodeCount.toLocaleString()} />
      <Stat label="Edges" value={s.edgeCount.toLocaleString()} />
      <Stat label="Communities" value={s.communityCount.toLocaleString()} />
      {s.topHubs.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 10, color: '#a8a69d', marginBottom: 4 }}>TOP HUBS (god-nodes)</div>
          {s.topHubs.map((h) => (
            <div
              key={h.symbol}
              style={{
                background: '#2a2926',
                boxShadow: 'inset 1px 1px 0 #45443f, inset -1px -1px 0 #15140f',
                padding: '4px 6px',
                marginBottom: 2,
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 10,
              }}
            >
              <span style={{ color: '#85b7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>
                {h.symbol}
              </span>
              <span style={{ color: '#5dcaa5' }}>{h.degree}</span>
            </div>
          ))}
        </div>
      )}
      {s.generatedAt && (
        <div style={{ fontSize: 9, color: '#6b6a63', marginTop: 4 }}>generated {s.generatedAt}</div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        background: '#2a2926',
        boxShadow: 'inset 1px 1px 0 #45443f, inset -1px -1px 0 #15140f',
        padding: '6px 8px',
      }}
    >
      <span style={{ color: '#a8a69d', fontSize: 10 }}>{label}</span>
      <span style={{ color: '#f1efe8' }}>{value}</span>
    </div>
  );
}
