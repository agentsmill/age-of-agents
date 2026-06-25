import type { HeroSnapshot, HeroStateKind } from '@agent-citadel/shared';
import type { World } from '../world.js';

/**
 * Demo mode: looped story of three scenes (user choice, 2026-06-13):
 *  1. Peon treasure run: subagent works and returns with a crate.
 *  2. Failure and repair: tool error, smoke, fix, fireworks.
 *  3. Git caravan: after work, the hero carries code to the market (commit + push).
 * Client does not distinguish demo from real sessions: same events.
 */

interface Step {
  at: number; // seconds from loop start
  run: (world: World, iteration: number) => void;
}

const LOOP_SECONDS = 58;

function makeHero(world: World, sessionId: string, title: string): HeroSnapshot {
  const now = new Date().toISOString();
  return {
    sessionId,
    title,
    projectDir: '/demo/project',
    model: 'claude-fable-5',
    gitBranch: 'main',
    teamColor: world.claimTeamColor(),
    state: 'idle',
    tokens: { input: 0, output: 0 },
    contextTokens: 24_000, // current context size: bar starts visible and grows in patch()
    startedAt: now,
    lastActivityAt: now,
  };
}

function patch(
  world: World,
  sessionId: string,
  fields: Partial<Pick<HeroSnapshot, 'state' | 'currentTool' | 'toolDetail'>> & { state?: HeroStateKind },
): void {
  const hero = world.getHero(sessionId);
  if (!hero) return;
  const tokens = {
    input: hero.tokens.input + 1200 + Math.floor(((hero.tokens.input * 7919) % 997)),
    output: hero.tokens.output + 350 + ((hero.tokens.output * 31) % 211),
  };
  world.upsertHero({
    ...hero,
    currentTool: undefined,
    toolDetail: undefined,
    ...fields,
    tokens,
    // Simulate growing context (cap 900k) so the bar fills during the loop.
    contextTokens: Math.min(900_000, (hero.contextTokens ?? 24_000) + 16_000),
    lastActivityAt: new Date().toISOString(),
  });
}

function say(world: World, sessionId: string, role: 'user' | 'assistant', text: string): void {
  world.emitTranscriptLine({
    type: 'transcript-line',
    line: { sessionId, role, text, ts: new Date().toISOString() },
  });
}

const H1 = 'demo-smith';
const H2 = 'demo-scout';
const PEON = 'demo-peon-1';

const TIMELINE: Step[] = [
  // --- Scene: failure and repair + git caravan (hero 1) ---
  {
    at: 1,
    run: (w, i) => {
      w.startMission({
        id: `demo-m-fix-${i}`,
        sessionId: H1,
        prompt: 'Fix the payments module — tests have been failing since morning',
        status: 'active',
        startedAt: new Date().toISOString(),
      });
      say(w, H1, 'user', 'Fix the payments module — tests have been failing since morning');
      patch(w, H1, { state: 'thinking' });
    },
  },
  { at: 4, run: (w) => patch(w, H1, { state: 'working', currentTool: 'Grep', toolDetail: 'PaymentError' }) },
  { at: 10, run: (w) => patch(w, H1, { state: 'working', currentTool: 'Edit', toolDetail: 'payments.ts' }) },
  { at: 16, run: (w) => patch(w, H1, { state: 'working', currentTool: 'Bash', toolDetail: 'npm test — payments' }) },
  {
    at: 21,
    run: (w) => {
      say(w, H1, 'assistant', 'Test still red — amount validation rejects zero. Fixing the edge case.');
      patch(w, H1, { state: 'error' });
    },
  },
  { at: 25, run: (w) => patch(w, H1, { state: 'working', currentTool: 'Edit', toolDetail: 'payments.ts — fix' }) },
  { at: 31, run: (w) => patch(w, H1, { state: 'working', currentTool: 'Bash', toolDetail: 'npm test — green ✓' }) },
  { at: 37, run: (w) => patch(w, H1, { state: 'working', currentTool: 'Bash', toolDetail: 'git commit + push' }) },
  {
    at: 43,
    run: (w, i) => {
      say(w, H1, 'assistant', 'Payments module fixed, tests green, changes pushed.');
      patch(w, H1, { state: 'returning' });
      w.completeMission(`demo-m-fix-${i}`, 'completed', new Date().toISOString());
    },
  },
  { at: 50, run: (w) => patch(w, H1, { state: 'idle' }) },

  // --- Scene: peon treasure run (hero 2) ---
  {
    at: 6,
    run: (w, i) => {
      w.startMission({
        id: `demo-m-export-${i}`,
        sessionId: H2,
        prompt: 'Add report export to CSV and PDF',
        status: 'active',
        startedAt: new Date().toISOString(),
      });
      say(w, H2, 'user', 'Add report export to CSV and PDF');
      patch(w, H2, { state: 'thinking' });
    },
  },
  {
    at: 11,
    run: (w) => {
      patch(w, H2, { state: 'working', currentTool: 'Task', toolDetail: 'Research export formats' });
      w.upsertPeon({
        agentId: PEON,
        parentSessionId: H2,
        state: 'working',
        currentTool: 'Grep',
        description: 'Research export formats',
      });
    },
  },
  { at: 14, run: (w) => patch(w, H2, { state: 'thinking' }) },
  { at: 19, run: (w) => w.upsertPeon({ agentId: PEON, parentSessionId: H2, state: 'working', currentTool: 'Bash', description: 'Research export formats' }) },
  { at: 27, run: (w) => w.completePeon(PEON) }, // returns to the hero with a crate
  {
    at: 29,
    run: (w) => {
      say(w, H2, 'assistant', 'Scout is back: csv-stringify + pdfkit are the best fit. Implementing.');
      patch(w, H2, { state: 'working', currentTool: 'Write', toolDetail: 'export.ts' });
    },
  },
  { at: 38, run: (w) => patch(w, H2, { state: 'working', currentTool: 'Bash', toolDetail: 'npm test — export' }) },
  {
    at: 46,
    run: (w, i) => {
      say(w, H2, 'assistant', 'CSV and PDF export ready, with tests.');
      patch(w, H2, { state: 'returning' });
      w.completeMission(`demo-m-export-${i}`, 'completed', new Date().toISOString());
    },
  },
  { at: 53, run: (w) => patch(w, H2, { state: 'idle' }) },
];

export function startDemo(world: World): void {
  world.upsertHero(makeHero(world, H1, 'Fix payments module'));
  world.upsertHero(makeHero(world, H2, 'Report export'));

  const startedAt = Date.now();
  const fired = new Set<string>();

  setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const iteration = Math.floor(elapsed / LOOP_SECONDS);
    const inLoop = elapsed % LOOP_SECONDS;
    for (const step of TIMELINE) {
      const key = `${iteration}:${step.at}`;
      if (inLoop >= step.at && !fired.has(key)) {
        fired.add(key);
        step.run(world, iteration);
      }
    }
  }, 400);
}
