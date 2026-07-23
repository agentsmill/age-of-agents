import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { interpretCodexLine, codexSource, isCodexHumanPrompt, codexToolToCanonical, codexSessionRoots } from '../src/sources/codex.js';

const line = (obj: unknown) => JSON.stringify(obj);

describe('interpretCodexLine', () => {
  it('session_meta emits meta with cwd', () => {
    const facts = interpretCodexLine(
      line({ type: 'session_meta', timestamp: '2026-06-14T10:00:00.000Z', payload: { cwd: '/Users/x/proj', model_provider: 'openai' } }),
    );
    expect(facts).toContainEqual({ kind: 'meta', cwd: '/Users/x/proj', model: undefined });
  });

  it('Codex subagent session_meta preserves the parent relationship', () => {
    const facts = interpretCodexLine(
      line({
        type: 'session_meta',
        timestamp: '2026-06-19T20:14:29.437Z',
        payload: {
          id: '019ee185-46ea-7311-bd5a-e77aa01e71f6',
          parent_thread_id: '019ee169-858c-76c3-a9d4-044415be1369',
          thread_source: 'subagent',
          agent_nickname: 'Leibniz',
          agent_role: 'worker',
          cwd: '/Users/x/proj',
          model_provider: 'openai',
        },
      }),
    );
    expect(facts).toContainEqual({
      kind: 'subagent-meta',
      agentId: '019ee185-46ea-7311-bd5a-e77aa01e71f6',
      parentSessionId: '019ee169-858c-76c3-a9d4-044415be1369',
      description: 'Leibniz',
    });
    expect(facts).toContainEqual({ kind: 'meta', cwd: '/Users/x/proj', model: undefined });
  });

  it('turn_context concrete model is preserved and session_meta provider is not treated as a model', () => {
    expect(interpretCodexLine(line({
      type: 'turn_context',
      timestamp: '2026-06-20T11:59:55.986Z',
      payload: { cwd: '/Users/x/age-of-agents', model: 'gpt-5.5' },
    }))).toContainEqual({
      kind: 'meta',
      cwd: '/Users/x/age-of-agents',
      model: 'gpt-5.5',
    });

    expect(interpretCodexLine(line({
      type: 'session_meta',
      timestamp: '2026-06-20T11:59:56.225Z',
      payload: { cwd: '/Users/x/age-of-agents', model_provider: 'openai', thread_source: 'user' },
    }))).toContainEqual({
      kind: 'meta',
      cwd: '/Users/x/age-of-agents',
      model: undefined,
    });
  });

  it('current Codex function_call names normalize to canonical game tools', () => {
    const exec = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T12:00:10.084Z',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call-exec',
        arguments: JSON.stringify({ cmd: 'npm test', workdir: '/repo' }),
      },
    }));
    expect(exec).toContainEqual({
      kind: 'tool-start',
      tool: 'Bash',
      detail: 'npm test',
      messageId: 'call-exec',
      ts: '2026-06-20T12:00:10.084Z',
    });

    const stdin = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T12:00:12.000Z',
      payload: {
        type: 'function_call',
        name: 'write_stdin',
        call_id: 'call-stdin',
        arguments: JSON.stringify({ session_id: 123, chars: 'y\n' }),
      },
    }));
    expect(stdin.find((f) => f.kind === 'tool-start')).toMatchObject({
      kind: 'tool-start',
      tool: 'Bash',
      messageId: 'call-stdin',
    });

    const js = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T12:00:25.638Z',
      payload: {
        type: 'function_call',
        name: 'js',
        call_id: 'call-js',
        arguments: JSON.stringify({ code: 'await page.title()' }),
      },
    }));
    expect(js).toContainEqual({
      kind: 'tool-start',
      tool: 'mcp__node_repl__js',
      detail: 'await page.title()',
      messageId: 'call-js',
      ts: '2026-06-20T12:00:25.638Z',
    });

    const plan = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T11:56:20.263Z',
      payload: {
        type: 'function_call',
        name: 'update_plan',
        call_id: 'call-plan',
        arguments: JSON.stringify({ plan: [{ step: 'Inspect', status: 'in_progress' }] }),
      },
    }));
    expect(plan.find((f) => f.kind === 'tool-start')).toMatchObject({
      kind: 'tool-start',
      tool: 'Workflow',
      detail: 'Inspect',
    });

    const goal = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T12:00:30.000Z',
      payload: {
        type: 'function_call',
        name: 'update_goal',
        call_id: 'call-goal',
        arguments: JSON.stringify({ status: 'complete' }),
      },
    }));
    expect(goal.find((f) => f.kind === 'tool-start')).toMatchObject({
      kind: 'tool-start',
      tool: 'Workflow',
      messageId: 'call-goal',
    });

    const resource = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T12:00:31.000Z',
      payload: {
        type: 'function_call',
        name: 'read_mcp_resource',
        call_id: 'call-resource',
        arguments: JSON.stringify({ server: 'serena', uri: 'memory://project' }),
      },
    }));
    expect(resource.find((f) => f.kind === 'tool-start')).toMatchObject({
      kind: 'tool-start',
      tool: 'Read',
      messageId: 'call-resource',
    });
  });

  it('namespaced Codex function_call records keep their namespace for attribution', () => {
    const serena = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T15:38:07.743Z',
      payload: {
        type: 'function_call',
        name: 'initial_instructions',
        namespace: 'mcp__serena',
        call_id: 'call-serena',
        arguments: '{}',
      },
    }));
    expect(serena).toContainEqual({
      kind: 'tool-start',
      tool: 'mcp__serena__initial_instructions',
      messageId: 'call-serena',
      ts: '2026-06-20T15:38:07.743Z',
    });

    const wait = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T07:37:40.903Z',
      payload: {
        type: 'function_call',
        name: 'wait_agent',
        namespace: 'multi_agent_v1',
        call_id: 'call-wait',
        arguments: JSON.stringify({ targets: ['agent-1'], timeout_ms: 600000 }),
      },
    }));
    expect(wait.find((f) => f.kind === 'tool-start')).toMatchObject({
      kind: 'tool-start',
      tool: 'mcp__multi_agent_v1__wait_agent',
      messageId: 'call-wait',
    });

    const spawn = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T07:37:41.000Z',
      payload: {
        type: 'function_call',
        name: 'spawn_agent',
        namespace: 'multi_agent_v1',
        call_id: 'call-spawn',
        arguments: JSON.stringify({ message: 'Inspect parser behavior' }),
      },
    }));
    expect(spawn.find((f) => f.kind === 'tool-start')).toMatchObject({
      kind: 'tool-start',
      tool: 'Workflow',
      messageId: 'call-spawn',
    });

    const close = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T07:37:42.000Z',
      payload: {
        type: 'function_call',
        name: 'close_agent',
        namespace: 'multi_agent_v1',
        call_id: 'call-close',
        arguments: JSON.stringify({ target: 'agent-1' }),
      },
    }));
    expect(close.find((f) => f.kind === 'tool-start')).toMatchObject({
      kind: 'tool-start',
      tool: 'mcp__multi_agent_v1__close_agent',
      messageId: 'call-close',
    });
  });

  it('current Codex custom/tool-search records become canonical tool-start facts', () => {
    const patch = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T11:55:00.000Z',
      payload: {
        type: 'custom_tool_call',
        name: 'apply_patch',
        call_id: 'call-patch',
        input: '*** Begin Patch\n*** Update File: packages/server/src/sources/codex.ts\n@@\n-a\n+b\n*** End Patch',
      },
    }));
    expect(patch.find((f) => f.kind === 'tool-start')).toMatchObject({
      kind: 'tool-start',
      tool: 'Edit',
      detail: 'codex.ts',
    });

    const search = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T12:00:20.394Z',
      payload: { type: 'tool_search_call', call_id: 'call-search', query: 'browser control' },
    }));
    expect(search).toContainEqual({
      kind: 'tool-start',
      tool: 'ToolSearch',
      detail: 'browser control',
      messageId: 'call-search',
      ts: '2026-06-20T12:00:20.394Z',
    });
  });

  it('Codex token_count preserves cumulative totals and current context usage', () => {
    expect(interpretCodexLine(line({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          model_context_window: 258400,
          total_token_usage: {
            input_tokens: 37049245,
            cached_input_tokens: 35437952,
            output_tokens: 178333,
            reasoning_output_tokens: 24685,
            total_tokens: 37227578,
          },
          last_token_usage: {
            input_tokens: 180825,
            cached_input_tokens: 179072,
            output_tokens: 227,
            reasoning_output_tokens: 98,
            total_tokens: 181052,
          },
        },
      },
    }))).toContainEqual({
      kind: 'usage-total',
      input: 37049245,
      output: 178333,
      context: 180825,
      contextWindow: 258400,
      cachedInput: 35437952,
      reasoningOutput: 24685,
      last: { input: 180825, output: 227, cachedInput: 179072, reasoningOutput: 98 },
    });
  });

  it('Codex compacted records do not end the current task', () => {
    expect(interpretCodexLine(line({
      type: 'compacted',
      timestamp: '2026-06-20T10:57:08.706Z',
      payload: { window_id: 1, window_number: 2 },
    }))).toEqual([]);
  });

  it('Codex token_count ignores malformed token values without emitting NaN', () => {
    expect(interpretCodexLine(line({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 'not-a-number',
            cached_input_tokens: 'also-bad',
            output_tokens: '12',
            reasoning_output_tokens: '42',
          },
          last_token_usage: {
            input_tokens: 'bad',
            cached_input_tokens: 'bad-cache',
            output_tokens: 7,
            reasoning_output_tokens: '3',
          },
        },
      },
    }))).toContainEqual({
      kind: 'usage-total',
      input: 0,
      output: 12,
      reasoningOutput: 42,
      last: { input: 0, output: 7, reasoningOutput: 3 },
    });
  });

  it('real user prompt -> prompt fact; injections -> nothing', () => {
    const userMsg = (text: string) =>
      interpretCodexLine(line({ type: 'response_item', timestamp: '2026-06-14T10:00:00.000Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }));
    expect(userMsg('Dodaj endpoint /health')).toContainEqual({ kind: 'prompt', text: 'Dodaj endpoint /health', ts: '2026-06-14T10:00:00.000Z' });
    expect(userMsg('<codex_delegation>\n  <source_thread_id>parent</source_thread_id>\n  <input>Run read-only telemetry check</input>\n</codex_delegation>'))
      .toContainEqual({ kind: 'prompt', text: 'Run read-only telemetry check', ts: '2026-06-14T10:00:00.000Z' });
    expect(userMsg('<codex_delegation>\n  <input>Missing source id</input>\n</codex_delegation>')).toEqual([]);
    expect(userMsg('<codex_delegation>\n  <source_thread_id>parent</source_thread_id>\n  <input>One</input>\n  <input>Two</input>\n</codex_delegation>')).toEqual([]);
    expect(userMsg('<codex_delegation>\n  <source_thread_id>parent</source_thread_id>\n  <input><environment_context></environment_context></input>\n</codex_delegation>')).toEqual([]);
    expect(userMsg('<environment_context>\n  <cwd>/x</cwd>\n</environment_context>')).toEqual([]);
    expect(userMsg('# AGENTS.md instructions for /x')).toEqual([]);
    // Developer role (permission instructions) -> not a prompt.
    expect(interpretCodexLine(line({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'normalny tekst' }] } }))).toEqual([]);
  });

  it('reasoning → thinking; assistant output_text → assistant-text', () => {
    expect(interpretCodexLine(line({ type: 'response_item', timestamp: '2026-06-14T10:00:01.000Z', payload: { type: 'reasoning', summary: [] } })))
      .toContainEqual({ kind: 'thinking', ts: '2026-06-14T10:00:01.000Z' });
    expect(interpretCodexLine(line({ type: 'response_item', timestamp: '2026-06-14T10:00:02.000Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Zrobione.' }] } })))
      .toContainEqual({ kind: 'assistant-text', text: 'Zrobione.', ts: '2026-06-14T10:00:02.000Z' });
  });

  it('function_call shell/apply_patch/web_search -> tool-start with canonical name and detail', () => {
    const shell = interpretCodexLine(line({ type: 'response_item', timestamp: '2026-06-14T10:00:03.000Z', payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }) } }));
    expect(shell).toContainEqual({ kind: 'tool-start', tool: 'Bash', detail: 'npm test', messageId: 'c1', ts: '2026-06-14T10:00:03.000Z' });

    const patch = interpretCodexLine(line({ type: 'response_item', timestamp: '2026-06-14T10:00:04.000Z', payload: { type: 'function_call', name: 'apply_patch', call_id: 'c2', arguments: JSON.stringify({ input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n-x\n+y\n*** End Patch' }) } }));
    expect(patch.find((f) => f.kind === 'tool-start')).toMatchObject({ kind: 'tool-start', tool: 'Edit' });

    const web = interpretCodexLine(line({ type: 'response_item', payload: { type: 'function_call', name: 'web_search', call_id: 'c3', arguments: JSON.stringify({ query: 'rust async' }) } }));
    expect(web.find((f) => f.kind === 'tool-start')).toMatchObject({ kind: 'tool-start', tool: 'WebSearch', detail: 'rust async' });
  });

  it('token_count → usage-total with current context when present; task_complete → turn-end', () => {
    expect(interpretCodexLine(line({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 1200, output_tokens: 300 },
          last_token_usage: { input_tokens: 700, output_tokens: 40, total_tokens: 740 },
          model_context_window: 258400,
        },
      },
    })))
      .toContainEqual({
        kind: 'usage-total',
        input: 1200,
        output: 300,
        context: 700,
        contextWindow: 258400,
        last: { input: 700, output: 40 },
      });
    expect(interpretCodexLine(line({ type: 'event_msg', timestamp: '2026-06-14T10:05:00.000Z', payload: { type: 'task_complete' } })))
      .toContainEqual({ kind: 'turn-end', ts: '2026-06-14T10:05:00.000Z' });
  });

  it('garbage and unknown records -> empty list / valid tool-result', () => {
    expect(interpretCodexLine('to nie json{')).toEqual([]);
    expect(interpretCodexLine(line({ type: 'response_item', payload: { type: 'function_call_output', output: { exit_code: 0 } } }))).toContainEqual({ kind: 'tool-result', isError: false, ts: expect.any(String) });
    expect(interpretCodexLine(line({ type: 'totally_unknown' }))).toEqual([]);
  });

  it('Codex lifecycle events update semantic session state', () => {
    expect(interpretCodexLine(line({
      type: 'event_msg',
      timestamp: '2026-06-20T19:00:00.000Z',
      payload: { type: 'task_started', turn_id: 'turn-1' },
    }))).toContainEqual({ kind: 'thinking', ts: '2026-06-20T19:00:00.000Z' });

    expect(interpretCodexLine(line({
      type: 'event_msg',
      timestamp: '2026-06-20T19:01:00.000Z',
      payload: { type: 'turn_aborted', reason: 'interrupted' },
    }))).toContainEqual({ kind: 'turn-aborted', ts: '2026-06-20T19:01:00.000Z' });
  });
});

describe('helpers (tuning points)', () => {
  it('isCodexHumanPrompt: true for tasks, false for injections/role', () => {
    expect(isCodexHumanPrompt('Napraw bug', 'user')).toBe(true);
    expect(isCodexHumanPrompt('<environment_context></environment_context>', 'user')).toBe(false);
    expect(isCodexHumanPrompt('Napraw bug', 'developer')).toBe(false);
  });
  it('codexToolToCanonical: maps Codex tools to game names', () => {
    expect(codexToolToCanonical('shell')).toBe('Bash');
    expect(codexToolToCanonical('apply_patch')).toBe('Edit');
    expect(codexToolToCanonical('read_file')).toBe('Read');
    expect(codexToolToCanonical('web_search')).toBe('WebSearch');
    expect(codexToolToCanonical('pencil__draw')).toBe('mcp__pencil__draw');
  });
  it('codexToolToCanonical: maps dotted Codex-local tools before MCP fallback', () => {
    expect(codexToolToCanonical('functions.write_stdin')).toBe('Bash');
    expect(codexToolToCanonical('write_stdin')).toBe('Bash');
    expect(codexToolToCanonical('request_user_input')).toBe('AskUserQuestion');
    expect(codexToolToCanonical('functions.request_user_input')).toBe('AskUserQuestion');
    expect(codexToolToCanonical('functions.view_image')).toBe('Read');
    expect(codexToolToCanonical('functions.apply_patch')).toBe('Edit');
    expect(codexToolToCanonical('web.run')).toBe('WebSearch');
    expect(codexToolToCanonical('update_goal')).toBe('Workflow');
    expect(codexToolToCanonical('create_goal')).toBe('Workflow');
    expect(codexToolToCanonical('get_goal')).toBe('Workflow');
    expect(codexToolToCanonical('functions.update_goal')).toBe('Workflow');
    expect(codexToolToCanonical('functions.create_goal')).toBe('Workflow');
    expect(codexToolToCanonical('functions.get_goal')).toBe('Workflow');
    expect(codexToolToCanonical('functions.exec_command')).toBe('Bash');
    expect(codexToolToCanonical('multi_tool_use.parallel')).toBe('Workflow');
    expect(codexToolToCanonical('tool_search.tool_search_tool')).toBe('ToolSearch');
    expect(codexToolToCanonical('image_gen.imagegen')).toBe('Edit');
    expect(codexToolToCanonical('list_mcp_resources')).toBe('ToolSearch');
    expect(codexToolToCanonical('list_mcp_resource_templates')).toBe('ToolSearch');
    expect(codexToolToCanonical('read_mcp_resource')).toBe('Read');
    expect(codexToolToCanonical('list_mcp_resources', 'functions')).toBe('ToolSearch');
    expect(codexToolToCanonical('list_mcp_resource_templates', 'functions')).toBe('ToolSearch');
    expect(codexToolToCanonical('read_mcp_resource', 'functions')).toBe('Read');
    expect(codexToolToCanonical('mcp__server__tool')).toBe('mcp__server__tool');
    expect(codexToolToCanonical('wait_agent', 'multi_agent_v1')).toBe('mcp__multi_agent_v1__wait_agent');
    expect(codexToolToCanonical('send_input', 'multi_agent_v1')).toBe('mcp__multi_agent_v1__send_input');
    expect(codexToolToCanonical('close_agent', 'multi_agent_v1')).toBe('mcp__multi_agent_v1__close_agent');
    expect(codexToolToCanonical('spawn_agent', 'multi_agent_v1')).toBe('Workflow');
  });
});

describe('codexSource.classify', () => {
  const root = '/Users/x/.codex/sessions';
  it('rollout -> session with sessionId from filename UUID', () => {
    const p = `${root}/2026/02/07/rollout-2026-02-07T01-14-55-019c3573-9d33-7fc2-8fc8-56cebffe1d6b.jsonl`;
    expect(codexSource.classify(p, root)).toEqual({ kind: 'session', sessionId: '019c3573-9d33-7fc2-8fc8-56cebffe1d6b', projectDir: '' });
  });
  it('non-rollout file -> other', () => {
    expect(codexSource.classify(`${root}/2026/02/07/notes.jsonl`, root).kind).toBe('other');
  });
});

describe('codexSessionRoots', () => {
  it('scopes watching to recent date folders instead of the whole sessions tree', () => {
    const roots = codexSessionRoots('/Users/x/.codex/sessions', new Date(2026, 5, 19, 12), 1);
    expect(roots).toEqual([
      join('/Users/x/.codex/sessions', '2026', '06', '18'),
      join('/Users/x/.codex/sessions', '2026', '06', '19'),
      join('/Users/x/.codex/sessions', '2026', '06', '20'),
    ]);
  });

  it('can include a bounded future window for runtime watchers', () => {
    const roots = codexSessionRoots('/Users/x/.codex/sessions', new Date(2026, 5, 19, 12), 1, 7);
    expect(roots).toEqual([
      join('/Users/x/.codex/sessions', '2026', '06', '18'),
      join('/Users/x/.codex/sessions', '2026', '06', '19'),
      join('/Users/x/.codex/sessions', '2026', '06', '20'),
      join('/Users/x/.codex/sessions', '2026', '06', '21'),
      join('/Users/x/.codex/sessions', '2026', '06', '22'),
      join('/Users/x/.codex/sessions', '2026', '06', '23'),
      join('/Users/x/.codex/sessions', '2026', '06', '24'),
      join('/Users/x/.codex/sessions', '2026', '06', '25'),
      join('/Users/x/.codex/sessions', '2026', '06', '26'),
    ]);
  });
});
