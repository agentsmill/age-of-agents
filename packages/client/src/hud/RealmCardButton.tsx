import { useWorld } from '../store';
import { getGameView } from '../game/view';

/**
 * #9 Living Banners — pobranie „Realm Card" (herbu) wybranego projektu jako PNG.
 * Widoczny tylko gdy wybrano miasto (wtedy herb wisi nad twierdzą) i nie trwa replay.
 * Render + eksport robi GameView jego własnym rendererem (w pełni lokalnie).
 */
export function RealmCardButton() {
  const selectedProjectDir = useWorld((s) => s.selectedProjectDir);
  const replayMode = useWorld((s) => s.replayMode);
  if (replayMode || !selectedProjectDir) return null;
  return (
    <button
      className="hud-panel px"
      onClick={() => getGameView()?.exportCrest(selectedProjectDir)}
      style={{ position: 'fixed', top: 84, left: '50%', transform: 'translateX(-50%)', cursor: 'pointer', fontSize: 12, padding: '6px 12px' }}
      title="Download this project's coat of arms as a PNG"
    >
      🛡 Save crest
    </button>
  );
}
