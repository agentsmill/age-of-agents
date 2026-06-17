import { useMemo, useRef, useState, useEffect, type ReactNode } from 'react';
import { useWorld } from '../store';
import { useUi } from '../i18n';
import { useMenuKeyboard } from './useMenuKeyboard';
import type { AgentKind, HeroStateKind } from '@agent-citadel/shared';

const AGENT_BADGE: Record<AgentKind, { label: string; color: string } | undefined> = {
  claude: undefined,
  codex: { label: 'C', color: '#10a37f' },
  opencode: { label: 'O', color: '#f59e0b' },
  koda: { label: 'K', color: '#8b5cf6' },
  'local-llm': { label: 'L', color: '#22d3ee' },
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
  /** „Miasto domowe" (katalog uruchomienia, 0 sesji) — pokazane tylko gdy ma realne dane intel. */
  isHome?: boolean;
}

/**
 * Przełącznik miast jako DROPDOWN: jeden kompaktowy trigger zamiast poziomej belki.
 *
 *  - Trigger pokazuje nagłówek (🏙️ CITIES · n miast · m agentów) + aktualnie wybrane
 *    miasto (lub 🌍 „All") + strzałkę. Dzięki temu HUD nie rozjeżdża się poziomo,
 *    niezależnie od liczby projektów.
 *  - Po kliknięciu rozwija się lista: „All" (widok ogólny) + jeden wiersz per
 *    aktywne miasto (nazwa + liczba sesji + odznaki agentów C/O/K + ikony stanów).
 *  - Lista jest przewijalna (maxHeight), więc skaluje się do wielu projektów.
 *
 *  TYLKO projekty z aktywnymi sesjami są widoczne (count > 0). Gdy wszyscy agenci
 *  miasta skończą, miasto znika z listy. Zamykanie: klik poza, Esc, wybór miasta.
 */
export function ProjectSwitcher() {
  const heroes = useWorld((s) => s.heroes);
  const selected = useWorld((s) => s.selectedProjectDir);
  const selectProject = useWorld((s) => s.selectProject);
  const connected = useWorld((s) => s.connected);
  const homeProjectDir = useWorld((s) => s.homeProjectDir);
  const homeIntel = useWorld((s) => (s.homeProjectDir ? s.projectIntel[s.homeProjectDir] : undefined));
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

  // „Miasto domowe" (bo7): katalog uruchomienia jako miasto z 0 sesji, TYLKO gdy
  //  (a) żaden bohater nie pracuje już w tym projekcie (workingDir === homeProjectDir → byłby duplikat),
  //  (b) są realne dane intel (beady LUB graphify dostępne) — opt-in, bez śmiecenia HUD.
  const homeCity = useMemo<CityInfo | null>(() => {
    if (!homeProjectDir || !homeIntel) return null;
    if (Object.values(heroes).some((h) => h.workingDir === homeProjectDir)) return null;
    if (!homeIntel.beads.available && !homeIntel.graphify.available) return null;
    return {
      dir: homeProjectDir,
      name: homeIntel.projectName || prettifyName(homeProjectDir, homeProjectDir),
      count: 0,
      agents: new Set(),
      states: new Map(),
      isHome: true,
    };
  }, [homeProjectDir, homeIntel, heroes]);

  // Zamknij dropdown po kliknięciu poza panelem lub naciśnięciu Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus(); // przywróć focus na trigger (zamknięcie z klawiatury)
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Gdy wybrane miasto zniknie (jego agenci skończą pracę), wróć do widoku „Wszystkie".
  // Inaczej trigger pokazuje miasto z licznikiem 0, lista go nie zawiera, a mapa/panel
  // architekta zostają odfiltrowane do pustego projektu — wszystko „znika" bez śladu.
  useEffect(() => {
    // Reset TYLKO gdy realnie połączeni i świat NIE jest pusty. Pusty snapshot przy
    // reconnekcie/restarcie serwera ≠ „miasto skończyło pracę" — inaczej wybór gubiłby się
    // bezpowrotnie przy każdym restarcie dev-servera.
    const selectable = new Set<string>(cities.keys());
    if (homeCity) selectable.add(homeCity.dir); // miasto domowe też jest „prawdziwym" wyborem
    if (connected && Object.keys(heroes).length > 0 && selected !== undefined && !selectable.has(selected)) {
      selectProject(undefined);
    }
  }, [connected, heroes, selected, cities, homeCity, selectProject]);

  // Nawigacja klawiaturą wewnątrz rozwiniętej listy (ArrowUp/Down/Home/End + focus po otwarciu).
  useMenuKeyboard(open, menuRef);

  // Pokaż TYLKO miasta z aktywnymi sesjami (count > 0).
  const activeCities = [...cities.values()].filter((c) => c.count > 0);
  // Sortuj malejąco po aktywnych sesjach, potem alfabetycznie.
  activeCities.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Lista wyświetlana = miasta z sesjami + (opcjonalnie) miasto domowe na końcu.
  const displayCities = homeCity ? [...activeCities, homeCity] : activeCities;

  if (displayCities.length === 0) return null; // brak miast i brak intelu domowego = czysty widok

  const totalSessions = activeCities.reduce((sum, c) => sum + c.count, 0);
  // Wybrane miasto (z sesją lub domowe); inaczej trigger pokaże „All".
  const selectedCity = selected !== undefined ? displayCities.find((c) => c.dir === selected) : undefined;

  const choose = (dir?: string) => {
    selectProject(dir);
    setOpen(false);
    // przywróć focus na trigger tylko przy wyborze z klawiatury (focus był w panelu)
    if (rootRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
  };

  return (
    <div
      ref={rootRef}
      className="hud-panel px"
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: 0,
        zIndex: 20,
        maxWidth: '92vw',
      }}
    >
      {/* ── Trigger (kompaktowy, klikalny) ── */}
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

        {/* Aktualny wybór: All albo nazwa miasta + licznik. */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {selected === undefined ? (
            <>
              <span style={{ fontSize: 16 }}>🌍</span>
              <span>{t.allCities}</span>
              <CountBadge count={totalSessions} active />
            </>
          ) : (
            <>
              <span style={{ fontSize: 15 }}>{selectedCity?.isHome ? '🏠' : '🏛️'}</span>
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

      {/* ── Rozwijana lista miast ── */}
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
              icon={city.isHome ? '🏠' : '🏛️'}
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

/** Odznaki agentów (C/O/K) + ikony stanów (⚙️3 ⏸️1) dla wiersza miasta. */
function CityMeta({ city, active }: { city: CityInfo; active: boolean }) {
  const topStates = [...city.states.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return (
    <>
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
