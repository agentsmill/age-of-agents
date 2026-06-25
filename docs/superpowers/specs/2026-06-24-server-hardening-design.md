# Server Security Hardening — Design

Date: 2026-06-24
Status: Approved (brainstorming → implementation)

## Background

A security review of the Age of Agents local server flagged four real issues,
all verified against the source:

1. **WebSocket has no Origin/auth check** (`server.ts` — `WebSocketServer` without
   `verifyClient`; snapshot is sent immediately on connect). Any web page in the
   user's browser can open `ws://127.0.0.1:8123/ws` cross-origin and read the full
   session activity (transcripts, tool names, project dirs, statuses).
2. **No CSRF/auth on state-changing endpoints** — `POST /hooks/install` and
   `/hooks/uninstall` take no body and no auth, so a drive-by "simple request"
   POST from a malicious page succeeds (no preflight is triggered).
3. **No auth on the agent-management API** — `/sessions/launch`, `/sessions/:id/message`,
   `/sessions/:id/stop` accept any caller. (`authConfigured()` only checks whether
   the SDK has an Anthropic credential; it is not request authorization.)
4. **`/fs/list` lists arbitrary absolute paths** — no restriction to a workspace.

`npm audit --omit=dev` is clean (0 vulnerabilities) and there is no command-injection
path (`spawn`/`execFile` use argv arrays, no `shell: true` with user input). Those
positive findings are confirmed and unchanged by this work.

The server binds to `127.0.0.1` only (`startServer` defaults host to loopback and the
CLI never passes `host`). So the server is **not** exposed to the LAN/internet. The
real attack surface is (a) a malicious web page in the user's browser (drive-by), and
(b) another local process/user on the same machine.

## Threat model and protection boundaries

Loopback is **not** per-user isolated: any local client can reach `127.0.0.1:8123`.
This bounds what is achievable. We state the boundaries explicitly rather than imply
stronger guarantees than exist.

| Threat | After hardening |
| --- | --- |
| Drive-by from a malicious web page (primary) | Fully blocked — Origin allowlist (WS + HTTP) plus a token in a custom header that forces a CORS preflight. |
| Another user on a shared machine | Raised bar — token lives in a `0600` file, so tools reading the file are gated; but `/session-token` is reachable locally and a non-browser client can spoof `Origin`. Full protection is not achievable without dropping the browser SPA. Documented, not hidden. |
| A process running as the user | Intentionally not defended — it can read `~/.claude` and the token file. Defending here is an illusion. |

The token's real value: a **second lock against drive-by** (custom header → preflight)
and a **barrier for another local user** (file is `0600`). It is not a substitute for
the Origin check, which is the primary anti-drive-by layer.

## Goals

- Block drive-by browser attacks against WS and all state-changing/sensitive HTTP endpoints.
- Add a session token (persisted, `0600`) required for sensitive endpoints and the WS handshake.
- Restrict `/fs/list` to the home subtree.
- Refuse non-loopback binding unless explicitly opted in.
- Regression tests covering each of the above.
- **No migration:** existing installed Claude hooks must keep working without reinstall.

## Non-goals

- Defending against a process running as the same user.
- Full multi-user isolation on a shared host (documented as out of reach here).
- Unix-domain socket / mTLS transport (overkill for a local-first human tool; would
  break `curl` and the hook shim).
- TLS for loopback traffic.

## Architecture — three small, testable modules

New directory `packages/server/src/security/`:

### `origin.ts`
Pure function `isAllowedOrigin(origin: string | undefined, port: number): boolean`.
Allowlist = loopback hosts (`localhost`, `127.0.0.1`) on the server port plus the dev
Vite ports (`5173`, `4173`). `undefined`/missing origin returns `true`: non-browser
callers (hook shim, curl) send no Origin, and browsers also omit it on same-origin GETs.
A cross-origin browser request always carries `Origin`, so the rule that blocks drive-by
is simply **present-and-not-allowlisted → false**. One rule, no special cases. No
dependencies → unit-testable with a case table.

### `token.ts`
- `tokenFilePath(): string` → `~/.age-of-agents/session-token`.
- `loadOrCreateToken(path?): Promise<string>` — read the file; if missing, generate
  `randomBytes(32).toString('hex')` and write atomically (`tmp` + `rename`, then
  `chmod 0600`), mirroring `mapping-config.ts`. Token is **stable across restarts**,
  so hooks and `aoa local` keep working without reinstall.
- `timingSafeEqualStr(a, b): boolean` — constant-time compare for the header check.

### `guard.ts`
- `registerSecurityGuard(app, { port, token, sensitivePaths })` — a global Fastify
  `onRequest` hook that:
  1. rejects with `403` when `Origin` is present and not allowlisted;
  2. rejects with `401` when the route is sensitive and `x-aoa-token` is missing/wrong.
- `verifyWsClient({ origin, token }, port, expected)` — helper used by
  `WebSocketServer({ verifyClient })`: requires an allowlisted origin AND a matching
  `token` query param.

## Endpoint classification

| Class | Endpoints | Origin | Token |
| --- | --- | --- | --- |
| Public | `GET /health`, static SPA assets, `index.html` | pass missing-origin | no |
| Secret issuance | `GET /session-token` | allowlist (reject present non-allowlisted) | no (it issues the token) |
| Hook channel | `POST /hooks`, `POST /hooks/decide` | allowlist/missing | **no** (shim calls them with no Origin — zero hook changes) |
| Sensitive / mutating | `POST /sessions/launch`·`/:id/message`·`/:id/stop`, `POST /hooks/install`·`/uninstall`, `PUT /tool-mapping`·`/model-config`·`/permission-policy`, `GET /fs/list` | allowlist | **yes** |
| WebSocket `/ws` | handshake | allowlist | **yes** (`?token=`) |

Rationale for keeping `/hooks` and `/hooks/decide` token-free: the `node -e` hook shim
calls them with no `Origin` (passes layer 1) and does not carry a token. The dangerous
`/hooks/install`·`/uninstall` are called only by the SPA panel, so they require the
token and the shim never touches them. Result: **no settings.json migration**.

`GET /session-token` needs no token but relies on the Origin layer: a drive-by page
fetching it cross-origin always sends `Origin: https://evil.com` → `403`, while the
same-origin SPA sends no Origin on a GET and passes. A local non-browser client can
still obtain it — that is the documented shared-machine boundary, not a regression.

## Client flow (SPA)

1. On boot: `GET /session-token` (same-origin → allowed) → keep token in memory.
2. WS: `new WebSocket(.../ws?token=…)`.
3. Mutating `fetch`: a thin `api.ts` wrapper adds `x-aoa-token`. Update the ~8
   mutating call sites in `sessions.ts`, `HooksPanel`, `mapping-store`, `model-store`,
   `PanelControlToggle`. Read-only GETs are unchanged.

`api.ts` lazily fetches the token once and caches it; the WS connector awaits it before
opening the socket.

## `/fs/list` whitelist

Resolve `dir`, then require it to be within `homedir()` (the folder picker only needs
to browse under home to choose a project). Anything outside → `400`. Defense-in-depth
on top of token + Origin. Use path containment that resolves `..` (normalize + prefix
check on the resolved real path) so traversal cannot escape.

## Non-loopback binding safeguard

In `startServer`: if `host` is not a loopback address (`127.0.0.1`, `::1`, `localhost`),
refuse to start unless `AOA_ALLOW_REMOTE=1` is set, in which case log a loud `WARN`.
There is no `--host` flag today; this is a cheap safeguard for future flags or manual edits.

## Tests (`packages/server/test/`)

- Drive-by: `Origin: https://evil.com` on a POST → `403`.
- Missing token on `/sessions/launch` → `401`; correct token → proceeds (or `501`/`400`
  on its own merits, not `401`).
- WS with bad Origin → rejected (no `snapshot` received); WS with no token → rejected.
- `/fs/list?dir=/etc` → `400`; `dir` within home → OK.
- Missing-origin (hook simulation) on `/hooks` → passes.
- Unit: `isAllowedOrigin` case table (loopback variants, dev ports, evil origin, missing).
- Unit: `loadOrCreateToken` creates a `0600` file and is stable on second load.

## Rollout

Work on branch `harden-server-security`; land on `main` (no PR, per project shipping
style) after `npm test` and `npm run build` pass. Bump version and document in README's
security section. No user action required (hooks unchanged; token auto-created on first run).
