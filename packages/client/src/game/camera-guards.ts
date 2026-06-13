/**
 * Zabezpieczenia, żeby zoom dotyczył TYLKO mapy, nie całej strony.
 *
 * Pinch na trackpadzie wysyła `wheel` z `ctrlKey` (Chrome/Firefox) albo zdarzenia
 * `gesture*` (Safari) — przeglądarka traktuje je jako zoom strony (skalując też
 * HUD). Przechwytujemy je `preventDefault`; pixi-viewport i tak zoomuje mapę z
 * własnych listenerów. Zwykły scroll (bez ctrl) zostawiamy viewportowi.
 */
export function installCameraGuards(host: HTMLElement): () => void {
  const prevTouchAction = host.style.touchAction;
  const prevOverscroll = document.body.style.overscrollBehavior;
  host.style.touchAction = 'none';
  document.body.style.overscrollBehavior = 'none';

  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) e.preventDefault(); // pinch-zoom trackpada → blokuj zoom strony
  };
  const onGesture = (e: Event) => e.preventDefault(); // Safari pinch

  host.addEventListener('wheel', onWheel, { passive: false });
  host.addEventListener('gesturestart', onGesture, { passive: false });
  host.addEventListener('gesturechange', onGesture, { passive: false });
  host.addEventListener('gestureend', onGesture, { passive: false });

  return () => {
    host.style.touchAction = prevTouchAction;
    document.body.style.overscrollBehavior = prevOverscroll;
    host.removeEventListener('wheel', onWheel);
    host.removeEventListener('gesturestart', onGesture);
    host.removeEventListener('gesturechange', onGesture);
    host.removeEventListener('gestureend', onGesture);
  };
}
