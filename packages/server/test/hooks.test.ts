import { describe, expect, it } from 'vitest';
import { translateHook } from '../src/hooks.js';

describe('translateHook — Notification', () => {
  const base = { session_id: 's1', cwd: '/Users/x/proj', hook_event_name: 'Notification' as const };

  it('powiadomienie o pozwoleniu → realny alarm awaiting', () => {
    const r = translateHook({ ...base, message: 'Claude needs your permission to use Bash' });
    expect(r?.facts).toEqual([expect.objectContaining({ kind: 'awaiting' })]);
  });

  it('„waiting for your input" (cisza po turze) NIE zapala alarmu', () => {
    // Regresja: ten Notification podbijał spoczywającego bohatera w wieczne "!".
    const r = translateHook({ ...base, message: 'Claude is waiting for your input' });
    expect(r).toBeNull();
  });

  it('Notification bez treści (nieznany) traktujemy zachowawczo jako alarm', () => {
    const r = translateHook({ ...base });
    expect(r?.facts).toEqual([expect.objectContaining({ kind: 'awaiting' })]);
  });

  it('Stop nadal kończy turę (returning), nie alarmuje', () => {
    const r = translateHook({ session_id: 's1', cwd: '/Users/x/proj', hook_event_name: 'Stop' });
    expect(r?.facts).toEqual([expect.objectContaining({ kind: 'turn-end' })]);
  });
});
