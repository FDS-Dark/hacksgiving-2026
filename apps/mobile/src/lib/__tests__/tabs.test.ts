import { describe, expect, it } from '@jest/globals';

import { tabAction, type TabTarget } from '@/lib/tabs';

const me: TabTarget = { href: '/me', match: (p) => p === '/me' || p === '/opportunities' };
const queue: TabTarget = { href: '/staff/cases', match: (p) => p.startsWith('/staff/cases') };
const today: TabTarget = { href: '/staff', match: (p) => p === '/staff' || p.startsWith('/staff/notifications') };
const getHelp: TabTarget = { push: '/help', match: () => false };
const record: TabTarget = { push: '/staff/records/new', match: (p) => p.startsWith('/staff/records') };

describe('tabAction', () => {
  it('does nothing when the selected tab is already at its root', () => {
    expect(tabAction(me, '/me')).toEqual({ kind: 'none' });
    expect(tabAction(queue, '/staff/cases')).toEqual({ kind: 'none' });
    expect(tabAction(queue, '/staff/cases/')).toEqual({ kind: 'none' });
  });

  it('returns the selected tab to its root from a nested screen', () => {
    expect(tabAction(me, '/opportunities')).toEqual({ kind: 'root', href: '/me' });
    expect(tabAction(queue, '/staff/cases/123')).toEqual({ kind: 'root', href: '/staff/cases' });
    expect(tabAction(today, '/staff/notifications')).toEqual({ kind: 'root', href: '/staff' });
  });

  it('switches to another tab at its root', () => {
    expect(tabAction(me, '/')).toEqual({ kind: 'root', href: '/me' });
    expect(tabAction(queue, '/staff/map')).toEqual({ kind: 'root', href: '/staff/cases' });
  });

  it('pushes an action tab unless its flow is already open', () => {
    expect(tabAction(getHelp, '/')).toEqual({ kind: 'push', href: '/help' });
    expect(tabAction(record, '/staff')).toEqual({ kind: 'push', href: '/staff/records/new' });
    expect(tabAction(record, '/staff/records/new')).toEqual({ kind: 'none' });
  });

  it('compares object hrefs by pathname', () => {
    const tab: TabTarget = { href: { pathname: '/me' }, match: (p) => p.startsWith('/me') };
    expect(tabAction(tab, '/me')).toEqual({ kind: 'none' });
    expect(tabAction(tab, '/me/settings')).toEqual({ kind: 'root', href: { pathname: '/me' } });
  });
});
