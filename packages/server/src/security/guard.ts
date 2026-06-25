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
