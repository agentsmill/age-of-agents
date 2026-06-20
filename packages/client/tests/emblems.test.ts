import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { emblemSrc } from '../src/theme/emblems';
import { ProviderEmblem } from '../src/hud/ProviderEmblem';
import type { AgentKind } from '@agent-citadel/shared';

/**
 * emblemSrc wyprowadza ścieżkę graficznego herba (Faza 2) z agenta, theme-agnostic.
 * Degradacja nieznany/undefined → claude (przez resolveProvider), a Claude nie ma herba.
 */
describe('emblemSrc', () => {
  it('mapuje providerów z herbem na ich PNG', () => {
    expect(emblemSrc('codex')).toBe('/assets/emblems/codex.png');
    expect(emblemSrc('opencode')).toBe('/assets/emblems/opencode.png');
    expect(emblemSrc('koda')).toBe('/assets/emblems/koda.png');
  });

  it('claude i brak agenta nie mają widocznego herba', () => {
    expect(emblemSrc('claude')).toBeUndefined();
    expect(emblemSrc(undefined)).toBeUndefined();
  });

  it('nieznany string → degraduje do claude bez herba', () => {
    expect(emblemSrc('gemini' as AgentKind)).toBeUndefined();
  });
});

describe('ProviderEmblem', () => {
  it('nie renderuje niczego dla domyślnego/no-provider Claude', () => {
    expect(renderToStaticMarkup(createElement(ProviderEmblem, { agent: 'claude', variant: 'pill' }))).toBe('');
    expect(renderToStaticMarkup(createElement(ProviderEmblem, { agent: undefined, variant: 'chip' }))).toBe('');
  });

  it('renderuje PNG dla providerów z herbem', () => {
    const html = renderToStaticMarkup(createElement(ProviderEmblem, { agent: 'codex', variant: 'chip' }));
    expect(html).toContain('/assets/emblems/codex.png');
  });
});
