import { useEffect, useRef } from 'react';
import { GameView } from './game/view';
import { installCameraGuards } from './game/camera-guards';
import { getTheme } from './theme';
import { useSettings } from './settings';

export function GameCanvas() {
  const themeId = useSettings((s) => s.themeId);
  const lang = useSettings((s) => s.lang);
  const flipped = useSettings((s) => s.flipped);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let view: GameView | undefined;
    let observer: ResizeObserver | undefined;
    const uninstallGuards = installCameraGuards(host); // zoom map only, not the page

    // Initialize only when the host has a real size; starting at
    // 1 px width (for example, hidden tab) would break camera fitting.
    const tryInit = () => {
      if (view || host.clientWidth < 50 || host.clientHeight < 50) return;
      view = new GameView(getTheme(themeId), lang, flipped);
      view.init(host).catch(console.error);
      observer?.disconnect();
    };
    observer = new ResizeObserver(tryInit);
    observer.observe(host);
    tryInit();

    return () => {
      observer?.disconnect();
      uninstallGuards();
      view?.destroy();
    };
    // Changing theme, language, or map direction rebuilds the scene.
  }, [themeId, lang, flipped]);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />;
}
