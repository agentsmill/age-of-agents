# Server Security Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop browser drive-by attacks and unauthorized local callers against the Age of Agents server by adding an Origin allowlist and a session token, plus an `/fs/list` whitelist and a non-loopback bind safeguard.

**Architecture:** Three small pure-ish modules under `packages/server/src/security/` (`origin.ts`, `token.ts`, `guard.ts`). A global Fastify `onRequest` hook rejects non-allowlisted Origins (403) and missing/invalid tokens on sensitive routes (401). The WebSocket server gains a `verifyClient`. The client fetches the token once from `GET /session-token` and attaches it to mutating calls and the WS query.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Fastify 5, `ws` 8, Vitest 3, Node `node:crypto`/`node:fs`.

## Global Constraints

- ESM only; import local modules with `.js` extension (e.g. `./origin.js`).
- Code comments and developer-facing text in English (project convention, PR #8).
- Node `>=22`.
- Tests use Vitest; route tests build `Fastify()` + `registerXxxRoutes` + `app.inject`; full-server tests use `startServer({ port: 0, ... })` + real `fetch`/`ws`.
- Token file path: `~/.age-of-agents/session-token`, atomic write (`tmp` + `rename`), mode `0600`. Mirror the pattern in `packages/server/src/mapping-config.ts`.
- No settings.json migration: the hook shim and `/hooks`, `/hooks/decide` stay token-free.
- Origin allowlist = loopback hosts (`localhost`, `127.0.0.1`) on the server port plus dev Vite ports `5173` and `4173`.
- Run a single test file with: `cd packages/server && npx vitest run test/<file>.test.ts`.

---

### Task 1: `origin.ts` — Origin allowlist (pure function)

**Files:**
- Create: `packages/server/src/security/origin.ts`
- Test: `packages/server/test/security-origin.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isAllowedOrigin(origin: string | undefined, port: number): boolean`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/server/test/security-origin.test.ts
import { describe, it, expect } from 'vitest';
import { isAllowedOrigin } from '../src/security/origin.js';

describe('isAllowedOrigin', () => {
  it('allows missing origin (non-browser callers, same-origin GET)', () => {
    expect(isAllowedOrigin(undefined, 8123)).toBe(true);
    expect(isAllowedOrigin('', 8123)).toBe(true);
  });
  it('allows loopback on the server port', () => {
    expect(isAllowedOrigin('http://127.0.0.1:8123', 8123)).toBe(true);
    expect(isAllowedOrigin('http://localhost:8123', 8123)).toBe(true);
  });
  it('allows the dev Vite ports', () => {
    expect(isAllowedOrigin('http://localhost:5173', 8123)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:4173', 8123)).toBe(true);
  });
  it('rejects foreign origins and ports', () => {
    expect(isAllowedOrigin('https://evil.com', 8123)).toBe(false);
    expect(isAllowedOrigin('http://localhost:9999', 8123)).toBe(false);
    expect(isAllowedOrigin('http://evil.localhost.example', 8123)).toBe(false);
    expect(isAllowedOrigin('null', 8123)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run test/security-origin.test.ts`
Expected: FAIL — cannot find module `../src/security/origin.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/server/src/security/origin.ts

/** Dev servers we trust beyond the runtime port (Vite dev + preview). */
const DEV_PORTS = new Set([5173, 4173]);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * True when a request may proceed past the Origin gate.
 *
 * A missing/empty Origin is allowed: non-browser callers (the hook shim, curl)
 * send none, and browsers omit it on same-origin GETs. A cross-origin browser
 * request always carries Origin, so a present-but-not-allowlisted value is the
 * signal we reject — that is what blocks drive-by pages.
 */
export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  if (!origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // e.g. the literal "null" origin from sandboxed/file pages
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) return false;
  const originPort = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  return originPort === port || DEV_PORTS.has(originPort);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run test/security-origin.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/security/origin.ts packages/server/test/security-origin.test.ts
git commit -m "feat(security): origin allowlist helper"
```

---

### Task 2: `token.ts` — persisted session token

**Files:**
- Create: `packages/server/src/security/token.ts`
- Test: `packages/server/test/security-token.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `tokenFilePath(): string`
  - `loadOrCreateToken(path?: string): Promise<string>`
  - `timingSafeEqualStr(a: string, b: string): boolean`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/server/test/security-token.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateToken, timingSafeEqualStr } from '../src/security/token.js';

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

describe('loadOrCreateToken', () => {
  it('creates a 64-char hex token in a 0600 file and is stable on reload', async () => {
    dir = mkdtempSync(join(tmpdir(), 'aoa-tok-'));
    const p = join(dir, 'session-token');
    const first = await loadOrCreateToken(p);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(p).mode & 0o777).toBe(0o600);
    const second = await loadOrCreateToken(p);
    expect(second).toBe(first);
  });
});

describe('timingSafeEqualStr', () => {
  it('compares by value and length', () => {
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true);
    expect(timingSafeEqualStr('abc', 'abd')).toBe(false);
    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false);
    expect(timingSafeEqualStr('', '')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run test/security-token.test.ts`
Expected: FAIL — cannot find module `../src/security/token.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/server/src/security/token.ts
import { readFile, writeFile, mkdir, rename, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export function tokenFilePath(): string {
  return join(homedir(), '.age-of-agents', 'session-token');
}

/**
 * Reads the session token, generating and persisting one (atomic write, 0600)
 * on first run. Stable across restarts so installed hooks and local tools keep
 * working. Mirrors the persistence pattern in mapping-config.ts.
 */
export async function loadOrCreateToken(path = tokenFilePath()): Promise<string> {
  try {
    const existing = (await readFile(path, 'utf8')).trim();
    if (/^[0-9a-f]{64}$/.test(existing)) return existing;
  } catch {
    /* missing/unreadable -> create below */
  }
  const token = randomBytes(32).toString('hex');
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, token, { encoding: 'utf8', mode: 0o600 });
  await chmod(tmp, 0o600); // ensure mode even if umask altered the create mode
  await rename(tmp, path);
  return token;
}

/** Constant-time string compare; false on length mismatch without leaking timing. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run test/security-token.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/security/token.ts packages/server/test/security-token.test.ts
git commit -m "feat(security): persisted 0600 session token"
```

---

### Task 3: `guard.ts` — Fastify Origin/token guard + WS verifier

**Files:**
- Create: `packages/server/src/security/guard.ts`
- Test: `packages/server/test/security-guard.test.ts`

**Interfaces:**
- Consumes: `isAllowedOrigin` (Task 1), `timingSafeEqualStr` (Task 2).
- Produces:
  - `isSensitiveRoute(method: string, path: string): boolean`
  - `registerSecurityGuard(app: FastifyInstance, opts: { getPort: () => number; token: string }): void`
  - `verifyWsClient(info: { origin?: string; reqUrl?: string }, port: number, token: string): boolean`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/server/test/security-guard.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerSecurityGuard, verifyWsClient, isSensitiveRoute } from '../src/security/guard.js';

let app: Awaited<ReturnType<typeof build>> | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

async function build(token = 'secret') {
  const a = Fastify();
  registerSecurityGuard(a, { getPort: () => 8123, token });
  a.get('/health', async () => ({ ok: true }));
  a.post('/sessions/launch', async () => ({ ok: true }));
  a.put('/tool-mapping', async () => ({ ok: true }));
  await a.ready();
  return a;
}

describe('registerSecurityGuard', () => {
  it('rejects a foreign origin on any route (403)', async () => {
    app = await build();
    const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.com' } });
    expect(res.statusCode).toBe(403);
  });
  it('allows missing origin on a non-sensitive route', async () => {
    app = await build();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
  it('requires the token on a sensitive route (401 without, pass with)', async () => {
    app = await build();
    const no = await app.inject({ method: 'POST', url: '/sessions/launch' });
    expect(no.statusCode).toBe(401);
    const bad = await app.inject({ method: 'POST', url: '/sessions/launch', headers: { 'x-aoa-token': 'nope' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/sessions/launch', headers: { 'x-aoa-token': 'secret' } });
    expect(ok.statusCode).toBe(200);
  });
  it('checks origin before token (403 wins over a good token)', async () => {
    app = await build();
    const res = await app.inject({ method: 'POST', url: '/sessions/launch', headers: { origin: 'https://evil.com', 'x-aoa-token': 'secret' } });
    expect(res.statusCode).toBe(403);
  });
  it('allows a dev-port origin with token', async () => {
    app = await build();
    const res = await app.inject({ method: 'PUT', url: '/tool-mapping', headers: { origin: 'http://localhost:5173', 'x-aoa-token': 'secret' } });
    expect(res.statusCode).toBe(200);
  });
});

describe('isSensitiveRoute', () => {
  it('classifies state-changing and sensitive routes', () => {
    expect(isSensitiveRoute('POST', '/sessions/launch')).toBe(true);
    expect(isSensitiveRoute('POST', '/sessions/abc-123/message')).toBe(true);
    expect(isSensitiveRoute('POST', '/sessions/abc-123/stop')).toBe(true);
    expect(isSensitiveRoute('POST', '/hooks/install')).toBe(true);
    expect(isSensitiveRoute('POST', '/hooks/uninstall')).toBe(true);
    expect(isSensitiveRoute('PUT', '/model-config')).toBe(true);
    expect(isSensitiveRoute('GET', '/fs/list')).toBe(true);
  });
  it('leaves the hook channel and reads token-free', () => {
    expect(isSensitiveRoute('POST', '/hooks')).toBe(false);
    expect(isSensitiveRoute('POST', '/hooks/decide')).toBe(false);
    expect(isSensitiveRoute('GET', '/sessions')).toBe(false);
    expect(isSensitiveRoute('GET', '/session-token')).toBe(false);
    expect(isSensitiveRoute('GET', '/health')).toBe(false);
  });
});

describe('verifyWsClient', () => {
  it('requires an allowlisted origin and a matching token', () => {
    expect(verifyWsClient({ origin: 'http://localhost:5173', reqUrl: '/ws?token=secret' }, 8123, 'secret')).toBe(true);
    expect(verifyWsClient({ origin: undefined, reqUrl: '/ws?token=secret' }, 8123, 'secret')).toBe(true);
    expect(verifyWsClient({ origin: 'https://evil.com', reqUrl: '/ws?token=secret' }, 8123, 'secret')).toBe(false);
    expect(verifyWsClient({ origin: 'http://localhost:5173', reqUrl: '/ws?token=wrong' }, 8123, 'secret')).toBe(false);
    expect(verifyWsClient({ origin: 'http://localhost:5173', reqUrl: '/ws' }, 8123, 'secret')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run test/security-guard.test.ts`
Expected: FAIL — cannot find module `../src/security/guard.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/server/src/security/guard.ts
import type { FastifyInstance } from 'fastify';
import { isAllowedOrigin } from './origin.js';
import { timingSafeEqualStr } from './token.js';

/** Routes that change state or expose the filesystem — require the token. */
const SENSITIVE: Array<[string, RegExp]> = [
  ['POST', /^\/sessions\/launch$/],
  ['POST', /^\/sessions\/[^/]+\/(message|stop)$/],
  ['POST', /^\/hooks\/(install|uninstall)$/],
  ['PUT', /^\/(tool-mapping|model-config|permission-policy)$/],
  ['GET', /^\/fs\/list$/],
];

export function isSensitiveRoute(method: string, path: string): boolean {
  return SENSITIVE.some(([m, re]) => m === method && re.test(path));
}

/**
 * Global request gate:
 *  1. reject a present, non-allowlisted Origin (drive-by) with 403;
 *  2. require a valid x-aoa-token on sensitive routes with 401.
 * Port is read lazily because the real port is only known after listen().
 */
export function registerSecurityGuard(
  app: FastifyInstance,
  opts: { getPort: () => number; token: string },
): void {
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (!isAllowedOrigin(origin, opts.getPort())) {
      return reply.code(403).send({ error: 'forbidden origin' });
    }
    const path = request.url.split('?')[0];
    if (isSensitiveRoute(request.method, path)) {
      const tok = request.headers['x-aoa-token'];
      if (typeof tok !== 'string' || !timingSafeEqualStr(tok, opts.token)) {
        return reply.code(401).send({ error: 'missing or invalid token' });
      }
    }
  });
}

/** WS handshake gate: allowlisted (or absent) Origin AND a matching ?token=. */
export function verifyWsClient(
  info: { origin?: string; reqUrl?: string },
  port: number,
  token: string,
): boolean {
  if (!isAllowedOrigin(info.origin, port)) return false;
  const url = new URL(info.reqUrl ?? '', 'http://localhost');
  const tok = url.searchParams.get('token');
  return tok !== null && timingSafeEqualStr(tok, token);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run test/security-guard.test.ts`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/security/guard.ts packages/server/test/security-guard.test.ts
git commit -m "feat(security): request guard + WS verifier"
```

---

### Task 4: Wire HTTP guard + `/session-token` into the server

**Files:**
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/test/security-server-http.test.ts`

**Interfaces:**
- Consumes: `registerSecurityGuard` (Task 3), `loadOrCreateToken` (Task 2).
- Produces: `StartServerOptions.tokenPath?: string`; `RunningServer.token: string`; `GET /session-token` → `{ token }`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/server/test/security-server-http.test.ts
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';

beforeAll(() => { process.env.AOA_SOURCES = 'claude'; });
let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

function tokenPath() { return join(mkdtempSync(join(tmpdir(), 'aoa-srv-')), 'session-token'); }

describe('HTTP security wiring', () => {
  it('serves the token to a same-origin (no-origin) caller', async () => {
    server = await startServer({ port: 0, demo: true, tokenPath: tokenPath() });
    const res = await fetch(`${server.url}/session-token`);
    expect(res.status).toBe(200);
    expect((await res.json()).token).toBe(server.token);
  });
  it('rejects /session-token for a foreign origin (403)', async () => {
    server = await startServer({ port: 0, demo: true, tokenPath: tokenPath() });
    const res = await fetch(`${server.url}/session-token`, { headers: { origin: 'https://evil.com' } });
    expect(res.status).toBe(403);
  });
  it('blocks a sensitive POST without the token (401), allows it with', async () => {
    server = await startServer({ port: 0, demo: true, tokenPath: tokenPath() });
    const no = await fetch(`${server.url}/sessions/launch`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: '/p', prompt: 'x', permissionMode: 'default' }),
    });
    expect(no.status).toBe(401);
    const ok = await fetch(`${server.url}/sessions/launch`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-aoa-token': server.token },
      body: JSON.stringify({ cwd: '/p', prompt: 'x', permissionMode: 'default' }),
    });
    expect(ok.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run test/security-server-http.test.ts`
Expected: FAIL — `server.token` undefined / `/session-token` 404 / launch returns 200 without token.

- [ ] **Step 3: Implement the wiring**

In `packages/server/src/server.ts`:

1. Add imports near the other security-free imports (after line 16):

```typescript
import { loadOrCreateToken } from './security/token.js';
import { registerSecurityGuard, verifyWsClient } from './security/guard.js';
```

2. Extend `StartServerOptions` (after `policyPath?`):

```typescript
  /** Override session-token file path (tests). Defaults to ~/.age-of-agents/session-token. */
  tokenPath?: string;
```

3. Extend `RunningServer`:

```typescript
export interface RunningServer {
  url: string;
  port: number;
  token: string;
  close: () => Promise<void>;
}
```

4. At the top of `startServer`, right after `const app = Fastify(...)` (line 38), add token load, a lazy port ref, and the guard — BEFORE any route is registered:

```typescript
  const token = await loadOrCreateToken(opts.tokenPath);
  let resolvedPort = opts.port;
  registerSecurityGuard(app, { getPort: () => resolvedPort, token });
```

5. Add the token endpoint just before the `webRoot` block (after line 139, after the `if (opts.demo) { ... } else { ... }`):

```typescript
  // Issued only to allowlisted origins (the guard rejects foreign Origins first).
  app.get('/session-token', async () => ({ token }));
```

6. After `await app.listen(...)` and computing `actualPort` (line 156), set the port ref so the guard and WS verifier use the real port:

```typescript
  resolvedPort = actualPort;
```

7. Update the `RunningServer` returned object (line 196) to include the token:

```typescript
  return {
    url,
    port: actualPort,
    token,
    close: async () => {
```

(Leave the WS `verifyClient` for Task 5; this task only covers HTTP.)

- [ ] **Step 4: Run the new test + the existing session/launch suites**

Run: `cd packages/server && npx vitest run test/security-server-http.test.ts test/session-routes.test.ts test/launch-request.test.ts`
Expected: PASS. (Route-only tests don't use the guard, so they're unaffected.)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/server.ts packages/server/test/security-server-http.test.ts
git commit -m "feat(security): wire request guard + /session-token endpoint"
```

---

### Task 5: WebSocket `verifyClient` (+ fix the full-server test)

**Files:**
- Modify: `packages/server/src/server.ts:158` (WebSocketServer construction)
- Modify: `packages/server/test/hooks-decide-route.test.ts:34`
- Test: `packages/server/test/security-server-ws.test.ts`

**Interfaces:**
- Consumes: `verifyWsClient` (Task 3), `RunningServer.token` (Task 4).
- Produces: WS handshake now requires allowlisted Origin + `?token=`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/server/test/security-server-ws.test.ts
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { WS_PATH } from '@agent-citadel/shared';
import { startServer } from '../src/server.js';

beforeAll(() => { process.env.AOA_SOURCES = 'claude'; });
let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

function tokenPath() { return join(mkdtempSync(join(tmpdir(), 'aoa-ws-')), 'session-token'); }
const wsUrl = (base: string, q = '') => `${base.replace('http', 'ws')}${WS_PATH}${q}`;

/** Resolves 'open'|'error' for a socket so we can assert accept/reject. */
function outcome(ws: WebSocket): Promise<'open' | 'error'> {
  return new Promise((resolve) => {
    ws.on('open', () => resolve('open'));
    ws.on('error', () => resolve('error'));
  });
}

describe('WebSocket security', () => {
  it('accepts a connection with a valid token', async () => {
    server = await startServer({ port: 0, demo: true, tokenPath: tokenPath() });
    const ws = new WebSocket(wsUrl(server.url, `?token=${server.token}`));
    expect(await outcome(ws)).toBe('open');
    ws.close();
  });
  it('rejects a connection without a token', async () => {
    server = await startServer({ port: 0, demo: true, tokenPath: tokenPath() });
    const ws = new WebSocket(wsUrl(server.url));
    expect(await outcome(ws)).toBe('error');
  });
  it('rejects a connection from a foreign origin', async () => {
    server = await startServer({ port: 0, demo: true, tokenPath: tokenPath() });
    const ws = new WebSocket(wsUrl(server.url, `?token=${server.token}`), { origin: 'https://evil.com' });
    expect(await outcome(ws)).toBe('error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run test/security-server-ws.test.ts`
Expected: FAIL — connections without token / foreign origin still `open` (verifyClient not wired yet).

- [ ] **Step 3: Wire `verifyClient`**

In `packages/server/src/server.ts`, replace the WS server construction (line 158):

```typescript
  const wss = new WebSocketServer({
    server: app.server,
    path: WS_PATH,
    verifyClient: (info) =>
      verifyWsClient({ origin: info.origin, reqUrl: info.req.url }, resolvedPort, token),
  });
```

- [ ] **Step 4: Fix the existing full-server WS test**

In `packages/server/test/hooks-decide-route.test.ts`, the second test opens a WS. Update line 34 to carry the token:

```typescript
    const ws = new WebSocket(`${server.url.replace('http', 'ws')}${WS_PATH}?token=${server.token}`);
```

- [ ] **Step 5: Run both WS tests**

Run: `cd packages/server && npx vitest run test/security-server-ws.test.ts test/hooks-decide-route.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/server.ts packages/server/test/security-server-ws.test.ts packages/server/test/hooks-decide-route.test.ts
git commit -m "feat(security): require origin + token on WebSocket handshake"
```

---

### Task 6: Non-loopback bind safeguard

**Files:**
- Modify: `packages/server/src/server.ts:37` (host resolution)
- Test: `packages/server/test/security-bind.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `startServer` rejects a non-loopback host unless `AOA_ALLOW_REMOTE=1`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/server/test/security-bind.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';

let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; delete process.env.AOA_ALLOW_REMOTE; });
function tokenPath() { return join(mkdtempSync(join(tmpdir(), 'aoa-bind-')), 'session-token'); }

describe('non-loopback bind safeguard', () => {
  it('refuses a non-loopback host by default', async () => {
    await expect(startServer({ port: 0, demo: true, host: '0.0.0.0', tokenPath: tokenPath() }))
      .rejects.toThrow(/non-loopback/i);
  });
  it('allows it with AOA_ALLOW_REMOTE=1', async () => {
    process.env.AOA_ALLOW_REMOTE = '1';
    server = await startServer({ port: 0, demo: true, host: '0.0.0.0', tokenPath: tokenPath() });
    expect(server.port).toBeGreaterThan(0);
  });
  it('allows loopback without the flag', async () => {
    server = await startServer({ port: 0, demo: true, host: '127.0.0.1', tokenPath: tokenPath() });
    expect(server.port).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run test/security-bind.test.ts`
Expected: FAIL — `0.0.0.0` starts instead of throwing.

- [ ] **Step 3: Implement the safeguard**

In `packages/server/src/server.ts`, replace the host line (line 37):

```typescript
  const host = opts.host ?? '127.0.0.1';
  const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
  if (!LOOPBACK.has(host) && process.env.AOA_ALLOW_REMOTE !== '1') {
    throw new Error(
      `Refusing to bind to non-loopback host "${host}": the server has no transport ` +
      `encryption and is meant for local use. Set AOA_ALLOW_REMOTE=1 to override.`,
    );
  }
```

And after `const app = Fastify(...)` (so the logger exists), warn when overridden:

```typescript
  if (!LOOPBACK.has(host)) app.log.warn(`Binding to non-loopback host ${host} (AOA_ALLOW_REMOTE=1)`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run test/security-bind.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/server.ts packages/server/test/security-bind.test.ts
git commit -m "feat(security): refuse non-loopback bind without AOA_ALLOW_REMOTE"
```

---

### Task 7: `/fs/list` home-subtree whitelist

**Files:**
- Modify: `packages/server/src/fs-routes.ts`
- Modify: `packages/server/test/fs-routes.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `registerFsRoutes(app, opts?: { allowedRoot?: string })` — `dir` outside the root → 400.

- [ ] **Step 1: Update the existing test + add an out-of-root test**

Replace `packages/server/test/fs-routes.test.ts` with:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { registerFsRoutes } from '../src/fs-routes.js';

let app: Awaited<ReturnType<typeof build>> | undefined;
async function build(allowedRoot: string) { const a = Fastify(); registerFsRoutes(a, { allowedRoot }); await a.ready(); return a; }
afterEach(async () => { await app?.close(); app = undefined; });

describe('GET /fs/list', () => {
  it('lists subdirectories only, within the allowed root', async () => {
    const base = mkdtempSync(join(tmpdir(), 'aoa-fs-'));
    mkdirSync(join(base, 'sub-a')); mkdirSync(join(base, 'sub-b')); writeFileSync(join(base, 'file.txt'), 'x');
    app = await build(base);
    const res = await app.inject({ method: 'GET', url: `/fs/list?dir=${encodeURIComponent(base)}` });
    const body = res.json();
    expect(body.dir).toBe(base);
    expect(body.entries.map((e: { name: string }) => e.name).sort()).toEqual(['sub-a', 'sub-b']);
  });
  it('missing dir within root -> 400', async () => {
    const base = mkdtempSync(join(tmpdir(), 'aoa-fs-'));
    app = await build(base);
    const res = await app.inject({ method: 'GET', url: `/fs/list?dir=${encodeURIComponent(join(base, 'nope'))}` });
    expect(res.statusCode).toBe(400);
  });
  it('dir outside the allowed root -> 400', async () => {
    const base = mkdtempSync(join(tmpdir(), 'aoa-fs-'));
    app = await build(base);
    const res = await app.inject({ method: 'GET', url: '/fs/list?dir=/etc' });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run test/fs-routes.test.ts`
Expected: FAIL — `registerFsRoutes` takes no options / `/etc` still returns 200.

- [ ] **Step 3: Implement the whitelist**

Replace `packages/server/src/fs-routes.ts` with:

```typescript
import type { FastifyInstance } from 'fastify';
import { readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

/** True when `target` is the root or nested inside it (after resolving `..`). */
function isWithin(root: string, target: string): boolean {
  const r = resolve(root);
  const t = resolve(target);
  return t === r || t.startsWith(r + sep);
}

/**
 * Lists immediate subdirectories of an absolute path (folder picker). Confined
 * to `allowedRoot` (the home subtree by default) so it cannot enumerate the
 * whole filesystem. Local-only server.
 */
export function registerFsRoutes(app: FastifyInstance, opts: { allowedRoot?: string } = {}): void {
  const root = resolve(opts.allowedRoot ?? homedir());
  app.get('/fs/list', async (request, reply) => {
    const raw = (request.query as { dir?: string }).dir;
    const dir = raw && isAbsolute(raw) ? resolve(raw) : root;
    if (!isWithin(root, dir)) return reply.code(400).send({ error: 'path outside allowed root' });
    try {
      const dirents = await readdir(dir, { withFileTypes: true });
      const entries = dirents
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => ({ name: d.name, path: join(dir, d.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { dir, parent: dir === root ? null : join(dir, '..'), entries };
    } catch {
      return reply.code(400).send({ error: 'cannot read directory' });
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run test/fs-routes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/fs-routes.ts packages/server/test/fs-routes.test.ts
git commit -m "feat(security): confine /fs/list to the home subtree"
```

---

### Task 8: Client — fetch the token and attach it

**Files:**
- Create: `packages/client/src/api.ts`
- Create: `packages/client/tests/api.test.ts`
- Modify: `packages/client/src/ws.ts`
- Modify: `packages/client/src/sessions.ts`
- Modify: `packages/client/src/mapping-store.ts:45` (PUT)
- Modify: `packages/client/src/model-store.ts:47` (PUT)
- Modify: `packages/client/src/hud/HooksPanel.tsx:37` (POST install/uninstall)
- Modify: `packages/client/src/hud/PanelControlToggle.tsx:24` (PUT permission-policy)

**Interfaces:**
- Consumes: `GET /session-token` → `{ token }` (Task 4).
- Produces:
  - `getToken(): Promise<string>`
  - `apiFetch(input: string, init?: RequestInit): Promise<Response>` — same as `fetch` but adds the `x-aoa-token` header.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/client/tests/api.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('apiFetch', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fetches the token once and attaches it to requests', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url === '/session-token') return new Response(JSON.stringify({ token: 'T123' }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fakeFetch);
    const { apiFetch } = await import('../src/api');

    await apiFetch('/sessions/launch', { method: 'POST' });
    await apiFetch('/tool-mapping', { method: 'PUT' });

    const tokenCalls = calls.filter((c) => c.url === '/session-token');
    expect(tokenCalls).toHaveLength(1); // cached after first fetch
    const launch = calls.find((c) => c.url === '/sessions/launch');
    expect(launch?.headers['x-aoa-token']).toBe('T123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/client && npx vitest run tests/api.test.ts`
Expected: FAIL — cannot find module `../src/api`.

- [ ] **Step 3: Create `api.ts`**

```typescript
// packages/client/src/api.ts

/**
 * Session-token client. The server issues the token only to allowlisted origins
 * (its Origin guard rejects foreign pages), so a same-origin SPA can read it but
 * a drive-by page cannot. We cache the fetch promise so the token is requested
 * at most once per page load.
 */
let tokenPromise: Promise<string> | undefined;

export function getToken(): Promise<string> {
  if (!tokenPromise) {
    tokenPromise = fetch('/session-token')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`token ${r.status}`))))
      .then((j: { token: string }) => j.token)
      .catch((e) => { tokenPromise = undefined; throw e; }); // allow retry on failure
  }
  return tokenPromise;
}

/** fetch() that attaches the session token in the x-aoa-token header. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  headers.set('x-aoa-token', token);
  return fetch(input, { ...init, headers });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/client && npx vitest run tests/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Use `apiFetch` at the mutating call sites**

In `packages/client/src/sessions.ts`: add `import { apiFetch } from './api';` at the top, then replace the `fetch(...)` calls for launch/stop/message/listDirs with `apiFetch(...)` (keep the GET `/sessions` calls in `sdkAvailable`/`sessionsStatus` on plain `fetch` — they are not sensitive):

```typescript
// launchAgent:
    const res = await apiFetch('/sessions/launch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
// stopSession:
  await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' }).catch(() => {});
// sendSessionMessage:
  await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/message`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
  }).catch(() => {});
// listDirs:
  const r = await apiFetch(`/fs/list${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`);
```

In `packages/client/src/hud/HooksPanel.tsx` (line 37): import `apiFetch` and replace:

```typescript
      await apiFetch(installing ? '/hooks/install' : '/hooks/uninstall', { method: 'POST' });
```

In `packages/client/src/mapping-store.ts` (line 45): import `apiFetch` and change the PUT `fetch('/tool-mapping', {...})` to `apiFetch('/tool-mapping', {...})`. Leave the GET on line 81 as `fetch`.

In `packages/client/src/model-store.ts` (line 47): same change for PUT `'/model-config'`; leave GET on line 88.

In `packages/client/src/hud/PanelControlToggle.tsx` (line 24): import `apiFetch` and change the PUT `fetch('/permission-policy', {...})` to `apiFetch(...)`. Leave the GET on line 12.

- [ ] **Step 6: Attach the token to the WebSocket**

In `packages/client/src/ws.ts`, import the token getter and await it before opening:

```typescript
import { WS_PATH, type GameEvent, type QuestionAnswer } from '@agent-citadel/shared';
import { useWorld } from './store';
import { getToken } from './api';

let current: WebSocket | undefined;

export function connectWorld(): void {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  let retryMs = 1000;

  const open = async () => {
    const token = await getToken();
    const url = `${protocol}://${location.host}${WS_PATH}?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(url);
    current = socket;
    socket.onopen = () => { retryMs = 1000; useWorld.getState().setConnected(true); };
    socket.onmessage = (msg) => {
      const event = JSON.parse(msg.data as string) as GameEvent;
      useWorld.getState().apply(event);
    };
    socket.onclose = () => {
      if (current === socket) current = undefined;
      useWorld.getState().setConnected(false);
      setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, 15_000);
    };
  };

  void open();
}
```

(Keep `sendAnswer` unchanged.)

- [ ] **Step 7: Verify client builds and tests pass**

Run: `cd packages/client && npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/api.ts packages/client/tests/api.test.ts packages/client/src/ws.ts packages/client/src/sessions.ts packages/client/src/mapping-store.ts packages/client/src/model-store.ts packages/client/src/hud/HooksPanel.tsx packages/client/src/hud/PanelControlToggle.tsx
git commit -m "feat(security): client attaches session token to mutating calls + WS"
```

---

### Task 9: Docs, version bump, full verification

**Files:**
- Modify: `README.md` (security section)
- Modify: `package.json` (version bump)

- [ ] **Step 1: Document the security model in README.md**

Add a `## Security` section near the end of `README.md` with this content:

```markdown
## Security

The server binds to `127.0.0.1` only and is meant for local use. It defends against
the realistic threat — a malicious web page in your browser (drive-by) — with two layers:

- **Origin allowlist:** WebSocket and state-changing HTTP requests from a non-local
  origin are rejected (`403`).
- **Session token:** a per-machine token in `~/.age-of-agents/session-token` (`0600`)
  is required for the WebSocket handshake and sensitive endpoints (launch/stop/message,
  hook install/uninstall, config writes, `/fs/list`). The SPA fetches it from
  `/session-token`, which is only served to allowlisted origins.

`/fs/list` is confined to your home directory. The server refuses to bind to a
non-loopback host unless `AOA_ALLOW_REMOTE=1` is set.

**Boundaries (honest):** loopback is not per-user isolated, so this does not fully
defend against another user on a shared machine, and a process running as you can read
the token file. Those are out of scope for a local-first tool.
```

- [ ] **Step 2: Bump the version**

In `package.json`, bump `"version"` from `0.8.0` to `0.9.0` (a security feature release).

- [ ] **Step 3: Full server + client test suites**

Run: `npm test`
Expected: PASS for both `@agent-citadel/server` and `@agent-citadel/client`.

- [ ] **Step 4: Full build**

Run: `npm run build`
Expected: client build + server build succeed with no errors.

- [ ] **Step 5: Commit**

```bash
git add README.md package.json
git commit -m "docs(security): document the hardening model; bump to 0.9.0"
```

---

## Self-Review Notes (filled during planning)

- **Spec coverage:** WS origin/auth → Tasks 3,5; `/hooks/install` CSRF → Tasks 3,4 (token on `/hooks/install`); agent API auth → Tasks 3,4; `/fs/list` → Task 7; non-loopback safeguard → Task 6; tests → every task + Task 9; no-migration constraint → Task 3 (`isSensitiveRoute` excludes `/hooks`, `/hooks/decide`) verified by its unit test.
- **Type consistency:** `isAllowedOrigin(origin, port)`, `loadOrCreateToken(path)`, `timingSafeEqualStr(a,b)`, `registerSecurityGuard(app, {getPort, token})`, `verifyWsClient({origin, reqUrl}, port, token)`, `RunningServer.token`, `StartServerOptions.tokenPath`, client `getToken()`/`apiFetch(input, init)` — used identically across tasks.
- **Known follow-up (out of scope):** projects outside `$HOME` won't be browsable by the folder picker after Task 7; if users report it, add an `AOA_FS_ROOTS` env or seed roots from recent project dirs.
