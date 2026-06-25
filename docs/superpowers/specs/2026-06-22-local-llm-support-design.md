# Local LLM Support — Design

**Date:** 2026-06-22
**Status:** Approved (design), pending implementation plan
**Origin:** Restores the functionality of closed PR #2 (`Add local LLM support via an
OpenAI-compatible proxy`), which was closed by its author by accident — not on merit.
Re-integrated onto current `main` and extended with model-registry integration and a
terminal-native capture path that PR #2 lacked.

## Problem

Age of Agents visualizes agent **transcripts** — the on-disk journals that Claude Code,
Codex, OpenCode and Koda write automatically. Local inference engines (Ollama, llama.cpp,
vLLM, oMLX) are *model servers*: they answer requests but persist nothing. With no
transcript, a local-LLM session never appears as a settler in the game.

We need to **capture the conversation in flight** and write it in the JSONL shape the
generic watcher already consumes, so local-LLM sessions become heroes like any other source.

## Goals

- A local-LLM session shows up as a hero in the game, with prompts, assistant text,
  tool calls, token usage and the model name.
- The model name (e.g. `bielik-11b-v3.0-instruct:Q4_K_M`) flows into the **model registry**
  ("Modele" tab) so the user can assign a sprite and context window; a sensible fallback
  applies until then.
- Cover the user's real workflow first: **`ollama run <model>` in a terminal**.
- Cover the other three backends (llama.cpp, vLLM, oMLX) via their shared OpenAI-compatible
  `/v1` surface, reusing the same transcript format and source.

## Non-goals

- No changes to how Ollama/llama.cpp/etc. are installed or served — we sit beside them.
- No persistent global daemon and no system-wide `OLLAMA_HOST` mutation (rejected approach B).
- No multi-turn conversation reconstruction beyond what a single capture session yields.
- Not building a model picker / chat UI — the user drives the model exactly as today.

## Approach (chosen)

Two **capture adapters** feed **one transcript format**, read by **one source**, integrated
**once** with the model registry.

```
 ┌─ Adapter A: aoa local <model>  ─ wraps `ollama run`, ephemeral Ollama-native proxy
 │     (Phase 1 — the user's real workflow)
 │                                              ┌───────────────────────────────┐
 │   ollama run … ─▶ ollama-logger ─▶ Ollama    │  ~/.age-of-agents/local-llm/   │
 │        (OLLAMA_HOST=proxy)  │ tee /api/chat ─▶│  sessions/<uuid>.jsonl         │
 │                                              └───────────────────────────────┘
 ├─ Adapter B: aoa local-proxy   ─ long-lived OpenAI /v1 proxy (restored from PR #2)
 │     (Phase 2 — llama.cpp / vLLM / oMLX / coding-agents)
 │   OpenAI client ─▶ openai-logger ─▶ LLM_BASE_URL │ tee /v1/chat/completions ─▶ (same dir)
 │
 └─ Source `local-llm` reads sessions/*.jsonl ─▶ Facts ─▶ HeroSnapshot ─▶ game + "Modele" tab
```

### Why two adapters, one format

The two backends differ **only in stream dialect**: Ollama speaks native NDJSON on
`/api/chat`; the OpenAI servers speak SSE on `/v1/chat/completions`. Both adapters normalize
to the **same JSONL transcript** (`type: session | message | usage | turn_complete`), so the
source, the registry integration, the sprite, the client labels and the tests are written
**once** and shared. Classic "shared data model, swappable adapters".

### Why a wrapper (A), not a persistent proxy (B)

`aoa local <model>` starts an **ephemeral** proxy bound to one terminal invocation, sets
`OLLAMA_HOST` only for the child process, and execs `ollama run`. One run = one proxy =
one transcript file = one hero. This eliminates the `fingerprint()` session-guessing hack
PR #2 needed for the stateless `/v1` case, and never mutates the user's global environment.

## Components

| # | Component | Status | Responsibility |
|---|-----------|--------|----------------|
| 1 | `shared/src/index.ts` — `AgentKind` | edit (1 line) | add `'local-llm'` to the union |
| 2 | `server/src/proxy/ollama-logger.ts` | **new** | transparent reverse-proxy of the whole Ollama API; tee `/api/chat` (+`/api/generate`) NDJSON → transcript; query `/api/show` once for context window |
| 3 | `server/src/proxy/openai-logger.ts` | **new** (restored from PR #2 `local-llm-proxy.ts`) | OpenAI `/v1/chat/completions` proxy → `LLM_BASE_URL`; tee SSE + non-stream → transcript |
| 4 | `server/src/sources/local-llm.ts` | **restored** from PR #2 | classify `sessions/<uuid>.jsonl`; `parseLine` (pure) → Facts |
| 5 | `server/src/sources/index.ts` | edit (1 line) | register `localLlmSource` in `ALL_SOURCES` |
| 6 | `server/src/cli.ts` + `cli-args.ts` | edit | subcommand dispatch: `local` (Adapter A), `local-proxy` (Adapter B); default = server |
| 7 | client: `unit.ts`, `ProjectSwitcher.tsx`, `SidePanel.tsx` | edit (small) | default sprite + "Local LLM" source label/icon |
| 8 | `shared/src/index.ts` — `DEFAULT_MODEL_CONFIG` | edit (optional) | starter SpriteRules for common local families (llama/qwen/mistral/gemma/phi/bielik/gpt-oss) |
| 9 | tests | **new** | NDJSON parser (Adapter A), SSE parser (Adapter B), `parseLine` source (pure) on real `lfm2.5-thinking` |

Each unit has a single purpose and a clear interface: the proxies expose
`start…Proxy(opts) → { url, port, close() }`; the source exposes the existing `AgentSource`
contract (`id`, `roots()`, `classify()`, `parseLine()`); `parseLine` is a pure function so
the bulk of behavior is unit-testable without sockets or a running Ollama.

## Transcript format (the shared contract)

One JSONL file per capture session at
`~/.age-of-agents/local-llm/sessions/<uuid>.jsonl`
(override: `LOCAL_LLM_SESSIONS_DIR`). One JSON object per line:

```jsonc
{ "type": "session",  "ts": "…", "cwd": "…", "model": "bielik-…", "backend": "ollama", "contextWindow": 8192 }
{ "type": "message",  "ts": "…", "role": "user|assistant|tool", "content": "…", "tool_calls": [ … ] }
{ "type": "usage",    "input": 412, "output": 188 }
{ "type": "turn_complete", "ts": "…" }
```

- `backend` and `contextWindow` are **additions** over PR #2's format (both optional, so old
  files still parse). `contextWindow` comes from Ollama `/api/show` (Adapter A) and lets the
  hero's context bar be correct before any WindowRule exists.
- `parseLine` maps records → Facts: `session → {kind:'meta', model, cwd}` (+ a `usage` fact
  carrying `contextWindow` when present); `message → prompt | assistant-text | tool-result`
  and one `tool-start` per `tool_calls[]`; `usage → usage-total`; `turn_complete → turn-end`.
- Tool names are canonicalized by `localLlmToolToCanonical` (e.g. `bash|shell|exec → Bash`,
  `read_file → Read`, dotted/`__` names → `mcp__…`), restored from PR #2.

## Model registry integration

Integration is **mostly automatic**: the source emits `{kind:'meta', model}`, which the
existing pipeline surfaces as `HeroSnapshot.model`. From there:

- The model appears in the **"Modele"** tab via `seen-models.ts` (`seenModelsByAgent`), where
  the user can attach a `SpriteRule` / `WindowRule` through `ModelRegistryEditor`.
- Until configured, `resolveModel` returns the registry fallback (`sprite:'sonnet',
  contextWindow:200_000`). Two improvements close that gap:
  1. **Context window from `/api/show`** (Adapter A): emitted via the `usage` fact's
     `contextWindow?` field, so the bar is right immediately (no WindowRule needed).
  2. **Starter SpriteRules** (component 8, optional): pattern rules for common local
     families so e.g. a `qwen…` model gets a distinct sprite out of the box. Added through
     `DEFAULT_MODEL_CONFIG` + `upgradeModelConfig`, so existing saved registries gain them
     without losing user rules.

No new registry API surface is required — we feed data into the existing two-axis resolver.

## CLI design

The current CLI is flag-only (`aoa [options]` → `startServer`). Add minimal subcommand
dispatch in `cli.ts`: if `argv[0]` is a known subcommand, route to it; otherwise behave
exactly as today (start the server).

```
aoa                      # unchanged: start the visualization server
aoa local <model> [args] # Adapter A: ephemeral Ollama proxy + exec `ollama run <model> …`
aoa local-proxy          # Adapter B: long-lived OpenAI /v1 proxy on a printed URL
                         #   reads LLM_BASE_URL (default Ollama), LLM_MODEL, LLM_API_KEY
```

`aoa local`:
1. `startOllamaLoggerProxy()` → ephemeral port, forwards to real `OLLAMA_HOST`
   (default `127.0.0.1:11434`).
2. `spawn('ollama', ['run', model, ...args], { stdio: 'inherit', env: { …, OLLAMA_HOST } })`
   so the REPL works normally in the user's terminal.
3. On child exit, `await proxy.close()` and exit with the child's code.

`aoa local-proxy` prints the proxy URL (e.g. `http://127.0.0.1:PORT/v1`) for the user to set
as their coding-agent's base URL, and stays up until Ctrl+C.

## Data flow (Adapter A, end to end)

```
user: aoa local bielik-11b
  → proxy listens :PORT, queries Ollama /api/show → contextWindow
  → writes {type:session, model, backend:'ollama', contextWindow}
  → exec ollama run bielik-11b   (OLLAMA_HOST=127.0.0.1:PORT)
  → each REPL turn: POST /api/chat (stream NDJSON)
       proxy forwards verbatim to :11434, tees each line:
         user message → {type:message, role:user}
         assistant deltas accumulate → {type:message, role:assistant}
         final line (done:true, eval counts) → {type:usage}, {type:turn_complete}
  → user exits REPL → proxy.close()
aoa server: watcher sees sessions/<uuid>.jsonl
  → localLlmSource.parseLine → Facts → HeroSnapshot{ kind:'local-llm', model, context… }
  → hero on the battlefield + entry in "Modele"
```

## Error handling

- **Backend unreachable:** Adapter A forwards the upstream error verbatim (the user sees
  Ollama's own message); Adapter B returns `502` with the unreachable `LLM_BASE_URL`
  (restored PR #2 behavior). Transcript still has the `session` line, so a stub hero appears.
- **`ollama` not on PATH (Adapter A):** `spawn` `error` event → print a clear hint
  (`install Ollama / ensure 'ollama' is on PATH`) and exit non-zero; do not crash the proxy.
- **Malformed / partial NDJSON or SSE frame:** parser ignores the unparseable frame and
  continues (frames split across chunks complete on the next chunk), mirroring PR #2.
- **Malformed transcript line:** `parseLine` returns `[]` for unparseable JSON — never throws,
  consistent with sibling sources.
- **Proxy crash:** isolated to the wrapper process; the visualization server is untouched.

## Testing

- `ollama-logger`: feed a recorded NDJSON `/api/chat` stream (incl. a tool call and the final
  `done:true` line) → assert the written JSONL lines.
- `openai-logger`: feed a recorded SSE stream + a non-stream completion → assert JSONL.
- `local-llm` source: golden-file `parseLine` over a representative transcript → assert Facts
  (meta/model, prompt, assistant-text, tool-start canonicalization, usage-total, turn-end).
- One integration smoke test (skipped if no Ollama): `aoa local lfm2.5-thinking` with a piped
  prompt, assert a `sessions/<uuid>.jsonl` is produced and parses.

## Phasing

- **Phase 1 — Ollama wrapper (the real workflow):** components 1, 2, 4, 5, 6 (`local`), 7, 9.
  End state: `aoa local <model>` produces a hero; model shows in "Modele".
- **Phase 2 — OpenAI proxy (other 3 backends):** components 3, 6 (`local-proxy`), 8, plus
  README docs of the four backends' base URLs. Same transcript, same source — additive.

Both phases ship together (user decision), but the plan sequences them so Phase 1 is
independently testable before Phase 2 is wired.

## Open questions / risks

- **`ollama run` REPL protocol:** modern `ollama run` uses `/api/chat`; the proxy must
  transparently pass through *all* other endpoints (`/api/tags`, `/api/show`, `/api/version`,
  `/api/generate`) so the CLI behaves identically. Verify against the installed
  `ollama` 0.30.8 during implementation.
- **Client/server version skew** (`ollama` client 0.14.3 vs server 0.30.8) is the user's
  existing setup; the proxy is a passthrough, so it should be unaffected — confirm in the
  smoke test.
- **Starter SpriteRules (component 8)** are cosmetic; if scope tightens, drop them — the
  fallback sprite still works.
