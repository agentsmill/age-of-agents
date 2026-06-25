import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { localLlmSessionsDir } from '../sources/local-llm.js';

/**
 * Transparent reverse-proxy for the Ollama API. The `aoa local` wrapper points
 * `OLLAMA_HOST` at this proxy and execs `ollama run`, so every request the CLI
 * makes is forwarded verbatim to the real Ollama server. We additionally tee
 * `/api/chat` traffic into a JSONL transcript that the `local-llm` source reads.
 * One proxy instance == one `ollama run` == one session file (no fingerprinting).
 */

export interface OllamaLoggerOptions {
  port?: number;
  host?: string;
  /** Real Ollama server "host:port" (no scheme). Default OLLAMA_HOST or 127.0.0.1:11434. */
  upstream?: string;
  sessionsDir?: string;
}

export interface RunningProxy {
  url: string;
  port: number;
  close: () => Promise<void>;
}

type TranscriptRecord = Record<string, unknown>;

const isChatPath = (url: string): boolean => url === '/api/chat' || url.startsWith('/api/chat?');
const isGeneratePath = (url: string): boolean => url === '/api/generate' || url.startsWith('/api/generate?');

/** Ollama /api/show returns model_info with an "<arch>.context_length" key. */
export function parseOllamaContextWindow(show: unknown): number | undefined {
  if (!show || typeof show !== 'object') return undefined;
  const info = (show as any).model_info;
  if (!info || typeof info !== 'object') return undefined;
  for (const [key, value] of Object.entries(info)) {
    if (key.endsWith('.context_length') && typeof value === 'number' && value > 0) return value;
  }
  return undefined;
}

/** Pure tee: given the request messages and the upstream NDJSON lines, build transcript records. */
export function teeOllamaChat(reqMessages: any[], ndjsonLines: string[]): TranscriptRecord[] {
  const out: TranscriptRecord[] = [];
  const ts = new Date().toISOString();
  for (const m of reqMessages) {
    out.push({ type: 'message', ts, role: m?.role, content: typeof m?.content === 'string' ? m.content : undefined, tool_calls: m?.tool_calls });
  }
  let assistantText = '';
  let toolCalls: any[] | undefined;
  let input = 0;
  let output = 0;
  let done = false;
  for (const line of ndjsonLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt: any;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue; // partial frame split across chunks; the next chunk completes it
    }
    if (typeof evt?.message?.content === 'string') assistantText += evt.message.content;
    if (Array.isArray(evt?.message?.tool_calls) && evt.message.tool_calls.length) toolCalls = evt.message.tool_calls;
    if (evt?.done) {
      done = true;
      input = Number(evt.prompt_eval_count ?? 0);
      output = Number(evt.eval_count ?? 0);
    }
  }
  if (done) {
    out.push({ type: 'message', ts: new Date().toISOString(), role: 'assistant', content: assistantText || undefined, tool_calls: toolCalls });
    out.push({ type: 'usage', input, output });
    out.push({ type: 'turn_complete', ts: new Date().toISOString() });
  }
  return out;
}

/**
 * Pure tee for /api/generate: given the request body and the upstream NDJSON lines,
 * build transcript records. The generate path carries a single `prompt` per call (no
 * growing message history), so no knownMessages dedup is needed.
 */
export function teeOllamaGenerate(reqBody: any, ndjsonLines: string[]): TranscriptRecord[] {
  const out: TranscriptRecord[] = [];
  const ts = new Date().toISOString();
  if (typeof reqBody?.prompt === 'string') {
    out.push({ type: 'message', ts, role: 'user', content: reqBody.prompt });
  }
  let assistantText = '';
  let input = 0;
  let output = 0;
  let done = false;
  for (const line of ndjsonLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt: any;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue; // malformed / non-JSON line; skip
    }
    if (typeof evt?.response === 'string') assistantText += evt.response;
    if (evt?.done) {
      done = true;
      input = Number(evt.prompt_eval_count ?? 0);
      output = Number(evt.eval_count ?? 0);
    }
  }
  if (done) {
    out.push({ type: 'message', ts: new Date().toISOString(), role: 'assistant', content: assistantText || undefined });
    out.push({ type: 'usage', input, output });
    out.push({ type: 'turn_complete', ts: new Date().toISOString() });
  }
  return out;
}

export async function startOllamaLoggerProxy(opts: OllamaLoggerOptions = {}): Promise<RunningProxy> {
  const host = opts.host ?? '127.0.0.1';
  const upstream = (opts.upstream ?? process.env.OLLAMA_HOST ?? '127.0.0.1:11434').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const sessionsDir = opts.sessionsDir ?? localLlmSessionsDir();
  await mkdir(sessionsDir, { recursive: true });

  const file = join(sessionsDir, `${randomUUID()}.jsonl`);
  let sessionStarted = false;
  let knownMessages = 0;

  const logLine = (record: TranscriptRecord): Promise<void> => appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');

  async function fetchContextWindow(model: string): Promise<number | undefined> {
    try {
      const r = await fetch(`http://${upstream}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: model }) });
      if (!r.ok) return undefined;
      return parseOllamaContextWindow(await r.json());
    } catch {
      return undefined;
    }
  }

  async function ensureSession(model: string | undefined): Promise<void> {
    if (sessionStarted) return;
    sessionStarted = true;
    const contextWindow = model ? await fetchContextWindow(model) : undefined;
    await logLine({ type: 'session', ts: new Date().toISOString(), cwd: process.cwd(), model, backend: 'ollama', contextWindow });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === 'host' || k === 'content-length' || typeof v === 'undefined') continue;
      headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(`http://${upstream}${url}`, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' || body.length === 0 ? undefined : body,
      });
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `cannot reach Ollama at ${upstream}: ${(err as Error).message}` }));
      return;
    }

    const resHeaders: Record<string, string> = {};
    upstreamRes.headers.forEach((value, key) => {
      if (key === 'content-length' || key === 'content-encoding' || key === 'transfer-encoding') return;
      resHeaders[key] = value;
    });
    res.writeHead(upstreamRes.status, resHeaders);

    if (!upstreamRes.body) {
      res.end();
      return;
    }

    // Non-tee endpoints: transparent passthrough.
    if (!(req.method === 'POST' && (isChatPath(url) || isGeneratePath(url)))) {
      const passthrough = Readable.fromWeb(upstreamRes.body as any);
      passthrough.on('error', (err) => {
        console.error('ollama-logger passthrough stream error:', err);
        res.destroy(err as Error);
      });
      passthrough.pipe(res);
      return;
    }

    // Parse request body once for both tee branches.
    let reqBody: any = {};
    try {
      reqBody = body.length ? JSON.parse(body.toString('utf8')) : {};
    } catch {
      // not JSON: just pass through without logging
    }

    await ensureSession(typeof reqBody.model === 'string' ? reqBody.model : undefined);

    if (isChatPath(url)) {
      // Chat endpoint: tee while streaming back to the client unchanged.
      const messages: any[] = Array.isArray(reqBody.messages) ? reqBody.messages : [];

      const newMessages = messages.slice(knownMessages);
      knownMessages = messages.length;
      const reqTs = new Date().toISOString();
      for (const m of newMessages) {
        await logLine({ type: 'message', ts: reqTs, role: m?.role, content: typeof m?.content === 'string' ? m.content : undefined, tool_calls: m?.tool_calls });
      }

      let buffered = '';
      let assistantText = '';
      let toolCalls: any[] | undefined;
      const node = Readable.fromWeb(upstreamRes.body as any);
      node.on('data', (chunk: Buffer) => {
        res.write(chunk);
        buffered += chunk.toString('utf8');
        let idx: number;
        while ((idx = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, idx).trim();
          buffered = buffered.slice(idx + 1);
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (typeof evt?.message?.content === 'string') assistantText += evt.message.content;
            if (Array.isArray(evt?.message?.tool_calls) && evt.message.tool_calls.length) toolCalls = evt.message.tool_calls;
            if (evt?.done) {
              void logLine({ type: 'message', ts: new Date().toISOString(), role: 'assistant', content: assistantText || undefined, tool_calls: toolCalls })
                .then(() => {
                  knownMessages += 1;
                  return logLine({ type: 'usage', input: Number(evt.prompt_eval_count ?? 0), output: Number(evt.eval_count ?? 0) });
                })
                .then(() => logLine({ type: 'turn_complete', ts: new Date().toISOString() }))
                .catch((err) => console.error('ollama-logger transcript write error:', err));
              assistantText = '';
              toolCalls = undefined;
            }
          } catch {
            // partial NDJSON frame; the next chunk completes it
          }
        }
      });
      node.on('end', () => res.end());
      node.on('error', (err) => {
        console.error('ollama-logger chat stream error:', err);
        res.destroy(err as Error);
      });
    } else {
      // Generate endpoint (/api/generate): tee while streaming back to the client unchanged.
      // Each generate call is one turn — no growing message history, no knownMessages dedup.
      const reqTs = new Date().toISOString();
      if (typeof reqBody.prompt === 'string') {
        await logLine({ type: 'message', ts: reqTs, role: 'user', content: reqBody.prompt });
      }

      let buffered = '';
      let assistantText = '';
      const node = Readable.fromWeb(upstreamRes.body as any);
      node.on('data', (chunk: Buffer) => {
        res.write(chunk);
        buffered += chunk.toString('utf8');
        let idx: number;
        while ((idx = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, idx).trim();
          buffered = buffered.slice(idx + 1);
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (typeof evt?.response === 'string') assistantText += evt.response;
            if (evt?.done) {
              void logLine({ type: 'message', ts: new Date().toISOString(), role: 'assistant', content: assistantText || undefined })
                .then(() => logLine({ type: 'usage', input: Number(evt.prompt_eval_count ?? 0), output: Number(evt.eval_count ?? 0) }))
                .then(() => logLine({ type: 'turn_complete', ts: new Date().toISOString() }))
                .catch((err) => console.error('ollama-logger transcript write error:', err));
              assistantText = '';
            }
          } catch {
            // partial NDJSON frame; the next chunk completes it
          }
        }
      });
      node.on('end', () => res.end());
      node.on('error', (err) => {
        console.error('ollama-logger generate stream error:', err);
        res.destroy(err as Error);
      });
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, host, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? 0);

  return {
    url: `http://${host}:${port}`,
    port,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
