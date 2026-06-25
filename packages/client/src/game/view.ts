import { Application, ColorMatrixFilter, Container, Graphics, Sprite, TextureStyle } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type { HeroSnapshot, MissionSnapshot, PeonSnapshot } from '@agent-citadel/shared';
import { useWorld } from '../store';
import { resolveBuildingLive, useMapping } from '../mapping-store';
import type { BuildingDef, BuildingId, ThemeDef } from '../theme/types';
import { WaypointGraph } from './pathfind';
import { buildBuilding, drawRoads, drawTerrain, TEAM_COLORS } from './placeholders';
import { themeRoadCurves } from './roads';
import { MatrixRain } from './matrix-rain';
import { Unit } from './unit';
import { getHeroSheet, getPeonSheet, loadThemeSprites } from './sprites';
import { loadEmblems } from './emblems';
import { sessionToArchetypeKey } from './archetype';
import { resolveModelLive, pickSpriteLive } from '../model-store';
import { loadTilemaps, hasTilemaps, buildTilemap } from './tilemap';
import { loadBuildingSprites, getBuildingSprite } from './building-sprites';
import { loadDecorationSprites, getDecorationTexture } from './decoration-sprites';
import { loadIsoTiles, hasIsoTiles, buildIsoTilemap } from './tilemap-iso';
import { scatterDecorations, type DecoKind } from './decorations';
import { peonSpawnScatter, heroSpawnScatter } from './scatter';
import { buildTerrainMap } from './terrain-map';
import { BUILDING_FX, collectActiveBuildings, type WorkerSample } from './building-fx';
import { buildingText } from '../i18n';
import { homeBuilding, awaitingBuilding, completedBuilding, recoveryBuilding } from './home-building';
import { worldLayerTransform, worldToViewport, flipTextNodes } from './flip';
import { getRealmAudio } from './audio';
import { deriveCrestSpec, buildCrest } from './heraldry';
import type { Lang } from '../settings';
import { contextPct } from '../context-progress';

/** Target decoration width in tiles (for sprite scaling). */
const DECO_W: Record<DecoKind, number> = { tree: 1.1, rock: 0.8, bush: 0.75, flower: 0.7 };

/**
 * "Wild land" margin (tiles outside the gameplay grid) around the board. A larger
 * margin at "cover" shrinks content toward the center, so edge buildings (for
 * example Forge in the top-right corner) move out from under overlapping HUD
 * panels. The whole board remains visible with panels open, still without black
 * borders because terrain fills the corners.
 */
const WORLD_MARGIN_TILES = 12;
/**
 * Extra headroom above the terrain (in tiles) for tall solids. A building sprite
 * is anchored at its foot (0.5, 1) and grows UP, so the top of e.g. the mage tower
 * extends beyond the world's top edge computed from terrain tiles and can be cut
 * off at "cover". The headroom is filled by isoFillRange with grass (not
 * darkness), lowering and centering the board.
 */
const TOP_SPRITE_HEADROOM_TILES = 2;
/** Upper zoom limit (controls/wheel). Lower limit = dynamically computed "cover". */
const MAX_ZOOM = 5;
/** Multiple of "cover" scale when focusing a unit (double-click / autofollow). */
const FOCUS_ZOOM_FACTOR = 2.5;

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  gravity: number;
}

/** Activity emitter for one building: glow + particle accumulator. */
interface FxEmitter {
  glow: Graphics;
  intensity: number; // 0..1, smooth fade in/out
  accum: number; // fractional particle waiting to emit
  x: number;
  y: number;
}

/** Active view registry; HUD (minimap, portraits) reaches the scene through it. */
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
 * Main game view: Pixi scene + viewport, reconciling world state (zustand) into
 * units and choosing targets by state/tool.
 */
export class GameView {
  private app = new Application();
  private viewport!: Viewport;
  private unitLayer = new Container();
  private fxLayer = new Container();
  private units = new Map<string, Unit>();
  private retiring = new Map<string, { unit: Unit; deadline: number }>();
  private targets = new Map<string, string>();
  private lastBuilding = new Map<string, BuildingId>(); // last workshop: the unit "lives" here, not in Citadel
  private homeByUnit = new Map<string, BuildingId>(); // stable social/off-duty home per hero
  private wanderAt = new Map<string, number>(); // elapsed time of next small idle-hero walk
  private worldLayer!: Container;
  private worldWidth = 0;
  private worldHeight = 0;
  private userZoomed = false; // wheel/pinch/controls: pauses auto-fit on resize
  private particles: Particle[] = [];
  private emitters = new Map<BuildingId, FxEmitter>();
  private lastClearedAt = new Map<string, number>();
  private elapsed = 0;
  // Realm Heartbeat: scena przyciemnia/rozjaśnia się wg TEMPA tokenów wyjściowych
  // (nie zegara) — realm „oddycha". Filtr na app.stage = jeden pełnoekranowy pass
  // (HUD to osobny DOM, więc nie jest tintowany).
  private dayNight = new ColorMatrixFilter();
  private lastTotalOutput = 0;
  private dayLevel = 0; // 0=noc, 1=dzień — wygładzane SYMETRYCZNIE (świt tak powolny jak zmierzch)
  private lastProduceAt = -999; // elapsed (s) ostatniej produkcji tokenów
  // Mission Thunderclap: rozchodzące się pierścienie przy ukończeniu misji.
  private shockwaves: { g: Graphics; life: number; maxLife: number; color: number }[] = [];
  // Tool Trail: ostatnia pozycja ekranowa, w której jednostka zostawiła ślad.
  private footAt = new Map<string, { x: number; y: number }>();
  // Soundscape: poprzedni stan bohatera — do wykrycia wejścia w 'awaiting-input' (cue).
  private prevHeroState = new Map<string, string>();
  // Living Banners (#9): herb wybranego projektu nad twierdzą + jego klucz cache.
  private crest?: Container;
  private crestKey?: string;
  // Cyberpunk: deszcz Matriksa (tło ekranowe) + neonowe „pakiety światła" płynące drogami.
  private matrix?: MatrixRain;
  private neonFlowLayer?: Container;
  private neonPaths: { pts: { x: number; y: number }[]; cum: number[]; total: number }[] = [];
  private neonMotes: { g: Graphics; path: number; dist: number; speed: number }[] = [];
  private missionStatus = new Map<string, string>();
  private graph: WaypointGraph;
  private unsubscribe?: () => void;
  private unsubscribeMapping?: () => void;
  private ready = false; // app.init() resolved, app.destroy() may be called
  private destroyed = false; // init()/destroy() race guard (theme change during load)

  constructor(
    private readonly theme: ThemeDef,
    private readonly lang: Lang = 'en',
    private readonly flipped = false,
  ) {
    this.graph = new WaypointGraph(theme);
  }

  async init(host: HTMLElement): Promise<void> {
    TextureStyle.defaultOptions.scaleMode = 'nearest';
    await this.app.init({
      // Cyberpunk → czysta czerń OLED (deszcz Matriksa świeci w pustce); reszta → ciepły grafit.
      background: this.theme.neon ? 0x000000 : 0x1a1a17,
      resizeTo: host,
      antialias: false,
      roundPixels: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    // The view may have been destroyed (theme change) while awaiting app.init().
    this.ready = true;
    if (this.destroyed) {
      this.app.destroy(true, { children: true });
      return;
    }
    host.appendChild(this.app.canvas);

    // World bounds = gameplay area bbox + "wild land" margin (tiles outside the
    // gameplay grid). Terrain fills exactly this rectangle -> no black corners.
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
    // Top headroom for tall solids (foot anchor -> sprite grows upward). Without
    // this, the mage tower top extends beyond the world rectangle and is cut off
    // at "cover". isoFillRange fills this band with grass, so the board lowers
    // and centers itself.
    const minY = Math.min(...corners.map((c) => c.y)) - TOP_SPRITE_HEADROOM_TILES * this.theme.tile;
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
    // Cyberpunk: deszcz Matriksa POD viewportem (tło ekranowe). Dodany pierwszy →
    // renderuje się za światem, w pustce dookoła unoszącego się miasta.
    if (this.theme.neon) {
      // Deszcz pada w barwach budynków realm (paleta placeholderColor) — spójny z miastem.
      const palette = this.theme.buildings.map((b) => `#${b.placeholderColor.toString(16).padStart(6, '0')}`);
      this.matrix = new MatrixRain(palette);
      this.app.stage.addChild(this.matrix.view);
    }
    this.app.stage.addChild(this.viewport);
    // Realm Heartbeat: filtr dnia/nocy NA VIEWPORCIE (nie na stage) — świat „oddycha",
    // ale deszcz Matriksa (sąsiad na stage) zostaje nietknięty czystą zielenią.
    this.viewport.filters = [this.dayNight];

    // Manual camera control (wheel zoom, pinch, drag) takes over and breaks
    // autofollow. Otherwise followSelected would undo pan-to-cursor on every
    // zoom frame and stick the map during drag.
    this.viewport.on('wheel-scroll', () => {
      this.userZoomed = true;
      useWorld.getState().setAutofollow(false);
    });
    this.viewport.on('pinch-start', () => {
      this.userZoomed = true;
      useWorld.getState().setAutofollow(false);
    });
    this.viewport.on('drag-start', () => useWorld.getState().setAutofollow(false));

    const refit = () => {
      const screenW = this.app.screen.width;
      const screenH = this.app.screen.height;
      if (screenW < 50 || screenH < 50) return;
      this.matrix?.resize(screenW, screenH);
      this.viewport.resize(screenW, screenH, worldWidth, worldHeight);
      // cover (Math.max): terrain ALWAYS fills the screen, ending letterbox/black corners.
      // Zoom in up to MAX_ZOOM; cannot zoom out beyond "cover" (no empty space).
      const cover = Math.max(screenW / worldWidth, screenH / worldHeight);
      this.viewport.clampZoom({ minScale: cover, maxScale: Math.max(MAX_ZOOM, cover * 1.2) });
      if (!this.userZoomed) {
        this.viewport.setZoom(cover, true);
        this.viewport.moveCenter(worldWidth / 2, worldHeight / 2);
      }
    };
    this.app.renderer.on('resize', refit);
    refit();

    // World layer shifted so negative coordinates (iso) fit in the viewport.
    const worldLayer = (this.worldLayer = new Container());
    const layout = worldLayerTransform(minX, maxX, minY, this.flipped);
    worldLayer.scale.set(layout.scaleX, layout.scaleY);
    worldLayer.position.set(layout.x, layout.y);
    this.viewport.addChild(worldLayer);

    // PixelLab assets/tilesets MUST be loaded BEFORE building terrain/buildings/decorations.
    // Otherwise hasTilemaps()/getBuildingSprite() return empty -> placeholders at startup,
    // and on theme change the scene builds from the old cache before it is cleared.
    await Promise.all([
      loadThemeSprites(this.theme.id),
      loadEmblems(), // herby providerów — theme-agnostic, idempotentne
      loadBuildingSprites(this.theme.id),
      loadDecorationSprites(this.theme.id),
      this.theme.style === 'topdown' ? loadTilemaps(this.theme.id) : loadIsoTiles(this.theme.id),
    ]);
    if (this.destroyed) return; // destroyed while loading assets: do not build the scene

    if (this.theme.style === 'topdown' && hasTilemaps()) {
      worldLayer.addChild(buildTilemap(this.theme)); // unsorted background layer below unitLayer
    } else if (this.theme.style === 'iso' && hasIsoTiles()) {
      worldLayer.addChild(buildIsoTilemap(this.theme, worldRect));
    } else {
      worldLayer.addChild(drawTerrain(this.theme, projection));
    }
    worldLayer.addChild(drawRoads(this.theme, projection));

    // Cyberpunk: „pakiety światła" płynące siecią dróg (świecące krople nad trasami).
    // Warstwa tuż nad drogami, pod budynkami/jednostkami → światło sunie po gruncie.
    if (this.theme.neon) {
      this.neonFlowLayer = new Container();
      this.neonFlowLayer.blendMode = 'add';
      worldLayer.addChild(this.neonFlowLayer);
      this.setupNeonFlow();
    }

    // Budynki i jednostki we wspólnej warstwie sortowanej po głębokości —
    // w izometrii jednostka może zniknąć ZA budynkiem.
    this.unitLayer.sortableChildren = true;
    for (const def of this.theme.buildings) {
      const label = buildingText(this.theme.id, def.id, this.lang).label;
      const node = buildBuilding(def, this.theme, projection, label);
      if (this.flipped) flipTextNodes(node);
      node.eventMode = 'static';
      node.cursor = 'pointer';
      node.on('pointertap', () => useWorld.getState().selectBuilding(def.id));
      this.unitLayer.addChild(node);
    }

    // Decorations: flowers/bushes are flat under units (worldLayer before unitLayer);
    // trees/rocks occlude in unitLayer with depth (like buildings/units).
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
        unit.setSelected(id === selected);
        unit.update(dt);
      }
      if (selected && useWorld.getState().autofollow) this.followSelected(selected);
      this.wanderIdle();
      this.updateRetiring(dt);
      this.updateBuildingFx(dt);
      this.updateParticles(dt);
      this.updateShockwaves(dt);
      this.updateDayNight(dt);
      this.dropFootprints();
      this.matrix?.update(dt);
      this.updateNeonFlow(dt);
    });

    this.unsubscribe = useWorld.subscribe((state) => {
      this.reconcile(state.heroes, state.peons, state.missions, state.selectedProjectDir);
      this.updateCrest();
    });
    // Zmiana mapy narzędzie→budynek wymusza ponowne wyznaczenie celów: jednostki
    // przechodzą do nowych budynków na żywo (reconcile ma early-return per
    // niezmieniony klucz, więc re-steer jest tani). Bez tego mapa „doganiałaby"
    // edycję dopiero przy następnym evencie świata.
    this.unsubscribeMapping = useMapping.subscribe(() => {
      const w = useWorld.getState();
      this.reconcile(w.heroes, w.peons, w.missions, w.selectedProjectDir);
    });
    const { heroes, peons, missions, selectedProjectDir } = useWorld.getState();
    this.reconcile(heroes, peons, missions, selectedProjectDir);
    this.updateCrest();
    activeView = this;
  }

  destroy(): void {
    if (this.destroyed) return; // idempotentne
    this.destroyed = true;
    if (activeView === this) activeView = undefined;
    this.unsubscribe?.();
    this.unsubscribeMapping?.();
    this.matrix?.destroy();
    if (this.ready) this.app.destroy(true, { children: true }); // app.init() musiało się rozwiązać
  }

  /** Center the camera on a grid position (minimap / portrait click). */
  centerOn(gx: number, gy: number): void {
    const { x, y } = this.theme.projection.toScreen(gx, gy);
    this.viewport.animate({
      position: this.worldToViewport(x, y),
      time: 350,
      ease: 'easeInOutSine',
    });
  }

  centerOnUnit(id: string): void {
    const unit = this.units.get(id);
    if (unit) this.centerOn(unit.gx, unit.gy);
  }

  /** Center and zoom the camera on a unit (portrait double-click / autofollow enable). */
  focusOnUnit(id: string): void {
    const unit = this.units.get(id);
    if (!unit) return;
    const cover = this.coverScale();
    const max = Math.max(MAX_ZOOM, cover * 1.2);
    const target = Math.min(max, Math.max(cover, cover * FOCUS_ZOOM_FACTOR));
    this.userZoomed = true; // like zoomBy: refit() on resize will not undo focus zoom
    // When autofollow owns THIS unit, followSelected owns position every frame;
    // animate only scale to avoid competing over position (two tickers -> jitter).
    const st = useWorld.getState();
    if (st.autofollow && st.selectedSessionId === id) {
      this.viewport.animate({ scale: target, time: 350, ease: 'easeInOutSine' });
      return;
    }
    const { x, y } = this.theme.projection.toScreen(unit.gx, unit.gy);
    this.viewport.animate({
      position: this.worldToViewport(x, y),
      scale: target,
      time: 350,
      ease: 'easeInOutSine',
    });
  }

  /** When autofollow is enabled: keep camera on the selected unit (zoom unchanged). */
  private followSelected(id: string): void {
    const unit = this.units.get(id);
    if (!unit) return;
    const { x, y } = this.theme.projection.toScreen(unit.gx, unit.gy);
    const p = this.worldToViewport(x, y);
    this.viewport.moveCenter(p.x, p.y);
  }

  private worldToViewport(sx: number, sy: number): { x: number; y: number } {
    return worldToViewport(
      {
        x: this.worldLayer.position.x,
        y: this.worldLayer.position.y,
        scaleX: this.worldLayer.scale.x,
        scaleY: this.worldLayer.scale.y,
      },
      sx,
      sy,
    );
  }

  /** Zoom multiplier (HUD +/- controls). Kept within clampZoom (cover ... MAX_ZOOM). */
  zoomBy(factor: number): void {
    const cover = this.coverScale();
    const max = Math.max(MAX_ZOOM, cover * 1.2);
    const target = Math.min(max, Math.max(cover, this.viewport.scale.x * factor));
    this.userZoomed = true;
    this.viewport.animate({ scale: target, time: 160, ease: 'easeInOutSine' });
  }

  /** Camera reset: maximum zoom-out (cover) + centered on the world. */
  resetView(): void {
    this.userZoomed = false;
    this.viewport.animate({
      scale: this.coverScale(),
      position: { x: this.worldWidth / 2, y: this.worldHeight / 2 },
      time: 320,
      ease: 'easeInOutSine',
    });
  }

  /** "Cover" scale: terrain fills the screen (lower zoom bound). */
  private coverScale(): number {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    return Math.max(sw / this.worldWidth, sh / this.worldHeight);
  }

  /** Unit positions for the minimap. */
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

  /** Living Banners: zbuduj/odśwież herb wybranego projektu nad twierdzą (#9). */
  private updateCrest(): void {
    const { selectedProjectDir, arsenal } = useWorld.getState();
    const seed = selectedProjectDir;
    const ar = seed ? arsenal[seed] : undefined;
    const key = seed ? `${seed}:${ar?.refreshedAt ?? 0}` : '';
    if (key === this.crestKey) return; // bez zmian → nie przebudowuj (subskrypcja bije często)
    this.crestKey = key;
    if (this.crest) {
      this.crest.parent?.removeChild(this.crest);
      this.crest.destroy({ children: true });
      this.crest = undefined;
    }
    if (!seed) return; // widok „All" → brak jednego właściciela, brak herbu
    const spec = deriveCrestSpec({ seed, arsenal: ar });
    const crest = buildCrest(spec, this.theme.tile * 2.2);
    const c = this.building('citadel');
    const top = this.theme.projection.toScreen(c.gx + c.w / 2, c.gy);
    crest.position.set(top.x, top.y - this.theme.tile * 2.4);
    crest.zIndex = 1_000_000; // nad budynkami/jednostkami w sortowanej warstwie
    this.unitLayer.addChild(crest);
    this.crest = crest;
  }

  /** Eksport „Realm Card": świeży herb w wysokiej rozdzielczości → PNG (w pełni lokalnie). */
  exportCrest(projectDir: string): void {
    const { arsenal } = useWorld.getState();
    const spec = deriveCrestSpec({ seed: projectDir, arsenal: arsenal[projectDir] });
    const big = buildCrest(spec, 320);
    // extract.canvas zwraca HTMLCanvasElement LUB OffscreenCanvas — obsłuż oba.
    const canvas = this.app.renderer.extract.canvas(big) as unknown as {
      toBlob?: (cb: (b: Blob | null) => void, type?: string) => void;
      convertToBlob?: (opts?: { type?: string }) => Promise<Blob>;
    };
    big.destroy({ children: true });
    const download = (blob: Blob | null): void => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `realm-card-${projectDir.split('/').pop() || 'project'}.png`;
      a.click();
      URL.revokeObjectURL(url);
    };
    if (typeof canvas.toBlob === 'function') canvas.toBlob(download);
    else if (typeof canvas.convertToBlob === 'function') canvas.convertToBlob({ type: 'image/png' }).then(download).catch(() => {});
  }

  private reconcile(
    heroes: Record<string, HeroSnapshot>,
    peons: Record<string, PeonSnapshot>,
    missions: Record<string, MissionSnapshot> = {},
    projectFilter?: string,
  ): void {
    // Filter heroes and peons by selected project (city).
    // Peons have parentSessionId; use the parent's project.
    const heroList = projectFilter
      ? Object.values(heroes).filter((h) => h.projectDir === projectFilter)
      : Object.values(heroes);
    const projectHeroIds = new Set(heroList.map((h) => h.sessionId));
    const peonList = projectFilter
      ? Object.values(peons).filter((p) => projectHeroIds.has(p.parentSessionId))
      : Object.values(peons);
    // Still draw ALL buildings, decorations, etc.; the filter applies only to
    // units (who is currently visible).
    const seen = new Set<string>();

    // Fireworks on mission transition active -> completed.
    for (const mission of Object.values(missions)) {
      const prev = this.missionStatus.get(mission.id);
      if (mission.status === 'completed' && prev === 'active') {
        const hero = this.units.get(mission.sessionId);
        if (hero) {
          this.spawnFireworks(hero.gx, hero.gy, hero.colorIndex);
          this.spawnShockwave(hero.gx, hero.gy, hero.colorIndex);
          getRealmAudio().cue('mission-complete');
        }
      }
      this.missionStatus.set(mission.id, mission.status);
    }

    for (const hero of heroList) {
      seen.add(hero.sessionId);
      let unit = this.units.get(hero.sessionId);
      if (!unit) {
        // The citadel plaza clogs up if every new session spawns at its door.
        // New sessions from the same project instead go to a theme-appropriate
        // gathering point (arena/tavern/garden for fantasy; holodeck/mess/
        // hydroponics for sci-fi), chosen by a stable hash of the project name.
        // Citadel remains the destination for sessions without a recognizable project.
        const homeId = homeBuilding(this.theme, hero);
        const home = this.building(homeId);
        const o = heroSpawnScatter(hero.sessionId);
        const door = { gx: home.door.gx + o.dx, gy: home.door.gy + o.dy };
        const sheet = getHeroSheet(sessionToArchetypeKey(hero, resolveModelLive(hero.model).sprite));
        unit = new Unit(hero.sessionId, hero.teamColor, false, clipName(hero.title), door, this.theme.projection, sheet, hero.agent ?? 'claude', this.theme.heroSprite.scale, this.theme.heroSprite.footAnchor, this.theme.neon);
        unit.container.eventMode = 'static';
        unit.container.cursor = 'pointer';
        const sessionId = hero.sessionId;
        unit.container.on('pointertap', () => useWorld.getState().select(sessionId));
        this.units.set(hero.sessionId, unit);
        this.unitLayer.addChild(unit.container);
        // Remember the social home separately from the last work building.
        if (this.flipped) flipTextNodes(unit.container);
        this.homeByUnit.set(hero.sessionId, homeId);
        this.lastBuilding.set(hero.sessionId, homeId);
        this.lastClearedAt.set(hero.sessionId, hero.clearedAt ?? 0);
      }
      unit.setName(clipName(hero.title));
      unit.setState(hero.state, hero.state === 'working' ? hero.toolDetail ?? hero.currentTool : undefined);
      // Soundscape: miękki cue, gdy bohater właśnie wszedł w oczekiwanie na usera.
      if (hero.state === 'awaiting-input' && this.prevHeroState.get(hero.sessionId) !== 'awaiting-input') {
        getRealmAudio().cue('awaiting-input');
      }
      this.prevHeroState.set(hero.sessionId, hero.state);
      // Context Pressure: bursztynowy pierścień, gdy okno modelu ≥80% pełne.
      const ctxWin = resolveModelLive(hero.model).contextWindow;
      unit.setContextPressure(!!hero.contextTokens && hero.contextTokens / ctxWin >= 0.8);
      this.steer(unit, hero.state, hero.currentTool, hero.toolDetail, hero.teamColor);
      const cleared = hero.clearedAt ?? 0;
      if (cleared !== (this.lastClearedAt.get(hero.sessionId) ?? 0)) {
        this.lastClearedAt.set(hero.sessionId, cleared);
        this.smiteOnClear(unit);
      }
    }

    for (const peon of peonList) {
      seen.add(peon.agentId);
      let unit = this.units.get(peon.agentId);
      if (!unit) {
        // Minions recruited from Hangar (Barracks): they exit SCATTERED around
        // the door (per-peon jitter), not from one point; otherwise 8 sprites
        // overlap and look like "2 instead of 8" (short-lived peons do not spread out).
        const door = this.building('barracks').door;
        const o = peonSpawnScatter(peon.agentId);
        const start = { gx: door.gx + o.dx, gy: door.gy + o.dy };
        unit = new Unit(peon.agentId, this.parentColor(peon, heroes), true, clipName(peon.description ?? 'peon', 22), start, this.theme.projection, getPeonSheet(), 'claude', undefined, undefined, this.theme.neon);
        unit.container.eventMode = 'static';
        unit.container.cursor = 'pointer';
        const parentId = peon.parentSessionId;
        unit.container.on('pointertap', () => useWorld.getState().select(parentId));
        this.units.set(peon.agentId, unit);
        this.unitLayer.addChild(unit.container);
        if (this.flipped) flipTextNodes(unit.container);
      }
      unit.setState(peon.state, peon.currentTool);
      this.steer(unit, peon.state, peon.currentTool, undefined, 0);
    }

    for (const [id, unit] of this.units) {
      if (!seen.has(id)) {
        this.units.delete(id);
        this.targets.delete(id);
        this.footAt.delete(id);
        this.prevHeroState.delete(id);
        if (unit.isPeon) {
          this.retirePeon(unit);
        } else {
          this.unitLayer.removeChild(unit.container);
          unit.container.destroy({ children: true });
        }
      }
    }
  }

  /** Peon finishes service: returns to parent (or citadel) with a crate and disappears. */
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

  /** Simple particle burst (completed mission / delivered loot). */
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

  private smiteOnClear(unit: Unit): void {
    window.setTimeout(() => {
      if (this.units.get(unit.id) !== unit) return;
      this.spawnLightning(unit.gx, unit.gy);
    }, 120);
  }

  private spawnLightning(gx: number, gy: number): void {
    const { x, y } = this.theme.projection.toScreen(gx, gy);
    const pts: number[] = [0, -220];
    let py = -220;
    while (py < -14) {
      py = Math.min(-14, py + 22 + Math.random() * 16);
      pts.push((Math.random() - 0.5) * 18, py);
    }

    const bolt = new Graphics();
    bolt.poly(pts, false).stroke({ color: 0x85c8ff, width: 7, alpha: 0.38 });
    bolt.poly(pts, false).stroke({ color: 0xfff4bd, width: 2.5, alpha: 0.96 });
    bolt.blendMode = 'add';
    bolt.position.set(x, y);
    this.fxLayer.addChild(bolt);
    this.particles.push({ g: bolt, vx: 0, vy: 0, life: 0.24, maxLife: 0.24, gravity: 0 });

    const flash = new Graphics();
    flash.circle(0, -12, 22).fill({ color: 0xd8efff, alpha: 0.42 });
    flash.circle(0, -12, 9).fill({ color: 0xfff4bd, alpha: 0.78 });
    flash.blendMode = 'add';
    flash.position.set(x, y);
    this.fxLayer.addChild(flash);
    this.particles.push({ g: flash, vx: 0, vy: 0, life: 0.32, maxLife: 0.32, gravity: 0 });

    const ring = new Graphics();
    ring.ellipse(0, 2, 18, 7).stroke({ color: 0xfff4bd, width: 2.5, alpha: 0.9 });
    ring.blendMode = 'add';
    ring.position.set(x, y);
    this.fxLayer.addChild(ring);
    this.particles.push({ g: ring, vx: 0, vy: 0, life: 0.45, maxLife: 0.45, gravity: 0 });

    for (let i = 0; i < 14; i++) {
      const spark = new Graphics();
      spark.rect(-2, -2, 4, 4).fill(i % 3 === 0 ? 0xfff4bd : 0x85c8ff);
      spark.blendMode = 'add';
      spark.position.set(x, y - 14);
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 130;
      const life = 0.55 + Math.random() * 0.4;
      this.fxLayer.addChild(spark);
      this.particles.push({
        g: spark,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 70,
        life,
        maxLife: life,
        gravity: 220,
      });
    }
  }

  /**
   * Building activity FX: for every building with a working unit nearby, keep a
   * glow (smooth fade in/out) and drip particles using BUILDING_FX style.
   * Threshold/look -> building-fx.ts (user tuning point).
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
      // Soundscape: barwa budynku śpiewa proporcjonalnie do aktywności (lazy/no-op
      // dopóki user nie włączy dźwięku i nie wznowi AudioContext gestem).
      getRealmAudio().setBuildingIntensity(b.id, em.intensity);

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
        getRealmAudio().setBuildingIntensity(b.id, 0); // wycisz głos budynku
      }
    }
  }

  /** Single floating activity particle (smoke/spark/glow). */
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
      gravity: 36, // light gravity: particle rises and slows down
    });
  }

  /** FX anchor point near the building sprite top (from texture dimensions). */
  private fxAnchor(b: BuildingDef): { x: number; y: number } {
    const foot = this.theme.projection.toScreen(b.gx + b.w / 2, b.gy + b.h); // kotwica sprite'a (0.5,1)
    const tex = getBuildingSprite(b.id);
    const hgt = tex ? tex.height * ((b.w * this.theme.tile) / tex.width) : this.theme.tile * (b.h + 1);
    return { x: foot.x, y: foot.y - hgt * 0.78 }; // ~upper 22% of the solid
  }

  /** Buildings with a working unit close enough to the door (pure rule in building-fx.ts). */
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

  /**
   * Realm Heartbeat: koryto dnia/nocy sterowane TEMPEM tokenów wyjściowych
   * (suma output po wszystkich bohaterach). Brak pracy → chłodna, przyciemniona
   * noc; intensywna praca → neutralne południe. Bardzo wolna EMA, by realm
   * „oddychał", a nie migotał przy każdym evencie.
   */
  private updateDayNight(dt: number): void {
    let total = 0;
    for (const h of Object.values(useWorld.getState().heroes)) total += h.tokens.output;
    // Tylko dodatnie przyrosty: zniknięcie sesji obniża sumę, ale to nie „ujemna praca".
    const delta = Math.max(0, total - this.lastTotalOutput);
    this.lastTotalOutput = total;
    if (delta > 0) this.lastProduceAt = this.elapsed; // właśnie była produkcja tokenów
    // Cel: dzień, gdy ktoś produkował w ostatnich ~6 s (most nad ciszą myślenia); inaczej noc.
    // Binarny cel zamiast spikującego TEMPA — paczka tokenów nie „przeskakuje" już od razu w dzień.
    const target = this.elapsed - this.lastProduceAt < 6 ? 1 : 0;
    // SYMETRYCZNE wygładzanie: TA SAMA stała czasowa w obie strony — świt jest teraz
    // tak samo powolny jak zmierzch (koniec brzydkiego skoku noc→dzień).
    this.dayLevel += (target - this.dayLevel) * Math.min(1, dt * 0.35);
    const day = this.dayLevel;
    // Noc: przyciemniona i chłodna (więcej niebieskiego). Dzień: neutralna pełnia.
    const r = 0.55 + 0.45 * day;
    const g = 0.62 + 0.38 * day;
    const b = 0.85 + 0.15 * day;
    // Macierz 4x5 (RGBA): skalowanie per-kanał, bez przesunięć.
    this.dayNight.matrix = [r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
  }

  /** Tool Trail: jednostki w ruchu zostawiają znikające ślady w barwie drużyny. */
  private dropFootprints(): void {
    const step = this.theme.tile * 0.7; // rozstaw śladów (px ekranu)
    for (const [id, unit] of this.units) {
      if (!unit.moving) continue;
      const { x, y } = this.theme.projection.toScreen(unit.gx, unit.gy);
      const last = this.footAt.get(id);
      if (last && Math.hypot(x - last.x, y - last.y) < step) continue;
      this.footAt.set(id, { x, y });
      const color = TEAM_COLORS[unit.colorIndex % TEAM_COLORS.length];
      const g = new Graphics();
      g.ellipse(0, 2, 5, 2.5).fill({ color, alpha: 0.4 });
      g.position.set(x, y);
      this.fxLayer.addChild(g);
      // Ślad to nieruchoma drobinka — recykluje istniejący system cząstek (sam gaśnie).
      const life = 1.8;
      this.particles.push({ g, vx: 0, vy: 0, life, maxLife: life, gravity: 0 });
    }
  }

  /** Mission Thunderclap: trzy rozchodzące się pierścienie w barwie drużyny. */
  private spawnShockwave(gx: number, gy: number, colorIndex: number): void {
    const { x, y } = this.theme.projection.toScreen(gx, gy);
    const color = TEAM_COLORS[colorIndex % TEAM_COLORS.length];
    const maxLife = 0.8;
    for (let i = 0; i < 3; i++) {
      const g = new Graphics();
      g.position.set(x, y - 14);
      g.blendMode = 'add';
      this.fxLayer.addChild(g);
      // delay rozkłada pierścienie w czasie (efekt „tętna"); życie startuje po delayu.
      this.shockwaves.push({ g, life: maxLife + i * 0.08, maxLife, color });
    }
  }

  private updateShockwaves(dt: number): void {
    const maxRadius = 140;
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life -= dt;
      if (s.life > s.maxLife) continue; // jeszcze w fazie opóźnienia
      const t = 1 - Math.max(0, s.life) / s.maxLife; // 0→1 w miarę rozchodzenia
      const alpha = Math.max(0, s.life / s.maxLife);
      s.g.clear();
      s.g.circle(0, 0, t * maxRadius).stroke({ width: 3, color: s.color, alpha });
      if (s.life <= 0) {
        this.fxLayer.removeChild(s.g);
        s.g.destroy();
        this.shockwaves.splice(i, 1);
      }
    }
  }

  /**
   * Cyberpunk: przygotuj geometrię „pakietów światła". Każda droga motywu →
   * polilinia ekranowa z tablicą skumulowanych długości (do próbkowania pozycji).
   * Na każdej trasie sieją się 1–2 świecące krople sunące w kółko.
   */
  private setupNeonFlow(): void {
    const neon = this.theme.neon!;
    const proj = this.theme.projection;
    const palette = [neon.edge, neon.primary, neon.secondary, neon.tertiary];
    for (const curve of themeRoadCurves(this.theme)) {
      if (curve.length < 2) continue;
      const pts = curve.map((p) => proj.toScreen(p.gx, p.gy));
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      const total = cum[cum.length - 1];
      if (total < 1) continue;
      const pathIdx = this.neonPaths.push({ pts, cum, total }) - 1;
      const count = total > this.theme.tile * 6 ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const color = palette[(pathIdx + k) % palette.length];
        const g = new Graphics();
        g.circle(0, 0, 5).fill({ color, alpha: 0.22 }); // halo
        g.circle(0, 0, 2).fill({ color: neon.edge, alpha: 0.95 }); // rdzeń
        this.neonFlowLayer!.addChild(g);
        this.neonMotes.push({
          g,
          path: pathIdx,
          dist: (total * (k + Math.random())) / count,
          speed: this.theme.tile * (1.4 + Math.random() * 1.2), // px/s wzdłuż trasy
        });
      }
    }
  }

  /** Cyberpunk: przesuń pakiety światła wzdłuż dróg (zapętlone) z delikatnym tętnem. */
  private updateNeonFlow(dt: number): void {
    for (const m of this.neonMotes) {
      const path = this.neonPaths[m.path];
      m.dist = (m.dist + m.speed * dt) % path.total;
      // Próbkuj pozycję na polilinii wg skumulowanej długości.
      const { cum, pts } = path;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < m.dist) i++;
      const seg = cum[i] - cum[i - 1] || 1;
      const t = (m.dist - cum[i - 1]) / seg;
      m.g.position.set(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t);
      m.g.alpha = 0.7 + 0.3 * Math.sin(this.elapsed * 5 + m.path);
    }
  }

  private parentColor(peon: PeonSnapshot, heroes: Record<string, HeroSnapshot>): number {
    return heroes[peon.parentSessionId]?.teamColor ?? 0;
  }

  /**
   * Small idle hero walk around their workshop, so the colony feels ALIVE rather
   * than frozen at one point. Every 5-10s, an idle (not sleeping/working) hero
   * gets a new path to a random point near their last building. Re-steer from
   * reconcile does not interfere: for 'idle', the target key is stable -> no-op.
   */
  private wanderIdle(): void {
    for (const [id, unit] of this.units) {
      if (unit.isPeon || unit.moving || unit.stateKind !== 'idle') continue;
      if (this.elapsed < (this.wanderAt.get(id) ?? 0)) continue;
      this.wanderAt.set(id, this.elapsed + 5 + (hashId(id) % 5)); // 5-10s, desynchronized per unit
      const door = this.building(this.homeByUnit.get(id) ?? this.lastBuilding.get(id) ?? 'citadel').door;
      const k = (Math.floor(this.elapsed * 7) + hashId(id)) >>> 0;
      const angle = (k % 360) * (Math.PI / 180);
      const radius = 1.2 + (k % 5) * 0.5; // 1.2-3.2 tiles around the workshop
      const spot = { gx: door.gx + Math.cos(angle) * radius, gy: door.gy + Math.sin(angle) * radius };
      const route = this.graph.route(this.graph.nearest(unit.gx, unit.gy).id, this.graph.nearest(spot.gx, spot.gy).id);
      route.push({ id: 'wander', gx: spot.gx, gy: spot.gy });
      unit.setPath(route);
    }
  }

  private steer(unit: Unit, state: string, tool?: string, detail?: string, slot = 0): void {
    let buildingId: BuildingId;
    if (state === 'working') {
      buildingId = resolveBuildingLive(tool, detail);
      // Unknown tool gives fallback 'citadel'. For a peon this is the wrong foot:
      // target=Citadel -> empty path -> standing still. Send it to Barracks so it actually runs.
      if (buildingId === 'citadel' && unit.isPeon) buildingId = 'barracks';
      this.lastBuilding.set(unit.id, buildingId); // remember workshop; unit stays here between tasks
    } else if (!unit.isPeon && state === 'awaiting-input') {
      // Czeka na usera → idzie do kaplicy/poczekalni. NIE nadpisujemy lastBuilding,
      // so after an answer it returns to its workshop (idle -> last workshop).
      buildingId = awaitingBuilding(this.theme.id);
    } else if (!unit.isPeon && state === 'returning') {
      buildingId = completedBuilding(this.theme.id);
    } else if (!unit.isPeon && (state === 'recovering' || state === 'error')) {
      buildingId = recoveryBuilding(this.theme.id);
    } else if (!unit.isPeon && state === 'thinking') {
      this.targets.delete(unit.id); // hero: stay where you are (thinking at workshop)
      return;
    } else {
      // idle/sleeping: off-duty heroes return to their stable social home.
      const fallback: BuildingId = unit.isPeon ? 'barracks' : 'citadel';
      buildingId = (!unit.isPeon ? this.homeByUnit.get(unit.id) : undefined) ?? this.lastBuilding.get(unit.id) ?? fallback;
    }

    const key = `${state === 'working' ? 'w' : 'home'}:${buildingId}`;
    if (this.targets.get(unit.id) === key) return;
    this.targets.set(unit.id, key);

    const door = this.building(buildingId).door;
    const startNode = this.graph.nearest(unit.gx, unit.gy);
    const route = this.graph.route(startNode.id, `door:${buildingId}`);
    // Working hero: tight scatter by the door. Peons and idle heroes:
    // wide circle around the building so units do not overlap (declutter sprites and labels).
    const spot = !unit.isPeon && state === 'working' ? spotJitter(unit.id, slot) : idleScatter(unit.id);
    route.push({ id: 'spot', gx: door.gx + spot.dx, gy: door.gy + spot.dy });
    unit.setPath(route);
  }
}

/** Simple string hash -> number (seed for desynchronizing walks/jitter). */
function hashId(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Deterministic circle of idle positions around the citadel (loose crowd, not a stack). */
function idleScatter(id: string): { dx: number; dy: number } {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const angle = (h % 360) * (Math.PI / 180);
  const radius = 1.5 + (h % 6) * 0.4; // 1.5-3.5 tiles
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
}

/** Deterministic scatter of work spots so units do not overlap. */
function spotJitter(id: string, slot: number): { dx: number; dy: number } {
  let hash = slot * 7;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 9973;
  return { dx: ((hash % 5) - 2) * 0.45, dy: ((hash >> 2) % 3) * 0.4 + 0.2 };
}

function clipName(name: string, max = 18): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}
