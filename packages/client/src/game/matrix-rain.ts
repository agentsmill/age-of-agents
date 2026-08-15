import { CanvasSource, Sprite, Texture } from 'pixi.js';

/**
 * Deszcz Matriksa (#cyberpunk) — tło ekranowe za światem gry. W pełni
 * proceduralny: rysowany na offscreenowym canvasie 2D (klasyczny algorytm
 * „spadających kolumn" z zanikającym ogonem) i podawany do Pixi jako jeden
 * Sprite z teksturą odświeżaną co krok. Żyje na app.stage POD viewportem, więc
 * świeci w pustce (czarny OLED) dookoła unoszącego się neonowego miasta i NIE
 * podlega filtrowi dnia/nocy (ten siedzi teraz na viewporcie).
 */

// Katakana + cyfry + garść znaków technicznych — alfabet „cyfrowego deszczu".
const GLYPHS =
  'アァカサタナハマヤラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユルグズヅブプエェケセテネヘメレヱゲゼデベペオォコソトノホモヨロヲゴゾドボポ0123456789:.=*+#<>¦｜╳';

export class MatrixRain {
  readonly view = new Sprite();
  private canvas!: HTMLCanvasElement; // wymieniany przy resize (świeży backing + tekstura)
  private ctx!: CanvasRenderingContext2D;
  private texture?: Texture;
  private drops: number[] = []; // wiersz „głowy" każdej kolumny (w jednostkach fontu)
  private dropCol: number[] = []; // indeks koloru każdej kolumny (z palety budynków)
  private readonly colors: string[]; // paleta CSS — barwy budynków realm
  private readonly cssFont = 11; // px CSS — drobny glif (ostry, gęsty deszcz)
  private dpr = 0;
  private font = 11; // px urządzenia (cssFont * dpr) — realna jednostka canvasu
  private w = 0; // szerokość canvasu w px URZĄDZENIA
  private h = 0;
  private acc = 0;
  private readonly step = 1 / 20; // ~20 kroków/s — tempo opadania (niezależne od FPS)

  // „Neo" warp — glify uginają się promieniście wokół kursora (jak w agentSpam).
  // Pozycja w px CSS (przestrzeń logiczna sprite'a); aktywna dopiero po ruchu myszy.
  private pointerX = -9999;
  private pointerY = -9999;
  private pointerActive = false;
  private static readonly WARP_RADIUS = 90; // promień pola w px CSS
  private static readonly WARP_STRENGTH = 0.85; // siła odepchnięcia (0..1)

  /** Pozycja kursora w px CSS (z e.global Pixi — przestrzeń ekranu = logiczna sprite'a). */
  setPointer(cssX: number, cssY: number): void {
    this.pointerX = cssX;
    this.pointerY = cssY;
    this.pointerActive = true;
  }

  /** Kursor opuścił scenę → wyłącz warp (deszcz wraca do pionu). */
  clearPointer(): void {
    this.pointerActive = false;
  }

  /** @param colors barwy budynków (CSS #rrggbb) — deszcz pada w kolorach realm. */
  constructor(colors: string[] = ['#5bffb0']) {
    this.colors = colors.length ? colors : ['#5bffb0'];
    this.view.alpha = 0.5; // tło, nie pierwszy plan
    this.resize(window.innerWidth || 1, window.innerHeight || 1);
  }

  /**
   * Dopasuj do rozmiaru ekranu. Zamiast resize'ować istniejącą teksturę (co NIE
   * odświeża wgrania na GPU → deszcz znika po zmianie rozmiaru), budujemy ZA KAŻDYM
   * razem świeży, izolowany canvas + CanvasSource(resolution = dpr) + Texture i
   * podmieniamy go w sprite, niszcząc stary. resolution = dpr → logiczny rozmiar
   * tekstury = px CSS (skala naturalna pokrywa ekran), a backing jest ×dpr → ostre
   * piksele bez „HUGE" upscalingu na retinie. resize jest rzadki, więc to tanie.
   */
  resize(cssWidth: number, cssHeight: number): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(cssWidth * dpr)); // backing canvasu w px URZĄDZENIA
    const h = Math.max(1, Math.floor(cssHeight * dpr));
    if (w === this.w && h === this.h && dpr === this.dpr) return; // bez zmian (także DPR) → nic
    this.dpr = dpr;
    this.font = Math.max(8, Math.round(this.cssFont * dpr));
    this.w = w;
    this.h = h;

    // Świeży, izolowany canvas (poprzedni nie jest współdzielony → bezpieczny destroy).
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const texture = new Texture({ source: new CanvasSource({ resource: canvas, resolution: dpr }) });

    const old = this.texture;
    this.canvas = canvas;
    this.ctx = ctx;
    this.texture = texture;
    this.view.texture = texture; // skala naturalna (1) → logiczny rozmiar = CSS, pokrywa ekran
    old?.destroy(true); // zwolnij starą teksturę + jej (nie-współdzielony) canvas/GPU

    const cols = Math.ceil(w / this.font);
    // Start każdej kolumny rozsiany NAD ekranem → deszcz nie „włącza się" jednym frontem.
    this.drops = Array.from({ length: cols }, () => Math.floor((Math.random() * -h) / this.font));
    this.dropCol = Array.from({ length: cols }, () => (Math.random() * this.colors.length) | 0);
  }

  update(dt: number): void {
    this.acc += dt;
    if (this.acc < this.step) return;
    this.acc = 0;
    const ctx = this.ctx;
    // Półprzezroczysta czerń na całość → poprzednie znaki gasną, tworząc ogon.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.085)';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.font = `${this.font}px monospace`;
    ctx.textBaseline = 'top';
    // Kursor w px URZĄDZENIA (glify liczone w px backing canvasu) + promień ×dpr.
    const warp = this.pointerActive;
    const mx = this.pointerX * this.dpr;
    const my = this.pointerY * this.dpr;
    const radius = MatrixRain.WARP_RADIUS * this.dpr;
    for (let i = 0; i < this.drops.length; i++) {
      const x = i * this.font;
      const y = this.drops[i] * this.font;
      const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
      // „Neo" warp: odepchnij głowę promieniście od kursora, gdy blisko. Ogon
      // jest „wypalony" na canvasie z poprzednich klatek → gnie się wraz z głową.
      let dx = x;
      let dy = y;
      if (warp) {
        const ox = x - mx;
        const oy = y - my;
        const dist = Math.hypot(ox, oy);
        if (dist < radius && dist > 0.1) {
          const t = 1 - dist / radius;
          const force = t * t * radius * MatrixRain.WARP_STRENGTH;
          dx += (ox / dist) * force;
          dy += (oy / dist) * force;
        }
      }
      // Głowa kolumny w barwie budynku (rzadziej biały błysk); ogon gaśnie do czerni przez fade.
      ctx.fillStyle = Math.random() < 0.05 ? '#ffffff' : this.colors[this.dropCol[i]];
      ctx.fillText(ch, dx, dy);
      if (y > this.h && Math.random() > 0.972) {
        this.drops[i] = 0; // reset głowy nad ekran
        this.dropCol[i] = (Math.random() * this.colors.length) | 0; // nowa barwa po cyklu
      } else this.drops[i]++;
    }
    this.texture?.source.update();
  }

  destroy(): void {
    this.view.destroy();
    this.texture?.destroy(true);
  }
}
