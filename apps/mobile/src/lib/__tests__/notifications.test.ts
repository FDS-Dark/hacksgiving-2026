import { describe, expect, it } from '@jest/globals';

import { groupNotifications, notificationTime, unreadCaseIds, type NotificationLike } from '@/lib/notifications';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const item = (id: string, created: Date, read = false, caseId: string | null = 'c1') => ({
  id,
  case_id: caseId,
  created_at: created.toISOString(),
  read_at: read ? created.toISOString() : null,
});

describe('groupNotifications', () => {
  const now = at(21, 20);

  it('splits Today from Earlier and keeps the order', () => {
    const items = [item('a', at(21, 18, 44)), item('b', at(21, 0, 5)), item('c', at(20, 23, 59)), item('d', at(14, 9))];
    expect(groupNotifications(items, now).map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Earlier', ['c', 'd']],
    ]);
  });

  it('leaves out an empty group', () => {
    expect(groupNotifications([item('c', at(20, 9))], now).map((g) => g.title)).toEqual(['Earlier']);
    expect(groupNotifications([], now)).toEqual([]);
  });
});

describe('notificationTime', () => {
  it('shows the time today and the date before', () => {
    expect(notificationTime(at(21, 18, 44).toISOString(), at(21, 20))).toBe('6:44 PM');
    expect(notificationTime(at(20, 18, 44).toISOString(), at(21, 20))).toBe('Fri, Nov 20');
  });
});

describe('unreadCaseIds', () => {
  it('collects cases with unread items only', () => {
    const items: NotificationLike[] = [item('a', at(21, 1), false, 'c1'), item('b', at(21, 2), true, 'c2'), item('c', at(21, 3), false, null)];
    expect([...unreadCaseIds(items)]).toEqual(['c1']);
  });
});
