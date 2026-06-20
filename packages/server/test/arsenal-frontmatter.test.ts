import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../src/arsenal/frontmatter.js';

describe('parseFrontmatter', () => {
  it('extracts name and description from --- block', () => {
    const md = `---\nname: brainstorming\ndescription: Pomysł w projekt\n---\n# Body`;
    expect(parseFrontmatter(md)).toEqual({ name: 'brainstorming', description: 'Pomysł w projekt' });
  });

  it('tolerates missing frontmatter', () => {
    expect(parseFrontmatter('# tylko body')).toEqual({});
  });

  it('takes only the first value after the colon and keeps the rest of the line', () => {
    const md = `---\nname: code-review\ndescription: Review a PR: correctness\n---`;
    expect(parseFrontmatter(md)).toEqual({ name: 'code-review', description: 'Review a PR: correctness' });
  });
});
