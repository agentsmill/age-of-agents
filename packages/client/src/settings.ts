import { create } from 'zustand';

export type Lang = 'en' | 'pl' | 'it';

interface SettingsStore {
  themeId: string;
  /** UI language. Defaults to English; Polish and Italian are alternatives. */
  lang: Lang;
  flipped: boolean;
  /** Czy panel misji (MissionLog) jest zwinięty do paska tytułu. */
  missionsCollapsed: boolean;
  setTheme(id: string): void;
  setLang(lang: Lang): void;
  setFlipped(flipped: boolean): void;
  setMissionsCollapsed(collapsed: boolean): void;
}

const STORAGE_KEY = 'agent-citadel.theme';
const LANG_KEY = 'agent-citadel.lang';
const FLIP_KEY = 'agent-citadel.flip';
const MISSIONS_COLLAPSED_KEY = 'agent-citadel.missions-collapsed';

const VALID_LANGS: Lang[] = ['en', 'pl', 'it'];

function isValidLang(value: string | null): value is Lang {
  return value !== null && (VALID_LANGS as string[]).includes(value);
}

export const useSettings = create<SettingsStore>((set) => ({
  themeId: localStorage.getItem(STORAGE_KEY) ?? 'fantasy',
  lang: isValidLang(localStorage.getItem(LANG_KEY)) ? (localStorage.getItem(LANG_KEY) as Lang) : 'en', // default EN
  flipped: localStorage.getItem(FLIP_KEY) === '1',
  missionsCollapsed: localStorage.getItem(MISSIONS_COLLAPSED_KEY) === '1',
  setTheme: (themeId) => {
    localStorage.setItem(STORAGE_KEY, themeId);
    set({ themeId });
  },
  setLang: (lang) => {
    localStorage.setItem(LANG_KEY, lang);
    set({ lang });
  },
  setFlipped: (flipped) => {
    localStorage.setItem(FLIP_KEY, flipped ? '1' : '0');
    set({ flipped });
  },
  setMissionsCollapsed: (missionsCollapsed) => {
    localStorage.setItem(MISSIONS_COLLAPSED_KEY, missionsCollapsed ? '1' : '0');
    set({ missionsCollapsed });
  },
}));
