import { describe, expect, it } from '@jest/globals';

import type { Case, Task } from '@/api/types';
import { sortTasks } from '@/components/staff/case/CaseTasks';
import { caseChanges } from '@/components/staff/case/UpdateCaseSheet';
import { titleFrom } from '@/lib/cases';

const kase = { status: 'new', priority: 'medium', category: 'other', assigned_worker_id: null } as unknown as Case;

describe('caseChanges', () => {
  it('sends only what changed', () => {
    expect(caseChanges(kase, { status: 'new', priority: 'medium', category: 'other', assigned_worker_id: null })).toEqual({});
    expect(caseChanges(kase, { status: 'in_progress', priority: 'medium', category: 'other', assigned_worker_id: 'w1' })).toEqual({
      status: 'in_progress',
      assigned_worker_id: 'w1',
    });
  });

  it('can unassign', () => {
    const held = { ...kase, assigned_worker_id: 'w1' } as Case;
    expect(caseChanges(held, { status: 'new', priority: 'medium', category: 'other', assigned_worker_id: null })).toEqual({ assigned_worker_id: null });
  });
});

describe('sortTasks', () => {
  const t = (id: string, status: 'open' | 'done', due: string | null) => ({ id, status, due_at: due }) as unknown as Task;
  it('puts open tasks first, soonest due first, undated last', () => {
    const sorted = sortTasks([t('done', 'done', null), t('later', 'open', '2026-11-23T10:00:00Z'), t('none', 'open', null), t('soon', 'open', '2026-11-22T10:00:00Z')]);
    expect(sorted.map((x) => x.id)).toEqual(['soon', 'later', 'none', 'done']);
  });
});

describe('titleFrom', () => {
  it('uses the first sentence', () => {
    expect(titleFrom('Family evicted today. Two kids, 6 and 9.')).toBe('Family evicted today.');
  });
  it('shortens a long first sentence', () => {
    const title = titleFrom('a'.repeat(120));
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith('…')).toBe(true);
  });
});
