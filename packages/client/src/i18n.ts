import type { HeroStateKind, BuildingId } from '@agent-citadel/shared';
import { useSettings, type Lang } from './settings';

/**
 * Lekkie i18n bez bibliotek. Domyślny język = angielski (EN), polski (PL) jako
 * przełącznik. Dwie warstwy: UI (chrome HUD) i BUILDINGS (nazwy + opisy budynków).
 *
 * Ton: język LAICKI — dla bystrych, ale niekoniecznie technicznych osób.
 * Unikamy surowego żargonu (nazw narzędzi, „tokenów", „hooków") na rzecz
 * zwykłych słów; opis budynku tłumaczy, CO tam się dzieje, nie jakim API.
 */

export interface UiStrings {
  fantasy: string;
  scifi: string;
  hooksOn: string;
  hooksOff: string;
  hooksTitle: string;
  hooksInstall: string;
  hooksUninstall: string;
  tokensOut: string;
  tokensIn: string;
  connecting: string;
  missions: string;
  states: Record<HeroStateKind, string>;
  modelUnknown: string;
  transcriptHint: string;
  tok: string;
  workingNow: string;
  sessions: string;
  peons: string;
  tokenUsage: string;
  today: string;
  week: string;
  month: string;
  attribution: string;
  langLabel: string; // tekst przycisku przełącznika (pokazuje język DOCELOWY)
  zoomIn: string;
  zoomOut: string;
  zoomReset: string;
}

const EN: UiStrings = {
  fantasy: 'Fantasy',
  scifi: 'Sci-Fi',
  hooksOn: '⚡ live: on',
  hooksOff: '⚡ live: off',
  hooksTitle: 'Update the world the instant your sessions do something (otherwise there is a ~1s delay)',
  hooksInstall:
    'Turn on live updates?\n\nThe world will react the moment your Claude Code sessions do something, instead of with a ~1 second delay. This adds a small entry to your Claude Code settings file (a backup is saved first). Your existing settings are left untouched.',
  hooksUninstall: 'Turn off live updates? (your other settings stay untouched)',
  tokensOut: 'Total work the agents have produced',
  tokensIn: 'Total amount the agents have read',
  connecting: '○ connecting…',
  missions: 'Tasks',
  states: {
    thinking: 'thinking',
    working: 'working',
    'awaiting-input': 'needs you!',
    idle: 'waiting',
    sleeping: 'asleep',
    error: 'hit a snag',
    returning: 'heading back',
  },
  modelUnknown: 'unknown model',
  transcriptHint: 'The conversation will show up here as the session does new work.',
  tok: 'k produced',
  workingNow: 'Busy here right now',
  sessions: 'sessions',
  peons: 'helpers',
  tokenUsage: 'Work done here',
  today: 'Today',
  week: 'Last 7 days',
  month: 'Last 30 days',
  attribution:
    'Estimated from each session’s activity. Work is credited to the building that matches what the agent was doing (counted in the AI’s units of text).',
  langLabel: 'PL',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomReset: 'Reset view',
};

const PL: UiStrings = {
  fantasy: 'Fantasy',
  scifi: 'Sci-Fi',
  hooksOn: '⚡ na żywo: wł',
  hooksOff: '⚡ na żywo: wył',
  hooksTitle: 'Aktualizuj świat w chwili, gdy Twoje sesje coś robią (inaczej jest ~1 s opóźnienia)',
  hooksInstall:
    'Włączyć aktualizacje na żywo?\n\nŚwiat będzie reagował w chwili, gdy Twoje sesje Claude Code coś zrobią, zamiast z ~1-sekundowym opóźnieniem. Dopisze to mały wpis do pliku ustawień Claude Code (najpierw powstaje kopia zapasowa). Twoje istniejące ustawienia pozostają nietknięte.',
  hooksUninstall: 'Wyłączyć aktualizacje na żywo? (Twoje pozostałe ustawienia zostają nietknięte)',
  tokensOut: 'Łączna praca wytworzona przez agentów',
  tokensIn: 'Łączna ilość, którą agenci przeczytali',
  connecting: '○ łączenie…',
  missions: 'Zadania',
  states: {
    thinking: 'myśli',
    working: 'pracuje',
    'awaiting-input': 'czeka na Ciebie!',
    idle: 'czeka',
    sleeping: 'śpi',
    error: 'potknięcie',
    returning: 'wraca',
  },
  modelUnknown: 'nieznany model',
  transcriptHint: 'Rozmowa pojawi się tutaj, gdy sesja zacznie coś robić.',
  tok: 'k wytworzono',
  workingNow: 'Pracuje tu teraz',
  sessions: 'sesji',
  peons: 'pomocników',
  tokenUsage: 'Wykonana tu praca',
  today: 'Dziś',
  week: 'Ostatnie 7 dni',
  month: 'Ostatnie 30 dni',
  attribution:
    'Szacowane z aktywności każdej sesji. Pracę przypisujemy do budynku pasującego do tego, co agent robił (liczone w jednostkach tekstu AI).',
  langLabel: 'EN',
  zoomIn: 'Przybliż',
  zoomOut: 'Oddal',
  zoomReset: 'Wycentruj',
};

const UI: Record<Lang, UiStrings> = { en: EN, pl: PL };

/** Reaktywny hook: zwraca napisy UI dla aktualnego języka. */
export function useUi(): UiStrings {
  return UI[useSettings((s) => s.lang)];
}

export interface BuildingText {
  label: string;
  desc: string;
}

type ThemeId = 'fantasy' | 'scifi';

// Opis = co budynek REPREZENTUJE, zwykłym językiem (2 zdania, bez żargonu narzędzi).
const BUILDINGS: Record<ThemeId, Record<BuildingId, Record<Lang, BuildingText>>> = {
  fantasy: {
    citadel: {
      en: {
        label: 'Citadel',
        desc: 'The home base. A session rests here between tasks — planning its next move and thinking things through before heading out to work.',
      },
      pl: {
        label: 'Twierdza',
        desc: 'Baza domowa. Sesja odpoczywa tu między zadaniami — planuje kolejny krok i przemyśliwa sprawy, zanim ruszy do pracy.',
      },
    },
    tower: {
      en: {
        label: 'Mage Tower',
        desc: 'The lookout onto the outside world. Agents come here to search the internet and read pages, gathering knowledge that isn’t in your project.',
      },
      pl: {
        label: 'Wieża Maga',
        desc: 'Punkt obserwacyjny świata zewnętrznego. Agenci przychodzą tu przeszukiwać internet i czytać strony, zbierając wiedzę, której nie ma w Twoim projekcie.',
      },
    },
    forge: {
      en: {
        label: 'Forge',
        desc: 'The workshop. This is where agents actually write and rewrite code — creating new features and fixing what’s broken in your program.',
      },
      pl: {
        label: 'Kuźnia',
        desc: 'Warsztat. To tutaj agenci naprawdę piszą i przerabiają kod — tworzą nowe funkcje i naprawiają to, co nie działa w Twoim programie.',
      },
    },
    library: {
      en: {
        label: 'Library',
        desc: 'The reading room. Agents browse and search through the project’s files here to understand how everything fits together before changing anything.',
      },
      pl: {
        label: 'Biblioteka',
        desc: 'Czytelnia. Agenci przeglądają i przeszukują pliki projektu, by zrozumieć, jak wszystko się łączy, zanim cokolwiek zmienią.',
      },
    },
    mine: {
      en: {
        label: 'Mine',
        desc: 'The engine room. Agents run commands and tests here — building the project and checking that the work actually runs. The heavy lifting.',
      },
      pl: {
        label: 'Kopalnia',
        desc: 'Maszynownia. Agenci uruchamiają tu polecenia i testy — budują projekt i sprawdzają, czy praca naprawdę działa. Najcięższa robota.',
      },
    },
    barracks: {
      en: {
        label: 'Barracks',
        desc: 'The staging ground. When a job is big, an agent calls in helpers here — smaller assistants that each take on a part of the task at the same time.',
      },
      pl: {
        label: 'Koszary',
        desc: 'Plac zbiórki. Gdy zadanie jest duże, agent wzywa tu pomocników — mniejszych asystentów, z których każdy bierze na siebie część pracy naraz.',
      },
    },
    market: {
      en: {
        label: 'Market',
        desc: 'The shipping dock. Finished work leaves from here — saving changes and publishing them so the rest of the team (or the live app) receives them.',
      },
      pl: {
        label: 'Targ',
        desc: 'Nabrzeże wysyłkowe. Stąd wychodzi gotowa praca — zapis zmian i ich publikacja, by trafiły do reszty zespołu (albo do działającej aplikacji).',
      },
    },
    guild: {
      en: {
        label: 'Guild',
        desc: 'The connections hub. Agents reach out to outside tools and services here — the plug-ins and integrations that extend what they can do.',
      },
      pl: {
        label: 'Gildia',
        desc: 'Węzeł połączeń. Agenci łączą się tu z zewnętrznymi narzędziami i usługami — wtyczkami i integracjami, które poszerzają ich możliwości.',
      },
    },
  },
  scifi: {
    citadel: {
      en: {
        label: 'Command Center',
        desc: 'The home base. A session rests here between tasks — planning its next move and thinking things through before heading out to work.',
      },
      pl: {
        label: 'Centrum dowodzenia',
        desc: 'Baza domowa. Sesja odpoczywa tu między zadaniami — planuje kolejny krok i przemyśliwa sprawy, zanim ruszy do pracy.',
      },
    },
    tower: {
      en: {
        label: 'Laboratory',
        desc: 'The lookout onto the outside world. Agents come here to search the internet and read pages, gathering knowledge that isn’t in your project.',
      },
      pl: {
        label: 'Laboratorium',
        desc: 'Punkt obserwacyjny świata zewnętrznego. Agenci przychodzą tu przeszukiwać internet i czytać strony, zbierając wiedzę, której nie ma w Twoim projekcie.',
      },
    },
    forge: {
      en: {
        label: 'Drone Factory',
        desc: 'The workshop. This is where agents actually write and rewrite code — creating new features and fixing what’s broken in your program.',
      },
      pl: {
        label: 'Fabryka dronów',
        desc: 'Warsztat. To tutaj agenci naprawdę piszą i przerabiają kod — tworzą nowe funkcje i naprawiają to, co nie działa w Twoim programie.',
      },
    },
    library: {
      en: {
        label: 'Data Archive',
        desc: 'The reading room. Agents browse and search through the project’s files here to understand how everything fits together before changing anything.',
      },
      pl: {
        label: 'Archiwum danych',
        desc: 'Czytelnia. Agenci przeglądają i przeszukują pliki projektu, by zrozumieć, jak wszystko się łączy, zanim cokolwiek zmienią.',
      },
    },
    mine: {
      en: {
        label: 'Refinery',
        desc: 'The engine room. Agents run commands and tests here — building the project and checking that the work actually runs. The heavy lifting.',
      },
      pl: {
        label: 'Rafineria',
        desc: 'Maszynownia. Agenci uruchamiają tu polecenia i testy — budują projekt i sprawdzają, czy praca naprawdę działa. Najcięższa robota.',
      },
    },
    barracks: {
      en: {
        label: 'Hangar',
        desc: 'The staging ground. When a job is big, an agent calls in helpers here — smaller assistants that each take on a part of the task at the same time.',
      },
      pl: {
        label: 'Hangar',
        desc: 'Plac zbiórki. Gdy zadanie jest duże, agent wzywa tu pomocników — mniejszych asystentów, z których każdy bierze na siebie część pracy naraz.',
      },
    },
    market: {
      en: {
        label: 'Spaceport',
        desc: 'The shipping dock. Finished work leaves from here — saving changes and publishing them so the rest of the team (or the live app) receives them.',
      },
      pl: {
        label: 'Port kosmiczny',
        desc: 'Nabrzeże wysyłkowe. Stąd wychodzi gotowa praca — zapis zmian i ich publikacja, by trafiły do reszty zespołu (albo do działającej aplikacji).',
      },
    },
    guild: {
      en: {
        label: 'Comms Station',
        desc: 'The connections hub. Agents reach out to outside tools and services here — the plug-ins and integrations that extend what they can do.',
      },
      pl: {
        label: 'Stacja łączności',
        desc: 'Węzeł połączeń. Agenci łączą się tu z zewnętrznymi narzędziami i usługami — wtyczkami i integracjami, które poszerzają ich możliwości.',
      },
    },
  },
};

/** Nazwa + opis budynku dla motywu i języka (z fallbackiem na EN/id). */
export function buildingText(themeId: string, id: BuildingId, lang: Lang): BuildingText {
  const theme = BUILDINGS[themeId as ThemeId] ?? BUILDINGS.fantasy;
  return theme[id]?.[lang] ?? theme[id]?.en ?? { label: id, desc: '' };
}
