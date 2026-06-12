import { GameCanvas } from './GameCanvas';
import { useWorld } from './store';

/** Korzeń aplikacji: pełnoekranowa scena gry + lekki pasek statusu (HUD w etapie 4). */
export function App() {
  const connected = useWorld((s) => s.connected);
  const heroCount = useWorld((s) => Object.keys(s.heroes).length);
  const peonCount = useWorld((s) => Object.keys(s.peons).length);

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <GameCanvas />
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          padding: '6px 12px',
          background: 'rgba(26,26,23,0.85)',
          border: '1px solid #444441',
          borderRadius: 6,
          fontSize: 13,
          pointerEvents: 'none',
        }}
      >
        Agent Citadel · {connected ? '●' : '○'} · bohaterowie: {heroCount} · peony: {peonCount}
      </div>
    </div>
  );
}
