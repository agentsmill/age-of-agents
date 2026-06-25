/** Minimal frontmatter parser for SKILL.md/agents: block between first --- and ---.
 *  Reads only `name` and `description` (one line = one value). No YAML dependency. */
export function parseFrontmatter(content: string): { name?: string; description?: string } {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return {};
  const out: { name?: string; description?: string } = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') break;
    const m = /^(name|description)\s*:\s*(.*)$/.exec(line);
    if (m) {
      const key = m[1] as 'name' | 'description';
      const value = m[2].trim();
      if (value) out[key] = value;
    }
  }
  return out;
}
