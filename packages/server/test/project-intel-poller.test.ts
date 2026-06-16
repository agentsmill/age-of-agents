import { describe, expect, it } from 'vitest';
import { parseBeadsJsonl, bdRowToIssue } from '../src/intel/project-intel-poller.js';

describe('bdRowToIssue', () => {
  it('mapuje snake_case → camelCase i liczy zależności', () => {
    const issue = bdRowToIssue({
      id: 'AoA-1',
      title: 'Napraw X',
      status: 'in_progress',
      priority: 1,
      issue_type: 'bug',
      assignee: 'mpawelczuk',
      dependencies: [
        { type: 'blocks', id: 'AoA-2' },
        { type: 'blocks', id: 'AoA-3' },
        { type: 'blocked_by', id: 'AoA-9' },
      ],
      created_at: 1000,
      updated_at: 2000,
    });
    expect(issue).toEqual({
      id: 'AoA-1',
      title: 'Napraw X',
      status: 'in_progress',
      priority: 1,
      issueType: 'bug',
      assignee: 'mpawelczuk',
      blocksCount: 2,
      blockedByCount: 1,
      createdAt: 1000,
      updatedAt: 2000,
    });
  });

  it('zwraca null bez id', () => {
    expect(bdRowToIssue({ title: 'bez id' })).toBeNull();
  });

  it('stosuje wartości domyślne (untitled/open/P2/task) i akceptuje pole type', () => {
    const issue = bdRowToIssue({ id: 'AoA-5', type: 'feature' });
    expect(issue).toMatchObject({
      id: 'AoA-5',
      title: '(untitled)',
      status: 'open',
      priority: 2,
      issueType: 'feature',
      assignee: undefined,
      blocksCount: 0,
      blockedByCount: 0,
    });
  });
});

describe('parseBeadsJsonl', () => {
  it('parsuje wiele linii, pomija puste/komentarze/nie-JSON i wiersze bez id', () => {
    const content = [
      '# komentarz bd',
      '',
      '{"id":"AoA-1","title":"Pierwsze","status":"open","priority":0}',
      '   ', // sama biel
      'to nie jest JSON',
      '{"title":"bez id — pominięte"}',
      '{"id":"AoA-2","title":"Drugie","status":"closed","priority":3,"issue_type":"task"}',
    ].join('\n');

    const issues = parseBeadsJsonl(content);
    expect(issues.map((i) => i.id)).toEqual(['AoA-1', 'AoA-2']);
    expect(issues[0]).toMatchObject({ title: 'Pierwsze', status: 'open', priority: 0 });
    expect(issues[1]).toMatchObject({ title: 'Drugie', status: 'closed', issueType: 'task' });
  });

  it('zwraca pustą tablicę dla pustej treści', () => {
    expect(parseBeadsJsonl('')).toEqual([]);
    expect(parseBeadsJsonl('\n\n# tylko komentarz\n')).toEqual([]);
  });
});
