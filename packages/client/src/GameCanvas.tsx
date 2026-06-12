import { useEffect, useRef } from 'react';
import { GameView } from './game/view';
import { FANTASY } from './theme/fantasy';

export function GameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let view: GameView | undefined;
    let observer: ResizeObserver | undefined;

    // Inicjalizacja dopiero gdy host ma realny rozmiar — start przy
    // szerokości 1 px (np. ukryta karta) psułby dopasowanie kamery.
    const tryInit = () => {
      if (view || host.clientWidth < 50 || host.clientHeight < 50) return;
      view = new GameView(FANTASY);
      view.init(host).catch(console.error);
      observer?.disconnect();
    };
    observer = new ResizeObserver(tryInit);
    observer.observe(host);
    tryInit();

    return () => {
      observer?.disconnect();
      view?.destroy();
    };
  }, []);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />;
}
