import { useEffect, useRef } from 'react';
import { getGameView } from '../game/view';
import { TEAM_COLORS } from '../game/placeholders';
import { FANTASY } from '../theme/fantasy';

const W = 180;
const H = 120;

/** Minimapa: budynki + jednostki, klik przesuwa kamerę. */
export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const theme = FANTASY;
    const sx = W / theme.grid.w;
    const sy = H / theme.grid.h;

    const timer = setInterval(() => {
      ctx.fillStyle = '#33402a';
      ctx.fillRect(0, 0, W, H);

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
    }, 200);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="hud-panel minimap">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const gx = ((e.clientX - rect.left) / W) * FANTASY.grid.w;
          const gy = ((e.clientY - rect.top) / H) * FANTASY.grid.h;
          getGameView()?.centerOn(gx, gy);
        }}
      />
    </div>
  );
}
