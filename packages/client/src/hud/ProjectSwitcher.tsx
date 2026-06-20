import { useMemo, useRef, useState, useEffect, type ReactNode } from 'react';
import { useWorld } from '../store';
import { useUi } from '../i18n';
import { useMenuKeyboard } from './useMenuKeyboard';
import type { AgentKind, HeroStateKind } from '@agent-citadel/shared';
import { ProviderEmblem } from './ProviderEmblem';

/** Emoji per agent state (visual flourish in city buttons). */
const STATE_ICON: Record<HeroStateKind, string> = {
  working: '⚙️',
  thinking: '💭',
  'awaiting-input': '✋',
  error: '⚠️',
  recovering: '⚕️',
  idle: '⏸️',
  sleeping: '💤',
  returning: '🚶',
};

/** Shape the project name: Koda Windows-encoded path (for example "C-Users-pietr-progetti-learneoo")
 * becomes a basename; when basename looks like an encoded path, try decoding it back. */
function prettifyName(raw: string, fallback: string): string {
  // If this is a normal path (has "/" or "\"), use basename.
  if (/[\\/]/.test(raw)) {
    const parts = raw.split(/[\\/]/).filter(Boolean);
    return prettifyName(parts[parts.length - 1], fallback);
  }
  // Koda encoding: "C-Users-pietr-progetti-learneoo" (hyphens instead of separators).
  // Look for stable markers in the path: "Users-<user>-progetti-<basename>"
  // or "Users-<user>-<directorio>-<basename>" when the path lacks "progetti".
  const withProgetti = raw.match(/^[A-Z]-Users-[^-]+-progetti-(.+)$/);
  if (withProgetti) return withProgetti[1];
  const withoutProgetti = raw.match(/^[A-Z]-Users-[^-]+-[^-]+-(.+)$/);
  if (withoutProgetti) return withoutProgetti[1];
  // Decode attempt: "--" -> "/" (some Koda variants use double hyphens).
  const decoded = raw
    .replace(/-{2,}/g, '/')
    .replace(/^([A-Z])[\-/]/i, '$1:/');
  if (/[\\/]/.test(decoded)) {
    const parts = decoded.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || fallback;
  }
  // Looks OK: return as-is.
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
 * City switcher as DROPDOWN: one compact trigger instead of a horizontal bar.
 *
 *  - Trigger shows header (CITIES · n cities · m agents) + current city (or "All")
 *    + arrow. This keeps the HUD from stretching horizontally regardless of
 *    project count.
 *  - Click expands a list: "All" (overview) + one row per active city (name +
 *    session count + C/O/K agent badges + state icons).
 *  - The list scrolls (maxHeight), so it scales to many projects.
 *
 *  ONLY projects with active sessions are visible (count > 0). When all city
 *  agents finish, the city disappears from the list. Closing: outside click, Esc,
 *  city selection.
 */
export function ProjectSwitcher() {
  const heroes = useWorld((s) => s.heroes);
  const selected = useWorld((s) => s.selectedProjectDir);
  const selectProject = useWorld((s) => s.selectProject);
  const connected = useWorld((s) => s.connected);
  const t = useUi();

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Close dropdown after outside panel click or Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus(); // restore focus to trigger (keyboard close)
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // When the selected city disappears (its agents finished working), return to
  // "All". Otherwise the trigger shows a city with count 0, the list omits it,
  // and map/architect panel are filtered to an empty project: everything "vanishes".
  useEffect(() => {
    // Reset ONLY when really connected and the world is NOT empty. Empty snapshot
    // on reconnect/server restart is not "city finished work"; otherwise selection
    // would be lost permanently on every dev-server restart.
    const selectable = new Set<string>(cities.keys());
    if (connected && Object.keys(heroes).length > 0 && selected !== undefined && !selectable.has(selected)) {
      selectProject(undefined);
    }
  }, [connected, heroes, selected, cities, selectProject]);

  // Keyboard navigation inside the expanded list (ArrowUp/Down/Home/End + focus after opening).
  useMenuKeyboard(open, menuRef);

  // Show ONLY cities with active sessions (count > 0).
  const activeCities = [...cities.values()].filter((c) => c.count > 0);
  // Sort descending by active sessions, then alphabetically.
  activeCities.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const displayCities = activeCities;

  if (displayCities.length === 0) return null; // no active cities = clean view

  const totalSessions = activeCities.reduce((sum, c) => sum + c.count, 0);
  // Selected city (with session or home); otherwise trigger shows "All".
  const selectedCity = selected !== undefined ? displayCities.find((c) => c.dir === selected) : undefined;

  const choose = (dir?: string) => {
    selectProject(dir);
    setOpen(false);
    // restore focus to trigger only for keyboard selection (focus was in panel)
    if (rootRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
  };

  return (
    <div
      ref={rootRef}
      className="hud-panel px"
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: 0,
        zIndex: 20,
        maxWidth: '92vw',
      }}
    >
      {/* Compact clickable trigger. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="px proj-trigger"
        aria-haspopup="menu"
        aria-controls="proj-city-menu"
        aria-expanded={open}
        title={t.cities}
      >
        <span style={{ fontSize: 18 }}>🏙️</span>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1, textAlign: 'left' }}>
          <span style={{ fontSize: 12, color: '#a8a69d' }}>{t.cities}</span>
          <span style={{ fontSize: 11 }}>
            {activeCities.length} <span style={{ color: '#a8a69d' }}>· {totalSessions} {t.sessions}</span>
          </span>
        </div>

        <span style={{ width: 2, alignSelf: 'stretch', background: '#3a3a36' }} />

        {/* Current selection: All or city name + counter. */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {selected === undefined ? (
            <>
              <span style={{ fontSize: 16 }}>🌍</span>
              <span>{t.allCities}</span>
              <CountBadge count={totalSessions} active />
            </>
          ) : (
            <>
              <span style={{ fontSize: 15 }}>🏛️</span>
              <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedCity ? selectedCity.name : prettifyName(selected, selected)}
              </span>
              <CountBadge count={selectedCity?.count ?? 0} active />
            </>
          )}
        </span>

        <span
          aria-hidden
          style={{
            marginLeft: 4,
            fontSize: 11,
            color: '#a8a69d',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 120ms ease',
          }}
        >
          ▾
        </span>
      </button>

      {/* Expanded city list. */}
      {open && (
        <div ref={menuRef} className="hud-panel px proj-dropdown" id="proj-city-menu" role="menu" aria-label={t.cities}>
          <OptionRow
            icon="🌍"
            label={t.allCities}
            count={totalSessions}
            active={selected === undefined}
            onClick={() => choose(undefined)}
          />
          <div role="none" style={{ height: 2, background: '#3a3a36' }} />
          {displayCities.map((city) => (
            <OptionRow
              key={city.dir}
              icon="🏛️"
              label={city.name}
              title={city.dir}
              count={city.count}
              active={selected === city.dir}
              onClick={() => choose(city.dir)}
              meta={<CityMeta city={city} active={selected === city.dir} />}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CountBadge({ count, active }: { count: number; active: boolean }) {
  return (
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
  );
}

function OptionRow({
  icon,
  label,
  count,
  active,
  onClick,
  title,
  meta,
}: {
  icon: string;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  title?: string;
  meta?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className={`px proj-option${active ? ' active' : ''}`}
      title={title}
    >
      <span style={{ fontSize: 15 }}>{icon}</span>
      <span style={{ flex: 1, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <CountBadge count={count} active={active} />
      {meta}
    </button>
  );
}

/** Agent badges (C/O/K) + state icons (for example gear 3, pause 1) for a city row. */
function CityMeta({ city, active }: { city: CityInfo; active: boolean }) {
  const topStates = [...city.states.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return (
    <>
      {city.agents.size > 0 && (
        <span style={{ display: 'flex', gap: 2 }}>
          {[...city.agents].map((a) => (
            <ProviderEmblem key={a} agent={a} variant="chip" />
          ))}
        </span>
      )}
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
    </>
  );
}
