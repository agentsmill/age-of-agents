# 🚀 Launch agent (BETA)

Launch a real Claude Code session from inside Age of Agents — pick a folder, type a
prompt, and answer the agent's permission prompts, plan approvals and multiple‑choice
questions directly in the panel.

> **BETA.** This runs a **real** Claude Code session on your account and consumes
> tokens. It needs a one‑time auth setup (below). If you don't set it up, launches
> fail with `401 Invalid authentication credentials` and the launch dialog warns you.

## 1. Install the SDK (optional dependency)

```bash
npm i @anthropic-ai/claude-agent-sdk
```

Without it, the **🚀 Launch agent** button stays hidden and nothing else changes.

## 2. Authenticate (one time)

The Agent SDK does **not** read your interactive Claude Code login (macOS Keychain /
`~/.claude/.credentials.json`). It authenticates **only from environment variables**.
To use your Claude subscription (Pro/Max):

```bash
# Opens your browser, prints a long‑lived OAuth token bound to your subscription
claude setup-token
```

Then start the app from a shell where the token is set:

```bash
export CLAUDE_CODE_OAUTH_TOKEN=<token-from-setup-token>
unset ANTHROPIC_API_KEY      # if set, it takes precedence and would bill the API instead
aoa                          # (npm i -g age-of-agents) — or npm run dev from source
```

- Usage is billed against your **subscription** (same pool as interactive Claude Code)
  when authenticated with `CLAUDE_CODE_OAUTH_TOKEN`.
- If you'd rather use the metered API, set `ANTHROPIC_API_KEY` instead.

## 3. Launch

Click **🚀 Launch agent (BETA)**, choose a working folder, write a prompt, pick a
permission mode, and launch. The session appears as a settler; answer its prompts in
the panel (and `AskUserQuestion` in a centered modal).

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Button not shown | SDK not installed → `npm i @anthropic-ai/claude-agent-sdk` |
| `401 Invalid authentication credentials` | No token in the app's environment → run `claude setup-token`, `export CLAUDE_CODE_OAUTH_TOKEN=…`, restart the app from that shell |
| Launches bill the API, not the subscription | `ANTHROPIC_API_KEY` is set and takes precedence → `unset ANTHROPIC_API_KEY` |
