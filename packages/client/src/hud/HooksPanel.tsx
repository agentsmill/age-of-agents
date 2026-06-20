import { useEffect, useState } from 'react';
import { useUi } from '../i18n';

type Status = 'loading' | 'installed' | 'absent' | 'demo' | 'error';

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
      setStatus(data.demo ? 'demo' : data.installed ? 'installed' : 'absent');
    } catch {
      setStatus('error');
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  if (status === 'loading' || status === 'demo' || status === 'error') return null;

  const toggle = async () => {
    const installing = status === 'absent';
    const message = installing ? t.hooksInstall : t.hooksUninstall;
    if (!window.confirm(message)) return;
    setBusy(true);
    try {
      await fetch(installing ? '/hooks/install' : '/hooks/uninstall', { method: 'POST' });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="ghost" disabled={busy} onClick={toggle} title={t.hooksTitle}>
      {status === 'installed' ? t.hooksOn : t.hooksOff}
    </button>
  );
}
