import os from 'node:os';
import type { ProjectArsenal } from '@agent-citadel/shared';
import type { World } from '../world.js';
import { readSkills } from './readers/skills.js';
import { readConnectors } from './readers/connectors.js';
import { readHooks } from './readers/hooks.js';
import { readAgents } from './readers/agents.js';

const POLL_INTERVAL_MS = 4000;

interface CacheEntry { fingerprint: string; lastSeenMs: number; }

/** Fingerprint WITHOUT refreshedAt: emit only when it really changes. */
function fingerprint(a: ProjectArsenal): string {
  return [
    a.activeSessions,
    a.skills.map((s) => s.id).sort().join(','),
    a.connectors.map((c) => c.name).sort().join(','),
    a.hooks.map((h) => `${h.event}:${h.command}`).sort().join(','),
    a.agents.map((x) => x.name).sort().join(','),
  ].join('|');
}

/**
 * Reads static "Arsenal" (skills/MCP/hooks/subagents) from each active project.
 * i emituje `arsenal-updated`.
 */
export class ArsenalPoller {
  private cache = new Map<string, CacheEntry>();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly world: World, private readonly homeDir: string = os.homedir()) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.refreshOnce();
    this.timer = setInterval(() => void this.refreshOnce(), POLL_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass over all active projects (public for tests). */
  async refreshOnce(): Promise<void> {
    const projectDirs = this.world.activeProjectDirs();
    for (const dir of projectDirs) {
      try {
        await this.refreshProject(dir);
      } catch (err) {
        console.error('[arsenal] refresh failed for', dir, err);
      }
    }
    // GC: remove cache for directories without active sessions after 60s.
    const active = new Set(projectDirs);
    for (const dir of [...this.cache.keys()]) {
      if (!active.has(dir) && Date.now() - (this.cache.get(dir)?.lastSeenMs ?? 0) > 60_000) {
        this.cache.delete(dir);
      }
    }
  }

  private async refreshProject(projectDir: string): Promise<void> {
    const heroes = this.world.heroesByProject(projectDir);
    // Read files from the hero's REAL cwd (workingDir), fallback to projectDir.
    const workingDir = heroes.find((h) => h.workingDir)?.workingDir ?? projectDir;
    const opts = { workingDir, homeDir: this.homeDir };
    const [skills, connectors, hooks, agents] = await Promise.all([
      readSkills(opts), readConnectors(opts), readHooks(opts), readAgents(opts),
    ]);
    const arsenal: ProjectArsenal = {
      projectDir,
      projectName: heroes[0]?.projectName ?? projectDir.split(/[\\/]/).pop() ?? projectDir,
      activeSessions: heroes.length,
      skills, connectors, hooks, agents,
      refreshedAt: Date.now(),
    };
    const fp = fingerprint(arsenal);
    const prev = this.cache.get(projectDir);
    if (prev && prev.fingerprint === fp) {
      prev.lastSeenMs = Date.now();
      return;
    }
    this.cache.set(projectDir, { fingerprint: fp, lastSeenMs: Date.now() });
    // Zapis w stanie świata (a nie ulotny emit) — nowy klient dostaje arsenał
    // w snapshocie, nawet jeśli podłączył się po tym skanie.
    this.world.setArsenal(arsenal);
  }
}
