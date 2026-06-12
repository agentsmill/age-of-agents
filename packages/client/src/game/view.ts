import { Application, Container, TextureStyle } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type { HeroSnapshot, PeonSnapshot } from '@agent-citadel/shared';
import { useWorld } from '../store';
import { toolToBuilding } from '../theme/mapping';
import type { BuildingId, ThemeDef } from '../theme/types';
import { WaypointGraph } from './pathfind';
import { buildBuilding, drawRoads, drawTerrain } from './placeholders';
import { Unit } from './unit';

/**
 * Główny widok gry: scena Pixi + viewport, rekoncyliacja stanu świata
 * (zustand) na jednostki oraz wybór celów wg stanu/narzędzia.
 */
export class GameView {
  private app = new Application();
  private viewport!: Viewport;
  private unitLayer = new Container();
  private units = new Map<string, Unit>();
  private targets = new Map<string, string>();
  private graph: WaypointGraph;
  private unsubscribe?: () => void;

  constructor(private readonly theme: ThemeDef) {
    this.graph = new WaypointGraph(theme);
  }

  async init(host: HTMLElement): Promise<void> {
    TextureStyle.defaultOptions.scaleMode = 'nearest';
    await this.app.init({
      background: 0x1a1a17,
      resizeTo: host,
      antialias: false,
      roundPixels: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    host.appendChild(this.app.canvas);

    const worldWidth = this.theme.grid.w * this.theme.tile;
    const worldHeight = this.theme.grid.h * this.theme.tile;
    this.viewport = new Viewport({
      events: this.app.renderer.events,
      worldWidth,
      worldHeight,
      screenWidth: host.clientWidth,
      screenHeight: host.clientHeight,
    });
    this.viewport.drag().pinch().wheel().decelerate();
    this.viewport.clamp({ direction: 'all', underflow: 'center' });
    this.app.stage.addChild(this.viewport);

    let userZoomed = false;
    this.viewport.on('wheel-scroll', () => (userZoomed = true));
    this.viewport.on('pinch-start', () => (userZoomed = true));

    const refit = () => {
      const screenW = this.app.screen.width;
      const screenH = this.app.screen.height;
      if (screenW < 50 || screenH < 50) return;
      this.viewport.resize(screenW, screenH, worldWidth, worldHeight);
      const fitScale = Math.min(screenW / worldWidth, screenH / worldHeight);
      this.viewport.clampZoom({ minScale: Math.min(0.5, fitScale * 0.9), maxScale: 3 });
      if (!userZoomed) {
        this.viewport.setZoom(fitScale * 0.96, true);
        this.viewport.moveCenter(worldWidth / 2, worldHeight / 2);
      }
    };
    this.app.renderer.on('resize', refit);
    refit();

    const projection = this.theme.projection;
    this.viewport.addChild(drawTerrain(this.theme, projection));
    this.viewport.addChild(drawRoads(this.theme, projection, this.roadSegments()));

    const buildingLayer = new Container();
    buildingLayer.sortableChildren = true;
    for (const def of this.theme.buildings) buildingLayer.addChild(buildBuilding(def, this.theme, projection));
    this.viewport.addChild(buildingLayer);

    this.unitLayer.sortableChildren = true;
    this.viewport.addChild(this.unitLayer);

    this.app.ticker.add((ticker) => {
      const dt = ticker.deltaMS / 1000;
      for (const unit of this.units.values()) unit.update(dt);
    });

    this.unsubscribe = useWorld.subscribe((state) => this.reconcile(state.heroes, state.peons));
    const { heroes, peons } = useWorld.getState();
    this.reconcile(heroes, peons);
  }

  destroy(): void {
    this.unsubscribe?.();
    this.app.destroy(true, { children: true });
  }

  private roadSegments(): [number, number, number, number][] {
    return this.theme.edges.map(([a, b]) => {
      const na = this.graph.node(a)!;
      const nb = this.graph.node(b)!;
      return [na.gx, na.gy, nb.gx, nb.gy];
    });
  }

  private building(id: BuildingId) {
    return this.theme.buildings.find((b) => b.id === id)!;
  }

  private reconcile(heroes: Record<string, HeroSnapshot>, peons: Record<string, PeonSnapshot>): void {
    const seen = new Set<string>();

    for (const hero of Object.values(heroes)) {
      seen.add(hero.sessionId);
      let unit = this.units.get(hero.sessionId);
      if (!unit) {
        const door = this.building('citadel').door;
        unit = new Unit(hero.sessionId, hero.teamColor, false, clipName(hero.title), door, this.theme.projection);
        this.units.set(hero.sessionId, unit);
        this.unitLayer.addChild(unit.container);
      }
      unit.setName(clipName(hero.title));
      unit.setState(hero.state, hero.state === 'working' ? hero.toolDetail ?? hero.currentTool : undefined);
      this.steer(unit, hero.state, hero.currentTool, hero.toolDetail, hero.teamColor);
    }

    for (const peon of Object.values(peons)) {
      seen.add(peon.agentId);
      let unit = this.units.get(peon.agentId);
      if (!unit) {
        const parent = this.units.get(peon.parentSessionId);
        const start = parent ? { gx: parent.gx, gy: parent.gy } : this.building('barracks').door;
        unit = new Unit(peon.agentId, this.parentColor(peon, heroes), true, clipName(peon.description ?? 'peon', 22), start, this.theme.projection);
        this.units.set(peon.agentId, unit);
        this.unitLayer.addChild(unit.container);
      }
      unit.setState(peon.state, peon.currentTool);
      this.steer(unit, peon.state, peon.currentTool, undefined, 0);
    }

    for (const [id, unit] of this.units) {
      if (!seen.has(id)) {
        this.unitLayer.removeChild(unit.container);
        unit.container.destroy({ children: true });
        this.units.delete(id);
        this.targets.delete(id);
      }
    }
  }

  private parentColor(peon: PeonSnapshot, heroes: Record<string, HeroSnapshot>): number {
    return heroes[peon.parentSessionId]?.teamColor ?? 0;
  }

  private steer(unit: Unit, state: string, tool?: string, detail?: string, slot = 0): void {
    let buildingId: BuildingId;
    if (state === 'working') buildingId = toolToBuilding(tool, detail);
    else if (state === 'thinking' || state === 'awaiting-input' || state === 'error') {
      this.targets.delete(unit.id); // zostań gdzie jesteś
      return;
    } else buildingId = 'citadel';

    const key = `${state === 'working' ? 'w' : 'home'}:${buildingId}`;
    if (this.targets.get(unit.id) === key) return;
    this.targets.set(unit.id, key);

    const door = this.building(buildingId).door;
    const startNode = this.graph.nearest(unit.gx, unit.gy);
    const route = this.graph.route(startNode.id, `door:${buildingId}`);
    const jitter = spotJitter(unit.id, slot);
    route.push({ id: 'spot', gx: door.gx + jitter.dx, gy: door.gy + jitter.dy });
    unit.setPath(route);
  }
}

/** Deterministyczny rozrzut miejsc pracy, żeby jednostki się nie nakładały. */
function spotJitter(id: string, slot: number): { dx: number; dy: number } {
  let hash = slot * 7;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 9973;
  return { dx: ((hash % 5) - 2) * 0.45, dy: ((hash >> 2) % 3) * 0.4 + 0.2 };
}

function clipName(name: string, max = 18): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}
