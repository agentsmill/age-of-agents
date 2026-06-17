import { useEffect, useRef } from 'react';
import { useUi } from '../i18n';
import { BuildingReactionsEditor } from './BuildingReactionsEditor';

/** Modal ustawień. Sekcjonowany — na razie jedna sekcja: reakcje budynków. */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const t = useUi();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Minimalny focus-trap: Tab/Shift+Tab cyklują w obrębie dialogu.
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
        if (e.target === e.currentTarget) onClose(); // klik w tło zamyka
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
            ⚙ {t.settings} · {t.buildingReactions}
          </strong>
          <button className="ghost" onClick={onClose} aria-label={t.notifClose}>✕</button>
        </div>
        <BuildingReactionsEditor />
      </div>
    </div>
  );
}
