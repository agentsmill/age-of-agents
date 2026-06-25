import { useEffect, useState } from 'react';
import { SDK_PERMISSION_MODES, type SdkPermissionMode } from '@agent-citadel/shared';
import { useUi } from '../i18n';
import { launchAgent, listDirs, recentDirs, sessionsStatus } from '../sessions';
import { useWorld } from '../store';

/** BETA setup instructions (token auth) — GitHub Pages section. */
const LAUNCH_DOCS_URL = 'https://agentsmill.github.io/age-of-agents/#launch-agent';

export function LaunchAgentDialog({ onClose }: { onClose: () => void }) {
  const t = useUi();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [authConfigured, setAuthConfigured] = useState(true);
  const [cwd, setCwd] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<SdkPermissionMode>('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browse, setBrowse] = useState<{ dir: string; parent: string | null; entries: { name: string; path: string }[] } | null>(null);

  useEffect(() => { void sessionsStatus().then((s) => { setAvailable(s.available); setAuthConfigured(s.authConfigured); }); }, []);
  useEffect(() => { void listDirs(cwd || undefined).then(setBrowse).catch(() => setBrowse(null)); }, [cwd]);

  const submit = async () => {
    setBusy(true); setError(null);
    const res = await launchAgent({ cwd, prompt, model: model || undefined, permissionMode: mode });
    setBusy(false);
    if (res.ok) {
      if (res.sessionId) useWorld.getState().markSdkSession(res.sessionId);
      onClose();
    } else {
      setError(res.error ?? 'failed');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0008', display: 'grid', placeItems: 'center', zIndex: 50 }} onClick={onClose}>
      <div className="hud-panel" style={{ width: 460, maxWidth: '90vw', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong className="px" style={{ fontSize: 15, color: '#fac775' }}>{t.launchTitle}</strong>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#0c0c0c', background: '#f0c995', padding: '1px 5px', borderRadius: 3 }}>BETA</span>
          <a href={LAUNCH_DOCS_URL} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', fontSize: 11, color: '#7fc7e8' }}>{t.launchSetupGuide} ↗</a>
        </div>
        {available === false && <div style={{ color: '#f09595', fontSize: 12 }}>{t.launchUnavailable}</div>}
        {available !== false && !authConfigured && (
          <div style={{ color: '#f0c995', fontSize: 12, lineHeight: 1.5 }}>
            ⚠️ {t.launchAuthWarning}
            <pre style={{ margin: '4px 0 0', fontSize: 11, whiteSpace: 'pre-wrap', opacity: 0.85 }}>claude setup-token{'\n'}export CLAUDE_CODE_OAUTH_TOKEN=…</pre>
            <a href={LAUNCH_DOCS_URL} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#7fc7e8' }}>{t.launchSetupGuide} ↗</a>
          </div>
        )}
        <div style={{ fontSize: 11, opacity: 0.7 }}>{t.launchCostWarning}</div>

        <label style={{ fontSize: 12 }}>{t.launchFolder}
          <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/Users/you/project" style={{ width: '100%' }} />
        </label>
        {recentDirs().length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {recentDirs().map((d) => <button key={d} className="ghost" style={{ fontSize: 11 }} onClick={() => setCwd(d)}>{d.split('/').pop()}</button>)}
          </div>
        )}
        {browse && (
          <div style={{ maxHeight: 120, overflow: 'auto', border: '1px solid #ffffff14', fontSize: 12 }}>
            {browse.parent && <div style={{ cursor: 'pointer', padding: '2px 6px' }} onClick={() => setCwd(browse.parent!)}>📁 ..</div>}
            {browse.entries.map((e) => <div key={e.path} style={{ cursor: 'pointer', padding: '2px 6px' }} onClick={() => setCwd(e.path)}>📁 {e.name}</div>)}
          </div>
        )}

        <label style={{ fontSize: 12 }}>{t.launchPrompt}
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} style={{ width: '100%' }} />
        </label>
        <label style={{ fontSize: 12 }}>{t.launchModel}
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-opus-4-8" style={{ width: '100%' }} />
        </label>
        <label style={{ fontSize: 12 }}>{t.launchPermissionMode}
          <select value={mode} onChange={(e) => setMode(e.target.value as SdkPermissionMode)} style={{ width: '100%' }}>
            {SDK_PERMISSION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>

        {error && <div style={{ color: '#f09595', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={onClose}>{t.launchCancel}</button>
          <button className="ghost" disabled={busy || !cwd.trim() || !prompt.trim()} onClick={submit}>{t.launchStart}</button>
        </div>
      </div>
    </div>
  );
}
