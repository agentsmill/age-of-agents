import { useEffect, useRef } from 'react';
import { getGameView } from '../game/view';
import { flipAxis } from '../game/flip';
import { TEAM_COLORS } from '../game/placeholders';
import { getTheme } from '../theme';
import { useSettings } from '../settings';

const W = 180;
const H = 120;

/** Minimap: buildings + units; click moves the camera. */
export function Minimap() {
  const themeId = useSettings((s) => s.themeId);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const theme = getTheme(themeId);
    const sx = W / theme.grid.w;
    const sy = H / theme.grid.h;

    const bg = `#${(theme.terrain.base & 0xfefefe).toString(16).padStart(6, '0')}`;
    const timer = setInterval(() => {
      ctx.fillStyle = bg;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;

      // Przy odbiciu miasta lustrzymy też minimapę — tym samym mechanizmem co
      // widok główny (worldLayer.scale.x=-1), tu przez macierz kontekstu 2D, żeby
      // lewo/prawo zgadzało się z planszą. Transform obejmuje tylko rysowanie;
      // współrzędne kliknięcia odwracamy osobno (flipAxis) w onClick.
      const flipped = useSettings.getState().flipped;
      ctx.save();
      if (flipped) {
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
      }

      for (const b of theme.buildings) {
        ctx.fillStyle = `#${b.placeholderColor.toString(16).padStart(6, '0')}`;
        ctx.fillRect(b.gx * sx, b.gy * sy, Math.max(3, b.w * sx), Math.max(3, b.h * sy));
      }

      const view = getGameView();
      if (view) {
        for (const dot of view.unitDots()) {
          const color = TEAM_COLORS[dot.colorIndex % TEAM_COLORS.length];
          ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
          const r = dot.isPeon ? 2 : 3.5;
          ctx.beginPath();
          ctx.arc(dot.gx * sx, dot.gy * sy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#1a1a17';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      ctx.restore();
    }, 200);
    return () => clearInterval(timer);
  }, [themeId]);

  return (
    <div className="hud-panel minimap">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onClick={(e) => {
          const grid = getTheme(useSettings.getState().themeId).grid;
          const rect = e.currentTarget.getBoundingClientRect();
          // Gdy minimapa odbita, jej oś X jest zlustrowana względem świata — odwróć
          // gx z powrotem (flipAxis to inwolucja, więc trafia w tę samą jednostkę).
          const flipped = useSettings.getState().flipped;
          const gx = flipAxis(((e.clientX - rect.left) / W) * grid.w, grid.w, flipped);
          const gy = ((e.clientY - rect.top) / H) * grid.h;
          getGameView()?.centerOn(gx, gy);
        }}
      />
    </div>
  );
}
