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
