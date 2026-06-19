import { create } from 'zustand';

export type Lang = 'en' | 'pl' | 'it';

interface SettingsStore {
  themeId: string;
  /** Język UI. Domyślnie angielski; polski, włoski jako alternatywy. */
  lang: Lang;
  flipped: boolean;
  setTheme(id: string): void;
  setLang(lang: Lang): void;
  setFlipped(flipped: boolean): void;
}

const STORAGE_KEY = 'agent-citadel.theme';
const LANG_KEY = 'agent-citadel.lang';
const FLIP_KEY = 'agent-citadel.flip';

const VALID_LANGS: Lang[] = ['en', 'pl', 'it'];

function isValidLang(value: string | null): value is Lang {
  return value !== null && (VALID_LANGS as string[]).includes(value);
}

export const useSettings = create<SettingsStore>((set) => ({
  themeId: localStorage.getItem(STORAGE_KEY) ?? 'fantasy',
  lang: isValidLang(localStorage.getItem(LANG_KEY)) ? (localStorage.getItem(LANG_KEY) as Lang) : 'en', // domyślnie EN
  flipped: localStorage.getItem(FLIP_KEY) === '1',
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
}));
