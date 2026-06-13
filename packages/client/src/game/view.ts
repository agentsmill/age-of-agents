import { Application, Container, Graphics, Sprite, TextureStyle } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type { HeroSnapshot, MissionSnapshot, PeonSnapshot } from '@agent-citadel/shared';
import { useWorld } from '../store';
import { toolToBuilding } from '../theme/mapping';
import type { BuildingId, ThemeDef } from '../theme/types';
import { WaypointGraph } from './pathfind';
import { buildBuilding, drawRoads, drawTerrain, TEAM_COLORS } from './placeholders';
import { Unit } from './unit';
import { getHeroSheet, getPeonSheet, loadThemeSprites } from './sprites';
import { sessionToArchetypeKey } from './archetype';
import { loadTilemaps, hasTilemaps, buildTilemap } from './tilemap';
import { loadBuildingSprites } from './building-sprites';
import { loadDecorationSprites, getDecorationTexture } from './decoration-sprites';
import { loadIsoTiles, hasIsoTiles, buildIsoTilemap } from './tilemap-iso';
import { scatterDecorations, type DecoKind } from './decorations';
import { buildTerrainMap } from './terrain-map';

/** Docelowa szerokość dekoracji w kaflach (do skalowania sprite'a). */
const DECO_W: Record<DecoKind, number> = { tree: 1.1, rock: 0.8, bush: 0.75, flower: 0.7 };

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
}

/** Rejestr aktywnego widoku — HUD (minimapa, portrety) sięga przez niego do sceny. */
let activeView: GameView | undefined;
export function getGameView(): GameView | undefined {
  return activeView;
}

export interface UnitDot {
  id: string;
  gx: number;
  gy: number;
  colorIndex: number;
  isPeon: boolean;
}

/**
 * Główny widok gry: scena Pixi + viewport, rekoncyliacja stanu świata
 * (zustand) na jednostki oraz wybór celów wg stanu/narzędzia.
 */
export class GameView {
  private app = new Application();
  private viewport!: Viewport;
  private unitLayer = new Container();
  private fxLayer = new Container();
  private units = new Map<string, Unit>();
  private retiring = new Map<string, { unit: Unit; deadline: number }>();
  private targets = new Map<string, string>();
  private worldOffset = { x: 0, y: 0 };
  private particles: Particle[] = [];
  private missionStatus = new Map<string, string>();
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

    // Granice świata z projekcji (izo ma ujemne X i inną wysokość niż top-down).
    const projection = this.theme.projection;
    const corners = [
      projection.toScreen(0, 0),
      projection.toScreen(this.theme.grid.w, 0),
      projection.toScreen(0, this.theme.grid.h),
      projection.toScreen(this.theme.grid.w, this.theme.grid.h),
    ];
    const pad = 60;
    const minX = Math.min(...corners.map((c) => c.x)) - pad;
    const maxX = Math.max(...corners.map((c) => c.x)) + pad;
    const minY = Math.min(...corners.map((c) => c.y)) - pad;
    const maxY = Math.max(...corners.map((c) => c.y)) + pad;
    const worldWidth = maxX - minX;
    const worldHeight = maxY - minY;

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

    // Warstwa świata przesunięta tak, by współrzędne ujemne (izo) mieściły się w viewporcie.
    const worldLayer = new Container();
    worldLayer.position.set(-minX, -minY);
    this.worldOffset = { x: -minX, y: -minY };
    this.viewport.addChild(worldLayer);

    if (this.theme.style === 'topdown' && hasTilemaps()) {
      worldLayer.addChild(buildTilemap(this.theme)); // niesortowana warstwa tła pod unitLayer
    } else if (this.theme.style === 'iso' && hasIsoTiles()) {
      worldLayer.addChild(buildIsoTilemap(this.theme));
    } else {
      worldLayer.addChild(drawTerrain(this.theme, projection));
    }
    worldLayer.addChild(drawRoads(this.theme, projection, this.roadSegments()));

    // Budynki i jednostki we wspólnej warstwie sortowanej po głębokości —
    // w izometrii jednostka może zniknąć ZA budynkiem.
    this.unitLayer.sortableChildren = true;
    for (const def of this.theme.buildings) this.unitLayer.addChild(buildBuilding(def, this.theme, projection));

    // Dekoracje: kwiaty/krzaki płasko pod jednostkami (worldLayer, przed unitLayer),
    // drzewa/skały zasłaniające w unitLayer z głębokością (jak budynki/jednostki).
    if (this.theme.style === 'topdown' || this.theme.style === 'iso') {
      const terrain = buildTerrainMap(this.theme);
      for (const p of scatterDecorations(this.theme, terrain)) {
        const tex = getDecorationTexture(p.kind);
        if (!tex) continue;
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5, 1);
        sprite.scale.set((this.theme.tile * DECO_W[p.kind]) / tex.width);
        const s = projection.toScreen(p.gx, p.gy);
        sprite.position.set(s.x, s.y);
        if (p.kind === 'tree' || p.kind === 'rock') {
          sprite.zIndex = projection.depth(p.gx, p.gy);
          this.unitLayer.addChild(sprite);
        } else {
          worldLayer.addChild(sprite);
        }
      }
    }

    worldLayer.addChild(this.unitLayer);
    worldLayer.addChild(this.fxLayer);

    this.app.ticker.add((ticker) => {
      const dt = ticker.deltaMS / 1000;
      for (const unit of this.units.values()) unit.update(dt);
      this.updateRetiring(dt);
      this.updateParticles(dt);
    });

    // Atlasy + tilesety PixelLab ładujemy zanim powstaną jednostki/teren.
    await Promise.all([
      loadThemeSprites(this.theme.id),
      loadBuildingSprites(this.theme.id),
      loadDecorationSprites(this.theme.id),
      this.theme.style === 'topdown' ? loadTilemaps(this.theme.id) : loadIsoTiles(this.theme.id),
    ]);

    this.unsubscribe = useWorld.subscribe((state) => this.reconcile(state.heroes, state.peons, state.missions));
    const { heroes, peons, missions } = useWorld.getState();
    this.reconcile(heroes, peons, missions);
    activeView = this;
  }

  destroy(): void {
    if (activeView === this) activeView = undefined;
    this.unsubscribe?.();
    this.app.destroy(true, { children: true });
  }

  /** Wycentruj kamerę na pozycji siatki (klik w minimapę / portret). */
  centerOn(gx: number, gy: number): void {
    const { x, y } = this.theme.projection.toScreen(gx, gy);
    this.viewport.animate({
      position: { x: x + this.worldOffset.x, y: y + this.worldOffset.y },
      time: 350,
      ease: 'easeInOutSine',
    });
  }

  centerOnUnit(id: string): void {
    const unit = this.units.get(id);
    if (unit) this.centerOn(unit.gx, unit.gy);
  }

  /** Pozycje jednostek do minimapy. */
  unitDots(): UnitDot[] {
    return [...this.units.values()].map((u) => ({
      id: u.id,
      gx: u.gx,
      gy: u.gy,
      colorIndex: u.colorIndex,
      isPeon: u.isPeon,
    }));
  }

  worldGrid(): { w: number; h: number } {
    return this.theme.grid;
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

  private reconcile(
    heroes: Record<string, HeroSnapshot>,
    peons: Record<string, PeonSnapshot>,
    missions: Record<string, MissionSnapshot> = {},
  ): void {
    const seen = new Set<string>();

    // Fajerwerki przy przejściu misji active -> completed.
    for (const mission of Object.values(missions)) {
      const prev = this.missionStatus.get(mission.id);
      if (mission.status === 'completed' && prev === 'active') {
        const hero = this.units.get(mission.sessionId);
        if (hero) this.spawnFireworks(hero.gx, hero.gy, hero.colorIndex);
      }
      this.missionStatus.set(mission.id, mission.status);
    }

    for (const hero of Object.values(heroes)) {
      seen.add(hero.sessionId);
      let unit = this.units.get(hero.sessionId);
      if (!unit) {
        const door = this.building('citadel').door;
        const sheet = getHeroSheet(sessionToArchetypeKey(hero));
        unit = new Unit(hero.sessionId, hero.teamColor, false, clipName(hero.title), door, this.theme.projection, sheet);
        unit.container.eventMode = 'static';
        unit.container.cursor = 'pointer';
        const sessionId = hero.sessionId;
        unit.container.on('pointertap', () => useWorld.getState().select(sessionId));
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
        unit = new Unit(peon.agentId, this.parentColor(peon, heroes), true, clipName(peon.description ?? 'peon', 22), start, this.theme.projection, getPeonSheet());
        unit.container.eventMode = 'static';
        unit.container.cursor = 'pointer';
        const parentId = peon.parentSessionId;
        unit.container.on('pointertap', () => useWorld.getState().select(parentId));
        this.units.set(peon.agentId, unit);
        this.unitLayer.addChild(unit.container);
      }
      unit.setState(peon.state, peon.currentTool);
      this.steer(unit, peon.state, peon.currentTool, undefined, 0);
    }

    for (const [id, unit] of this.units) {
      if (!seen.has(id)) {
        this.units.delete(id);
        this.targets.delete(id);
        if (unit.isPeon) {
          this.retirePeon(unit);
        } else {
          this.unitLayer.removeChild(unit.container);
          unit.container.destroy({ children: true });
        }
      }
    }
  }

  /** Peon kończy służbę: wraca do rodzica (lub twierdzy) ze skrzynką i znika. */
  private retirePeon(unit: Unit): void {
    unit.setCrate(true);
    unit.setState('returning');
    const home = [...this.units.values()].find((u) => !u.isPeon && u.colorIndex === unit.colorIndex);
    const targetPos = home ? { gx: home.gx, gy: home.gy } : this.building('citadel').door;
    const start = this.graph.nearest(unit.gx, unit.gy);
    const route = this.graph.route(start.id, this.graph.nearest(targetPos.gx, targetPos.gy).id);
    route.push({ id: 'home', ...targetPos });
    unit.setPath(route);
    this.retiring.set(unit.id, { unit, deadline: performance.now() + 12_000 });
  }

  private updateRetiring(dt: number): void {
    for (const [id, entry] of this.retiring) {
      entry.unit.update(dt);
      if (!entry.unit.moving || performance.now() > entry.deadline) {
        this.spawnFireworks(entry.unit.gx, entry.unit.gy, entry.unit.colorIndex, 8);
        this.unitLayer.removeChild(entry.unit.container);
        entry.unit.container.destroy({ children: true });
        this.retiring.delete(id);
      }
    }
  }

  /** Prosty wybuch cząsteczek (ukończona misja / dostarczony łup). */
  private spawnFireworks(gx: number, gy: number, colorIndex: number, count = 26): void {
    const { x, y } = this.theme.projection.toScreen(gx, gy);
    const color = TEAM_COLORS[colorIndex % TEAM_COLORS.length];
    for (let i = 0; i < count; i++) {
      const g = new Graphics();
      g.rect(-2, -2, 4, 4).fill(i % 3 === 0 ? 0xfac775 : color);
      g.position.set(x, y - 14);
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 130;
      this.fxLayer.addChild(g);
      this.particles.push({
        g,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 80,
        life: 0.9 + Math.random() * 0.5,
      });
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.vy += 220 * dt;
      p.g.position.x += p.vx * dt;
      p.g.position.y += p.vy * dt;
      p.g.alpha = Math.max(0, p.life);
      if (p.life <= 0) {
        this.fxLayer.removeChild(p.g);
        p.g.destroy();
        this.particles.splice(i, 1);
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
