import { useState, useRef, useEffect } from 'react';
import { useSettings, type Lang } from '../settings';
import { useUi } from '../i18n';
import { HooksPanel } from './HooksPanel';
import { SettingsPanel } from './SettingsPanel';
import { useMenuKeyboard } from './useMenuKeyboard';

/** Lista języków do dropdownu: endonimy (nazwa w danym języku) + flaga + krótki kod. */
const LANGS: { id: Lang; label: string; flag: string }[] = [
  { id: 'en', label: 'English', flag: '🇬🇧' },
  { id: 'pl', label: 'Polski', flag: '🇵🇱' },
  { id: 'it', label: 'Italiano', flag: '🇮🇹' },
];
const LANG_SHORT: Record<Lang, string> = { en: 'EN', pl: 'PL', it: 'IT' };

export function ThemeSwitch() {
  const themeId = useSettings((s) => s.themeId);
  const setTheme = useSettings((s) => s.setTheme);
  const lang = useSettings((s) => s.lang);
  const setLang = useSettings((s) => s.setLang);
  const t = useUi();

  const [langOpen, setLangOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const gearRef = useRef<HTMLButtonElement>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const langTriggerRef = useRef<HTMLButtonElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);

  // Zamknij menu języka po kliknięciu poza nim lub naciśnięciu Esc (jak w ProjectSwitcher).
  useEffect(() => {
    if (!langOpen) return;
    const onDown = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLangOpen(false);
        langTriggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [langOpen]);

  const chooseLang = (id: Lang) => {
    setLang(id);
    setLangOpen(false);
    if (langRef.current?.contains(document.activeElement)) langTriggerRef.current?.focus();
  };

  // Nawigacja klawiaturą w rozwiniętym menu języka (strzałki/Home/End + focus po otwarciu).
  useMenuKeyboard(langOpen, langMenuRef);

  return (
    <div className="hud-panel" style={{ top: 12, left: 12, padding: 6, display: 'flex', gap: 6 }}>
      <button
        className="ghost"
        style={themeId === 'fantasy' ? { background: '#3b3b35' } : undefined}
        onClick={() => setTheme('fantasy')}
      >
        🏰 {t.fantasy}
      </button>
      <button
        className="ghost"
        style={themeId === 'scifi' ? { background: '#3b3b35' } : undefined}
        onClick={() => setTheme('scifi')}
      >
        🛰️ {t.scifi}
      </button>
      <HooksPanel />

      {/* ── Język jako dropdown (zamiast cyklicznego przycisku) ── */}
      <div ref={langRef} style={{ position: 'relative' }}>
        <button
          ref={langTriggerRef}
          className="ghost"
          onClick={() => setLangOpen((o) => !o)}
          aria-haspopup="menu"
          aria-controls="lang-menu"
          aria-expanded={langOpen}
          title="Language / Język / Lingua"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          🌐 {LANG_SHORT[lang]}
          <span
            aria-hidden
            style={{
              fontSize: 9,
              transform: langOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 120ms ease',
            }}
          >
            ▾
          </span>
        </button>

        {langOpen && (
          <div ref={langMenuRef} className="hud-panel px hud-dd-menu" id="lang-menu" role="menu" aria-label={t.language}>
            {LANGS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="menuitemradio"
                aria-checked={l.id === lang}
                onClick={() => chooseLang(l.id)}
                className={`px hud-dd-option${l.id === lang ? ' active' : ''}`}
              >
                <span style={{ fontSize: 14 }}>{l.flag}</span>
                <span style={{ flex: 1 }}>{l.label}</span>
                <span style={{ fontSize: 10, color: '#888780' }}>{LANG_SHORT[l.id]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Trybik: ustawienia (reakcje budynków) ── */}
      <button
        ref={gearRef}
        className="ghost"
        onClick={() => setSettingsOpen(true)}
        title={t.settings}
        aria-label={t.settings}
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        style={{ display: 'inline-flex', alignItems: 'center' }}
      >
        ⚙
      </button>
      {settingsOpen && (
        <SettingsPanel
          onClose={() => {
            setSettingsOpen(false);
            gearRef.current?.focus(); // przywróć fokus na trybik (a11y)
          }}
        />
      )}
    </div>
  );
}
