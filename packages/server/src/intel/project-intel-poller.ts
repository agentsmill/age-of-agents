import { promises as fs, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { AgentKind, BeadsIssue, GraphifySummary, ProjectIntel } from '@agent-citadel/shared';
import type { World } from '../world.js';

const execFileAsync = promisify(execFile);
/**
 * Project Intel Poller - czyta "salon architekta" z każdego monitorowanego projektu:
 *
 *  1. `.beads/issues.jsonl`  → BeadsIssue[] (bd format)
 *  2. `graphify-out/graph.json` → GraphifySummary (statystyki kodu)
 *
 * Emituje `project-intel-updated` event dla każdego znanego projectDir.
 *
 * Polling (vs file watching) jest tu OK bo:
 *  - pliki aktualizowane są przez zewnętrzne CLI (`bd sync`, `graphify update`),
 *  - i tak odpytujemy co kilka sekund — nie potrzebujemy natychmiastowej reakcji,
 *  - polling jest idempotentny (gorszy błąd to po prostu stary snapshot).
 *
 * Graceful degradation: brak beads → available:false, brak graphify → available:false.
 * Klient dostaje `error` w polu i może to wyświetlić w panelu architekta.
 */

const POLL_INTERVAL_MS = 4000;

interface ProjectCache {
  /** Ostatni wyemitowany intel — by nie wysyłać identycznych eventów. */
  lastFingerprint: string;
  lastMtimeMs: number;
  lastError?: string;
}

function safeReadJsonl(filePath: string): BeadsIssue[] {
  // Czytamy plik .beads/issues.jsonl linia-po-linii. Każda linia to osobny JSON.
  // Pomijamy linie puste i te, które nie są JSONem (np. komentarze bd).
  const content = readFileSync(filePath, 'utf8');
  const out: BeadsIssue[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      // `bd ready --json` shape jest w pełni flat — issue_type, priority, status, etc.
      // Normalizujemy nazwy pól: snake_case → camelCase, filtrujemy do naszego typu.
      const id = String(obj.id ?? '');
      if (!id) continue;
      const dep = (obj.dependencies as Array<{ type: string; id: string }> | undefined) ?? [];
      out.push({
        id,
        title: String(obj.title ?? '(untitled)'),
        status: String(obj.status ?? 'open'),
        priority: Number(obj.priority ?? 2),
        issueType: String(obj.issue_type ?? obj.type ?? 'task'),
        assignee: obj.assignee ? String(obj.assignee) : undefined,
        blocksCount: dep.filter((d) => d.type === 'blocks').length,
        blockedByCount: dep.filter((d) => d.type === 'blocked_by').length,
        createdAt: obj.created_at ? Number(obj.created_at) : undefined,
        updatedAt: obj.updated_at ? Number(obj.updated_at) : undefined,
      });
    } catch {
      // Ignoruj linie, które nie są poprawnym JSONem
    }
  }
  return out;
}

async function readBeads(projectDir: string): Promise<{ available: boolean; issues: BeadsIssue[]; error?: string }> {
  // Trzy źródła, w kolejności preferencji:
  //  1. `.beads/issues.jsonl` — JSONL export z Dolt (commitowany do gita).
  //  2. Fallback: `bd list --json` — czyta bezpośrednio z Dolt (embeddeddolt/),
  //     droższe (subprocess) ale zawsze aktualne.
  //  3. Samo istnienie `.beads/` (z config.yaml) = zainicjalizowane, puste.
  const beadsDir = path.join(projectDir, '.beads');
  const issuesPath = path.join(beadsDir, 'issues.jsonl');

  // Spróbuj issues.jsonl najpierw (szybka ścieżka).
  try {
    await fs.access(issuesPath);
    const issues = safeReadJsonl(issuesPath);
    return { available: true, issues };
  } catch {
    // issues.jsonl nie istnieje — próbuj dalej.
  }

  // Fallback: odpal `bd list --json` by przeczytać z Dolt.
  // Wolniejsze (subprocess), ale daje aktualny stan nawet bez sync.
  try {
    const { stdout } = await execFileAsync('bd', ['list', '--json'], {
      cwd: projectDir,
      timeout: 3000,
      windowsHide: true,
    });
    const arr = JSON.parse(stdout) as Array<Record<string, unknown>>;
    if (!Array.isArray(arr)) return { available: false, issues: [], error: 'bd returned non-array' };
    return {
      available: true,
      issues: arr.map(bdRowToIssue).filter((i): i is BeadsIssue => i !== null),
    };
  } catch {
    // bd niedostępne albo błąd — sprawdź czy w ogóle katalog .beads istnieje.
  }

  // Czy .beads/ w ogóle istnieje? (zainicjalizowane ale puste / bd nie ma).
  try {
    await fs.access(beadsDir);
    return { available: true, issues: [] };
  } catch {
    return { available: false, issues: [], error: 'no .beads directory' };
  }
}

function bdRowToIssue(row: Record<string, unknown>): BeadsIssue | null {
  const id = String(row.id ?? '');
  if (!id) return null;
  const dep = (row.dependencies as Array<{ type: string; id: string }> | undefined) ?? [];
  return {
    id,
    title: String(row.title ?? '(untitled)'),
    status: String(row.status ?? 'open'),
    priority: Number(row.priority ?? 2),
    issueType: String(row.issue_type ?? row.type ?? 'task'),
    assignee: row.assignee ? String(row.assignee) : undefined,
    blocksCount: dep.filter((d) => d.type === 'blocks').length,
    blockedByCount: dep.filter((d) => d.type === 'blocked_by').length,
    createdAt: row.created_at ? Number(row.created_at) : undefined,
    updatedAt: row.updated_at ? Number(row.updated_at) : undefined,
  };
}

async function readGraphify(projectDir: string): Promise<{ available: boolean; summary: GraphifySummary | null; error?: string }> {
  const graphPath = path.join(projectDir, 'graphify-out', 'graph.json');
  try {
    await fs.access(graphPath);
  } catch {
    return { available: false, summary: null, error: 'no graphify-out/graph.json' };
  }
  try {
    const raw = await fs.readFile(graphPath, 'utf8');
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const stats = (obj.stats as Record<string, unknown> | undefined) ?? {};
    const nodes = (obj.nodes as Array<{ id: string; degree?: number; symbol?: string }> | undefined) ?? [];
    // Top 5 god-nodes (highest degree) — wzbogaca UI „god-nodes: 3, 7, 11".
    const top = [...nodes]
      .filter((n) => typeof n.degree === 'number')
      .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
      .slice(0, 5)
      .map((n) => ({ symbol: n.symbol ?? n.id, degree: n.degree ?? 0 }));
    return {
      available: true,
      summary: {
        nodeCount: Number(stats.nodeCount ?? nodes.length),
        edgeCount: Number(stats.edgeCount ?? 0),
        communityCount: Number(stats.communityCount ?? 0),
        topHubs: top,
        generatedAt: typeof stats.generatedAt === 'string' ? stats.generatedAt : undefined,
      },
    };
  } catch (err) {
    return { available: false, summary: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function deriveName(projectDir: string): string {
  // basename jako fallback; jeśli projectDir = "C:/.../RTS agents", zwraca "RTS agents".
  return path.basename(projectDir) || projectDir;
}

function fingerprint(intel: ProjectIntel): string {
  // Stabilny hash szybkiego porównania (nie wysyłamy eventu, jeśli nic się nie zmieniło).
  // Używamy liczby issues i kluczowych pól, nie całego JSON.stringify (za drogie).
  return [
    intel.activeSessions,
    intel.activeAgents.join(','),
    intel.beads.available ? intel.beads.issues.length : 'na',
    intel.beads.available ? intel.beads.issues.map((i) => i.id + ':' + i.status).join(',') : '',
    intel.graphify.available ? String(intel.graphify.summary?.nodeCount ?? 0) : 'na',
    intel.refreshedAt,
  ].join('|');
}

export class ProjectIntelPoller {
  private cache = new Map<string, ProjectCache>();
  private timer?: NodeJS.Timeout;
  private isRunning = false;
  private world: World;

  constructor(world: World) {
    this.world = world;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    // Pierwszy obieg natychmiast (żeby UI od razu widział miasta), potem co POLL_INTERVAL_MS.
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async poll(): Promise<void> {
    if (!this.isRunning) return;
    // 1. Zbierz unikalne katalogi z aktywnych bohaterów.
    const projectDirs = this.world.activeProjectDirs();
    // 2. Dla każdego: czytaj beads + graphify, emituj event jeśli fingerprint się zmienił.
    for (const dir of projectDirs) {
      try {
        await this.refreshProject(dir);
      } catch (err) {
        // Jeden projekt nie może zepsuć pętli dla pozostałych.
        console.error('[intel] refresh failed for', dir, err);
      }
    }
    // 3. Opcjonalnie: wyrzuć cache dla katalogów bez aktywnych sesji (TTL 60s)
    // by nie trzymać martwych miast w pamięci.
    const activeSet = new Set(projectDirs);
    for (const dir of [...this.cache.keys()]) {
      if (!activeSet.has(dir)) {
        const lastSeen = this.cache.get(dir)?.lastMtimeMs ?? 0;
        if (Date.now() - lastSeen > 60_000) this.cache.delete(dir);
      }
    }
  }

  private async refreshProject(projectDir: string): Promise<void> {
    const heroes = this.world.heroesByProject(projectDir);
    const activeAgents: AgentKind[] = [...new Set(heroes.map((h) => h.agent ?? 'claude'))];
    const [beads, graphify] = await Promise.all([readBeads(projectDir), readGraphify(projectDir)]);
    const intel: ProjectIntel = {
      projectDir,
      projectName: heroes[0]?.projectName ?? deriveName(projectDir),
      activeSessions: heroes.length,
      activeAgents,
      beads,
      graphify,
      refreshedAt: Date.now(),
    };
    const fp = fingerprint(intel);
    const prev = this.cache.get(projectDir);
    if (prev && prev.lastFingerprint === fp) {
      // Bez zmian — nie wysyłamy eventu (klient i tak ma aktualny stan).
      // Aktualizujemy mtime, by wiedzieć, kiedy cache może wygasnąć.
      prev.lastMtimeMs = Date.now();
      return;
    }
    this.cache.set(projectDir, { lastFingerprint: fp, lastMtimeMs: Date.now() });
    this.world.emitCustom({ type: 'project-intel-updated', intel });
  }
}
