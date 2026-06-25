import { useState, type ReactNode } from 'react';
import type { AgentKind } from '@agent-citadel/shared';
import { resolveProvider } from '../theme/providers';
import { emblemSrc } from '../theme/emblems';

/**
 * Herb providera. Warstwa podstawowa: graficzny PNG (Faza 2). Gdy asset się nie
 * wczyta → fallback na dawny kolorowy chip/pigułkę (Claude bez koloru → nic).
 * - 'pill': herb + pełna nazwa (panel sesji).
 * - 'chip': sam herb ~16px + tooltip (przełącznik miast, „Widziane modele", kafelki).
 */
export function ProviderEmblem({
  agent,
  variant,
}: {
  agent: AgentKind | undefined;
  variant: 'pill' | 'chip';
}): ReactNode {
  const { kind, label, labelShort, color } = resolveProvider(agent);
  const [imgFailed, setImgFailed] = useState(false);
  if (color === null) return null;

  if (!imgFailed) {
    const src = emblemSrc(kind);
    if (!src) return null;
    const img = (
      <img
        src={src}
        alt={label}
        title={label}
        width={16}
        height={16}
        onError={() => setImgFailed(true)}
        style={{ imageRendering: 'pixelated', display: 'block', flex: 'none' }}
      />
    );
    if (variant === 'pill') {
      return (
        <span
          className="px"
          title={label}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6, verticalAlign: 'middle', fontSize: 10, opacity: 0.95 }}
        >
          {img}
          {label}
        </span>
      );
    }
    return img;
  }

  // Fallback (brak assetu): dawny kolorowy chip/pigułka.
  if (variant === 'pill') {
    return (
      <span
        className="px"
        style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 4, background: `${color}33`, color, border: `1px solid ${color}66`, verticalAlign: 'middle' }}
      >
        {label}
      </span>
    );
  }
  return (
    <span
      title={label}
      style={{ background: color, color: '#15140f', width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}
    >
      {labelShort}
    </span>
  );
}
