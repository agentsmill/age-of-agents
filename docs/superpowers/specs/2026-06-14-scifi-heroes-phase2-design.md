# Spec: bohaterowie sci‑fi (Faza 2 PixelLab)

Data: 2026-06-14
Status: design zatwierdzony w brainstormingu (user: „super lecisz wykonaj zadanie”).

## Cel

Dostarczyć dla motywu **sci‑fi** komplet 4 archetypów bohaterów (`opus`,
`sonnet`, `haiku`, `fable`, tryb `default`) z animacjami **idle / walk / work**
(south‑only), spakowanych w atlasy Pixi do
`packages/client/public/assets/scifi/heroes/`. To sci‑fi odpowiednik Fazy 1
fantasy (`2026-06-13-pixellab-assets-phase1.md`) — **ten sam pipeline**,
`theme=scifi`.

## Zakres

- **W zakresie:** 4 bazy `model` (świeże `create_character`, NIE
  `create_character_state` z fantasy — sci‑fi to inna tożsamość), animacje
  idle/walk/work south‑only, pakowanie packerem, walidacja w preview,
  ewentualne strojenie kotwicy/skali pod sci‑fi.
- **Poza zakresem:** 12 wariantów `permissionMode`, peon sci‑fi, budynki/teren
  sci‑fi (już istnieją), efekt zgonu, scenariusz demo.

## Twardy inwariant (bez zmian)

ZERO generacji PixelLab w runtime. Gra ładuje gotowe atlasy. Cała generacja to
offline pass w tej sesji MCP. Kod gry (`archetype.ts`, `sprites.ts`, `unit.ts`,
`view.ts`) **już** obsługuje sci‑fi — `loadThemeSprites('scifi')` czyta
`/assets/scifi/heroes/index.json`, `sessionToArchetypeKey` i fallback
`sonnet-default` są wspólne dla obu motywów. Klucze atlasów muszą być te same co
fantasy: `opus-default`, `sonnet-default`, `haiku-default`, `fable-default`.

## Roster (klimat: kolonia/marines + oficerowie; kolor per model zachowany)

Hierarchia rang; kolor modela spójny z fantasy dla rozpoznawalności między
motywami (opus=fiolet, sonnet=błękit, haiku=zieleń, fable=szkarłat).

| Klucz | Koncept | Opis (`create_character`, v3) |
|---|---|---|
| `opus-default` | Naczelny dowódca (oficer) | elite colonial commander in heavy powered armor, deep purple plating with gold rank trim, officer pauldrons, open visor helmet, confident stance, sci‑fi, pixel art |
| `sonnet-default` | Oficer taktyczny | tactical fleet officer in medium combat armor, steel‑blue armor panels with glowing cyan visor, holstered energy sidearm, sci‑fi, pixel art |
| `haiku-default` | Zwiadowca / lekka piechota | agile recon scout in light reconnaissance armor, green stealth plating and visor, compact carbine, nimble alert pose, sci‑fi, pixel art |
| `fable-default` | ⭐ Legendarny powracający bohater | legendary champion in ornate ceremonial battle armor, crimson and gold filigree engravings, flowing red cape, glowing energy blade, radiant heroic presence, sci‑fi, pixel art |

Decyzja usera: fable dostaje wyróżniony „super” strój — model jest teraz
zbanowany, ale wróci; „super” osiągamy bogatszym opisem, nie innym silnikiem
(pipeline jednolity). Wszystkie 4 w **v3 (premium)** — user wybrał „ładne”.

## Generacja (parametry)

- `create_character`: `mode:"v3"`, `view:"low top-down"`, `size:48`,
  `detail:"high detail"` (v3: `n_directions`/`shading`/`proportions`/
  `text_guidance_scale` ignorowane — zawsze 8 kierunków; renderujemy tylko
  `south` + odbicie `scale.x=±1`).
- Animacje (south‑only, 1 gen/kierunek):
  - `idle`: template `breathing-idle`
  - `walk`: template `walking`
  - `work`: `mode:"v3"`, `action_description:"operating a control console with both hands"`, `frame_count:8` (sci‑fi odpowiednik fantasy „hammering”).
- Limit 8 jobów animacji naraz → batchowanie (np. 2 postacie × 3 animacje = 6
  jobów, potem kolejne 2).
- Probe‑first (bezpiecznik celu „ładne”): obejrzeć klatki baz po `completed`
  (szczególnie fable) zanim animujemy; słaba baza → re‑roll (`delete_character`
  + ponów) — tanie.

## Pakowanie i loader (bez zmian w kodzie)

1. Pobranie klatek per‑frame URL z `get_character` →
   `downloads/frames/<key>/<anim>/NN.png` (komenda z
   `notes/2026-06-13-pixellab-export-format.md`).
2. `node scripts/pixellab/pack-atlas.mjs scifi` → atlasy
   `assets/scifi/heroes/<key>.{png,json}` + `index.json` (packer już
   theme‑parametryczny, `theme=argv[2]`).
3. `loadThemeSprites('scifi')` w `view.ts` podnosi atlasy automatycznie; brak
   atlasu danego klucza → fallback placeholdera (gra działa przez cały rollout).

## Walidacja

- Build typów klienta (`npm run build -w @agent-citadel/client`).
- Preview: przełącz motyw na sci‑fi, potwierdź render sprite'ów (nie
  placeholder), animacje (idle≠walk≠work), odbicie, kotwica w stopie.
- Strojenie: `SPRITE_FOOT_ANCHOR` / `SPRITE_SCALE` w `unit.ts` — sci‑fi może
  wymagać innej wartości niż fantasy (canvas v3 może mieć inny padding niż
  standard). Jeśli rozjazd istotny → wydzielić wartość per‑theme; jeśli zbieżne
  — zostawić wspólne. **Punkt strojenia usera.**

## Ryzyka

- **Padding/kotwica v3 ≠ standard:** fantasy strojone na `0.87`/`0.8` z trybu
  standard; v3 może mieć inny canvas → osobne strojenie sci‑fi.
- **Styl fable za mało „epicki”:** mitygacja przez re‑roll / wzbogacenie opisu;
  ostatecznie opcjonalnie `pro` (20–40 gen) tylko dla fable.
- **Asymetria jakości z fantasy** (v3 vs standard): zaakceptowana; ewentualna
  późniejsza regeneracja fantasy w v3 dla symetrii (osobne zadanie).

## Punkty wkładu usera (tryb learning)

- Opisy wizualne i klimat (zatwierdzone w brainstormingu).
- Strojenie `SPRITE_FOOT_ANCHOR`/`SPRITE_SCALE` sci‑fi w preview.
- Brama commita assetów (zasada projektu: nie commituj assetów bez zgody).
