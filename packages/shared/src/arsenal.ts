/** Where an arsenal item comes from, used for the UI badge. */
export type ArsenalOrigin = 'project' | 'user' | 'plugin';

export interface ArsenalSkill {
  /** Bare skill name from SKILL.md frontmatter, e.g. 'brainstorming'. */
  id: string;
  description?: string;
  origin: ArsenalOrigin;
  /** When origin === 'plugin', the plugin name derived from the path. */
  pluginName?: string;
}

export interface ArsenalConnector {
  /** MCP server name (the key in mcpServers), e.g. 'visualize'. */
  name: string;
  origin: ArsenalOrigin;
  transport?: 'stdio' | 'http' | 'sse';
}

export interface ArsenalHook {
  /** Event name, e.g. 'SessionStart', 'PreToolUse'. */
  event: string;
  /** Full hook command; the UI shortens it to the basename. */
  command: string;
  origin: ArsenalOrigin;
}

export interface ArsenalAgent {
  name: string;
  description?: string;
  origin: ArsenalOrigin;
}

/** Source A: the static loadout for one city. */
export interface ProjectArsenal {
  projectDir: string;
  projectName: string;
  activeSessions: number;
  skills: ArsenalSkill[];
  connectors: ArsenalConnector[];
  hooks: ArsenalHook[];
  agents: ArsenalAgent[];
  refreshedAt: number;
}

/** Source B: what the hero actually used, as distinct sets from transcript attribution. */
export interface WieldedArsenal {
  skills: string[];
  connectors: string[];
  plugins: string[];
}
