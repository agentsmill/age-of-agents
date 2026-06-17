import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { localLlmSessionsDir } from '../sources/local-llm.js';

/**
 * Lokalny proxy OpenAI-compatible chat-completions: dowolny klient (agent CLI,
 * skrypt) konfiguruje swój base URL na ten proxy, a my przepuszczamy żądania
 * do prawdziwego backendu (Ollama/oMLX/inny) wskazanego przez LLM_BASE_URL,
 * jednocześnie logując deltę konwersacji jako transkrypt JSONL, który czyta
 * source 'local-llm' (sources/local-llm.ts) — dzięki temu sesje lokalnego LLM
 * pojawiają się w grze tak samo jak Claude/Codex/OpenCode/Koda.
 */

export interface LocalLlmProxyOptions {
  port?: number;
  host?: string;
  /** Backend OpenAI-compatible, np. Ollama (http://localhost:11434/v1) lub oMLX. */
  baseUrl?: string;
  /** Wymuszony model (nadpisuje pole `model` w żądaniu klienta), opcjonalny. */
  model?: string;
  /** Klucz API do backendu, jeśli wymagany (Ollama/oMLX lokalnie zwykle nie). */
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

/** Identyfikuje "tę samą" rozmowę między żądaniami: historia OpenAI rośnie
 *  o nowe wiadomości, ale system/pierwszy user message są stałe. */
function fingerprint(messages: any[]): string {
  const anchor = messages.find((m) => m && m.role === 'system') ?? messages[0];
  return createHash('sha1').update(JSON.stringify(anchor ?? null)).digest('hex').slice(0, 32);
}

export async function startLocalLlmProxy(opts: LocalLlmProxyOptions = {}): Promise<RunningProxy> {
  const host = opts.host ?? '127.0.0.1';
  const baseUrl = (opts.baseUrl ?? process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1').replace(/\/+$/, '');
  const model = opts.model ?? process.env.LLM_MODEL;
  const apiKey = opts.apiKey ?? process.env.LLM_API_KEY;
  const sessionsDir = opts.sessionsDir ?? localLlmSessionsDir();
  await mkdir(sessionsDir, { recursive: true });

  const sessions = new Map<string, SessionState>();

  const logLine = (state: SessionState, record: Record<string, unknown>): Promise<void> =>
    appendFile(state.file, `${JSON.stringify(record)}\n`, 'utf8');

  async function ensureSession(fp: string, cwd: string | undefined, requestedModel: string | undefined): Promise<SessionState> {
    const existing = sessions.get(fp);
    if (existing) return existing;
    const state: SessionState = { file: join(sessionsDir, `${randomUUID()}.jsonl`), knownMessages: 0 };
    sessions.set(fp, state);
    await logLine(state, { type: 'session', ts: new Date().toISOString(), cwd, model: model ?? requestedModel });
    return state;
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');

    let body: any;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'invalid JSON body' } }));
      return;
    }

    const messages: any[] = Array.isArray(body.messages) ? body.messages : [];
    const state = await ensureSession(fingerprint(messages), process.cwd(), body.model);

    const newMessages = messages.slice(state.knownMessages);
    state.knownMessages = messages.length;
    const reqTs = new Date().toISOString();
    for (const m of newMessages) {
      await logLine(state, {
        type: 'message',
        ts: reqTs,
        role: m?.role,
        content: typeof m?.content === 'string' ? m.content : undefined,
        tool_calls: m?.tool_calls,
      });
    }

    const outgoingBody = { ...body, model: model ?? body.model };
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    let upstream: Response;
    try {
      upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(outgoingBody),
      });
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

    if (outgoingBody.stream) {
      streamAndLog(upstream.body, res, state);
      return;
    }

    const text = await upstream.text();
    await logCompletion(text, state);
    res.end(text);
  }

  function streamAndLog(body: ReadableStream<Uint8Array>, res: ServerResponse, state: SessionState): void {
    let buffered = '';
    let assistantText = '';
    const toolCallsAcc = new Map<number, any>();
    const nodeStream = Readable.fromWeb(body as any);

    nodeStream.on('data', (chunk: Buffer) => {
      res.write(chunk);
      buffered += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, idx).trim();
        buffered = buffered.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload);
          const delta = evt?.choices?.[0]?.delta;
          if (typeof delta?.content === 'string') assistantText += delta.content;
          for (const tc of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
            const i = tc.index ?? 0;
            const acc = toolCallsAcc.get(i) ?? { id: undefined, function: { name: '', arguments: '' } };
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.function.name += tc.function.name;
            if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
            toolCallsAcc.set(i, acc);
          }
        } catch {
          // partial SSE frame split across chunks — ignore, next chunk completes it
        }
      }
    });

    nodeStream.on('end', () => {
      res.end();
      const toolCalls = [...toolCallsAcc.values()];
      void logLine(state, {
        type: 'message',
        ts: new Date().toISOString(),
        role: 'assistant',
        content: assistantText || undefined,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      }).then(() => {
        state.knownMessages += 1;
      });
    });
    nodeStream.on('error', () => res.end());
  }

  async function logCompletion(text: string, state: SessionState): Promise<void> {
    try {
      const json = JSON.parse(text);
      const message = json?.choices?.[0]?.message;
      if (message) {
        await logLine(state, {
          type: 'message',
          ts: new Date().toISOString(),
          role: message.role ?? 'assistant',
          content: typeof message.content === 'string' ? message.content : undefined,
          tool_calls: message.tool_calls,
        });
        state.knownMessages += 1;
      }
      const usage = json?.usage;
      if (usage) {
        await logLine(state, { type: 'usage', input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 });
      }
    } catch {
      // upstream returned a non-JSON body (e.g. an error page) — nothing to log
    }
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
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
