import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli-args.js';

describe('parseArgs', () => {
  it('domyślnie: realny tryb, port 8123, bez open/help', () => {
    expect(parseArgs([])).toEqual({ port: 8123, demo: false, open: false, help: false });
  });

  it('obsługuje --demo --open --port <n>', () => {
    expect(parseArgs(['--demo', '--open', '--port', '9000'])).toEqual({
      port: 9000, demo: true, open: true, help: false,
    });
  });

  it('obsługuje --port=9001 i -p 9002', () => {
    expect(parseArgs(['--port=9001']).port).toBe(9001);
    expect(parseArgs(['-p', '9002']).port).toBe(9002);
  });

  it('obsługuje -h / --help', () => {
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it('rzuca na nieprawidłowy port', () => {
    expect(() => parseArgs(['--port', 'abc'])).toThrow();
    expect(() => parseArgs(['--port', '99999'])).toThrow();
  });

  it('rzuca na nieznaną opcję', () => {
    expect(() => parseArgs(['--cos'])).toThrow(/Nieznana opcja/);
  });

  it('rzuca gdy --port/-p bez wartości', () => {
    expect(() => parseArgs(['-p'])).toThrow();
    expect(() => parseArgs(['--port'])).toThrow();
    expect(() => parseArgs(['--port='])).toThrow();
  });
});
