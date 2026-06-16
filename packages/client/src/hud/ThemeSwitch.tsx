import { useSettings, type Lang } from '../settings';
import { useUi } from '../i18n';
import { HooksPanel } from './HooksPanel';

const LANG_CYCLE: Lang[] = ['en', 'pl', 'it'];
const LANG_LABELS: Record<Lang, string> = { en: 'EN', pl: 'PL', it: 'IT' };

export function ThemeSwitch() {
  const themeId = useSettings((s) => s.themeId);
  const setTheme = useSettings((s) => s.setTheme);
  const lang = useSettings((s) => s.lang);
  const setLang = useSettings((s) => s.setLang);
  const t = useUi();

  const cycleLang = () => {
    const idx = LANG_CYCLE.indexOf(lang);
    const next = LANG_CYCLE[(idx + 1) % LANG_CYCLE.length];
    setLang(next);
  };

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
      <button className="ghost" onClick={cycleLang} title="Language / Język / Lingua">
        🌐 {LANG_LABELS[lang]}
      </button>
    </div>
  );
}
