/**
 * Guards so zoom applies ONLY to the map, not the whole page.
 *
 * Trackpad pinch sends `wheel` with `ctrlKey` (Chrome/Firefox) or `gesture*`
 * events (Safari); the browser treats them as page zoom (scaling HUD too).
 * Intercept them with `preventDefault`; pixi-viewport still zooms the map from
 * its own listeners. Regular scroll (without ctrl) is left to the viewport.
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
