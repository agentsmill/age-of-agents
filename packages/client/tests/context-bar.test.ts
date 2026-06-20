import { describe, it, expect } from 'vitest';
import { contextPct, contextColor } from '../src/hud/context-bar';

describe('contextPct', () => {
  it('liczy procent wzgl. PODANEGO okna', () => {
    expect(contextPct(100_000, 200_000)).toBe(50);
    expect(contextPct(50_000, 1_000_000)).toBe(5);
  });
  it('clamp do 100; zero przy niepoprawnym oknie', () => {
    expect(contextPct(300_000, 200_000)).toBe(100);
    expect(contextPct(1000, 0)).toBe(0);
  });
});

describe('contextColor', () => {
  it('zielony do 60%, żółty do 80%, czerwony powyżej', () => {
    expect(contextColor(5)).toBe('#5dcaa5');
    expect(contextColor(60)).toBe('#5dcaa5');
    expect(contextColor(61)).toBe('#f0d76e');
    expect(contextColor(80)).toBe('#f0d76e');
    expect(contextColor(81)).toBe('#e24b4a');
    expect(contextColor(95)).toBe('#e24b4a');
  });
});
