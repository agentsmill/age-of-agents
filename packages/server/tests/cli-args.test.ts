import { describe, it, expect } from 'vitest';
import { parseArgs, shouldOpenBrowser } from '../src/cli-args.js';

describe('parseArgs', () => {
  it('defaults: real mode, port 8123, open=auto, no help', () => {
    expect(parseArgs([])).toEqual({ port: 8123, demo: false, open: 'auto', help: false });
  });

  it('--open forces opening (always), --demo, --port <n>', () => {
    expect(parseArgs(['--demo', '--open', '--port', '9000'])).toEqual({
      port: 9000, demo: true, open: 'always', help: false,
    });
  });

  it('--no-open disables opening (never)', () => {
    expect(parseArgs(['--no-open']).open).toBe('never');
  });

  it('supports --port=9001 and -p 9002', () => {
    expect(parseArgs(['--port=9001']).port).toBe(9001);
    expect(parseArgs(['-p', '9002']).port).toBe(9002);
  });

  it('supports -h / --help', () => {
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it('throws on invalid port', () => {
    expect(() => parseArgs(['--port', 'abc'])).toThrow();
    expect(() => parseArgs(['--port', '99999'])).toThrow();
  });

  it('throws on unknown option', () => {
    expect(() => parseArgs(['--cos'])).toThrow(/Unknown option/);
  });

  it('throws when --port/-p has no value', () => {
    expect(() => parseArgs(['-p'])).toThrow();
    expect(() => parseArgs(['--port'])).toThrow();
    expect(() => parseArgs(['--port='])).toThrow();
  });
});

describe('shouldOpenBrowser', () => {
  it('always: always true (even in CI / without TTY)', () => {
    expect(shouldOpenBrowser('always', { ci: true, isTTY: false })).toBe(true);
    expect(shouldOpenBrowser('always', { ci: false, isTTY: true })).toBe(true);
  });

  it('never: always false (even interactively)', () => {
    expect(shouldOpenBrowser('never', { ci: false, isTTY: true })).toBe(false);
  });

  it('auto: opens only interactively (not CI and has TTY)', () => {
    expect(shouldOpenBrowser('auto', { ci: false, isTTY: true })).toBe(true);
    expect(shouldOpenBrowser('auto', { ci: true, isTTY: true })).toBe(false);
    expect(shouldOpenBrowser('auto', { ci: false, isTTY: false })).toBe(false);
    expect(shouldOpenBrowser('auto', { ci: true, isTTY: false })).toBe(false);
  });
});
