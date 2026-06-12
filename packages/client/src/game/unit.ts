import { Container, Graphics, Text } from 'pixi.js';
import type { HeroStateKind } from '@agent-citadel/shared';
import type { Projection } from './projection';
import type { PathNode } from './pathfind';
import { buildUnitBody, labelStyle, teamColor } from './placeholders';

const SPEED_GRID_PER_S = 2.2;

/**
 * Jednostka na mapie (bohater lub peon): pozycja na siatce logicznej,
 * ruch po waypointach, nakładki stanów (aura, wykrzyknik, dym, zzz)
 * i dymek z opisem pracy.
 */
export class Unit {
  readonly container = new Container();
  gx: number;
  gy: number;
  private path: PathNode[] = [];
  private body: Container;
  private aura = new Graphics();
  private overlay = new Text({ text: '', style: labelStyle });
  private bubble = new Text({ text: '', style: { ...labelStyle, fontSize: 10 } });
  private nameTag: Text;
  private elapsed = Math.random() * 10;
  private state: HeroStateKind = 'idle';

  constructor(
    readonly id: string,
    colorIndex: number,
    readonly isPeon: boolean,
    name: string,
    start: { gx: number; gy: number },
    private readonly projection: Projection,
  ) {
    this.gx = start.gx;
    this.gy = start.gy;
    this.body = buildUnitBody(teamColor(colorIndex), isPeon);

    this.aura.circle(0, -12, 18).fill({ color: 0x7f77dd, alpha: 0.25 });
    this.aura.visible = false;

    this.overlay.anchor.set(0.5, 1);
    this.overlay.position.set(0, -34);

    this.bubble.anchor.set(0.5, 1);
    this.bubble.position.set(0, -44);

    this.nameTag = new Text({ text: name, style: { ...labelStyle, fontSize: isPeon ? 9 : 11 } });
    this.nameTag.anchor.set(0.5, 0);
    this.nameTag.position.set(0, 6);
    this.nameTag.alpha = 0.9;

    this.container.addChild(this.aura, this.body, this.overlay, this.bubble, this.nameTag);
    this.syncScreen();
  }

  setName(name: string): void {
    if (this.nameTag.text !== name) this.nameTag.text = name;
  }

  setPath(path: PathNode[]): void {
    this.path = path.filter((node) => Math.hypot(node.gx - this.gx, node.gy - this.gy) > 0.05);
  }

  get moving(): boolean {
    return this.path.length > 0;
  }

  setState(state: HeroStateKind, bubbleText?: string): void {
    this.state = state;
    this.aura.visible = state === 'thinking';
    this.overlay.text = state === 'awaiting-input' ? '!' : state === 'error' ? '✶' : state === 'sleeping' ? 'zzz' : '';
    this.overlay.style.fill = state === 'awaiting-input' ? 0xfac775 : state === 'error' ? 0xe24b4a : 0xb4b2a9;
    this.bubble.text = bubbleText ? clip(bubbleText, 34) : '';
    const dimmed = state === 'sleeping';
    this.body.alpha = dimmed ? 0.45 : 1;
    this.nameTag.alpha = dimmed ? 0.45 : 0.9;
  }

  update(dtSeconds: number): void {
    this.elapsed += dtSeconds;

    if (this.path.length > 0) {
      const target = this.path[0];
      const dx = target.gx - this.gx;
      const dy = target.gy - this.gy;
      const dist = Math.hypot(dx, dy);
      const step = SPEED_GRID_PER_S * dtSeconds;
      if (dist <= step) {
        this.gx = target.gx;
        this.gy = target.gy;
        this.path.shift();
      } else {
        this.gx += (dx / dist) * step;
        this.gy += (dy / dist) * step;
        // zwrot w kierunku ruchu
        this.body.scale.x = dx < -0.01 ? -1 : 1;
      }
      // animacja kroku
      this.body.rotation = Math.sin(this.elapsed * 14) * 0.06;
      this.body.position.y = -Math.abs(Math.sin(this.elapsed * 14)) * 2;
    } else {
      this.body.rotation = 0;
      if (this.state === 'working') {
        // "praca": rytmiczne pochylenie (kucie/kopanie)
        this.body.position.y = Math.abs(Math.sin(this.elapsed * 6)) * -1.5;
        this.body.rotation = Math.sin(this.elapsed * 6) * 0.1;
      } else if (this.state === 'thinking') {
        this.aura.scale.set(1 + Math.sin(this.elapsed * 3) * 0.12);
        this.body.position.y = 0;
      } else {
        this.body.position.y = Math.sin(this.elapsed * 1.5) * 0.8;
      }
    }

    if (this.overlay.text === '!') {
      this.overlay.position.y = -34 + Math.sin(this.elapsed * 5) * 3;
    }

    this.syncScreen();
  }

  private syncScreen(): void {
    const { x, y } = this.projection.toScreen(this.gx, this.gy);
    this.container.position.set(x, y);
    this.container.zIndex = this.projection.depth(this.gx, this.gy) + 100;
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
