import { Application, Container, Graphics, Sprite, TextureStyle } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type { HeroSnapshot, MissionSnapshot, PeonSnapshot } from '@agent-citadel/shared';
import { useWorld } from '../store';
import { toolToBuilding } from '../theme/mapping';
import type { BuildingDef, BuildingId, ThemeDef } from '../theme/types';
import { WaypointGraph } from './pathfind';
import { buildBuilding, drawRoads, drawTerrain, TEAM_COLORS } from './placeholders';
import { Unit } from './unit';
import { getHeroSheet, getPeonSheet, loadThemeSprites } from './sprites';
import { sessionToArchetypeKey } from './archetype';
import { loadTilemaps, hasTilemaps, buildTilemap } from './tilemap';
import { loadBuildingSprites, getBuildingSprite } from './building-sprites';
import { loadDecorationSprites, getDecorationTexture } from './decoration-sprites';
import { loadIsoTiles, hasIsoTiles, buildIsoTilemap } from './tilemap-iso';
import { scatterDecorations, type DecoKind } from './decorations';
import { peonSpawnScatter } from './scatter';
import { buildTerrainMap } from './terrain-map';
import { BUILDING_FX, collectActiveBuildings, type WorkerSample } from './building-fx';
import { buildingText } from '../i18n';
import type { Lang } from '../settings';

/** Docelowa szerokość dekoracji w kaflach (do skalowania sprite'a). */
const DECO_W: Record<DecoKind, number> = { tree: 1.1, rock: 0.8, bush: 0.75, flower: 0.7 };

/** Margines „dzikiej ziemi" (kafle poza siatką rozgrywki) wypełniający rogi ekranu. */
const WORLD_MARGIN_TILES = 4;
/** Górny limit przybliżenia (kontrolki/kółko). Dolny = „cover" liczony dynamicznie. */
const MAX_ZOOM = 5;

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  gravity: number;
}

/** Emiter aktywności jednego budynku: poświata + akumulator drobinek. */
interface FxEmitter {
  glow: Graphics;
  intensity: number; // 0..1, łagodne włączanie/wygaszanie
  accum: number; // ułamek drobinki do wyemitowania
  x: number;
  y: number;
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
  private worldWidth = 0;
  private worldHeight = 0;
  private userZoomed = false; // wheel/pinch/kontrolki — wstrzymuje auto-dopasowanie przy resize
  private particles: Particle[] = [];
  private emitters = new Map<BuildingId, FxEmitter>();
  private elapsed = 0;
  private missionStatus = new Map<string, string>();
  private graph: WaypointGraph;
  private unsubscribe?: () => void;
  private ready = false; // app.init() rozwiązane — wolno wołać app.destroy()
  private destroyed = false; // strażnik wyścigu init()↔destroy() (zmiana motywu w trakcie ładowania)

  constructor(
    private readonly theme: ThemeDef,
    private readonly lang: Lang = 'en',
  ) {
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
    // Widok mógł zostać zniszczony (zmiana motywu) w trakcie await app.init().
    this.ready = true;
    if (this.destroyed) {
      this.app.destroy(true, { children: true });
      return;
    }
    host.appendChild(this.app.canvas);

    // Granice świata = bbox obszaru gry + margines „dzikiej ziemi" (kafle poza
    // siatką rozgrywki). Teren wypełni dokładnie ten prostokąt → brak czarnych rogów.
    const projection = this.theme.projection;
    const M = WORLD_MARGIN_TILES;
    const { w: gw, h: gh } = this.theme.grid;
    const corners = [
      projection.toScreen(-M, -M),
      projection.toScreen(gw + M, -M),
      projection.toScreen(-M, gh + M),
      projection.toScreen(gw + M, gh + M),
    ];
    const minX = Math.min(...corners.map((c) => c.x));
    const maxX = Math.max(...corners.map((c) => c.x));
    const minY = Math.min(...corners.map((c) => c.y));
    const maxY = Math.max(...corners.map((c) => c.y));
    const worldWidth = maxX - minX;
    const worldHeight = maxY - minY;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    const worldRect = { minX, minY, maxX, maxY };

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

    this.viewport.on('wheel-scroll', () => (this.userZoomed = true));
    this.viewport.on('pinch-start', () => (this.userZoomed = true));

    const refit = () => {
      const screenW = this.app.screen.width;
      const screenH = this.app.screen.height;
      if (screenW < 50 || screenH < 50) return;
      this.viewport.resize(screenW, screenH, worldWidth, worldHeight);
      // cover (Math.max): teren ZAWSZE wypełnia ekran — koniec letterboxa/czarnych rogów.
      // Przybliżać można do MAX_ZOOM; oddalać nie da się poza „cover" (brak pustki).
      const cover = Math.max(screenW / worldWidth, screenH / worldHeight);
      this.viewport.clampZoom({ minScale: cover, maxScale: Math.max(MAX_ZOOM, cover * 1.2) });
      if (!this.userZoomed) {
        this.viewport.setZoom(cover, true);
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

    // Assety/tilesety PixelLab MUSZĄ być załadowane PRZED budową terenu/budynków/dekoracji.
    // Inaczej hasTilemaps()/getBuildingSprite() zwracają puste → placeholdery na starcie,
    // a przy zmianie motywu scena buduje się ze starym (jeszcze niewyczyszczonym) cache.
    await Promise.all([
      loadThemeSprites(this.theme.id),
      loadBuildingSprites(this.theme.id),
      loadDecorationSprites(this.theme.id),
      this.theme.style === 'topdown' ? loadTilemaps(this.theme.id) : loadIsoTiles(this.theme.id),
    ]);
    if (this.destroyed) return; // zniszczony w trakcie ładowania assetów — nie buduj sceny

    if (this.theme.style === 'topdown' && hasTilemaps()) {
      worldLayer.addChild(buildTilemap(this.theme)); // niesortowana warstwa tła pod unitLayer
    } else if (this.theme.style === 'iso' && hasIsoTiles()) {
      worldLayer.addChild(buildIsoTilemap(this.theme, worldRect));
    } else {
      worldLayer.addChild(drawTerrain(this.theme, projection));
    }
    worldLayer.addChild(drawRoads(this.theme, projection));

    // Budynki i jednostki we wspólnej warstwie sortowanej po głębokości —
    // w izometrii jednostka może zniknąć ZA budynkiem.
    this.unitLayer.sortableChildren = true;
    for (const def of this.theme.buildings) {
      const label = buildingText(this.theme.id, def.id, this.lang).label;
      const node = buildBuilding(def, this.theme, projection, label);
      node.eventMode = 'static';
      node.cursor = 'pointer';
      node.on('pointertap', () => useWorld.getState().selectBuilding(def.id));
      this.unitLayer.addChild(node);
    }

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
      this.elapsed += dt;
      const selected = useWorld.getState().selectedSessionId;
      for (const [id, unit] of this.units) {
        unit.setBubbleForced(id === selected);
        unit.update(dt);
      }
      this.updateRetiring(dt);
      this.updateBuildingFx(dt);
      this.updateParticles(dt);
    });

    this.unsubscribe = useWorld.subscribe((state) => this.reconcile(state.heroes, state.peons, state.missions));
    const { heroes, peons, missions } = useWorld.getState();
    this.reconcile(heroes, peons, missions);
    activeView = this;
  }

  destroy(): void {
    if (this.destroyed) return; // idempotentne
    this.destroyed = true;
    if (activeView === this) activeView = undefined;
    this.unsubscribe?.();
    if (this.ready) this.app.destroy(true, { children: true }); // app.init() musiało się rozwiązać
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

  /** Mnożnik zoomu (kontrolki HUD +/−). Trzymany w granicach clampZoom (cover … MAX_ZOOM). */
  zoomBy(factor: number): void {
    const cover = this.coverScale();
    const max = Math.max(MAX_ZOOM, cover * 1.2);
    const target = Math.min(max, Math.max(cover, this.viewport.scale.x * factor));
    this.userZoomed = true;
    this.viewport.animate({ scale: target, time: 160, ease: 'easeInOutSine' });
  }

  /** Reset kamery: maksymalne oddalenie (cover) + wycentrowanie na świecie. */
  resetView(): void {
    this.userZoomed = false;
    this.viewport.animate({
      scale: this.coverScale(),
      position: { x: this.worldWidth / 2, y: this.worldHeight / 2 },
      time: 320,
      ease: 'easeInOutSine',
    });
  }

  /** Skala „cover" — teren wypełnia ekran (dolna granica zoomu). */
  private coverScale(): number {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    return Math.max(sw / this.worldWidth, sh / this.worldHeight);
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
        // Minioni rekrutowani z Hangaru (Koszar): wychodzą ROZSIANI wokół drzwi
        // (per-peon jitter), nie z jednego punktu — inaczej 8 sprite'ów stoi na sobie
        // i widać „2 zamiast 8" (krótkożyciowi peoni nie zdążą się rozejść).
        const door = this.building('barracks').door;
        const o = peonSpawnScatter(peon.agentId);
        const start = { gx: door.gx + o.dx, gy: door.gy + o.dy };
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
      const life = 0.9 + Math.random() * 0.5;
      this.fxLayer.addChild(g);
      this.particles.push({
        g,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 80,
        life,
        maxLife: life,
        gravity: 220,
      });
    }
  }

  /**
   * FX aktywności budynków: dla każdego budynku z pracującą jednostką w pobliżu
   * utrzymuje poświatę (łagodnie włączaną/wygaszaną) i sączy drobinki w stylu
   * z BUILDING_FX. Próg/wygląd → building-fx.ts (punkt strojenia usera).
   */
  private updateBuildingFx(dt: number): void {
    const active = this.collectActiveBuildings();
    for (const b of this.theme.buildings) {
      const style = BUILDING_FX[b.id];
      const on = active.has(b.id);
      let em = this.emitters.get(b.id);

      if (on && !em) {
        const anchor = this.fxAnchor(b);
        const glow = new Graphics();
        const r = this.theme.tile * 0.55;
        for (const k of [1, 0.65, 0.35]) glow.circle(0, 0, r * k).fill({ color: style.color, alpha: 0.5 });
        glow.blendMode = 'add';
        glow.position.set(anchor.x, anchor.y);
        this.fxLayer.addChild(glow);
        em = { glow, intensity: 0, accum: 0, x: anchor.x, y: anchor.y };
        this.emitters.set(b.id, em);
      }
      if (!em) continue;

      em.intensity += ((on ? 1 : 0) - em.intensity) * Math.min(1, dt * 4);
      const pulse = 0.78 + 0.22 * Math.sin(this.elapsed * 3 + b.gx + b.gy);
      em.glow.alpha = em.intensity * style.glow * pulse;

      if (on) {
        em.accum += dt * style.rate * em.intensity;
        while (em.accum >= 1) {
          em.accum -= 1;
          this.spawnBuildingMote(em, style);
        }
      } else if (em.intensity < 0.02) {
        this.fxLayer.removeChild(em.glow);
        em.glow.destroy();
        this.emitters.delete(b.id);
      }
    }
  }

  /** Pojedyncza unosząca się drobinka aktywności (dym/iskra/poświata). */
  private spawnBuildingMote(em: FxEmitter, style: (typeof BUILDING_FX)[BuildingId]): void {
    const g = new Graphics();
    g.rect(-1.5, -1.5, 3, 3).fill(Math.random() < 0.3 ? style.spark : style.color);
    g.position.set(em.x + (Math.random() - 0.5) * style.spread, em.y);
    g.blendMode = 'add';
    const life = 1.0 + Math.random() * 0.8;
    this.fxLayer.addChild(g);
    this.particles.push({
      g,
      vx: (Math.random() - 0.5) * 12,
      vy: -style.rise * (0.6 + Math.random() * 0.6),
      life,
      maxLife: life,
      gravity: 36, // lekka grawitacja — drobinka wznosi się i zwalnia
    });
  }

  /** Punkt zaczepienia FX przy wierzchołku sprite'a budynku (z wymiarów tekstury). */
  private fxAnchor(b: BuildingDef): { x: number; y: number } {
    const foot = this.theme.projection.toScreen(b.gx + b.w / 2, b.gy + b.h); // kotwica sprite'a (0.5,1)
    const tex = getBuildingSprite(b.id);
    const hgt = tex ? tex.height * ((b.w * this.theme.tile) / tex.width) : this.theme.tile * (b.h + 1);
    return { x: foot.x, y: foot.y - hgt * 0.78 }; // ~górne 22% bryły
  }

  /** Budynki z pracującą jednostką dostatecznie blisko drzwi (czysta reguła w building-fx.ts). */
  private collectActiveBuildings(): Set<BuildingId> {
    const samples: WorkerSample[] = [];
    for (const [id, unit] of this.units) {
      const target = this.targets.get(id);
      if (!target || !target.startsWith('w:')) continue;
      const buildingId = target.slice(2) as BuildingId;
      const door = this.building(buildingId).door;
      samples.push({
        buildingId,
        distToDoor: Math.hypot(unit.gx - door.gx, unit.gy - door.gy),
        working: true,
      });
    }
    return collectActiveBuildings(samples);
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.g.position.x += p.vx * dt;
      p.g.position.y += p.vy * dt;
      p.g.alpha = Math.max(0, p.life / p.maxLife);
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
    // Dom: bohater wraca do Twierdzy, peon (pomocnik) mustruje w Koszarach.
    const home: BuildingId = unit.isPeon ? 'barracks' : 'citadel';
    let buildingId: BuildingId;
    if (state === 'working') {
      buildingId = toolToBuilding(tool, detail);
      // Nieznane narzędzie daje fallback 'citadel'. Dla peona to zła stopa: spawnuje
      // się przy rodzicu (zwykle Twierdza), więc cel=Twierdza ⇒ pusta ścieżka ⇒ stoi.
      // Kieruj go do Koszar, żeby faktycznie biegł.
      if (buildingId === 'citadel' && unit.isPeon) buildingId = 'barracks';
    } else if (!unit.isPeon && (state === 'thinking' || state === 'awaiting-input' || state === 'error')) {
      this.targets.delete(unit.id); // bohater: zostań gdzie jesteś
      return;
    } else {
      buildingId = home; // peon ZAWSZE ma cel — nie zastyga w stosie przy Twierdzy
    }

    const key = `${state === 'working' ? 'w' : 'home'}:${buildingId}`;
    if (this.targets.get(unit.id) === key) return;
    this.targets.set(unit.id, key);

    const door = this.building(buildingId).door;
    const startNode = this.graph.nearest(unit.gx, unit.gy);
    const route = this.graph.route(startNode.id, `door:${buildingId}`);
    // Bohater przy pracy: ciasny rozrzut przy drzwiach. Peony i bezczynni bohaterowie:
    // szeroki krąg wokół budynku, żeby się nie nakładali (declutter sprite'ów i etykiet).
    const spot = !unit.isPeon && state === 'working' ? spotJitter(unit.id, slot) : idleScatter(unit.id);
    route.push({ id: 'spot', gx: door.gx + spot.dx, gy: door.gy + spot.dy });
    unit.setPath(route);
  }
}

/** Deterministyczny krąg pozycji bezczynnych wokół twierdzy (luźny tłum, nie stos). */
function idleScatter(id: string): { dx: number; dy: number } {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const angle = (h % 360) * (Math.PI / 180);
  const radius = 1.5 + (h % 6) * 0.4; // 1.5–3.5 kafle
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
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
