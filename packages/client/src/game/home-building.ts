import type { BuildingId } from '@agent-citadel/shared';
import type { HeroSnapshot } from '@agent-citadel/shared';
import type { ThemeDef } from '../theme/types';

/**
 * Punti di raccolta (3 per tema) in cui una nuova sessione spawna
 * prima di essere mandata a lavorare. Scelti da un hash STABILE del
 * nome del progetto, così le sessioni dello stesso progetto si
 * raggruppano nello stesso punto, e progetti diversi si distribuiscono
 * sulla mappa invece di ammucchiarsi davanti alla citadella.
 *
 * I 3 building per tema sono ordinati così che ognuno "ospiti" un
 * sottoinsieme diverso di progetti (hash % 3) — la suddivisione è
 * deterministica e non dipende dall'ordine di arrivo.
 */
const HOME_BUILDINGS: Record<string, BuildingId[]> = {
  fantasy: ['arena', 'tavern', 'garden', 'bar', 'shrine'],
  scifi: ['holodeck', 'mess', 'hydroponics', 'lounge', 'medbay'],
};

/** djb2 — veloce, deterministico, sufficiente per spalmare 100+ progetti. */
function projectHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Restituisce l'id del building in cui una NUOVA unità di questa sessione
 * dovrebbe apparire. Se il tema non ha punti di raccolta o manca il progetto,
 * fallback alla citadella (la destinazione originale).
 */
export function homeBuilding(theme: ThemeDef, hero: Pick<HeroSnapshot, 'projectName' | 'projectDir'>): BuildingId {
  const options = HOME_BUILDINGS[theme.id];
  if (!options || options.length === 0) return 'citadel';
  // Preferiamo projectName (più corto e stabile di un path assoluto), ma
  // se manca usiamo projectDir come fallback. Entrambi portano alla stessa
  // destinazione se lo stesso progetto si presenta più volte.
  const key = hero.projectName ?? hero.projectDir ?? '';
  if (!key) return 'citadel';
  return options[projectHash(key) % options.length];
}
