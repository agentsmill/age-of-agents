import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { localLlmSessionsDir } from '../sources/local-llm.js';

/**
 * OpenAI-compatible /v1/chat/completions logging proxy. A client (coding agent,
 * script) sets its base URL to this proxy; we forward to the real backend at
 * LLM_BASE_URL (llama.cpp / vLLM / oMLX / Ollama's /v1) and tee the conversation
 * delta into the same JSONL transcript the `local-llm` source reads.
 * Restored from closed PR #2 (local-llm-proxy.ts).
 */

export interface OpenAiLoggerOptions {
  port?: number;
  host?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  sessionsDir?: string;
}

export interface RunningProxy {
  url: string;
  port: number;
  close: () => Promise<void>;
}

interface SessionState {
  file: string;
  knownMessages: number;
}

/** Identify "the same" conversation across stateless requests: the system /
 *  first message is the stable anchor while history grows. */
export function fingerprint(messages: any[]): string {
  const anchor = messages.find((m) => m && m.role === 'system') ?? messages[0];
  return createHash('sha1').update(JSON.stringify(anchor ?? null)).digest('hex').slice(0, 32);
}

/** Pure accumulator for an SSE stream → final assistant content + tool calls + usage. */
export function accumulateSse(lines: string[]): { content: string; toolCalls: any[]; usage: any } {
  let content = '';
  let usage: any;
  const acc = new Map<number, any>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let evt: any;
    try {
      evt = JSON.parse(payload);
    } catch {
      continue;
    }
    if (evt?.usage) usage = evt.usage;
    const delta = evt?.choices?.[0]?.delta;
    if (typeof delta?.content === 'string') content += delta.content;
    for (const tc of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
      const i = tc.index ?? 0;
      const cur = acc.get(i) ?? { id: undefined, function: { name: '', arguments: '' } };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.function.name += tc.function.name;
      if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
      acc.set(i, cur);
    }
  }
  return { content, toolCalls: [...acc.values()], usage };
}

export async function startOpenAiLoggerProxy(opts: OpenAiLoggerOptions = {}): Promise<RunningProxy> {
  const host = opts.host ?? '127.0.0.1';
  const baseUrl = (opts.baseUrl ?? process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1').replace(/\/+$/, '');
  const model = opts.model ?? process.env.LLM_MODEL;
  const apiKey = opts.apiKey ?? process.env.LLM_API_KEY;
  const sessionsDir = opts.sessionsDir ?? localLlmSessionsDir();
  await mkdir(sessionsDir, { recursive: true });

  const sessions = new Map<string, SessionState>();
  const logLine = (state: SessionState, record: Record<string, unknown>): Promise<void> =>
    appendFile(state.file, `${JSON.stringify(record)}\n`, 'utf8');

  async function ensureSession(fp: string, requestedModel: string | undefined): Promise<SessionState> {
    const existing = sessions.get(fp);
    if (existing) return existing;
    const state: SessionState = { file: join(sessionsDir, `${randomUUID()}.jsonl`), knownMessages: 0 };
    sessions.set(fp, state);
    await logLine(state, { type: 'session', ts: new Date().toISOString(), cwd: process.cwd(), backend: 'openai', model: model ?? requestedModel });
    return state;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: any;
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'invalid JSON body' } }));
      return;
    }

    const messages: any[] = Array.isArray(body.messages) ? body.messages : [];
    const state = await ensureSession(fingerprint(messages), body.model);
    const newMessages = messages.slice(state.knownMessages);
    state.knownMessages = messages.length;
    const reqTs = new Date().toISOString();
    for (const m of newMessages) {
      await logLine(state, { type: 'message', ts: reqTs, role: m?.role, content: typeof m?.content === 'string' ? m.content : undefined, tool_calls: m?.tool_calls });
    }

    const outgoing = { ...body, model: model ?? body.model };
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    let upstream: Response;
    try {
      upstream = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(outgoing) });
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `cannot reach LLM_BASE_URL (${baseUrl}): ${(err as Error).message}` } }));
      return;
    }

    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
    if (!upstream.body) {
      res.end();
      return;
    }

    if (outgoing.stream) {
      let buffered = '';
      const lines: string[] = [];
      const node = Readable.fromWeb(upstream.body as any);
      node.on('data', (chunk: Buffer) => {
        res.write(chunk);
        buffered += chunk.toString('utf8');
        let idx: number;
        while ((idx = buffered.indexOf('\n')) >= 0) {
          lines.push(buffered.slice(0, idx));
          buffered = buffered.slice(idx + 1);
        }
      });
      node.on('end', () => {
        res.end();
        const { content, toolCalls, usage } = accumulateSse(lines);
        void logLine(state, { type: 'message', ts: new Date().toISOString(), role: 'assistant', content: content || undefined, tool_calls: toolCalls.length ? toolCalls : undefined })
          .then(() => {
            state.knownMessages += 1;
            if (usage) return logLine(state, { type: 'usage', input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 });
          })
          .catch((err) => console.error('openai-logger transcript write error:', err));
      });
      node.on('error', (err) => {
        console.error('openai-logger stream error:', err);
        res.destroy(err as Error);
      });
      return;
    }

    const text = await upstream.text();
    res.end(text);
    try {
      const json = JSON.parse(text);
      const message = json?.choices?.[0]?.message;
      if (message) {
        await logLine(state, { type: 'message', ts: new Date().toISOString(), role: message.role ?? 'assistant', content: typeof message.content === 'string' ? message.content : undefined, tool_calls: message.tool_calls });
        state.knownMessages += 1;
      }
      const usage = json?.usage;
      if (usage) await logLine(state, { type: 'usage', input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 });
    } catch {
      // non-JSON upstream body (e.g. an error page) — nothing to log
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: (err as Error).message } }));
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, host, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? 0);

  return {
    url: `http://${host}:${port}/v1`,
    port,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
