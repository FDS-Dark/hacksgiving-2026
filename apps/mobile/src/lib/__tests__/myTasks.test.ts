import { describe, expect, it } from '@jest/globals';

import type { Task } from '@/api/types';
import { bucketOf, groupTasks } from '@/lib/myTasks';

const now = new Date(2026, 10, 21, 15, 0); // 3 PM local
const at = (h: number, dayOffset = 0) => new Date(2026, 10, 21 + dayOffset, h, 0).toISOString();
const task = (id: string, due_at: string | null) => ({ id, title: id, due_at }) as unknown as Task;

describe('my tasks', () => {
  it('buckets by due time relative to now', () => {
    expect(bucketOf({ due_at: at(9) }, now)).toBe('overdue');
    expect(bucketOf({ due_at: at(20) }, now)).toBe('today');
    expect(bucketOf({ due_at: at(9, 1) }, now)).toBe('upcoming');
    expect(bucketOf({ due_at: null }, now)).toBe('undated');
  });

  it('groups overdue first, soonest due first within a group', () => {
    const groups = groupTasks(
      [task('later', at(10, 3)), task('none', null), task('late', at(8)), task('later-soon', at(10, 1)), task('tonight', at(21))],
      now,
    );
    expect(groups.map((g) => g.bucket)).toEqual(['overdue', 'today', 'upcoming', 'undated']);
    expect(groups[2].tasks.map((t) => t.id)).toEqual(['later-soon', 'later']);
  });
});
