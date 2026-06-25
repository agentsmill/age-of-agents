import { useEffect, useState } from 'react';
import { useUi } from '../i18n';
import { apiFetch } from '../api';

type Status = 'loading' | 'installed' | 'legacy' | 'absent' | 'demo' | 'error';

/**
 * Tryb turbo: hooki HTTP Claude Code. Instalacja modyfikuje
 * ~/.claude/settings.json; requires explicit user confirmation.
 */
export function HooksPanel() {
  const [status, setStatus] = useState<Status>('loading');
  const [busy, setBusy] = useState(false);
  const t = useUi();

  const refresh = async () => {
    try {
      const res = await fetch('/hooks/status');
      const data = await res.json();
      setStatus(data.demo ? 'demo' : data.needsMigration ? 'legacy' : data.installed ? 'installed' : 'absent');
    } catch {
      setStatus('error');
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  if (status === 'loading' || status === 'demo' || status === 'error') return null;

  const toggle = async () => {
    const installing = status === 'absent' || status === 'legacy';
    const message = status === 'legacy' ? t.hooksRepair : installing ? t.hooksInstall : t.hooksUninstall;
    if (!window.confirm(message)) return;
    setBusy(true);
    try {
      await apiFetch(installing ? '/hooks/install' : '/hooks/uninstall', { method: 'POST' });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="ghost" disabled={busy} onClick={toggle} title={t.hooksTitle}>
      {status === 'installed' ? t.hooksOn : status === 'legacy' ? t.hooksRepairShort : t.hooksOff}
    </button>
  );
}
