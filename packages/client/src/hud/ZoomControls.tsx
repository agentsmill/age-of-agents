import { getGameView } from '../game/view';
import { useUi } from '../i18n';

/** Visible camera controls: zoom in / zoom out / center (as in-game). */
export function ZoomControls() {
  const t = useUi();
  return (
    <div className="hud-panel zoom-controls">
      <button className="ghost" onClick={() => getGameView()?.zoomBy(1.25)} title={t.zoomIn} aria-label={t.zoomIn}>
        +
      </button>
      <button className="ghost" onClick={() => getGameView()?.zoomBy(0.8)} title={t.zoomOut} aria-label={t.zoomOut}>
        −
      </button>
      <button className="ghost" onClick={() => getGameView()?.resetView()} title={t.zoomReset} aria-label={t.zoomReset}>
        ⤢
      </button>
    </div>
  );
}
