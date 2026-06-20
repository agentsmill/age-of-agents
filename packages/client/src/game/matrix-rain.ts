import { Sprite, Texture } from 'pixi.js';

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
  readonly view: Sprite;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: Texture;
  private drops: number[] = []; // wiersz „głowy" każdej kolumny (w jednostkach fontSize)
  private dropCol: number[] = []; // indeks koloru każdej kolumny (z palety budynków)
  private readonly colors: string[]; // paleta CSS — barwy budynków realm
  private readonly cssFont = 11; // px CSS — drobny glif (ostry, gęsty deszcz)
  private dpr = 1;
  private font = 11; // px urządzenia (cssFont * dpr) — realna jednostka canvasu
  private w = 1; // szerokość canvasu w px URZĄDZENIA
  private h = 1;
  private acc = 0;
  private readonly step = 1 / 20; // ~20 kroków/s — tempo opadania (niezależne od FPS)

  /** @param colors barwy budynków (CSS #rrggbb) — deszcz pada w kolorach realm. */
  constructor(colors: string[] = ['#5bffb0']) {
    this.colors = colors.length ? colors : ['#5bffb0'];
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = Texture.from(this.canvas);
    this.view = new Sprite(this.texture);
    this.view.alpha = 0.5; // tło, nie pierwszy plan
    this.resize(window.innerWidth || 1, window.innerHeight || 1);
  }

  /**
   * Dopasuj canvas do rozmiaru ekranu. KLUCZOWE: backing canvasu rysujemy w px
   * URZĄDZENIA (× devicePixelRatio), a Sprite wyświetlamy w px CSS → tekstura 1:1
   * z pikselami ekranu (koniec rozmycia/„HUGE" upscalingu na ekranach retina).
   */
  resize(cssWidth: number, cssHeight: number): void {
    this.dpr = window.devicePixelRatio || 1;
    this.font = Math.max(8, Math.round(this.cssFont * this.dpr));
    const w = Math.max(1, Math.floor(cssWidth * this.dpr));
    const h = Math.max(1, Math.floor(cssHeight * this.dpr));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    const cols = Math.ceil(w / this.font);
    // Start każdej kolumny rozsiany NAD ekranem → deszcz nie „włącza się" jednym frontem.
    this.drops = Array.from({ length: cols }, () => Math.floor((Math.random() * -h) / this.font));
    this.dropCol = Array.from({ length: cols }, () => (Math.random() * this.colors.length) | 0);
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, w, h);
    this.view.width = Math.floor(cssWidth); // wyświetlanie w px CSS (backing jest ×dpr)
    this.view.height = Math.floor(cssHeight);
    this.texture.source.update();
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
    for (let i = 0; i < this.drops.length; i++) {
      const x = i * this.font;
      const y = this.drops[i] * this.font;
      const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
      // Głowa kolumny w barwie budynku (rzadziej biały błysk); ogon gaśnie do czerni przez fade.
      ctx.fillStyle = Math.random() < 0.05 ? '#ffffff' : this.colors[this.dropCol[i]];
      ctx.fillText(ch, x, y);
      if (y > this.h && Math.random() > 0.972) {
        this.drops[i] = 0; // reset głowy nad ekran
        this.dropCol[i] = (Math.random() * this.colors.length) | 0; // nowa barwa po cyklu
      } else this.drops[i]++;
    }
    this.texture.source.update();
  }

  destroy(): void {
    this.view.destroy();
    this.texture.destroy(true);
  }
}
