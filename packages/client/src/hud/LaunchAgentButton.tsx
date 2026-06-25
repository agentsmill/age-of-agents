import { useEffect, useState } from 'react';
import { useUi } from '../i18n';
import { sdkAvailable } from '../sessions';
import { LaunchAgentDialog } from './LaunchAgentDialog';

export function LaunchAgentButton() {
  const t = useUi();
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(false);
  useEffect(() => { void sdkAvailable().then(setAvailable); }, []);
  if (!available) return null; // hide when the SDK isn't installed
  return (
    <>
      <button className="ghost" onClick={() => setOpen(true)} title={t.launchAgent}>
        🚀 {t.launchAgent}
        <span style={{ fontSize: 9, fontWeight: 700, color: '#0c0c0c', background: '#f0c995', padding: '0 4px', borderRadius: 3, marginLeft: 4 }}>BETA</span>
      </button>
      {open && <LaunchAgentDialog onClose={() => setOpen(false)} />}
    </>
  );
}
