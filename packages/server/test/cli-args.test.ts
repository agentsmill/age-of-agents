import { describe, expect, it } from 'vitest';
import { parseSubcommand } from '../src/cli-args.js';

describe('parseSubcommand', () => {
  it('defaults to serve with all args as rest', () => {
    expect(parseSubcommand(['--port', '9000'])).toEqual({ command: 'serve', rest: ['--port', '9000'] });
    expect(parseSubcommand([])).toEqual({ command: 'serve', rest: [] });
  });
  it('detects local + passes the model and trailing args through', () => {
    expect(parseSubcommand(['local', 'bielik:Q4', '--verbose'])).toEqual({ command: 'local', rest: ['bielik:Q4', '--verbose'] });
  });
  it('detects local-proxy', () => {
    expect(parseSubcommand(['local-proxy'])).toEqual({ command: 'local-proxy', rest: [] });
  });
  it('treats a leading flag as serve (not a subcommand)', () => {
    expect(parseSubcommand(['--demo']).command).toBe('serve');
  });
});
