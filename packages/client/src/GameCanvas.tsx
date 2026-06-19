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
    const uninstallGuards = installCameraGuards(host); // zoom tylko mapy, nie strony

    // Inicjalizacja dopiero gdy host ma realny rozmiar — start przy
    // szerokości 1 px (np. ukryta karta) psułby dopasowanie kamery.
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
    // Zmiana motywu LUB języka przebudowuje scenę (etykiety budynków z i18n).
  }, [themeId, lang, flipped]);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />;
}
