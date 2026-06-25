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
