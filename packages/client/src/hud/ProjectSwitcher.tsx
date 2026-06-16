import { useMemo } from 'react';
import { useWorld } from '../store';
import type { AgentKind, HeroStateKind } from '@agent-citadel/shared';

const AGENT_BADGE: Record<AgentKind, { label: string; color: string } | undefined> = {
  claude: undefined,
  codex: { label: 'C', color: '#10a37f' },
  opencode: { label: 'O', color: '#f59e0b' },
  koda: { label: 'K', color: '#8b5cf6' },
};

/** Emoji per stato agente (gadżet wizualny w przyciskach miast). */
const STATE_ICON: Record<HeroStateKind, string> = {
  working: '⚙️',
  thinking: '💭',
  'awaiting-input': '✋',
  error: '⚠️',
  idle: '⏸️',
  sleeping: '💤',
  returning: '🚶',
};

/** Kształtowanie nazwy projektu: path Windows-encoded przez Kodę (np. "C-Users-pietr-progetti-learneoo")
 * zamień na basename, a gdy basename wygląda na ścieżkę zakodowaną, spróbuj zdekodować w odwrotną stronę. */
function prettifyName(raw: string, fallback: string): string {
  // Jeśli to normalna ścieżka (ma "/" lub "\") — basename.
  if (/[\\/]/.test(raw)) {
    const parts = raw.split(/[\\/]/).filter(Boolean);
    return prettifyName(parts[parts.length - 1], fallback);
  }
  // Koda encoding: "C-Users-pietr-progetti-learneoo" (myślniki zamiast separatorów)
  // Szukamy stałych markerów w ścieżce: "Users-<user>-progetti-<basename>"
  // albo "Users-<user>-<directorio>-<basename>" (gdy path nie ma "progetti").
  const withProgetti = raw.match(/^[A-Z]-Users-[^-]+-progetti-(.+)$/);
  if (withProgetti) return withProgetti[1];
  const withoutProgetti = raw.match(/^[A-Z]-Users-[^-]+-[^-]+-(.+)$/);
  if (withoutProgetti) return withoutProgetti[1];
  // Próba dekodowania: "--" → "/" (niektóre warianty Kodę używają podwójnych myślników)
  const decoded = raw
    .replace(/-{2,}/g, '/')
    .replace(/^([A-Z])[\-/]/i, '$1:/');
  if (/[\\/]/.test(decoded)) {
    const parts = decoded.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || fallback;
  }
  // Wygląda OK — zwróć jak jest.
  return raw || fallback;
}

interface CityInfo {
  dir: string;
  name: string;
  count: number;
  agents: Set<AgentKind>;
  states: Map<HeroStateKind, number>;
}

/**
 * Pasek zakładek miast: jeden tab per aktywny katalog projektu (= jedno miasto).
 *
 *  - "All": widok ogólny (agenci ze wszystkich miast na jednej mapie).
 *  - Jeden tab per projectDir: nazwa miasta + liczba aktywnych agentów
 *    + odznaki agentów (C/O/K) + ikony stanów (ile pracuje, ile myśli…).
 *
 *  TYLKO projekty z aktywnymi sesjami są widoczne (activeSessions > 0).
 *  Miasta znikają automatycznie, gdy wszyscy ich agenci zakończą pracę.
 *  Tło w stylu pixel-art HUD (hud-panel + px font), ostre rogi.
 */
export function ProjectSwitcher() {
  const heroes = useWorld((s) => s.heroes);
  const selected = useWorld((s) => s.selectedProjectDir);
  const selectProject = useWorld((s) => s.selectProject);

  const cities = useMemo<Map<string, CityInfo>>(() => {
    const acc = new Map<string, CityInfo>();
    for (const hero of Object.values(heroes)) {
      if (!hero.projectDir) continue;
      let info = acc.get(hero.projectDir);
      if (!info) {
        info = {
          dir: hero.projectDir,
          name: prettifyName(hero.projectName ?? hero.projectDir, hero.projectDir),
          count: 0,
          agents: new Set(),
          states: new Map(),
        };
        acc.set(hero.projectDir, info);
      }
      info.count += 1;
      info.agents.add(hero.agent ?? 'claude');
      info.states.set(hero.state, (info.states.get(hero.state) ?? 0) + 1);
    }
    return acc;
  }, [heroes]);

  // Pokaż TYLKO miasta z aktywnymi sesjami (activeSessions > 0).
  // Gdy wszyscy agenci zakończą, miasto znika z listy.
  const activeCities = [...cities.values()].filter((c) => c.count > 0);
  // Sortuj malejąco po aktywnych sesjach, potem alfabetycznie.
  activeCities.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  if (activeCities.length === 0) return null; // brak agentów = brak paska (czysty widok)

  const totalSessions = activeCities.reduce((sum, c) => sum + c.count, 0);

  return (
    <div
      className="hud-panel px"
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        padding: 0,
        zIndex: 10,
        maxWidth: '92vw',
        overflow: 'hidden',
      }}
    >
      <Header total={totalSessions} cities={activeCities.length} />
      <AllTab active={selected === undefined} onClick={() => selectProject(undefined)} count={totalSessions} />
      <Divider />
      {activeCities.map((city) => (
        <CityTab
          key={city.dir}
          city={city}
          active={selected === city.dir}
          onClick={() => selectProject(city.dir)}
        />
      ))}
    </div>
  );
}

function Header({ total, cities }: { total: number; cities: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        background: '#2a2926',
        borderRight: '2px solid #3a3a36',
        fontSize: 13,
        color: '#f1efe8',
        textShadow: '1px 1px 0 #000',
      }}
    >
      <span style={{ fontSize: 18 }}>🏙️</span>
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
        <span style={{ fontSize: 12, color: '#a8a69d' }}>CITTÀ</span>
        <span style={{ fontSize: 11 }}>
          {cities} <span style={{ color: '#a8a69d' }}>· {total} agenti</span>
        </span>
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 2, background: '#3a3a36' }} />;
}

function AllTab({ active, onClick, count }: { active: boolean; onClick: () => void; count: number }) {
  return (
    <button
      onClick={onClick}
      className="px"
      style={{
        background: active ? '#45443f' : 'transparent',
        color: active ? '#f1efe8' : '#a8a69d',
        border: 'none',
        borderRight: '2px solid #3a3a36',
        padding: '8px 14px',
        fontSize: 14,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        whiteSpace: 'nowrap',
        textShadow: '1px 1px 0 #000',
      }}
    >
      <span style={{ fontSize: 16 }}>🌍</span>
      <span>All</span>
      <span
        style={{
          background: active ? '#5dcaa5' : '#3a3a36',
          color: active ? '#15140f' : '#a8a69d',
          padding: '1px 6px',
          fontSize: 11,
          minWidth: 18,
          textAlign: 'center',
        }}
      >
        {count}
      </span>
    </button>
  );
}

function CityTab({ city, active, onClick }: { city: CityInfo; active: boolean; onClick: () => void }) {
  // Top 3 stany (sortowane malejąco po count) — każdy z emoji i liczbą.
  const topStates = [...city.states.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <button
      onClick={onClick}
      className="px"
      title={city.dir}
      style={{
        background: active ? '#45443f' : 'transparent',
        color: active ? '#f1efe8' : '#a8a69d',
        border: 'none',
        borderRight: '2px solid #3a3a36',
        padding: '8px 12px',
        fontSize: 13,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        whiteSpace: 'nowrap',
        textShadow: '1px 1px 0 #000',
      }}
    >
      <span style={{ fontSize: 15 }}>🏛️</span>
      <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{city.name}</span>
      <span
        style={{
          background: active ? '#5dcaa5' : '#3a3a36',
          color: active ? '#15140f' : '#a8a69d',
          padding: '1px 6px',
          fontSize: 11,
          minWidth: 18,
          textAlign: 'center',
        }}
      >
        {city.count}
      </span>
      {/* Odznaki agentów: C/O/K (Claude bez odznaki, bo domyślny). */}
      {city.agents.size > 0 && (
        <span style={{ display: 'flex', gap: 2 }}>
          {[...city.agents].map((a) => {
            const badge = AGENT_BADGE[a];
            if (!badge) return null;
            return (
              <span
                key={a}
                title={badge.label}
                style={{
                  background: badge.color,
                  color: '#15140f',
                  width: 14,
                  height: 14,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  fontWeight: 700,
                }}
              >
                {badge.label[0]}
              </span>
            );
          })}
        </span>
      )}
      {/* Stany: ikona + count (np. ⚙️3 ⏸️1). */}
      {topStates.length > 0 && (
        <span style={{ display: 'flex', gap: 3, marginLeft: 4, fontSize: 11, color: active ? '#d4d2c8' : '#888780' }}>
          {topStates.map(([state, n]) => (
            <span key={state} title={state} style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              <span style={{ fontSize: 11 }}>{STATE_ICON[state]}</span>
              <span style={{ fontSize: 10 }}>{n}</span>
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
