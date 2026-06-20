import { describe, it, expect } from 'vitest';
import { contextPct, contextColor } from '../src/hud/context-bar';

describe('contextPct', () => {
  it('calculates percent relative to the PROVIDED window', () => {
    expect(contextPct(100_000, 200_000)).toBe(50);
    expect(contextPct(50_000, 1_000_000)).toBe(5);
  });
  it('clamps to 100; zero for invalid window', () => {
    expect(contextPct(300_000, 200_000)).toBe(100);
    expect(contextPct(1000, 0)).toBe(0);
  });
  it('clamps negative tokens to 0', () => {
    expect(contextPct(-1000, 200_000)).toBe(0);
  });
  it('returns 0 for non-finite inputs', () => {
    expect(contextPct(Number.NaN, 200_000)).toBe(0);
    expect(contextPct(Number.POSITIVE_INFINITY, 200_000)).toBe(0);
    expect(contextPct(1000, Number.NaN)).toBe(0);
    expect(contextPct(1000, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('contextColor', () => {
  it('green low, red high', () => {
    expect(contextColor(5)).toBe('#5dcaa5');
    expect(contextColor(60)).toBe('#5dcaa5');
    expect(contextColor(61)).toBe('#f0d76e');
    expect(contextColor(80)).toBe('#f0d76e');
    expect(contextColor(81)).toBe('#e24b4a');
    expect(contextColor(95)).toBe('#e24b4a');
  });
});
