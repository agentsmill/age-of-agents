<div align="center">

# 🏰 Age of Agents

**Watch your AI coding sessions grow a peaceful pixel-art realm.**

Every Claude Code, Codex, OpenCode or Koda session becomes a settler walking out of the keep.
The tool it runs decides which workshop it visits, subagents become workers,
and tokens fill the storehouse — a calm, Age-of-Empires-style kingdom of your work.
No combat, just a quiet realm you can watch at a glance.

[![npm version](https://img.shields.io/npm/v/age-of-agents?color=6e9b46&label=npm&logo=npm)](https://www.npmjs.com/package/age-of-agents)
[![License: MIT](https://img.shields.io/badge/License-MIT-e0b64a.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)
![PixiJS](https://img.shields.io/badge/PixiJS-v8-e91e63)

[**▶ Live site**](https://agentsmill.github.io/age-of-agents/) · [Quick start](#-quick-start) · [How it works](#-how-it-works) · [Architecture](#-architecture)

<img src="docs/screenshots/citadel-fantasy.png" alt="Age of Agents — peaceful fantasy realm" width="820">

</div>

---

## ✨ What is this?

Age of Agents (npm package **`age-of-agents`**) runs as a small local web app
alongside your normal CLI workflow. It watches your agent session transcripts and
renders them as a calm, real-time strategy realm:

- **Each session → a settler.** Start a Claude Code, Codex, OpenCode or Koda session and a settler walks out of the keep, carrying your prompt as its task.
- **Tools → workshops.** The settler heads to the building that matches the work — the forge for code edits, the mage tower for web research, the mine for the terminal.
- **Subagents → workers.** When a session spawns subagents (e.g. the Task tool), they appear as little workers around their settler.
- **Tokens → harvest.** Tokens read and produced fill the storehouse. Settlers ponder while thinking, rest when waiting, and stroll home when the day's work is done.
- **Two worlds.** Switch between a **fantasy** (top-down) and a **sci-fi** (isometric) realm on the fly.
- **Many projects → cities.** Each project becomes a city you can switch between; open one for an optional peek at [Beads](https://github.com/steveyegge/beads) tasks and a [Graphify](https://github.com/safishamsi/graphify) code map (see [Project intel](#-project-intel-optional)).

A glanceable, second-monitor view of what your agents are quietly up to.

## 🖼️ Gallery

| Fantasy | Sci-Fi |
| --- | --- |
| <img src="docs/screenshots/citadel-fantasy.png" alt="Fantasy realm" width="400"> | <img src="docs/screenshots/citadel-scifi.png" alt="Sci-fi colony" width="400"> |

**Session detail** — click a settler to inspect its task, token economy and live activity:

<div align="center">
<img src="docs/screenshots/citadel-session-panel.png" alt="Session detail panel" width="720">
</div>

## 🚀 Quick start

**Quick run — `npx`.** No install, and it always fetches the latest release (handy since new versions ship often):

```bash
npx age-of-agents          # watches ~/.claude, ~/.codex, ~/.opencode & ~/.koda sessions (+ Claude in local Docker containers), prints the URL
npx age-of-agents --demo   # calm demo mode (fake sessions)
npx age-of-agents --open   # also open the browser
```

**Regular use — `npm i -g`.** Install it globally for a faster start and the short `aoa` command. You own the updates here, so run `npm update -g age-of-agents` now and then:

```bash
npm i -g age-of-agents
aoa --open
```

> The server binds to `127.0.0.1` only and never writes your transcripts anywhere — it just reads them locally and broadcasts game state over a local WebSocket. See [Privacy](#-privacy).

### From source

```bash
git clone https://github.com/agentsmill/age-of-agents
cd age-of-agents && npm install
npm run demo     # server (demo) + client (Vite) → http://localhost:5173
npm run dev      # visualize your real sessions
```

## 🧭 How it works

```
agent session transcript ──▶ server (watcher + state machine) ──▶ WebSocket ──▶ client (PixiJS realm + HUD)
```

- The **server** tails JSONL transcripts, turns each line into a `Fact`, and runs a small per-session **state machine** (thinking / working / resting / idle / returning).
- It broadcasts a `HeroSnapshot` for every session over a WebSocket. The snapshot carries *what* the session is doing (`currentTool`, recent actions, tokens) — never raw coordinates.
- The **client** decides *where* each settler goes and renders the pixel-art realm, the HUD, the minimap and the side panel.
- **Running agents in Docker?** Local containers are auto-discovered (zero-config) and their Claude sessions read straight out of the container via `docker exec` — no image changes, no host bind-mounts required. Containerized settlers carry a 🐳 badge in the side panel. Disable with `AGENTCRAFT_DOCKER=0`.

## 🏛️ Project intel (optional)

Run several projects at once and each becomes its own **city** in the top bar — switch between them, or pick **All** to see every settler together. A city shows how many agents are active and which kind (Claude, Codex, OpenCode, Koda).

Select a city to open the **Architect's Hall**, a side panel that surfaces two optional, third-party signals about that project — read-only and entirely opt-in:

- **📜 Beads** — open tasks from [Beads](https://github.com/steveyegge/beads), an AI-native issue tracker that lives in your repo. Age of Agents reads `.beads/issues.jsonl` (falling back to `bd list --json`). Turn it on in a project with `bd init`.
- **🌳 Graph** — a code knowledge graph: symbol, edge and community counts plus the most-connected "god-nodes". Age of Agents reads `graphify-out/graph.json`. Generate it with the **bundled, dependency-free generator** — run `npm run graphify` in a project (or `node scripts/graphify.mjs <dir>`) to scan relative imports and write `graphify-out/graph.json`. You can also use the external [Graphify](https://github.com/safishamsi/graphify) tool; the schema is the same.

Neither tool is bundled or required. If a project has no `.beads/` or `graphify-out/`, the panel just reads "not initialized"; it polls every few seconds, so intel appears as soon as the files do.

## 🎨 Themes

Two full art sets, switchable from the top bar:

- **Fantasy** — top-down: keep, mage tower, library, guild, market, mine, orchard & ponds.
- **Sci-Fi** — isometric: command center, hangars, drone factory, ore refinery, research lab on a calm Martian colony.

## 🧱 Architecture

A small npm-workspaces monorepo, published as the single `age-of-agents` CLI:

| Package | Stack | Responsibility |
| --- | --- | --- |
| `packages/shared` | TypeScript | WebSocket protocol types (`GameEvent`, snapshots) |
| `packages/server` | Node + Fastify + `ws` + SQLite | transcript watcher, state machine, hooks endpoint, demo generator, CLI |
| `packages/client` | Vite + React 19 + PixiJS v8 | the game realm, HUD, minimap, side panel |

```bash
npm test      # unit tests (server + client)
npm run build # production client + bundled CLI (dist/cli.js)
```

## 🔒 Privacy

- The server listens on `127.0.0.1` only — nothing is exposed to your network.
- Transcripts are read **locally and read-only**; their contents are never written to disk by Age of Agents or sent anywhere.
- Installing the optional Claude Code hooks modifies `~/.claude/settings.json` (a fast event channel). Demo mode touches nothing of yours.

## 🎭 Assets

All pixel-art assets in `packages/client/public/assets/` were **generated by the author with [PixelLab](https://pixellab.ai)** and are the author's own work — released here under the same MIT license as the code. Without any assets the game still runs on procedurally generated placeholders.

`assets-manifest.json` + `scripts/download-assets.mjs` are an **optional** helper for swapping in alternative third-party packs locally; those packs are never committed (some forbid redistribution) and are not needed to run the game.

## 🤝 Contributing

Issues and PRs are welcome. To get going: `npm install`, then `npm run demo` to see the realm, and `npm test` before opening a PR.

## 📜 License

[MIT](LICENSE) © Mateusz Pawelczuk. Art assets generated with PixelLab, redistributed under MIT per PixelLab's Terms of Service.

## 🙏 Acknowledgements

Inspired by [AgentCraft](https://www.getagentcraft.com). Built with [PixiJS](https://pixijs.com), [React](https://react.dev), [Fastify](https://fastify.dev) and [PixelLab](https://pixellab.ai).
