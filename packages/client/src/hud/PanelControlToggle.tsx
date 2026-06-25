import { useEffect, useState } from 'react';
import type { PermissionPolicy } from '@agent-citadel/shared';
import { useUi } from '../i18n';
import { apiFetch } from '../api';

/** Global ON/OFF for panel-based answering. Reads/writes /permission-policy. */
export function PanelControlToggle() {
  const [policy, setPolicy] = useState<PermissionPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useUi();

  useEffect(() => {
    fetch('/permission-policy')
      .then((r) => r.json())
      .then((p: PermissionPolicy) => setPolicy(p))
      .catch(() => setPolicy(null));
  }, []);

  if (!policy) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      const next = { ...policy, enabled: !policy.enabled };
      const res = await apiFetch('/permission-policy', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (res.ok) setPolicy(await res.json());
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="ghost" disabled={busy} onClick={toggle} title={t.pqPanelControl}>
      {policy.enabled ? t.pqPanelControlOn : t.pqPanelControlOff}
    </button>
  );
}
