import { useEffect, useMemo, useRef, useState } from 'react';
import {
  validateMapping,
  type BuildingId,
  type MappingConfig,
  type MappingRule,
} from '../theme/mapping';
import { useMapping } from '../mapping-store';
import { useSettings } from '../settings';
import { useUi, buildingText, type UiStrings } from '../i18n';
import { useWorld } from '../store';
import { computeCoverage } from '../coverage';
import { parseTriggers } from '../mapping-edit';
import { parseUploadedMapping, downloadMapping } from './mapping-io';

/** "Working" buildings (tool targets). citadel = home/fallback, but allow its own rules. */
const WORKING_BUILDINGS: BuildingId[] = [
  'tower', 'forge', 'library', 'mine', 'barracks', 'market', 'guild', 'citadel',
];

/** Social buildings per theme (driven by session state, without tool triggers). */
const SOCIAL_BY_THEME: Record<string, BuildingId[]> = {
  fantasy: ['arena', 'tavern', 'garden', 'bar', 'shrine'],
  scifi: ['holodeck', 'mess', 'hydroponics', 'lounge', 'medbay'],
};

export function BuildingReactionsEditor() {
  const mapping = useMapping((s) => s.mapping);
  const setMapping = useMapping((s) => s.setMapping);
  const resetMapping = useMapping((s) => s.resetMapping);
  const themeId = useSettings((s) => s.themeId);
  const lang = useSettings((s) => s.lang);
  const heroes = useWorld((s) => s.heroes);
  const t = useUi();

  // Tools actually seen in live logs: basis for coverage analysis.
  const seenTools = useMemo(() => {
    const set = new Set<string>();
    for (const h of Object.values(heroes)) {
      if (h.currentTool) set.add(h.currentTool);
      for (const a of h.recentActions ?? []) if (a.tool) set.add(a.tool);
    }
    return [...set];
  }, [heroes]);

  const coverage = useMemo(
    () => computeCoverage(mapping, seenTools, WORKING_BUILDINGS),
    [mapping, seenTools],
  );

  const addRules = (rules: MappingRule[]) =>
    setMapping({ ...mapping, rules: [...mapping.rules, ...rules] });
  const removeAt = (idx: number) =>
    setMapping({ ...mapping, rules: mapping.rules.filter((_, i) => i !== idx) });

  const social = (SOCIAL_BY_THEME[themeId] ?? SOCIAL_BY_THEME.fantasy)
    .map((id) => buildingText(themeId, id, lang).label)
    .join(', ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.75 }}>{t.buildingReactionsHint}</div>

      {/* Coverage strip. */}
      <div className="cov-strip">
        <span className="px" style={{ opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 11 }}>
          {t.coverage}
        </span>
        <span className="ok">✓ {coverage.coveredCount} {t.covCovered}</span>
        <span className={coverage.uncoveredTools.length ? 'warn' : ''}>
          ⚠ {coverage.uncoveredTools.length} {t.covUnassigned}
        </span>
        <span className={coverage.conflicts.length ? 'bad' : ''}>
          ⚔ {coverage.conflicts.length} {t.covConflicts}
        </span>
      </div>

      {/* Unassigned tools from live logs: assign with one click. */}
      {coverage.uncoveredTools.length > 0 && (
        <UnassignedTools tools={coverage.uncoveredTools} onAssign={(tool, building) =>
          addRules([{ kind: 'exact', tool, building }])} t={t} />
      )}

      {/* Chip type legend. */}
      <div style={{ display: 'flex', gap: 10, fontSize: 11.5, opacity: 0.8 }}>
        <LegendDot cls="bre-chip--exact" label={t.kindName} />
        <LegendDot cls="bre-chip--prefix" label={t.kindPattern} />
        <LegendDot cls="bre-chip--detail" label={t.kindCondition} />
      </div>

      {/* Building cards. */}
      <div className="bre-grid">
        {WORKING_BUILDINGS.map((id) => (
          <BuildingCard
            key={id}
            id={id}
            label={buildingText(themeId, id, lang).label}
            themeId={themeId}
            isFallback={id === mapping.fallback}
            rules={mapping.rules
              .map((rule, idx) => ({ rule, idx }))
              .filter(({ rule }) => rule.building === id)}
            onAddExact={(tools) => addRules(tools.map((tool) => ({ kind: 'exact', tool, building: id })))}
            onAddPrefix={(prefix) => addRules([{ kind: 'prefix', prefix, building: id }])}
            onAddDetail={(tool, pattern) => addRules([{ kind: 'detail', tool, pattern, building: id }])}
            onRemove={removeAt}
            t={t}
          />
        ))}
      </div>

      {/* Social buildings: informational. */}
      <div style={{ fontSize: 12, opacity: 0.6 }}>
        🏘 {t.socialBuildings} <span style={{ opacity: 0.85 }}>{social}</span>
      </div>

      {/* JSON below. */}
      <JsonEditor mapping={mapping} setMapping={setMapping} t={t} />

      <div>
        <button className="ghost" onClick={resetMapping}>↺ {t.restoreDefaults}</button>
      </div>
    </div>
  );
}

function LegendDot({ cls, label }: { cls: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span className={`bre-chip ${cls}`} style={{ width: 12, height: 12, padding: 0 }} aria-hidden />
      {label}
    </span>
  );
}

function UnassignedTools({
  tools,
  onAssign,
  t,
}: {
  tools: string[];
  onAssign: (tool: string, building: BuildingId) => void;
  t: UiStrings;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 12, alignItems: 'center' }}>
      {tools.map((tool) => (
        <span key={tool} className="bre-chip bre-chip--detail" style={{ background: '#3a2a2a', color: '#f0a0a0' }}>
          {tool}
          <select
            aria-label={`${t.assign}: ${tool}`}
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) onAssign(tool, e.target.value as BuildingId);
            }}
            className="bre-input"
            style={{ padding: '1px 3px' }}
          >
            <option value="" disabled>{t.assign}…</option>
            {WORKING_BUILDINGS.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </span>
      ))}
    </div>
  );
}

function BuildingCard({
  id,
  label,
  themeId,
  isFallback,
  rules,
  onAddExact,
  onAddPrefix,
  onAddDetail,
  onRemove,
  t,
}: {
  id: BuildingId;
  label: string;
  themeId: string;
  isFallback: boolean;
  rules: { rule: MappingRule; idx: number }[];
  onAddExact: (tools: string[]) => void;
  onAddPrefix: (prefix: string) => void;
  onAddDetail: (tool: string, pattern: string) => void;
  onRemove: (idx: number) => void;
  t: UiStrings;
}) {
  const [imgOk, setImgOk] = useState(true);
  const [exactVal, setExactVal] = useState('');
  const [form, setForm] = useState<'none' | 'prefix' | 'detail'>('none');
  const [prefixVal, setPrefixVal] = useState('');
  const [detailTool, setDetailTool] = useState('');
  const [detailPattern, setDetailPattern] = useState('');

  const commitExact = () => {
    const tools = parseTriggers(exactVal);
    if (tools.length) onAddExact(tools);
    setExactVal('');
  };
  const commitPrefix = () => {
    if (prefixVal.trim()) onAddPrefix(prefixVal.trim());
    setPrefixVal('');
    setForm('none');
  };
  const commitDetail = () => {
    if (detailTool.trim() && detailPattern.trim()) onAddDetail(detailTool.trim(), detailPattern.trim());
    setDetailTool('');
    setDetailPattern('');
    setForm('none');
  };

  return (
    <div className="bre-card">
      {imgOk ? (
        <img
          className="bre-thumb"
          src={`/assets/${themeId}/buildings/${id}.png`}
          alt=""
          onError={() => setImgOk(false)}
        />
      ) : (
        <div className="bre-thumb" aria-hidden>🏛</div>
      )}

      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="px" style={{ fontSize: 13.5, marginBottom: 6 }}>
          {label} <span style={{ opacity: 0.45, fontWeight: 400 }}>· {id}</span>
          {isFallback && <span style={{ opacity: 0.5, fontSize: 11 }}> · home</span>}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
          {rules.map(({ rule, idx }) => (
            <TriggerChip key={idx} rule={rule} onRemove={() => onRemove(idx)} t={t} />
          ))}

          <input
            className="bre-input"
            style={{ width: 120 }}
            placeholder={t.addTrigger}
            value={exactVal}
            onChange={(e) => setExactVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitExact();
            }}
          />
          {exactVal.trim() && (
            <button className="bre-addbtn" onClick={commitExact} aria-label={t.addTriggerConfirm}>
              ✓
            </button>
          )}
        </div>

        {/* Dodawanie wzorca / warunku. */}
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {form === 'none' && (
            <>
              <button className="bre-addbtn" onClick={() => setForm('prefix')}>{t.addPattern}</button>
              <button className="bre-addbtn" onClick={() => setForm('detail')}>{t.addCondition}</button>
            </>
          )}
          {form === 'prefix' && (
            <>
              <input
                className="bre-input"
                style={{ width: 130 }}
                placeholder="mcp__"
                value={prefixVal}
                autoFocus
                onChange={(e) => setPrefixVal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commitPrefix()}
              />
              <button className="bre-addbtn" onClick={commitPrefix}>✓</button>
              <button className="bre-addbtn" onClick={() => setForm('none')}>✕</button>
            </>
          )}
          {form === 'detail' && (
            <>
              <input
                className="bre-input"
                style={{ width: 80 }}
                placeholder={t.toolName}
                value={detailTool}
                autoFocus
                onChange={(e) => setDetailTool(e.target.value)}
              />
              <input
                className="bre-input"
                style={{ width: 130 }}
                placeholder={t.pattern}
                value={detailPattern}
                onChange={(e) => setDetailPattern(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commitDetail()}
              />
              <button className="bre-addbtn" onClick={commitDetail}>✓</button>
              <button className="bre-addbtn" onClick={() => setForm('none')}>✕</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TriggerChip({ rule, onRemove, t }: { rule: MappingRule; onRemove: () => void; t: UiStrings }) {
  const cls =
    rule.kind === 'prefix' ? 'bre-chip--prefix' : rule.kind === 'detail' ? 'bre-chip--detail' : 'bre-chip--exact';
  const text =
    rule.kind === 'prefix'
      ? `${rule.prefix}*`
      : rule.kind === 'detail'
        ? `${rule.tool} · /${rule.pattern}/`
        : rule.tool;
  return (
    <span className={`bre-chip ${cls}`}>
      {text}
      <button onClick={onRemove} aria-label={`${t.remove}: ${text}`}>✕</button>
    </span>
  );
}

function JsonEditor({
  mapping,
  setMapping,
  t,
}: {
  mapping: MappingConfig;
  setMapping: (c: MappingConfig) => void;
  t: UiStrings;
}) {
  const [text, setText] = useState(() => JSON.stringify(mapping, null, 2));
  const [error, setError] = useState<string | undefined>();
  const focused = useRef(false);
  const applyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  // When the map changes from the panel (chips), refresh textarea, but not while typing.
  useEffect(() => {
    if (focused.current) return;
    setText(JSON.stringify(mapping, null, 2));
    setError(undefined);
  }, [mapping]);

  // Clean up debounce on unmount.
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
    const res = validateMapping(parsed);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(undefined);
    // Debounce: nie zalewaj serwera PUT-em per-znak (spec 4.4).
    clearTimeout(applyTimer.current);
    applyTimer.current = setTimeout(() => setMapping(res.config), 400);
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
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button className="ghost" onClick={() => downloadMapping(mapping)}>{t.downloadJson}</button>
        <button className="ghost" onClick={() => fileRef.current?.click()}>{t.uploadJson}</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // allow uploading the same file again
            if (!file) return;
            const res = parseUploadedMapping(await file.text());
            if (res.ok) {
              setError(undefined);
              setText(JSON.stringify(res.config, null, 2));
              setMapping(res.config);
            } else {
              setError(t.jsonInvalid);
            }
          }}
        />
      </div>
    </div>
  );
}
