import { describe, expect, it } from '@jest/globals';

import type { Case } from '@/api/types';
import { needsAttention } from '@/lib/attention';

let n = 1000;
function make(overrides: Partial<Case>): Case {
  n += 1;
  return {
    id: `id-${n}`,
    number: n,
    title: `Case ${n}`,
    status: 'in_progress',
    priority: 'medium',
    assigned_worker_id: 'w1',
    ...overrides,
  } as Case;
}

describe('needsAttention', () => {
  it('lists urgent, then new, then unassigned, each case once', () => {
    const urgentNew = make({ priority: 'critical', status: 'new', assigned_worker_id: null });
    const fresh = make({ status: 'new' });
    const loose = make({ assigned_worker_id: null });
    const fine = make({});
    const result = needsAttention([fine, loose, fresh, urgentNew]);
    expect(result.map((r) => [r.item.id, r.reason])).toEqual([
      [urgentNew.id, 'urgent'],
      [fresh.id, 'new'],
      [loose.id, 'unassigned'],
    ]);
  });

  it('leaves out resolved and closed cases', () => {
    const done = make({ priority: 'critical', status: 'resolved' });
    const closed = make({ status: 'closed', assigned_worker_id: null });
    expect(needsAttention([done, closed])).toEqual([]);
  });

  it('stops at the limit', () => {
    const many = Array.from({ length: 8 }, () => make({ priority: 'high' }));
    expect(needsAttention(many, 3)).toHaveLength(3);
  });
});
