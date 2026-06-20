import { describe, it, expect } from 'vitest';
import { toolToBuilding } from '../src/theme/mapping';

describe('toolToBuilding', () => {
  it('maps tools to the right buildings (game metaphor)', () => {
    expect(toolToBuilding('Edit')).toBe('forge');
    expect(toolToBuilding('Write')).toBe('forge');
    expect(toolToBuilding('Read')).toBe('library');
    expect(toolToBuilding('Grep')).toBe('library');
    expect(toolToBuilding('Bash')).toBe('mine');
    expect(toolToBuilding('Task')).toBe('barracks');
    expect(toolToBuilding('WebSearch')).toBe('tower');
  });

  it('subagent tools: StructuredOutput->barracks, ToolSearch->library, KillShell->mine', () => {
    expect(toolToBuilding('StructuredOutput')).toBe('barracks');
    expect(toolToBuilding('ToolSearch')).toBe('library');
    expect(toolToBuilding('KillShell')).toBe('mine');
  });

  it('Bash with git command -> market (caravan with goods)', () => {
    expect(toolToBuilding('Bash', 'git commit -m "x"')).toBe('market');
    expect(toolToBuilding('Bash', 'git push origin main')).toBe('market');
  });

  it('Bash without git -> mine (GIT_RE distinction)', () => {
    expect(toolToBuilding('Bash', 'ls -la')).toBe('mine');
    expect(toolToBuilding('Bash', 'echo git is mentioned')).toBe('mine');
  });

  it('any mcp__ tool -> guild', () => {
    expect(toolToBuilding('mcp__pixellab__get_balance')).toBe('guild');
    expect(toolToBuilding('mcp__whatever')).toBe('guild');
  });

  it('unknown tool and missing tool -> citadel (fallback)', () => {
    expect(toolToBuilding('TotallyUnknownTool')).toBe('citadel');
    expect(toolToBuilding(undefined)).toBe('citadel');
  });
});
