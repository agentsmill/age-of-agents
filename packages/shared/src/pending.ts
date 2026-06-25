/** Protocol + pure logic for answering agent questions from the panel. */

// ---- Pending question (server -> client) ----

export type PendingQuestionKind =
  | 'tool-permission'
  | 'plan-approval'
  | 'ask-user-question'
  | 'free-text';

export interface PendingQuestionOption {
  label: string;
  description?: string;
}

export interface PendingQuestion {
  id: string;
  sessionId: string;
  source: 'hook' | 'sdk';
  kind: PendingQuestionKind;
  tool?: string;
  detail?: string;
  options?: PendingQuestionOption[];
  createdAt: string;
}

// ---- Answer (client -> server) ----

export type QuestionDecision =
  | { type: 'allow'; scope?: 'once' | 'always' }
  | { type: 'deny'; reason?: string }
  | { type: 'approve-plan' }
  | { type: 'reject-plan'; reason?: string }
  | { type: 'select'; optionLabels: string[] }
  | { type: 'text'; text: string };

export interface QuestionAnswer {
  id: string;
  decision: QuestionDecision;
}

// ---- Permission policy (data, editable) ----

export type PolicyMatch = 'any' | 'prefix';

export interface PermissionRule {
  tool: string;
  match: PolicyMatch;
  /** Required when match === 'prefix': matched against the tool detail. */
  value?: string;
  decision: 'allow' | 'deny';
  /** 'global' (default) or `session:<id>`. */
  scope?: string;
}

export interface PermissionPolicy {
  /** Master switch. OFF (default) => app stays a passive observer. */
  enabled: boolean;
  rules: PermissionRule[];
}

export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = { enabled: false, rules: [] };

/** Read-only / non-mutating tools that never need a panel decision. */
export const SAFE_TOOLS: ReadonlySet<string> = new Set([
  'Read', 'Glob', 'Grep', 'NotebookRead', 'BashOutput', 'TodoWrite', 'LSP', 'ToolSearch',
]);

export function isSafeTool(tool: string): boolean {
  return SAFE_TOOLS.has(tool);
}

/** Whether a rule applies to this session (global rules always apply). */
function ruleInScope(rule: PermissionRule, sessionId: string): boolean {
  if (!rule.scope || rule.scope === 'global') return true;
  return rule.scope === `session:${sessionId}`;
}

function ruleMatches(rule: PermissionRule, tool: string, detail: string | undefined): boolean {
  if (rule.tool !== tool) return false;
  if (rule.match === 'any') return true;
  if (rule.match === 'prefix') return typeof detail === 'string' && !!rule.value && detail.startsWith(rule.value);
  return false;
}

/**
 * Decide a tool-permission outcome from the policy alone:
 *  - explicit rule (deny wins over allow within the same scope set) -> its decision
 *  - safe-list -> allow
 *  - otherwise -> pending (needs a human)
 * Deny rules are checked before the safe-list so a user can block even a safe tool.
 */
export function evaluatePolicy(
  tool: string,
  detail: string | undefined,
  policy: PermissionPolicy,
  sessionId: string,
): 'allow' | 'deny' | 'pending' {
  const applicable = policy.rules.filter((r) => ruleInScope(r, sessionId) && ruleMatches(r, tool, detail));
  if (applicable.some((r) => r.decision === 'deny')) return 'deny';
  if (applicable.some((r) => r.decision === 'allow')) return 'allow';
  if (isSafeTool(tool)) return 'allow';
  return 'pending';
}

// ---- Hook classification (used by the /hooks/decide route) ----

export interface HookDecideInput {
  hookEvent: string;
  tool?: string;
  detail?: string;
  sessionId: string;
}

export type HookClassification =
  | { action: 'defer' }          // print nothing; normal flow / terminal prompt
  | { action: 'allow' }          // auto-allow (safe-list or rule)
  | { action: 'deny' }           // auto-deny (rule)
  | { action: 'ask-permission' } // register tool-permission pending, block
  | { action: 'ask-plan' }       // register plan-approval pending, block
  | { action: 'show-question' }; // AskUserQuestion: display only, defer to terminal

export function classifyHookEvent(input: HookDecideInput, policy: PermissionPolicy): HookClassification {
  if (input.hookEvent !== 'PreToolUse') return { action: 'defer' };
  if (!policy.enabled) return { action: 'defer' };
  const tool = input.tool;
  if (!tool) return { action: 'defer' };
  if (tool === 'AskUserQuestion') return { action: 'show-question' };
  if (tool === 'ExitPlanMode') return { action: 'ask-plan' };
  const outcome = evaluatePolicy(tool, input.detail, policy, input.sessionId);
  if (outcome === 'allow') return { action: 'allow' };
  if (outcome === 'deny') return { action: 'deny' };
  return { action: 'ask-permission' };
}

// ---- Validators (runtime guards for file + WS input) ----

export function validatePermissionPolicy(
  input: unknown,
): { ok: true; config: PermissionPolicy } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Policy must be an object.' };
  const obj = input as Record<string, unknown>;
  if (typeof obj.enabled !== 'boolean') return { ok: false, error: 'Field "enabled" must be a boolean.' };
  if (!Array.isArray(obj.rules)) return { ok: false, error: 'Missing "rules" array.' };
  const rules: PermissionRule[] = [];
  for (let i = 0; i < obj.rules.length; i++) {
    const raw = obj.rules[i];
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: `Rule ${i}: not an object.` };
    const r = raw as Record<string, unknown>;
    if (typeof r.tool !== 'string' || !r.tool) return { ok: false, error: `Rule ${i}: "tool" required.` };
    if (r.match !== 'any' && r.match !== 'prefix') return { ok: false, error: `Rule ${i}: "match" must be any|prefix.` };
    if (r.decision !== 'allow' && r.decision !== 'deny') return { ok: false, error: `Rule ${i}: "decision" must be allow|deny.` };
    const rule: PermissionRule = { tool: r.tool, match: r.match, decision: r.decision };
    if (r.match === 'prefix') {
      if (typeof r.value !== 'string' || !r.value) return { ok: false, error: `Rule ${i}: "prefix" requires "value".` };
      rule.value = r.value;
    }
    if (r.scope !== undefined) {
      if (typeof r.scope !== 'string' || !r.scope) return { ok: false, error: `Rule ${i}: "scope" must be a non-empty string.` };
      rule.scope = r.scope;
    }
    rules.push(rule);
  }
  return { ok: true, config: { enabled: obj.enabled, rules } };
}

export function validateQuestionAnswer(
  input: unknown,
): { ok: true; answer: QuestionAnswer } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Answer must be an object.' };
  const obj = input as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !obj.id) return { ok: false, error: 'Missing "id".' };
  const d = obj.decision as Record<string, unknown> | undefined;
  if (typeof d !== 'object' || d === null) return { ok: false, error: 'Missing "decision".' };
  const t = d.type;
  const known = ['allow', 'deny', 'approve-plan', 'reject-plan', 'select', 'text'];
  if (typeof t !== 'string' || !known.includes(t)) return { ok: false, error: `Unknown decision type ${String(t)}.` };
  return { ok: true, answer: { id: obj.id, decision: d as unknown as QuestionDecision } };
}

// ---- Launch agent request (client -> server) ----

/** Permission modes we expose in the launch dialog (subset of the SDK's). */
export type SdkPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
export const SDK_PERMISSION_MODES: readonly SdkPermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];

export interface LaunchAgentRequest {
  cwd: string;
  prompt: string;
  model?: string;
  permissionMode: SdkPermissionMode;
}

export function validateLaunchRequest(
  input: unknown,
): { ok: true; value: LaunchAgentRequest } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Request must be an object.' };
  const o = input as Record<string, unknown>;
  if (typeof o.cwd !== 'string' || !o.cwd.trim()) return { ok: false, error: '"cwd" required.' };
  if (typeof o.prompt !== 'string' || !o.prompt.trim()) return { ok: false, error: '"prompt" required.' };
  let permissionMode: SdkPermissionMode = 'default';
  if (o.permissionMode !== undefined) {
    if (!SDK_PERMISSION_MODES.includes(o.permissionMode as SdkPermissionMode)) {
      return { ok: false, error: `Unknown permissionMode ${String(o.permissionMode)}.` };
    }
    permissionMode = o.permissionMode as SdkPermissionMode;
  }
  const value: LaunchAgentRequest = { cwd: o.cwd.trim(), prompt: o.prompt, permissionMode };
  if (o.model !== undefined) {
    if (typeof o.model !== 'string') return { ok: false, error: '"model" must be a string.' };
    if (o.model.trim()) value.model = o.model.trim();
  }
  return { ok: true, value };
}
