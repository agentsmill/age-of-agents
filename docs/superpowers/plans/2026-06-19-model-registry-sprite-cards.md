# Karty spiritów z grafiką — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Przebudować sekcję tożsamości zakładki „Modele" z płaskich wierszy na karty per spirit z grafiką bohatera (jak karty budynków), pokazujące relację wiele-modeli→jeden-spirit.

**Architecture:** Tylko klient. Model danych `ModelConfig.sprites: SpriteRule[]` BEZ ZMIAN — karta-per-spirit to widok-projekcja grupująca reguły po `.sprite`. Czyste helpery (`model-sprite-edit.ts`) operują na płaskim `sprites[]`; `ModelRegistryEditor` renderuje 4 karty (pętla po `SPRITE_IDS`) z miniaturą `SpriteThumb` (kadr klatki idle_00 z arkusza bohatera).

**Tech Stack:** React + Zustand, vitest. Spec: [docs/superpowers/specs/2026-06-19-model-registry-sprite-cards-design.md](../specs/2026-06-19-model-registry-sprite-cards-design.md).

**Konwencje:** runner = vitest. Pojedynczy plik testów: `npm run test -w @agent-citadel/client -- <wzorzec>`. Budowa klienta (typecheck + vite): `npm run build:web`.

---

## Task 1: i18n — klucze `defaultMark` + `setDefault`

**Files:**
- Modify: `packages/client/src/i18n.ts` (interfejs po `addRow: string;` na linii 112; EN po linii 224; PL po linii 336; IT po linii 448)

- [ ] **Step 1: Dodaj klucze do interfejsu `UiStrings`** (po `addRow: string;`)

```ts
  defaultMark: string;
  setDefault: string;
```

- [ ] **Step 2: Dodaj wartości EN** (po `addRow: '+ add',`)

```ts
  defaultMark: 'default',
  setDefault: 'set default',
```

- [ ] **Step 3: Dodaj wartości PL** (po `addRow: '+ dodaj',`)

```ts
  defaultMark: 'domyślny',
  setDefault: 'ustaw domyślny',
```

- [ ] **Step 4: Dodaj wartości IT** (po `addRow: '+ aggiungi',`)

```ts
  defaultMark: 'predefinito',
  setDefault: 'imposta predefinito',
```

- [ ] **Step 5: Typecheck (wszystkie 3 obiekty kompletne)**

Run: `npm run build:web`
Expected: build OK — brak błędu „property missing in type UiStrings".

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/i18n.ts
git commit -m "feat(i18n): klucze defaultMark/setDefault (karty spiritów)"
```

---

## Task 2: `model-sprite-edit.ts` — czyste helpery + test

**Files:**
- Create: `packages/client/src/hud/model-sprite-edit.ts`
- Test: `packages/client/tests/model-sprite-edit.test.ts`

- [ ] **Step 1: Napisz failing test `packages/client/tests/model-sprite-edit.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  groupBySprite,
  addSpriteModel,
  removeSpriteRule,
  renameSprite,
  setFallbackSprite,
} from '../src/hud/model-sprite-edit';
import { validateModelConfig, DEFAULT_MODEL_CONFIG, type ModelConfig } from '../src/theme/models';

const empty: ModelConfig = { sprites: [], windows: [], fallback: { sprite: 'sonnet', contextWindow: 200_000 } };
const valid = (c: ModelConfig) => validateModelConfig(c).ok;

describe('groupBySprite', () => {
  it('grupuje DEFAULT po sprite: wszystkie SPRITE_IDS, nazwa + indeksy', () => {
    const g = groupBySprite(DEFAULT_MODEL_CONFIG);
    expect(Object.keys(g).sort()).toEqual(['fable', 'haiku', 'opus', 'sonnet']);
    expect(g.opus.name).toBe('Opus 4.8');
    expect(g.opus.rules.length).toBe(1);
    expect(typeof g.opus.rules[0].index).toBe('number');
  });
  it('spirit bez reguł → pusta lista, brak nazwy', () => {
    expect(groupBySprite(empty).opus).toEqual({ rules: [] });
  });
});

describe('addSpriteModel', () => {
  it('dopisuje regułę pattern z nazwą', () => {
    const next = addSpriteModel(empty, 'opus', 'gpt-5', 'Opus 4.8');
    expect(next.sprites).toEqual([
      { match: { kind: 'pattern', pattern: 'gpt-5' }, sprite: 'opus', displayName: 'Opus 4.8' },
    ]);
    expect(valid(next)).toBe(true);
  });
  it('pomija pusty pattern', () => {
    expect(addSpriteModel(empty, 'opus', '   ').sprites.length).toBe(0);
  });
});

describe('removeSpriteRule', () => {
  it('usuwa właściwy indeks', () => {
    const next = removeSpriteRule(DEFAULT_MODEL_CONFIG, 0);
    expect(next.sprites.length).toBe(DEFAULT_MODEL_CONFIG.sprites.length - 1);
    expect(valid(next)).toBe(true);
  });
});

describe('renameSprite', () => {
  it('ustawia displayName na wszystkich regułach spirita', () => {
    const cfg = addSpriteModel(addSpriteModel(empty, 'opus', 'opus'), 'opus', 'gpt');
    const next = renameSprite(cfg, 'opus', 'Big Brain');
    expect(next.sprites.every((r) => r.displayName === 'Big Brain')).toBe(true);
    expect(valid(next)).toBe(true);
  });
  it('pusta nazwa → undefined', () => {
    const next = renameSprite(DEFAULT_MODEL_CONFIG, 'opus', '   ');
    expect(next.sprites.find((r) => r.sprite === 'opus')?.displayName).toBeUndefined();
    expect(valid(next)).toBe(true);
  });
});

describe('setFallbackSprite', () => {
  it('zmienia fallback.sprite', () => {
    const next = setFallbackSprite(DEFAULT_MODEL_CONFIG, 'haiku');
    expect(next.fallback.sprite).toBe('haiku');
    expect(valid(next)).toBe(true);
  });
});
```

- [ ] **Step 2: Uruchom — FAIL**

Run: `npm run test -w @agent-citadel/client -- model-sprite-edit`
Expected: FAIL — `../src/hud/model-sprite-edit` nie istnieje.

- [ ] **Step 3: Utwórz `packages/client/src/hud/model-sprite-edit.ts`**

```ts
import { SPRITE_IDS, type ModelConfig, type ModelMatch, type SpriteId, type SpriteRule } from '../theme/models';

/** Reguły jednego spirita (z oryginalnym indeksem w sprites[]) + nazwa wyświetlana. */
export interface SpriteGroup {
  name?: string;
  rules: { match: ModelMatch; index: number }[];
}

/**
 * Grupuje płaskie `sprites[]` po polu `.sprite` — widok-projekcja dla kart.
 * Zawsze zawiera WSZYSTKIE SPRITE_IDS (puste karty też się renderują).
 * `name` = displayName pierwszej reguły danego spirita, jeśli jest.
 */
export function groupBySprite(config: ModelConfig): Record<SpriteId, SpriteGroup> {
  const out = {} as Record<SpriteId, SpriteGroup>;
  for (const s of SPRITE_IDS) out[s] = { rules: [] };
  config.sprites.forEach((rule, index) => {
    const g = out[rule.sprite];
    if (!g) return; // nieznany sprite (nie przeszedłby walidacji) — pomiń
    g.rules.push({ match: rule.match, index });
    if (g.name === undefined && rule.displayName) g.name = rule.displayName;
  });
  return out;
}

/** Dopisuje regułę `pattern` dla spirita (pomija pusty pattern). */
export function addSpriteModel(config: ModelConfig, sprite: SpriteId, pattern: string, name?: string): ModelConfig {
  const p = pattern.trim();
  if (!p) return config;
  const rule: SpriteRule = { match: { kind: 'pattern', pattern: p }, sprite };
  if (name) rule.displayName = name;
  return { ...config, sprites: [...config.sprites, rule] };
}

/** Usuwa regułę o danym indeksie w sprites[]. */
export function removeSpriteRule(config: ModelConfig, index: number): ModelConfig {
  return { ...config, sprites: config.sprites.filter((_, i) => i !== index) };
}

/** Ustawia displayName na WSZYSTKICH regułach spirita (pusty string → undefined). */
export function renameSprite(config: ModelConfig, sprite: SpriteId, name: string): ModelConfig {
  const displayName = name.trim() || undefined;
  return {
    ...config,
    sprites: config.sprites.map((r) => (r.sprite === sprite ? { ...r, displayName } : r)),
  };
}

/** Ustawia domyślny sprite (fallback dla niedopasowanych modeli). */
export function setFallbackSprite(config: ModelConfig, sprite: SpriteId): ModelConfig {
  return { ...config, fallback: { ...config.fallback, sprite } };
}
```

- [ ] **Step 4: Uruchom — PASS**

Run: `npm run test -w @agent-citadel/client -- model-sprite-edit`
Expected: PASS (wszystkie bloki).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/hud/model-sprite-edit.ts packages/client/tests/model-sprite-edit.test.ts
git commit -m "feat(client): helpery model-sprite-edit (grupowanie/edycja sprites[] dla kart)"
```

---

## Task 3: `ModelRegistryEditor` — karty spiritów + miniatury

**Files:**
- Modify: `packages/client/src/hud/ModelRegistryEditor.tsx` (zastąp CAŁY plik treścią poniżej)

Zmiany vs obecny plik: dodany `SpriteThumb` (kadr idle_00 z arkusza); sekcja tożsamości → 4 karty per spirit (`SpriteCard`, pętla po `SPRITE_IDS`, grid `.bre-grid`); „Widziane modele" z miniaturą rozwiązanego spirita; fallback-row stracił dropdown sprite (sprite ustawiasz na kartach), został tylko input okna; usunięty `SpriteRow`; `MatchEditor`/`WindowRow`/`ModelJsonEditor`/`Section` bez zmian.

- [ ] **Step 1: Zastąp całość `packages/client/src/hud/ModelRegistryEditor.tsx`**

```tsx
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  validateModelConfig,
  resolveSprite,
  resolveContextWindow,
  matchModel,
  SPRITE_IDS,
  type ModelConfig,
  type ModelMatch,
  type SpriteId,
  type WindowRule,
} from '../theme/models';
import { useModels } from '../model-store';
import { useWorld } from '../store';
import { useSettings } from '../settings';
import { useUi, type UiStrings } from '../i18n';
import { parseUploadedModelConfig, downloadModelConfig } from './model-io';
import {
  groupBySprite,
  addSpriteModel,
  removeSpriteRule,
  renameSprite,
  setFallbackSprite,
  type SpriteGroup,
} from './model-sprite-edit';
import { formatK } from '../util';

// Klatka idle_00 (lewy-górny róg arkusza), jednolita 68×68 dla wszystkich spritów/motywów.
const SPRITE_FRAME = 68;

/** Miniatura spirita: kadr idle_00 z arkusza /assets/<theme>/heroes/<sprite>-default.png. */
function SpriteThumb({ themeId, sprite, size = 56 }: { themeId: string; sprite: SpriteId; size?: number }) {
  return (
    <div
      className="bre-thumb"
      style={{ width: size, height: size, overflow: 'hidden', flex: 'none', display: 'block', padding: 0 }}
      aria-hidden
    >
      <div
        style={{
          width: SPRITE_FRAME,
          height: SPRITE_FRAME,
          backgroundImage: `url(/assets/${themeId}/heroes/${sprite}-default.png)`,
          backgroundPosition: '0 0',
          backgroundRepeat: 'no-repeat',
          imageRendering: 'pixelated',
          transform: `scale(${size / SPRITE_FRAME})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  );
}

export function ModelRegistryEditor() {
  const models = useModels((s) => s.models);
  const setModels = useModels((s) => s.setModels);
  const resetModels = useModels((s) => s.resetModels);
  const heroes = useWorld((s) => s.heroes);
  const themeId = useSettings((s) => s.themeId);
  const t = useUi();

  // Odrębne modele widziane w bieżących sesjach.
  const seen = useMemo(() => {
    const set = new Set<string>();
    for (const h of Object.values(heroes)) if (h.model) set.add(h.model);
    return [...set];
  }, [heroes]);

  const groups = useMemo(() => groupBySprite(models), [models]);
  const setWindows = (windows: WindowRule[]) => setModels({ ...models, windows });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.75 }}>{t.modelsHint}</div>

      {/* Widziane modele — miniatura spirita + okno + flaga fallback. */}
      {seen.length > 0 && (
        <div className="cov-strip" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <span className="px" style={{ opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 11 }}>
            {t.seenModels}
          </span>
          {seen.map((m) => {
            const matched =
              models.sprites.some((r) => matchModel(m, r.match)) ||
              models.windows.some((r) => matchModel(m, r.match));
            return (
              <div key={m} style={{ display: 'flex', gap: 8, fontSize: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <SpriteThumb themeId={themeId} sprite={resolveSprite(m, models).sprite} size={28} />
                <code style={{ opacity: 0.9 }}>{m}</code>
                <span className="bre-chip bre-chip--exact">{resolveSprite(m, models).sprite}</span>
                <span className="bre-chip bre-chip--prefix">{formatK(resolveContextWindow(m, models))}</span>
                {!matched && <span style={{ color: '#ef9f27' }}>⚠ {t.usesFallback}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Tożsamość — karty per spirit z grafiką (jak karty budynków). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="px" style={{ fontSize: 13 }}>{`👤 ${t.spriteAndName}`}</div>
        <div className="bre-grid">
          {SPRITE_IDS.map((s) => (
            <SpriteCard
              key={s}
              sprite={s}
              themeId={themeId}
              group={groups[s]}
              isDefault={models.fallback.sprite === s}
              t={t}
              onAddModel={(pattern, name) => setModels(addSpriteModel(models, s, pattern, name))}
              onRemoveRule={(index) => setModels(removeSpriteRule(models, index))}
              onRename={(name) => setModels(renameSprite(models, s, name))}
              onSetDefault={() => setModels(setFallbackSprite(models, s))}
            />
          ))}
        </div>
      </div>

      {/* Oś pojemności. */}
      <Section title={`📦 ${t.contextWindowSection}`}>
        {models.windows.map((r, i) => (
          <WindowRow
            key={i}
            rule={r}
            t={t}
            onChange={(next) => setWindows(models.windows.map((x, j) => (j === i ? next : x)))}
            onRemove={() => setWindows(models.windows.filter((_, j) => j !== i))}
          />
        ))}
        <button
          className="bre-addbtn"
          onClick={() => setWindows([...models.windows, { match: { kind: 'pattern', pattern: '' }, contextWindow: 200_000 }])}
        >
          {t.addRow}
        </button>
      </Section>

      {/* Domyślne okno (niedopasowane). Domyślny sprite ustawiasz na kartach wyżej. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
        <span className="px" style={{ opacity: 0.7 }}>{t.fallbackLabel}:</span>
        <input
          className="bre-input"
          style={{ width: 110 }}
          type="number"
          min={1}
          aria-label={t.windowLabel}
          value={models.fallback.contextWindow}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (n > 0) setModels({ ...models, fallback: { ...models.fallback, contextWindow: n } });
          }}
        />
        <span style={{ opacity: 0.6 }}>{t.windowLabel}</span>
      </div>

      {/* JSON — zapis/wgranie (debounce 400 ms, walidacja). */}
      <ModelJsonEditor models={models} setModels={setModels} t={t} />

      <div>
        <button className="ghost" onClick={resetModels}>↺ {t.restoreDefaults}</button>
      </div>
    </div>
  );
}

/** Karta jednego spirita: grafika + nazwa + chipy model-wzorców + znacznik domyślnego. */
function SpriteCard({
  sprite,
  themeId,
  group,
  isDefault,
  t,
  onAddModel,
  onRemoveRule,
  onRename,
  onSetDefault,
}: {
  sprite: SpriteId;
  themeId: string;
  group: SpriteGroup;
  isDefault: boolean;
  t: UiStrings;
  onAddModel: (pattern: string, name?: string) => void;
  onRemoveRule: (index: number) => void;
  onRename: (name: string) => void;
  onSetDefault: () => void;
}) {
  const [nameVal, setNameVal] = useState(group.name ?? '');
  const [modelVal, setModelVal] = useState('');

  // Sync nazwy gdy zmieni się z zewnątrz (import JSON / reset / dodanie pierwszego modelu).
  useEffect(() => setNameVal(group.name ?? ''), [group.name]);

  const commitModel = () => {
    if (modelVal.trim()) onAddModel(modelVal.trim(), nameVal.trim() || undefined);
    setModelVal('');
  };

  return (
    <div className="bre-card">
      <SpriteThumb themeId={themeId} sprite={sprite} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="px" style={{ fontSize: 13.5, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="bre-input"
            style={{ width: 130 }}
            placeholder={t.displayNameLabel}
            value={nameVal}
            onChange={(e) => {
              setNameVal(e.target.value);
              onRename(e.target.value);
            }}
          />
          <span style={{ opacity: 0.45, fontWeight: 400 }}>· {sprite}</span>
          {isDefault ? (
            <span style={{ opacity: 0.6, fontSize: 11 }}>· {t.defaultMark}</span>
          ) : (
            <button className="bre-addbtn" style={{ fontSize: 11 }} onClick={onSetDefault}>{t.setDefault}</button>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
          {group.rules.map(({ match, index }) => (
            <span key={index} className="bre-chip bre-chip--exact">
              {match.kind === 'exact' ? `= ${match.id}` : match.pattern}
              <button onClick={() => onRemoveRule(index)} aria-label={t.remove}>✕</button>
            </span>
          ))}
          <input
            className="bre-input"
            style={{ width: 120 }}
            placeholder={t.matchValue}
            value={modelVal}
            onChange={(e) => setModelVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitModel();
            }}
          />
          {modelVal.trim() && (
            <button className="bre-addbtn" onClick={commitModel} aria-label={t.addRow}>✓</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="px" style={{ fontSize: 13 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function MatchEditor({ match, t, onChange }: { match: ModelMatch; t: UiStrings; onChange: (m: ModelMatch) => void }) {
  const value = match.kind === 'exact' ? match.id : match.pattern;
  return (
    <>
      <select
        className="bre-input"
        aria-label="match kind"
        value={match.kind}
        onChange={(e) =>
          onChange(e.target.value === 'exact' ? { kind: 'exact', id: value } : { kind: 'pattern', pattern: value })
        }
      >
        <option value="pattern">{t.matchPattern}</option>
        <option value="exact">{t.matchExact}</option>
      </select>
      <input
        className="bre-input"
        style={{ width: 150 }}
        placeholder={t.matchValue}
        value={value}
        onChange={(e) =>
          onChange(match.kind === 'exact' ? { kind: 'exact', id: e.target.value } : { kind: 'pattern', pattern: e.target.value })
        }
      />
    </>
  );
}

function WindowRow({ rule, t, onChange, onRemove }: { rule: WindowRule; t: UiStrings; onChange: (r: WindowRule) => void; onRemove: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <MatchEditor match={rule.match} t={t} onChange={(match) => onChange({ ...rule, match })} />
      <input
        className="bre-input"
        style={{ width: 120 }}
        type="number"
        min={1}
        aria-label={t.windowLabel}
        value={rule.contextWindow}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (n > 0) onChange({ ...rule, contextWindow: n });
        }}
      />
      <span style={{ opacity: 0.6, fontSize: 12 }}>{t.windowLabel}</span>
      <button className="bre-addbtn" onClick={onRemove} aria-label={t.remove}>✕</button>
    </div>
  );
}

function ModelJsonEditor({ models, setModels, t }: { models: ModelConfig; setModels: (c: ModelConfig) => void; t: UiStrings }) {
  const [text, setText] = useState(() => JSON.stringify(models, null, 2));
  const [error, setError] = useState<string | undefined>();
  const focused = useRef(false);
  const applyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  // Gdy rejestr zmieni się z panelu, odśwież textarea — ale nie podczas pisania.
  useEffect(() => {
    if (focused.current) return;
    setText(JSON.stringify(models, null, 2));
    setError(undefined);
  }, [models]);

  useEffect(() => () => clearTimeout(applyTimer.current), []);

  const onChange = (v: string) => {
    setText(v);
    let parsed: unknown;
    try {
      parsed = JSON.parse(v);
    } catch {
      setError(t.jsonInvalid);
      return;
    }
    const res = validateModelConfig(parsed);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(undefined);
    clearTimeout(applyTimer.current);
    applyTimer.current = setTimeout(() => setModels(res.config), 400);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ opacity: 0.7 }}>{`{ } ${t.jsonSynced}`}</span>
        {error && <span style={{ color: '#e24b4a' }}>{error}</span>}
      </div>
      <textarea
        className={`bre-json${error ? ' invalid' : ''}`}
        value={text}
        spellCheck={false}
        onFocus={() => (focused.current = true)}
        onBlur={() => (focused.current = false)}
        onChange={(e) => onChange(e.target.value)}
      />
      {/* Pobierz/wgraj plik JSON — bliźniaczo do sekcji budynków (mapping-io). */}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button className="ghost" onClick={() => downloadModelConfig(models)}>{t.downloadJson}</button>
        <button className="ghost" onClick={() => fileRef.current?.click()}>{t.uploadJson}</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // pozwól wgrać ten sam plik ponownie
            if (!file) return;
            const res = parseUploadedModelConfig(await file.text());
            if (res.ok) {
              setError(undefined);
              setText(JSON.stringify(res.config, null, 2));
              setModels(res.config);
            } else {
              setError(t.jsonInvalid);
            }
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build (typecheck + vite) — główny check**

Run: `npm run build:web`
Expected: build OK, zero błędów typów (m.in. `SpriteRule` nieużywany usunięty z importów; `useSettings`/helpery/`SpriteGroup` zaimportowane).

- [ ] **Step 3: Pełny pakiet testów klienta — brak regresji**

Run: `npm run test -w @agent-citadel/client`
Expected: wszystkie zielone (poprzednie + `model-sprite-edit`).

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/hud/ModelRegistryEditor.tsx
git commit -m "feat(client): karty spiritów z grafiką w rejestrze modeli (miniatura idle_00)"
```

---

## Task 4: Weryfikacja na żywo + wydanie

**Files:**
- Modify: `package.json` (wersja → następna wolna; obecnie 0.3.8 lokalnie — potwierdź przez tagi)

- [ ] **Step 1: Pełne testy + build**

Run: `npm test && npm run build`
Expected: serwer + klient zielone; build web + server OK.

- [ ] **Step 2: Weryfikacja na żywo (preview)**

Uruchom przez `preview_start` config `demo` (port 5173). Jeśli 8123 zajęty przez realny serwer usera — klient i tak renderuje (jak w v0.3.7). Sprawdź narzędziami preview (NIE pytaj usera):
1. Otwórz ustawienia (gear ⚙) → zakładka **Models**.
2. `preview_screenshot`: sekcja „Character & name" pokazuje **4 karty** z **miniaturami bohaterów** (opus/sonnet/haiku/fable), nazwą, chipami modeli, znacznikiem „default" na jednym.
3. W jednej karcie dodaj model (np. „gpt-5" w opus) → chip się pojawia; usuń → znika.
4. Zmień nazwę spirita → utrzymuje się; kliknij „set default" na innym → znacznik się przenosi (reaktywnie).
5. „Widziane modele" pokazują miniaturę spirita przy każdym realnym modelu.
6. `preview_console_logs` level=error → brak błędów; `preview_screenshot` jako dowód.

- [ ] **Step 3: Ustal następną wolną wersję i bump**

Run: `git ls-remote --tags origin | grep -oE "v[0-9]+\.[0-9]+\.[0-9]+" | sort -V | tail -3`
Ustaw `package.json` `version` na pierwszą wolną (≥ 0.3.8). Jeśli 0.3.8 wolne → 0.3.8.

- [ ] **Step 4: Commit wersji**

```bash
git add package.json
git commit -m "chore(release): v<X.Y.Z> — karty spiritów z grafiką w rejestrze modeli"
```

- [ ] **Step 5: Push + tag (po potwierdzeniu — npm publish)**

```bash
git fetch origin main && git rev-list --left-right --count origin/main...HEAD   # 0 behind przed pushem
git push origin main
git tag v<X.Y.Z> && git push origin v<X.Y.Z>   # odpala publish.yml → npm
```

Tag/publikację potwierdź z użytkownikiem (wyjście na zewnątrz, jak w v0.3.7).

---

## Self-Review

**Spec coverage:** §2 karty per spirit → Task 3 (SpriteCard + grid). §4.1 SpriteThumb → Task 3. §4.2 helpery → Task 2. §4.3 sekcja kart + fallback restructure → Task 3. §4.4 miniatury w „widzianych modelach" → Task 3. §5 i18n → Task 1. §6 testy helperów → Task 2; UI live → Task 4. Provider/herby świadomie poza zakresem (spec §2) — brak tasku, zgodnie z intencją.

**Placeholder scan:** brak TBD/TODO; cały plik ModelRegistryEditor podany dosłownie; wersja release ustalana przez sprawdzenie tagów (konkretna komenda).

**Type consistency:** `SpriteGroup {name?, rules:[{match,index}]}`, `groupBySprite`/`addSpriteModel`/`removeSpriteRule`/`renameSprite`/`setFallbackSprite` — sygnatury spójne między Task 2 (definicja) a Task 3 (użycie). `onAddModel(pattern, name?)`, `SpriteThumb({themeId,sprite,size})`, klucze i18n `defaultMark`/`setDefault` użyte w Task 3 zdefiniowane w Task 1. Usunięty `SpriteRow` i import `SpriteRule` (nieużywane) — bez wiszących referencji.
