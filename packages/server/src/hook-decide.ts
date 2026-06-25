import { randomUUID } from 'node:crypto';
import {
  classifyHookEvent,
  type PermissionPolicy,
  type PermissionRule,
  type PendingQuestion,
  type PendingQuestionOption,
} from '@agent-citadel/shared';
import type { PendingRegistry } from './pending-registry.js';
import { decisionToHookOutput, type HookPayload } from './hooks.js';
import { toolDetail } from './transcript/parser.js';

/**
 * Pulls the question text and options out of an AskUserQuestion tool input.
 * Handles both the nested `{ questions: [{ question, options }] }` shape and a
 * flat `{ question, options }` shape; option items may be strings or objects.
 * Used to render the question read-only in the panel (hooks can't answer it).
 */
export function parseAskUserQuestion(
  input: Record<string, unknown> | undefined,
): { question?: string; options?: PendingQuestionOption[] } {
  if (!input || typeof input !== 'object') return {};
  const nested = Array.isArray((input as { questions?: unknown }).questions)
    ? (input as { questions: unknown[] }).questions[0]
    : input;
  if (!nested || typeof nested !== 'object') return {};
  const q = nested as Record<string, unknown>;
  const question = typeof q.question === 'string' ? q.question
    : typeof q.header === 'string' ? q.header
    : undefined;
  let options: PendingQuestionOption[] | undefined;
  if (Array.isArray(q.options)) {
    options = q.options
      .map((o): PendingQuestionOption => {
        if (typeof o === 'string') return { label: o };
        const oo = (o ?? {}) as Record<string, unknown>;
        return {
          label: typeof oo.label === 'string' ? oo.label : String(oo.label ?? ''),
          description: typeof oo.description === 'string' ? oo.description : undefined,
        };
      })
      .filter((o) => o.label.length > 0);
  }
  return { question, options };
}

export interface DecideDeps {
  policy: PermissionPolicy;
  registry: PendingRegistry;
  /** How long to hold the request open waiting for a human (ms). Keep < hook timeout. */
  timeoutMs: number;
  /** Persist an "allow always" rule. */
  onAlwaysRule: (rule: PermissionRule) => Promise<void>;
}

/**
 * Turns a PreToolUse hook payload into the JSON Claude Code should act on.
 * Returns `{}` for "defer" (print nothing -> normal flow / terminal prompt).
 * Anything blocking goes through the PendingRegistry and waits for the panel.
 */
export async function decideHook(
  body: HookPayload,
  deps: DecideDeps,
): Promise<Record<string, unknown>> {
  const sessionId = body.session_id ?? '';
  const tool = body.tool_name;
  const detail = tool ? toolDetail(tool, body.tool_input) : undefined;
  const classification = classifyHookEvent(
    { hookEvent: body.hook_event_name ?? '', tool, detail, sessionId },
    deps.policy,
  );

  switch (classification.action) {
    case 'defer':
      return {};
    case 'show-question': {
      // Hooks can't answer AskUserQuestion — but we surface it read-only in the
      // panel so the user sees what's being asked. Broadcast a display-only card
      // (not awaited; the terminal still handles the actual answer). The client
      // hides it once the hero leaves the awaiting-input state.
      const { question: questionText, options } = parseAskUserQuestion(
        body.tool_input as Record<string, unknown> | undefined,
      );
      const question: PendingQuestion = {
        id: randomUUID(),
        sessionId,
        source: 'hook',
        kind: 'ask-user-question',
        tool,
        detail: questionText,
        options,
        createdAt: new Date().toISOString(),
      };
      void deps.registry.ask(question, deps.timeoutMs);
      return {};
    }
    case 'allow':
      return decisionToHookOutput('allow');
    case 'deny':
      return decisionToHookOutput('deny', 'Blocked by panel policy');
    case 'ask-permission': {
      const question: PendingQuestion = {
        id: randomUUID(),
        sessionId,
        source: 'hook',
        kind: 'tool-permission',
        tool,
        detail,
        createdAt: new Date().toISOString(),
      };
      const decision = await deps.registry.ask(question, deps.timeoutMs);
      if (!decision) return {}; // timeout / cancelled -> defer
      if (decision.type === 'deny') return decisionToHookOutput('deny', decision.reason);
      if (decision.type === 'allow') {
        if (decision.scope === 'always' && tool) {
          await deps.onAlwaysRule({ tool, match: 'any', decision: 'allow', scope: 'global' });
        }
        return decisionToHookOutput('allow');
      }
      return {}; // unexpected decision shape -> defer
    }
    case 'ask-plan': {
      const question: PendingQuestion = {
        id: randomUUID(),
        sessionId,
        source: 'hook',
        kind: 'plan-approval',
        tool,
        detail,
        createdAt: new Date().toISOString(),
      };
      const decision = await deps.registry.ask(question, deps.timeoutMs);
      if (decision?.type === 'approve-plan') return decisionToHookOutput('allow');
      return {}; // reject / timeout -> defer to terminal (hooks can't reject with feedback)
    }
  }
}
