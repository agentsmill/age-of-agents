import { useEffect, useRef, useState } from 'react';
import { useUi } from '../i18n';
import { useSettings } from '../settings';
import { getRealmAudio } from '../game/audio';
import { BuildingReactionsEditor } from './BuildingReactionsEditor';
import { ModelRegistryEditor } from './ModelRegistryEditor';

/** Settings modal. Sectioned; currently one section: building reactions. */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const t = useUi();
  const allRandom = useSettings((s) => s.allRandom);
  const setAllRandom = useSettings((s) => s.setAllRandom);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'buildings' | 'models'>('buildings');
  const soundEnabled = useSettings((s) => s.soundEnabled);
  const setSoundEnabled = useSettings((s) => s.setSoundEnabled);
  // Toggle = gest usera → wolno wznowić AudioContext (polityka autoplay).
  const toggleSound = async () => {
    const next = !soundEnabled;
    if (next) await getRealmAudio().resume();
    getRealmAudio().setEnabled(next);
    setSoundEnabled(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Minimal focus trap: Tab/Shift+Tab cycle within the dialog.
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')]
          .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (!dialog.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    // Focus na dialogu po otwarciu (a11y).
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="settings-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(); // backdrop click closes
      }}
    >
      <div
        className="hud-panel settings-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.settings}
        tabIndex={-1}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong className="px" style={{ fontSize: 16, color: '#fac775' }}>
            ⚙ {t.settings}
          </strong>
          <button className="ghost" onClick={onClose} aria-label={t.notifClose}>✕</button>
        </div>
        <div className="settings-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'buildings'}
            className={`settings-tab${tab === 'buildings' ? ' active' : ''}`}
            onClick={() => setTab('buildings')}
          >
            {t.tabBuildingReactions}
          </button>
          <button
            role="tab"
            aria-selected={tab === 'models'}
            className={`settings-tab${tab === 'models' ? ' active' : ''}`}
            onClick={() => setTab('models')}
          >
            {t.tabModels}
          </button>
        </div>
        <label
          className="px"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 2px 4px', fontSize: 13, cursor: 'pointer' }}
        >
          <input type="checkbox" checked={soundEnabled} onChange={toggleSound} />
          {soundEnabled ? '🔊' : '🔇'} Ambient soundscape
        </label>
        {tab === 'buildings' ? <BuildingReactionsEditor /> : <ModelRegistryEditor />}
      </div>
    </div>
  );
}
