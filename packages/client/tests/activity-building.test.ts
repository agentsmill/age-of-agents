import { describe, expect, it } from 'vitest';
import { DEFAULT_MAPPING, homeBuildingForTheme } from '@agent-citadel/shared';
import { activityBuildingForAction, activityBuildingForHero } from '../src/game/home-building';

describe('activity building attribution', () => {
  it('keeps working sessions on their mapped tool building', () => {
    expect(activityBuildingForHero('fantasy', {
      state: 'working',
      currentTool: 'Read',
      projectName: 'age-of-agents',
      projectDir: '/repo/age-of-agents',
    }, DEFAULT_MAPPING)).toBe('library');
  });

  it('sends awaiting-input sessions to the theme waiting building', () => {
    expect(activityBuildingForHero('fantasy', {
      state: 'awaiting-input',
      projectName: 'age-of-agents',
      projectDir: '/repo/age-of-agents',
    }, DEFAULT_MAPPING)).toBe('shrine');
  });

  it('routes idle and sleeping sessions to a stable social home', () => {
    expect(activityBuildingForHero('fantasy', {
      state: 'idle',
      sessionId: 'session-a',
      projectName: 'age-of-agents',
      projectDir: '/repo/age-of-agents',
    }, DEFAULT_MAPPING)).toBe(homeBuildingForTheme('fantasy', {
      sessionId: 'session-a',
      projectName: 'age-of-agents',
      projectDir: '/repo/age-of-agents',
    }));
    expect(activityBuildingForHero('fantasy', {
      state: 'sleeping',
      sessionId: 'session-a',
      projectName: 'age-of-agents',
      projectDir: '/repo/age-of-agents',
    }, DEFAULT_MAPPING)).toBe(homeBuildingForTheme('fantasy', {
      sessionId: 'session-a',
      projectName: 'age-of-agents',
      projectDir: '/repo/age-of-agents',
    }));
  });

  it('distributes home buildings by session within the same project', () => {
    expect(homeBuildingForTheme('scifi', {
      sessionId: 'session-a',
      projectName: 'age-of-agents',
      projectDir: '/repo/age-of-agents',
    })).toBe('medbay');
    expect(homeBuildingForTheme('scifi', {
      sessionId: 'session-b',
      projectName: 'age-of-agents',
      projectDir: '/repo/age-of-agents',
    })).toBe('holodeck');
  });

  it('routes returning sessions to the completed social building', () => {
    expect(activityBuildingForHero('fantasy', {
      state: 'returning',
      projectName: 'age-of-agents',
      projectDir: '/repo/age-of-agents',
    }, DEFAULT_MAPPING)).toBe('garden');
    expect(activityBuildingForHero('scifi', {
      state: 'returning',
      projectName: 'age-of-agents',
      projectDir: '/repo/age-of-agents',
    }, DEFAULT_MAPPING)).toBe('hydroponics');
  });

  it('routes recovering sessions to the recovery social building', () => {
    expect(activityBuildingForHero('fantasy', {
      state: 'recovering',
      projectName: 'age-of-agents',
      projectDir: '/repo/age-of-agents',
    }, DEFAULT_MAPPING)).toBe('shrine');
    expect(activityBuildingForHero('scifi', {
      state: 'recovering',
      projectName: 'age-of-agents',
      projectDir: '/repo/age-of-agents',
    }, DEFAULT_MAPPING)).toBe('medbay');
  });

  it('assigns completed action entries to theme resting buildings', () => {
    expect(activityBuildingForAction({ kind: 'completed', projectName: 'age-of-agents', projectDir: '/repo/age-of-agents' }, 'fantasy', DEFAULT_MAPPING)).toBe('garden');
    expect(activityBuildingForAction({ kind: 'completed', projectName: 'age-of-agents', projectDir: '/repo/age-of-agents' }, 'scifi', DEFAULT_MAPPING)).toBe('hydroponics');
  });
});
