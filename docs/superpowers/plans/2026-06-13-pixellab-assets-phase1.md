# PixelLab Assets — Faza 1 (dowód słuszności) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zastąpić proceduralny placeholder bohatera prawdziwymi sprite'ami PixelLab dla 4 baz `model` (motyw fantasy, tryb `default`), z animacjami idle/walk/work i twardym fallbackiem na placeholder — tak, by w preview wyrenderować ≥1 bohatera z poprawnym renderem, animacją, odbiciem i kotwicą w stopie.

**Architecture:** Generacja PixelLab jest **wyłącznie offline** (ta sesja MCP). Gra w runtime tylko ładuje gotowe atlasy Pixi (`public/assets/fantasy/heroes/<key>.{png,json}`). Klient: `sessionToArchetypeKey(hero)` **wybiera** klucz atlasu (nie generuje), `sprites.ts` ładuje atlasy i wydaje `Spritesheet`, `unit.ts` buduje `AnimatedSprite` albo spada na istniejący `buildUnitBody`. Twardy inwariant: **ZERO** wywołań PixelLab w kodzie gry.

**Tech Stack:** PixelLab MCP (`create_character`, `animate_character`, `get_character`), Pixi.js v8 (`Assets`, `Spritesheet`, `AnimatedSprite`), Node packer (`pngjs`), Vitest (już w monorepo).

---

## Scope Check

Spec (`docs/superpowers/specs/2026-06-13-pixellab-assets-design.md`) obejmuje pełny pivot w 4 fazach na 2 niezależnych podsystemach (fantasy top-down, sci-fi izo) + nowy moduł tilemap. **Ten plan świadomie pokrywa tylko Fazę 1** (4 bazy fantasy, dowód pipeline'u). Rekomendacja: po domknięciu Fazy 1 (gdy format eksportu i kotwica będą zdejderowane realnym assetem) napisać osobne plany dla:

- **Plan B — Faza 2 (fantasy pełne):** 12 wariantów `permissionMode` przez `create_character_state`, peon fantasy, 8 budynków `create_map_object`, tileset Wang + moduł tilemap, oraz **atlas-per-archetyp z leniwym ładowaniem** (Faza 1 ładuje atlasy eagerly — patrz Task 6).
- **Plan C — Faza 3 (sci-fi):** 16 bohaterów + peon + 8 budynków izo + kafle izometryczne (materializuje się ryzyko izo-2:1).
- **Plan D — Faza 4 (szlif):** FX aktywności budynków, efekt zgonu/zaniku, odświeżenie scenariusza demo.

Każdy z tych planów daje samodzielnie działające, testowalne oprogramowanie. Faza 1 niżej — też.

## File Structure

**Tworzone:**

- `packages/client/src/game/archetype.ts` — **wkłady learning**: `sessionToArchetypeKey(hero)` (siostra `toolToBuilding`) i `stateToAnimation(state, moving)`. Jedna odpowiedzialność: czyste mapowanie danych sesji → klucz/animacja. Bez zależności od Pixi.
- `packages/client/src/game/sprites.ts` — loader atlasów + akcesory `loadThemeSprites`, `getHeroSheet`, `getPeonSheet`. Jedyne miejsce dotykające `Assets.load`/`Spritesheet`.
- `packages/client/tests/archetype.test.ts` — testy jednostkowe czystych mapowań (TDD dla wkładów usera).
- `scripts/pixellab/pack-atlas.mjs` — packer offline: katalog klatek PNG → atlas Pixi (PNG + JSON z `animations`) + `index.json`. Nie wchodzi do bundla klienta.
- `packages/client/public/assets/fantasy/heroes/<key>.png` + `<key>.json` + `index.json` — wygenerowane atlasy (commitowane za zgodą usera).
- `docs/superpowers/notes/2026-06-13-pixellab-export-format.md` — udokumentowany format eksportu (wynik probe’a, Task 1).

**Modyfikowane:**

- `packages/client/src/game/unit.ts` — `Unit` przyjmuje opcjonalny `Spritesheet`; buduje `AnimatedSprite` (owinięty w `Container`) albo fallback na `buildUnitBody`; sterowanie torem animacji przez `stateToAnimation`; proceduralny bob tylko dla placeholdera.
- `packages/client/src/game/view.ts` — `init()` awaituje `loadThemeSprites(theme.id)`; tworzenie bohatera/peona przekazuje `Spritesheet` z `getHeroSheet(sessionToArchetypeKey(hero))` / `getPeonSheet()`.
- `packages/client/package.json` — skrypt `test` (vitest) + devDep `vitest`.
- `package.json` (root) — `test` uruchamia też klienta; devDep `pngjs`.

## Punkty wkładu użytkownika (tryb learning)

Te dwie funkcje pisze **użytkownik** — plan przygotowuje plik ze stubem (rzuca `Error`), sygnaturą, komentarzem i testami, które user czyni zielonymi:

1. `sessionToArchetypeKey(hero)` — `model` × `permissionMode` → klucz `'<model>-<mode>'`, z normalizacją surowych stringów i fallbackiem `ARCHETYPE_FALLBACK`.
2. `stateToAnimation(state, moving)` — `HeroStateKind` (+ czy jednostka idzie) → `'idle' | 'walk' | 'work'`.

`toolToBuilding`, progi/efekty FX i scenariusz demo **pozostają własnością usera** i nie są w zakresie Fazy 1.

---

### Task 1: Probe — wygeneruj 1 postać i zablokuj format eksportu

De-risking całej fazy: zanim napiszemy packer, musimy **zobaczyć**, co dokładnie zwraca `get_character` jako download (zip klatek? strip per-animacja? pojedyncze PNG?). To jedyna prawdziwie nieznana rzecz w planie.

**Files:**
- Create: `docs/superpowers/notes/2026-06-13-pixellab-export-format.md`

- [ ] **Step 1: Wygeneruj postać-sondę (MCP)**

Wywołaj `mcp__pixellab__create_character`:
```
description: "fantasy wizard apprentice in plain blue robe, simple staff, pixel art"
name: "probe-sonnet"
view: "low top-down"
n_directions: 4
size: 48
mode: "standard"
```
Zapisz zwrócone `character_id`.

- [ ] **Step 2: Poczekaj na ukończenie postaci**

Pollinguj `mcp__pixellab__get_character` z `character_id` co ~60 s aż `status: completed` (ETA ~2–5 min). Nie animuj wcześniej.

- [ ] **Step 3: Dodaj jedną animację (MCP)**

`mcp__pixellab__animate_character`:
```
character_id: <probe id>
template_animation_id: "breathing-idle"
animation_name: "idle"
directions: ["south"]
```
Poll `get_character` aż animacja `idle` będzie `completed`.

- [ ] **Step 4: Pobierz i obejrzyj artefakt**

Z `get_character` weź link `download` (lub URL-e klatek/rotacji). Pobierz do `downloads/probe/`:
```bash
mkdir -p downloads/probe && cd downloads/probe
curl -L -o probe.zip "<download_url>"   # albo curl per-frame jeśli to lista URL-i
file probe.zip && unzip -l probe.zip 2>/dev/null || ls -la
```
Następnie rozpakuj i obejrzyj strukturę:
```bash
unzip -o probe.zip -d probe_unzipped 2>/dev/null; find probe_unzipped -type f | head -50
```

- [ ] **Step 5: Udokumentuj format (decyzja blokująca Task 5)**

W `docs/superpowers/notes/2026-06-13-pixellab-export-format.md` zapisz konkretnie:
- Czy download to ZIP, czy lista URL-i klatek.
- Układ: pojedyncze PNG per klatka czy strip/sheet per animacja.
- Konwencja nazw plików (np. `south/0.png`) i które kierunki są obecne.
- Wymiary klatki w px (np. 68×68) i czy postać jest wyśrodkowana z paddingiem.
- **Mapowanie do znormalizowanego układu** wymaganego przez packer: `downloads/frames/<key>/<anim>/<NN>.png` (kierunek `south`). Opisz dokładną komendę kopiującą/tnącą z `probe_unzipped` do tego układu (jeśli strip — komenda slice'ująca; jeśli per-frame — komenda kopiująca z renumeracją).

Acceptance: notatka jednoznacznie opisuje, jak z dowolnego pobrania zrobić katalog `downloads/frames/<key>/<anim>/*.png`. Task 5 (packer) konsumuje już tylko ten układ.

---

### Task 2: Vitest w kliencie + stub `archetype.ts` (TDD pod wkład usera)

**Files:**
- Modify: `packages/client/package.json`
- Modify: `package.json` (root)
- Create: `packages/client/src/game/archetype.ts`
- Test: `packages/client/tests/archetype.test.ts`

- [ ] **Step 1: Dodaj vitest do klienta**

W `packages/client/package.json` dopisz w `scripts`:
```json
"test": "vitest run"
```
Zainstaluj runner (resztę monorepo nie ruszamy):
```bash
npm install -D vitest -w @agent-citadel/client
```

- [ ] **Step 2: Spraw, by root `npm test` obejmował klienta**

W root `package.json` zmień:
```json
"test": "npm run test -w @agent-citadel/server && npm run test -w @agent-citadel/client"
```

- [ ] **Step 3: Stub archetype.ts (sygnatury + TODO usera)**

Utwórz `packages/client/src/game/archetype.ts`:
```ts
import type { HeroSnapshot, HeroStateKind } from '@agent-citadel/shared';

/** Tory animacji generowane dla każdej postaci (1 kierunek = south + odbicie). */
export type AnimationName = 'idle' | 'walk' | 'work';

/** Klucz atlasu, gdy kombinacja model×mode jest nieznana lub assetu brak. */
export const ARCHETYPE_FALLBACK = 'sonnet-default';

export const MODELS = ['opus', 'sonnet', 'haiku', 'fable'] as const;
export const MODES = ['default', 'plan', 'acceptEdits', 'bypassPermissions'] as const;

/**
 * WKŁAD USERA (learning) — siostra toolToBuilding (theme/mapping.ts).
 * Mapuje HeroSnapshot.model × HeroSnapshot.permissionMode na klucz atlasu
 * '<model>-<mode>'. Surowe stringi bywają undefined albo pełnym id modelu
 * (np. 'claude-opus-4-8[1m]') — znormalizuj do jednego z MODELS / MODES.
 * Nieznane → ARCHETYPE_FALLBACK. NIE generuje — tylko wybiera.
 */
export function sessionToArchetypeKey(_hero: HeroSnapshot): string {
  // TODO(user): zaimplementuj. Cel: zielone packages/client/tests/archetype.test.ts.
  throw new Error('sessionToArchetypeKey not implemented');
}

/**
 * WKŁAD USERA (learning) — który tor animacji odtwarzać.
 * working → 'work'; jednostka w ruchu lub state 'returning' → 'walk';
 * idle/thinking/awaiting-input/error/sleeping → 'idle'.
 * `moving` jest osobnym argumentem, bo ruch po waypointach NIE jest zakodowany
 * w HeroStateKind (jednostka może iść będąc 'idle' albo 'working').
 */
export function stateToAnimation(_state: HeroStateKind, _moving: boolean): AnimationName {
  // TODO(user): zaimplementuj. Cel: zielone packages/client/tests/archetype.test.ts.
  throw new Error('stateToAnimation not implemented');
}
```

- [ ] **Step 4: Napisz testy (failing) — definiują kontrakt dla usera**

Utwórz `packages/client/tests/archetype.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { sessionToArchetypeKey, stateToAnimation } from '../src/game/archetype';
import type { HeroSnapshot } from '@agent-citadel/shared';

const hero = (model?: string, permissionMode?: string): HeroSnapshot => ({
  sessionId: 's', title: 't', projectDir: '/p', teamColor: 0, state: 'idle',
  tokens: { input: 0, output: 0 }, startedAt: '', lastActivityAt: '',
  model, permissionMode,
});

describe('sessionToArchetypeKey', () => {
  it('czyste model+mode → "<model>-<mode>"', () => {
    expect(sessionToArchetypeKey(hero('opus', 'plan'))).toBe('opus-plan');
  });
  it('brak model → fallback', () => {
    expect(sessionToArchetypeKey(hero(undefined, 'plan'))).toBe('sonnet-default');
  });
  it('brak mode → tryb default', () => {
    expect(sessionToArchetypeKey(hero('haiku', undefined))).toBe('haiku-default');
  });
  it('nieznany model → fallback', () => {
    expect(sessionToArchetypeKey(hero('gpt-5', 'default'))).toBe('sonnet-default');
  });
});

describe('stateToAnimation', () => {
  it('working → work', () => expect(stateToAnimation('working', false)).toBe('work'));
  it('w ruchu → walk niezależnie od stanu', () => expect(stateToAnimation('idle', true)).toBe('walk'));
  it('returning → walk', () => expect(stateToAnimation('returning', false)).toBe('walk'));
  it('thinking → idle', () => expect(stateToAnimation('thinking', false)).toBe('idle'));
  it('error → idle', () => expect(stateToAnimation('error', false)).toBe('idle'));
});
```

- [ ] **Step 5: Uruchom testy — potwierdź, że padają**

Run: `npm run test -w @agent-citadel/client`
Expected: FAIL — `sessionToArchetypeKey not implemented` / `stateToAnimation not implemented`.

- [ ] **Step 6: STOP — poproś usera o implementację dwóch funkcji**

To punkt wkładu learning. Przekaż userowi: plik `packages/client/src/game/archetype.ts`, dwa TODO, zielony cel = `packages/client/tests/archetype.test.ts`. Otwarta decyzja do omówienia: czy `sessionToArchetypeKey` powinno też mapować pełne id modeli (`claude-opus-4-8` → `opus`) — jeśli tak, user dorzuca własny test. **Nie implementuj za usera.**

- [ ] **Step 7: Po implementacji usera — testy zielone**

Run: `npm run test -w @agent-citadel/client`
Expected: PASS (wszystkie z Step 4).

- [ ] **Step 8: Commit (po zgodzie usera — patrz Task 10)**

```bash
git add packages/client/package.json package.json packages/client/src/game/archetype.ts packages/client/tests/archetype.test.ts
git commit -m "feat(client): archetype mapping (sessionToArchetypeKey, stateToAnimation) + vitest"
```

---

### Task 3: Loader atlasów `sprites.ts`

**Files:**
- Create: `packages/client/src/game/sprites.ts`

- [ ] **Step 1: Napisz loader + akcesory**

Utwórz `packages/client/src/game/sprites.ts`:
```ts
import { Assets, type Spritesheet } from 'pixi.js';

const heroSheets = new Map<string, Spritesheet>();
let peonSheet: Spritesheet | null = null;

/**
 * Eager-load atlasów bohaterów danego motywu wg index.json.
 * (Faza 2 zamieni to na leniwe ładowanie per-archetyp obecny na mapie.)
 * Brak index.json / pojedynczego atlasu → cicho zostawiamy fallback placeholdera.
 */
export async function loadThemeSprites(themeId: string): Promise<void> {
  heroSheets.clear();
  peonSheet = null;
  const base = `/assets/${themeId}/heroes`;
  let index: { keys: string[] };
  try {
    const res = await fetch(`${base}/index.json`);
    if (!res.ok) return;
    index = await res.json();
  } catch {
    return;
  }
  for (const key of index.keys) {
    try {
      const sheet = await Assets.load<Spritesheet>(`${base}/${key}.json`);
      heroSheets.set(key, sheet);
    } catch {
      /* brak pojedynczego atlasu → fallback dla tego klucza */
    }
  }
}

/** Spritesheet bohatera dla klucza archetypu, albo null (→ placeholder). */
export function getHeroSheet(key: string): Spritesheet | null {
  return heroSheets.get(key) ?? null;
}

/** Spritesheet peona (Faza 1: brak → null → placeholder). */
export function getPeonSheet(): Spritesheet | null {
  return peonSheet;
}
```

- [ ] **Step 2: Sanity — kompilacja typów klienta**

Run: `npm run build -w @agent-citadel/client` (tsc --noEmit + vite build — bez assetów loader po prostu zwróci wcześnie).
Expected: PASS (brak błędów typów). Atlasów jeszcze nie ma — to OK.

- [ ] **Step 3: Commit (po zgodzie usera)**

```bash
git add packages/client/src/game/sprites.ts
git commit -m "feat(client): sprites.ts — loader atlasów PixelLab z fallbackiem"
```

---

### Task 4: Generuj assety Fazy 1 (4 bazy × idle/walk/work, south-only)

Koszt ≈ 16 generacji (4 bazy + 4×3 animacje). Animacje **tylko south** → 1 gen/animację (template/v3 = 1 gen/kierunek). Wszystkie postacie tworzymy jako tryb `default` → klucze `opus-default`, `sonnet-default`, `haiku-default`, `fable-default`.

**Files:** (brak plików repo — to operacje MCP; klatki lądują w `downloads/`)

- [ ] **Step 1: Potwierdź balance przed serią**

`mcp__pixellab__get_balance` — `generations_remaining` ≥ 20. (Nie startuj serii, jeśli mniej.)

- [ ] **Step 2: Utwórz 4 bazy (MCP, równolegle)**

4× `mcp__pixellab__create_character` (zapisz każdy `character_id`), wspólne: `view:"low top-down"`, `n_directions:4`, `size:48`, `mode:"standard"`:
```
opus   → name:"fantasy-opus-default",   description:"regal archmage in deep purple robe with gold trim, ornate tall staff, pixel art"
sonnet → name:"fantasy-sonnet-default", description:"blue-robed scholar mage holding a quill and tome, calm, pixel art"
haiku  → name:"fantasy-haiku-default",  description:"nimble green-hooded apprentice ranger in light leather, short staff, pixel art"
fable  → name:"fantasy-fable-default",  description:"crimson storyteller bard with a lute on the back, feathered cap, pixel art"
```
> Opisy wizualne nie są wkładem learning (to nie logika) — ale przed odpaleniem **pokaż je userowi do akceptacji/tweaku** (Task 0 gate w podsumowaniu). Identyczne `view`/`size` dla spójności rosteru.

- [ ] **Step 3: Czekaj na ukończenie 4 baz**

Poll `get_character` każdego id aż `completed`. Jeśli którakolwiek `failed` — odczytaj `error`, popraw `description`, ponów `create_character` (nie blokuj reszty).

- [ ] **Step 4: Animuj idle / walk / work (south-only) dla każdej bazy**

Dla każdego ukończonego `character_id` po kolei:
```
idle: animate_character  template_animation_id:"breathing-idle"  animation_name:"idle"  directions:["south"]
walk: animate_character  template_animation_id:"walking"         animation_name:"walk"  directions:["south"]
work: animate_character  mode:"v3"  action_description:"hammering with both hands"  animation_name:"work"  directions:["south"]  frame_count:8
```
Poll `get_character` aż wszystkie 3 animacje danej postaci będą `completed`. (`work` używa v3, bo nie ma czystego template’u pracy; tani re-roll, gdyby poza wyszła słabo — `delete_animation` + ponów.)

- [ ] **Step 5: Pobierz klatki do znormalizowanego układu**

Dla każdego `key ∈ {opus,sonnet,haiku,fable}-default` i `anim ∈ {idle,walk,work}` pobierz klatki `south` z download-linku `get_character` i ułóż wg konwencji z Task 1:
```
downloads/frames/<key>/<anim>/00.png, 01.png, ...
```
Użyj dokładnej komendy normalizującej zapisanej w `docs/superpowers/notes/2026-06-13-pixellab-export-format.md`.

Acceptance: `find downloads/frames -name '*.png' | wc -l` ≥ 12 katalogów animacji wypełnionych klatkami (4 klucze × 3 animacje).

---

### Task 5: Packer offline — klatki → atlas Pixi

**Files:**
- Create: `scripts/pixellab/pack-atlas.mjs`
- Modify: `package.json` (root — devDep `pngjs`)
- Create (output): `packages/client/public/assets/fantasy/heroes/<key>.png|json`, `index.json`

- [ ] **Step 1: Dodaj pngjs (tylko dev/pipeline, nie do bundla klienta)**

```bash
npm install -D pngjs
```

- [ ] **Step 2: Napisz packer**

Utwórz `scripts/pixellab/pack-atlas.mjs`:
```js
#!/usr/bin/env node
/**
 * Packer offline: downloads/frames/<key>/<anim>/*.png -> atlas Pixi.
 * Wynik: public/assets/<theme>/heroes/<key>.png + <key>.json (frames+animations+meta)
 * oraz index.json z listą kluczy. Zero zależności od PixelLab/MCP.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const theme = process.argv[2] ?? 'fantasy';
const framesRoot = join(root, 'downloads/frames');
const outDir = join(root, `packages/client/public/assets/${theme}/heroes`);
const ANIMS = ['idle', 'walk', 'work'];

const loadPng = (p) => PNG.sync.read(readFileSync(p));

function packCharacter(key) {
  const sources = {}; // anim -> [PNG,...]
  let fw = 0, fh = 0;
  for (const anim of ANIMS) {
    const dir = join(framesRoot, key, anim);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    if (!files.length) continue;
    sources[anim] = files.map((f) => loadPng(join(dir, f)));
    for (const png of sources[anim]) { fw = Math.max(fw, png.width); fh = Math.max(fh, png.height); }
  }
  const all = Object.entries(sources).flatMap(([anim, pngs]) =>
    pngs.map((png, i) => ({ name: `${anim}_${String(i).padStart(2, '0')}`, anim, png })));
  if (!all.length) return null;

  const cols = Math.ceil(Math.sqrt(all.length));
  const rows = Math.ceil(all.length / cols);
  const sheet = new PNG({ width: cols * fw, height: rows * fh, fill: true });
  const frames = {};
  const animations = {};
  all.forEach((e, idx) => {
    const cx = (idx % cols) * fw, cy = Math.floor(idx / cols) * fh;
    const ox = cx + Math.floor((fw - e.png.width) / 2), oy = cy + Math.floor((fh - e.png.height) / 2);
    e.png.bitblt(sheet, 0, 0, e.png.width, e.png.height, ox, oy);
    frames[e.name] = { frame: { x: cx, y: cy, w: fw, h: fh }, rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: fw, h: fh }, sourceSize: { w: fw, h: fh } };
    (animations[e.anim] ??= []).push(e.name);
  });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${key}.png`), PNG.sync.write(sheet));
  writeFileSync(join(outDir, `${key}.json`), JSON.stringify({
    frames, animations,
    meta: { image: `${key}.png`, format: 'RGBA8888', size: { w: sheet.width, h: sheet.height }, scale: '1' },
  }, null, 2));
  return key;
}

const keys = existsSync(framesRoot)
  ? readdirSync(framesRoot).filter((k) => existsSync(join(framesRoot, k)))
  : [];
const packed = keys.map(packCharacter).filter(Boolean);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.json'), JSON.stringify({ keys: packed }, null, 2));
console.log(`Spakowano ${packed.length} atlasów do ${outDir}:`, packed.join(', '));
```

- [ ] **Step 3: Uruchom packer**

Run: `node scripts/pixellab/pack-atlas.mjs fantasy`
Expected: `Spakowano 4 atlasów ... opus-default, sonnet-default, haiku-default, fable-default`.

- [ ] **Step 4: Zweryfikuj atlasy**

```bash
ls -la packages/client/public/assets/fantasy/heroes/
node -e "const a=require('./packages/client/public/assets/fantasy/heroes/sonnet-default.json'); console.log('animations:', Object.keys(a.animations), '| idle frames:', a.animations.idle?.length)"
cat packages/client/public/assets/fantasy/heroes/index.json
```
Expected: 4× `.png` + 4× `.json` + `index.json`; `animations` zawiera `idle/walk/work`; `index.json.keys` = 4 klucze.

---

### Task 6: Wepnij sprite'y do `unit.ts` z fallbackiem

**Files:**
- Modify: `packages/client/src/game/unit.ts`

- [ ] **Step 1: Importy + stałe strojenia**

Na górze `packages/client/src/game/unit.ts` dodaj do importu z pixi.js `AnimatedSprite` oraz typ `Spritesheet`, i nowe importy:
```ts
import { AnimatedSprite, Container, Graphics, Text, type Spritesheet } from 'pixi.js';
import { stateToAnimation } from './archetype';
```
Pod `const SPEED_GRID_PER_S = 2.2;` dodaj (wartości strojone w Task 9):
```ts
/** Skala sprite'a PixelLab (~68px canvas) do skali jednostki na kaflu 48px. */
const SPRITE_SCALE = 0.62;
/** Kotwica Y sprite'a: 1.0 = dolna krawędź canvasu; strojona pod stopę w Task 9. */
const SPRITE_FOOT_ANCHOR = 0.92;
```

- [ ] **Step 2: Pola klasy na tryb sprite**

W `class Unit` dodaj pola:
```ts
  private animated?: AnimatedSprite;
  private sheet?: Spritesheet;
```

- [ ] **Step 3: Konstruktor — sprite albo placeholder**

Zmień sygnaturę konstruktora, dodając ostatni parametr:
```ts
    private readonly projection: Projection,
    sheet?: Spritesheet | null,
  ) {
```
Zastąp linię `this.body = buildUnitBody(teamColor(colorIndex), isPeon);` blokiem:
```ts
    if (sheet) {
      this.sheet = sheet;
      const sprite = new AnimatedSprite(sheet.animations.idle);
      sprite.anchor.set(0.5, SPRITE_FOOT_ANCHOR);
      sprite.scale.set(isPeon ? SPRITE_SCALE * 0.8 : SPRITE_SCALE);
      sprite.animationSpeed = 0.15;
      sprite.play();
      this.animated = sprite;
      this.body = new Container();
      this.body.addChild(sprite);
    } else {
      this.body = buildUnitBody(teamColor(colorIndex), isPeon);
    }
```

- [ ] **Step 4: `update()` — wybór toru animacji + brak proceduralnego bobu dla sprite'ów**

W `update(dtSeconds)` na początku (po `this.elapsed += dtSeconds;`) dodaj wybór animacji dla jednostek ze spritem:
```ts
    if (this.animated && this.sheet) {
      const anim = stateToAnimation(this.state, this.moving);
      const track = this.sheet.animations[anim];
      if (track && this.animated.textures !== track) {
        this.animated.textures = track;
        this.animated.play();
      }
    }
```
Następnie owiń **istniejący** proceduralny ruch (rotacja/`position.y` bob — bloki dla `path.length>0` oraz `else`) tak, by działał **tylko dla placeholdera**. Zachowaj odbicie `this.body.scale.x` zawsze (działa dla obu). Konkretnie: blok ustawiający `this.body.rotation`/`this.body.position.y` wykonuj jedynie gdy `!this.animated`. Linię zwrotu w ruchu zostaw bez zmian:
```ts
        // zwrot w kierunku ruchu (sprite i placeholder)
        this.body.scale.x = dx < -0.01 ? -1 : 1;
```
a poniżej proceduralny bob kroku oraz cały blok `else { ... working/thinking/idle bob ... }` opakuj warunkiem `if (!this.animated) { ... }`.

- [ ] **Step 5: Build typów**

Run: `npm run build -w @agent-citadel/client`
Expected: PASS (tsc bez błędów; `setState` nadal działa — alpha/overlay na `this.body` jako Container).

- [ ] **Step 6: Commit (po zgodzie usera)**

```bash
git add packages/client/src/game/unit.ts
git commit -m "feat(client): unit.ts — AnimatedSprite z fallbackiem na placeholder"
```

---

### Task 7: Przekaż atlasy w `view.ts` + załaduj przed rekoncyliacją

**Files:**
- Modify: `packages/client/src/game/view.ts`

- [ ] **Step 1: Importy**

W `packages/client/src/game/view.ts` dodaj:
```ts
import { getHeroSheet, getPeonSheet, loadThemeSprites } from './sprites';
import { sessionToArchetypeKey } from './archetype';
```

- [ ] **Step 2: Załaduj atlasy w `init()` przed pierwszą rekoncyliacją**

W `init()`, tuż przed `this.unsubscribe = useWorld.subscribe(...)` (linia ~135), dodaj:
```ts
    await loadThemeSprites(this.theme.id);
```
(`init` jest już `async` i awaitowane przez `GameCanvas` — kolejność: budowa sceny → load atlasów → subscribe → pierwsza reconcile.)

- [ ] **Step 3: Tworzenie bohatera przekazuje Spritesheet**

W `reconcile(...)`, w gałęzi tworzenia bohatera (`if (!unit) { const door = ... }`), przed `unit = new Unit(...)` policz arkusz i przekaż go ostatnim argumentem:
```ts
        const sheet = getHeroSheet(sessionToArchetypeKey(hero));
        unit = new Unit(hero.sessionId, hero.teamColor, false, clipName(hero.title), door, this.theme.projection, sheet);
```

- [ ] **Step 4: Tworzenie peona przekazuje (na razie pusty) Spritesheet**

W gałęzi tworzenia peona przekaż `getPeonSheet()` (Faza 1 → null → placeholder):
```ts
        unit = new Unit(peon.agentId, this.parentColor(peon, heroes), true, clipName(peon.description ?? 'peon', 22), start, this.theme.projection, getPeonSheet());
```

- [ ] **Step 5: Build typów**

Run: `npm run build -w @agent-citadel/client`
Expected: PASS.

- [ ] **Step 6: Commit (po zgodzie usera)**

```bash
git add packages/client/src/game/view.ts
git commit -m "feat(client): view.ts — ładowanie atlasów + wybór archetypu na spawnie"
```

---

### Task 8: Twardy inwariant — testowe potwierdzenie braku PixelLab w kodzie gry

**Files:** (brak nowych — to test/guard)

- [ ] **Step 1: Grep potwierdzający zero śladów MCP/PixelLab w `packages/`**

Run:
```bash
grep -rniE "pixellab|mcp__|create_character|animate_character|get_character" packages/ --include=*.ts --include=*.tsx
```
Expected: **brak wyników** (cała generacja żyje w `scripts/` i tej sesji MCP, nie w kodzie gry). Jeśli coś wyjdzie — usuń zależność zanim przejdziesz dalej.

- [ ] **Step 2: Potwierdź, że gra startuje bez atlasów (czysty fallback)**

Tymczasowo zmień nazwę `packages/client/public/assets/fantasy/heroes/index.json` → `index.json.bak`, odśwież preview, potwierdź że bohaterowie renderują się jako placeholdery bez błędów w konsoli, przywróć nazwę. (Dowód, że gra nie zależy od assetów do uruchomienia.)

---

### Task 9: Walidacja w preview (render / animacja / odbicie / kotwica) + strojenie

**Files:**
- Modify (strojenie): `packages/client/src/game/unit.ts` (`SPRITE_SCALE`, `SPRITE_FOOT_ANCHOR`)

- [ ] **Step 1: Uruchom serwer w trybie demo**

Użyj `preview_start` (komenda dev: `npm run demo`). Demo spawnuje bohaterów — przynajmniej jeden powinien mieć `model` mapujący się na wygenerowaną bazę w trybie `default` (np. sonnet/default → `sonnet-default`).

- [ ] **Step 2: Sprawdź konsolę i sieć**

`preview_console_logs` — brak błędów ładowania atlasu (404 PNG/JSON, parse). `preview_network` — `index.json` + ≥1 `<key>.json` + `<key>.png` ze statusem 200.

- [ ] **Step 3: Zrzut ekranu — render i kotwica**

`preview_screenshot`. Zweryfikuj wizualnie:
- **Render:** bohater to sprite PixelLab, nie szary placeholder.
- **Kotwica w stopie:** stopy stoją na pozycji jednostki (pierścień drużyny / punkt kafla), sprite nie „lewituje" ani nie tonie. Jeśli źle — stroj `SPRITE_FOOT_ANCHOR` (mniejsze = sprite wyżej) i powtórz Step 3.
- **Skala:** rozmiar zbliżony do placeholdera (~40 px wys.). Jeśli za duży/mały — stroj `SPRITE_SCALE`.

- [ ] **Step 4: Animacja i odbicie**

Poczekaj aż bohater zacznie iść do budynku (`steer` → `walk`) i wróci (`idle`/`work`):
- **Animacja:** widoczna zmiana klatek (idle ≠ walk ≠ work).
- **Odbicie:** idąc w lewo `scale.x=-1` odbija sprite poziomo bez artefaktów kotwicy.
- (Opcjonalnie `preview_resize` dla pewności, że nearest-scaling trzyma ostrość pikseli.)

- [ ] **Step 5: Zapisz dowód**

`preview_screenshot` stanu walk i stanu work → dołącz do podsumowania dla usera jako dowód Fazy 1.

- [ ] **Step 6: Commit strojenia (po zgodzie usera)**

```bash
git add packages/client/src/game/unit.ts
git commit -m "chore(client): strojenie skali i kotwicy sprite'ów Fazy 1"
```

---

### Task 10: Brama commita assetów (zgoda usera)

**Files:** (assety + ewentualny `.gitignore`)

- [ ] **Step 1: Pokaż userowi, co trafi do repo**

```bash
git status --porcelain packages/client/public/assets/fantasy/heroes/
du -sh packages/client/public/assets/fantasy/heroes/
```
Wygenerowane atlasy to **własne assety** (pivot znosi ograniczenie licencyjne). Mimo to **nie commituj bez wyraźnej zgody usera** (zasada projektu).

- [ ] **Step 2: Zignoruj surowe pobrania**

Dopisz do `.gitignore`:
```
/downloads/
```
(`downloads/frames` i `downloads/probe` to materiał roboczy packera — do repo idą tylko spakowane atlasy.)

- [ ] **Step 3: Commit assetów — wyłącznie po zgodzie usera**

```bash
git add packages/client/public/assets/fantasy/heroes/ .gitignore
git commit -m "assets(fantasy): atlasy bohaterów Fazy 1 (opus/sonnet/haiku/fable, default)"
```

---

## Otwarte kwestie poza Fazą 1 (TODO — wkład usera w kolejnych planach)

Przygotowane do osobnych planów; **nie** implementuję bez wkładu/decyzji usera:

- **FX aktywności budynku** i **parametry efektu zaniku/zgonu** (Faza 4) — progi i wygląd to decyzja usera.
- **Scenariusz demo** (`packages/server/src/demo/scenario.ts`) pod nowe sprite'y (Faza 4) — własność usera.
- **`create_character_state`** dla 12 wariantów `permissionMode` (Faza 2) — spójna tożsamość z baz.
- **Leniwe ładowanie atlasów** per-archetyp obecny na mapie (Faza 2) — Faza 1 ładuje eagerly.
- **Izo-budynki 2:1** kompromis 3/4 (Faza 3).

## Self-Review (wykonane przy pisaniu planu)

- **Pokrycie specu (Faza 1):** 4 bazy `model` (Task 4) ✓; idle/walk/work south-only (Task 4) ✓; atlas Pixi PNG+JSON named animations (Task 5) ✓; `sprites.ts` z `getHeroSprite`/`getPeonSprite` — zrealizowane jako `getHeroSheet`/`getPeonSheet` (Unit buduje `AnimatedSprite`, by móc przełączać tory) ✓; fallback w `unit.ts` (Task 6) ✓; walidacja 1 bohatera render/animacja/odbicie/kotwica (Task 9) ✓; twardy inwariant zero-runtime (Task 8) ✓; wkłady learning wydzielone i nieimplementowane przeze mnie (Task 2) ✓.
- **Rozjazd nazw vs spec:** spec proponował `getHeroSprite(key)`; plan używa `getHeroSheet(key)` + budowa `AnimatedSprite` w `Unit` — świadomy wybór, by `setState`/`update` mogły przełączać `textures` istniejącego sprite'a (zwracanie gotowego sprite'a utrudniałoby zmianę toru). Udokumentowane.
- **Spójność typów:** `AnimationName`, `sessionToArchetypeKey(hero):string`, `stateToAnimation(state,moving):AnimationName`, `getHeroSheet(key):Spritesheet|null`, `getPeonSheet():Spritesheet|null`, `loadThemeSprites(themeId):Promise<void>`, `Unit(..., sheet?)` — spójne między Task 2/3/6/7.
- **Placeholdery w planie:** brak „TBD/itd." — jedyna prawdziwa niewiadoma (format eksportu) jest zamknięta przez Task 1 (probe) zanim packer (Task 5) ją konsumuje.
- **Odchylenie sygnatury `stateToAnimation`:** spec pisał `stateToAnimation(state)`; ruch nie jest w `HeroStateKind`, więc dodano `moving`. Do potwierdzenia z userem przy Task 2 Step 6.
