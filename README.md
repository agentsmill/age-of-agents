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
![Themes](https://img.shields.io/badge/themes-3-b14bff)

[**▶ Live site**](https://agentsmill.github.io/age-of-agents/) · [What this fork adds](#-what-this-fork-adds) · [Quick start](#-quick-start) · [How it works](#-how-it-works) · [Architecture](#-architecture)

<img src="docs/screenshots/citadel-fantasy.png" alt="Age of Agents — peaceful fantasy realm" width="820">

</div>

> [!NOTE]
> **This is a fork** of [`agentsmill/age-of-agents`](https://github.com/agentsmill/age-of-agents) by Mateusz Pawelczuk, with **nine new features** and a **third art theme** (Cyberpunk). Everything below the [What this fork adds](#-what-this-fork-adds) section is upstream behaviour; that section is what's new here. All additions keep the project's local-only, read-only, privacy-first ethos.

---

## ✨ What is this?

Age of Agents (npm package **`age-of-agents`**) runs as a small local web app
alongside your normal CLI workflow. It watches your agent session transcripts and
renders them as a calm, real-time strategy realm:

- **Each session → a settler.** Start a Claude Code, Codex, OpenCode or Koda session and a settler walks out of the keep, carrying your prompt as its task.
- **Tools → workshops.** The settler heads to the building that matches the work — the forge for code edits, the mage tower for web research, the mine for the terminal.
- **Subagents → workers.** When a session spawns subagents (e.g. the Task tool), they appear as little workers around their settler.
- **Tokens → harvest.** Tokens read and produced fill the storehouse. Settlers ponder while thinking, rest when waiting, and stroll home when the day's work is done.
- **Three worlds.** Switch between a **fantasy** (top-down), a **sci-fi** (isometric) and a **cyberpunk** (isometric neon) realm on the fly.
- **Many projects → cities.** Each project becomes a city you can switch between; open one for an optional peek at [Beads](https://github.com/steveyegge/beads) tasks and a [Graphify](https://github.com/safishamsi/graphify) code map (see [Project intel](#-project-intel-optional)).

A glanceable, second-monitor view of what your agents are quietly up to.

## 🆕 What this fork adds

### Nine new features

Everything here is **local-first** and reads your sessions only — nothing leaves `127.0.0.1`.

| # | Feature | What it does |
| --- | --- | --- |
| 1 | **🌗 Realm Heartbeat** | The whole realm breathes with a day/night tint driven by token **rate**, not the clock — it dims to a cool night when idle and warms to noon under heavy output. |
| 2 | **👣 Tool Trail** | Settlers leave fading, team-colored footprints as they walk between workshops, so you can see traffic across the realm. |
| 3 | **💥 Mission Thunderclap** | When a mission/task completes, expanding shockwave rings and fireworks burst over the settler that finished it. |
| 4 | **🧾 Session Autopsy** | A per-session cost ledger. When a session ends it's appended to `~/.age-of-agents/session-log.json` (the app's *only* on-disk write — it never touches your transcripts). The **Session log** panel shows each run with a per-building cost split. |
| 5 | **⚠️ Context Pressure Alarm** | A settler gets an amber pulsing ring and a toast the moment its session crosses ~80% of that model's context window — spot a session about to run out of room before it does. |
| 6 | **📊 Tool Streak Heatmap** | The **Daily rhythm** panel: an SVG grid of output tokens by hour-of-day × building, so you can see *when* and *where* your agents do their heaviest work. |
| 7 | **🎞️ Chronicle** | Replay your day as a time-lapse. A scrubber/play/speed control re-feeds the day's JSONL back through the state machine into an isolated world and renders it forward — watch the realm light up and the day/night arc swing. |
| 8 | **🔊 The Realm Has a Pulse** | A generative ambient soundscape (Web Audio) where each building has its own voice that swells with activity. Off by default; toggle it in Settings. |
| 9 | **🛡️ Living Banners** | A procedural, per-project coat-of-arms hangs over the citadel (deterministic from the project's tool arsenal), plus a one-click **Realm Card** PNG export to share your realm. |

### 🌃 The Cyberpunk theme

A third art set beyond Fantasy and Sci-Fi: an **isometric, neon-glass, synthwave fever dream** — and it's **fully procedural** (no image assets, no downloads). Switch to it with the 🌃 button.

- **Real building primitives, varied heights.** Not a parking lot of cubes — the skyline is built from **cubes, pyramids, floating wireframe spheres, ringed cylinders, tapering spires and stepped ziggurats**, each with its own height band so the city has an actual silhouette.
- **Glowing, flowing light.** Animated "data packets" stream along the road network, road traces glow with multi-pass bloom, and every structure carries window-light grids, an apex beacon and a soft ground-glow.
- **OLED-black night + Matrix rain.** Pure-black void with a crisp (DPR-aware) digital-rain backdrop whose columns fall in the **realm's own building colors**, so the rain matches the city.

<!-- Hero shot for this theme: drop a capture at docs/screenshots/citadel-cyberpunk.png to feature it here. -->

## 🖼️ Gallery

| Fantasy | Sci-Fi |
| --- | --- |
| <img src="docs/screenshots/citadel-fantasy.png" alt="Fantasy realm" width="400"> | <img src="docs/screenshots/citadel-scifi.png" alt="Sci-fi colony" width="400"> |

**Session detail** — click a settler to inspect its task, token economy and live activity:

<div align="center">
<img src="docs/screenshots/citadel-session-panel.png" alt="Session detail panel" width="720">
</div>

## 🚀 Quick start

**Install — `npm i -g`.** Install it globally for the short `aoa` command; update with `npm update -g age-of-agents` when new versions ship:

```bash
npm i -g age-of-agents
aoa            # watches ~/.claude, ~/.codex, ~/.opencode & ~/.koda sessions (+ Claude in local Docker), prints the URL
aoa --demo     # calm demo mode (fake sessions)
aoa --open     # also open the browser
```

> The server binds to `127.0.0.1` only and never writes your transcripts anywhere — it just reads them locally and broadcasts game state over a local WebSocket. See [Privacy](#-privacy).

### From source (this fork)

```bash
git clone https://github.com/doctorgonzo/age-of-agents
cd age-of-agents && npm install
npm run demo     # server (demo) + client (Vite) → http://localhost:5173
npm run dev      # visualize your real sessions
```

Then open the realm, hit the 🌃 button, and watch your actual sessions render in neon.

## 🧭 How it works

```
agent session transcript ──▶ server (watcher + state machine) ──▶ WebSocket ──▶ client (PixiJS realm + HUD)
```

- The **server** tails JSONL transcripts, turns each line into a `Fact`, and runs a small per-session **state machine** (thinking / working / resting / idle / returning).
- It broadcasts a `HeroSnapshot` for every session over a WebSocket. The snapshot carries *what* the session is doing (`currentTool`, recent actions, tokens) — never raw coordinates.
- The **client** decides *where* each settler goes and renders the pixel-art realm, the HUD, the minimap and the side panel.
- **Running agents in Docker?** Local containers are auto-discovered (zero-config) and their Claude sessions read straight out of the container via `docker exec` — no image changes, no host bind-mounts required. Containerized settlers carry a 🐳 badge in the side panel. Disable with `AGENTCRAFT_DOCKER=0`.

The fork's features layer onto this without changing the contract: the **Chronicle** replays the same JSONL through the same state machine into an isolated world; the **Cyberpunk** theme is a pure client-side renderer that falls back to procedural drawing when a theme ships no assets; the **Session log** is the only feature that writes to disk, and only to its own file.

## 🏛️ Project intel (optional)

Run several projects at once and each becomes its own **city** in the top bar — switch between them, or pick **All** to see every settler together. A city shows how many agents are active and which kind (Claude, Codex, OpenCode, Koda).

Select a city to open the **Architect's Hall**, a side panel that surfaces two optional, third-party signals about that project — read-only and entirely opt-in:

- **📜 Beads** — open tasks from [Beads](https://github.com/steveyegge/beads), an AI-native issue tracker that lives in your repo. Age of Agents reads `.beads/issues.jsonl` (falling back to `bd list --json`). Turn it on in a project with `bd init`.
- **🌳 Graph** — a code knowledge graph: symbol, edge and community counts plus the most-connected "god-nodes". Age of Agents reads `graphify-out/graph.json`. Generate it with the **bundled, dependency-free generator** — run `npm run graphify` in a project (or `node scripts/graphify.mjs <dir>`) to scan relative imports and write `graphify-out/graph.json`. You can also use the external [Graphify](https://github.com/safishamsi/graphify) tool; the schema is the same.

Neither tool is bundled or required. If a project has no `.beads/` or `graphify-out/`, the panel just reads "not initialized"; it polls every few seconds, so intel appears as soon as the files do.

## 🎨 Themes

Three art sets, switchable from the top bar:

- **Fantasy** — top-down: keep, mage tower, library, guild, market, mine, orchard & ponds.
- **Sci-Fi** — isometric: command center, hangars, drone factory, ore refinery, research lab on a calm Martian colony.
- **Cyberpunk** *(new in this fork)* — isometric neon synthwave, **fully procedural** (no assets): The Mainframe, Uplink, Fabricator, Daemon Pit and more, as glowing glass primitives over an OLED-black grid with a color-matched Matrix-rain sky. See [The Cyberpunk theme](#-the-cyberpunk-theme).

## 🧱 Architecture

A small npm-workspaces monorepo, published as the single `age-of-agents` CLI:

| Package | Stack | Responsibility |
| --- | --- | --- |
| `packages/shared` | TypeScript | WebSocket protocol types (`GameEvent`, snapshots) |
| `packages/server` | Node + Fastify + `ws` + SQLite | transcript watcher, state machine, hooks endpoint, demo generator, CLI |
| `packages/client` | Vite + React 19 + PixiJS v8 | the game realm, HUD, minimap, side panel |

Notable client modules added in this fork: `game/matrix-rain.ts` (procedural digital-rain backdrop), the neon-shape renderer in `game/placeholders.ts`, `theme/cyberpunk.ts`, and the Chronicle / Session-log / Heatmap HUD panels.

```bash
npm test      # unit tests (server + client)
npm run build # production client + bundled CLI (dist/cli.js)
```

## 🔒 Privacy

- The server listens on `127.0.0.1` only — nothing is exposed to your network.
- Transcripts are read **locally and read-only**; their contents are never written to disk by Age of Agents or sent anywhere.
- The only file the app writes is the optional **Session log** (`~/.age-of-agents/session-log.json`) — a cost ledger derived from session metadata, never transcript contents.
- Installing the optional Claude Code hooks modifies `~/.claude/settings.json` (a fast event channel). Demo mode touches nothing of yours.
- **Optional interactive mode (off by default).** You can let the panel answer Claude Code permission prompts and plan approvals via the local hooks. It stays `127.0.0.1`-only; with the mode off, Age of Agents remains a passive read-only observer. When on, an unanswered prompt (timeout or app closed) always falls back to the terminal — the app never auto-allows. "Always allow" rules live in `~/.age-of-agents/permission-policy.json`; the app never edits the permission rules in `~/.claude/settings.json`.
- **Optional: launch agents from the app (BETA — [setup guide](docs/launch-agent.md)).** With the Claude Agent SDK installed (`npm i @anthropic-ai/claude-agent-sdk`), a **🚀 Launch agent** button lets you start a Claude Code session from the panel — pick a folder, type a prompt, choose a permission mode. These app-owned sessions are real Claude Code runs (they use your account and tokens) and you answer their permission prompts, plan approvals and multiple-choice questions (a centered "agent question" modal) directly in the panel. The SDK is an optional dependency; without it the button is hidden and nothing changes.
  - **Auth for launching:** the Agent SDK authenticates from environment variables only — it does **not** read your interactive Claude Code login. To use your subscription, generate a long-lived token once with `claude setup-token`, then start the app from a shell where `CLAUDE_CODE_OAUTH_TOKEN` is set (and `ANTHROPIC_API_KEY` is unset, or it takes precedence). Without it, launches fail with `401 Invalid authentication credentials`; the launch dialog warns when no auth is present.

## 🛡️ Security

The server binds to `127.0.0.1` only and is built for local use. It defends against the realistic threat — a malicious web page in your browser (a "drive-by" that scripts `localhost`) — with two layers:

- **Origin allowlist.** WebSocket and state-changing HTTP requests from a non-local origin are rejected (`403`). A cross-origin page always sends an `Origin` header, so it cannot connect or post.
- **Session token.** A per-machine token in `~/.age-of-agents/session-token` (`0600`) is required for the WebSocket handshake and for sensitive endpoints (launch/stop/message, hook install/uninstall, config writes, `/fs/list`). The app fetches it from `/session-token`, which is only served to allowlisted origins. Installed hooks and local tools keep working with no setup — the token is auto-created on first run.

`/fs/list` (the folder picker) is confined to your home directory. The server refuses to bind to a non-loopback host unless you explicitly set `AOA_ALLOW_REMOTE=1`.

**Honest boundaries:** loopback is not isolated per user, so this does not fully protect against another user on a shared machine, and a process running as you can read the token file. Those are out of scope for a local-first tool.

## 🎭 Assets

All pixel-art assets in `packages/client/public/assets/` were **generated by the original author with [PixelLab](https://pixellab.ai)** and are the author's own work — released under the same MIT license as the code. Without any assets the game still runs on procedurally generated placeholders, and the **Cyberpunk** theme is procedural by design — it ships no assets at all.

`assets-manifest.json` + `scripts/download-assets.mjs` are an **optional** helper for swapping in alternative third-party packs locally; those packs are never committed (some forbid redistribution) and are not needed to run the game.

## 🤝 Contributing

Issues and PRs are welcome. To get going: `npm install`, then `npm run demo` to see the realm, and `npm test` before opening a PR.

## 📜 License

[MIT](LICENSE) © Mateusz Pawelczuk (original project). Fork features © their contributors, same MIT license. Art assets generated with PixelLab, redistributed under MIT per PixelLab's Terms of Service.

## 🙏 Acknowledgements

A fork of [Age of Agents](https://github.com/agentsmill/age-of-agents) by Mateusz Pawelczuk. Inspired by [AgentCraft](https://www.getagentcraft.com). Built with [PixiJS](https://pixijs.com), [React](https://react.dev), [Fastify](https://fastify.dev) and [PixelLab](https://pixellab.ai).
