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
