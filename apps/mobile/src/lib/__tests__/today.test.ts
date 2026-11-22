import { describe, expect, it } from '@jest/globals';

import type { Case, DebriefRecord, ShiftHandoff, Task } from '@/api/types';
import { buildWorklist, caseReason, type WorklistInput } from '@/lib/today';

const NOW = new Date('2026-11-22T15:00:00Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const ahead = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

let n = 1000;
function kase(overrides: Partial<Case>): Case {
  n += 1;
  return {
    id: `case-${n}`,
    number: n,
    title: `Case ${n}`,
    status: 'in_progress',
    priority: 'medium',
    category: 'transportation',
    assigned_worker_id: 'me',
    assigned_worker_name: 'Me',
    created_at: ago(120),
    last_activity_at: ago(60),
    ...overrides,
  } as Case;
}

function task(overrides: Partial<Task>): Task {
  n += 1;
  return { id: `task-${n}`, case_id: 'case-x', case_number: 1, case_title: 'Ride', title: `Task ${n}`, status: 'open', due_at: null, ...overrides } as Task;
}

function input(overrides: Partial<WorklistInput>): WorklistInput {
  return { alerts: [], tasks: [], records: [], handoffs: [], cases: [], myId: 'me', now: NOW, ...overrides };
}

describe('buildWorklist', () => {
  it('orders urgent, overdue, due today, needs review, then assigned', () => {
    const assigned = kase({});
    const fresh = kase({ status: 'new', assigned_worker_id: null, assigned_worker_name: null });
    const urgent = kase({ priority: 'high', assigned_worker_id: null, assigned_worker_name: null });
    const overdue = task({ due_at: ago(30) });
    const later = task({ due_at: ahead(60) });
    const record = { id: 'r1', status: 'ready', raw_text: 'Met someone', extraction: null, created_at: ago(5) } as unknown as DebriefRecord;
    const alert = { id: 'a1', case_number: 1050, case_title: 'Fight outside', status: 'offering' as const, accepted_by: null, accepted_by_name: null, my_offer: null, next_name: null };

    const items = buildWorklist(input({ alerts: [alert], tasks: [later, overdue], records: [record], cases: [assigned, fresh, urgent] }));

    expect(items.map((i) => i.kind)).toEqual(['urgent', 'urgent', 'overdue', 'due_today', 'review', 'review', 'assigned']);
    expect(items[0].key).toBe('alert-a1');
    expect(items[1].key).toBe(`case-${urgent.id}`);
    expect(items[2].key).toBe(`task-${overdue.id}`);
    expect(items.at(-1)?.key).toBe(`case-${assigned.id}`);
  });

  it('shows each case once, under its most pressing reason', () => {
    const mineAndUrgent = kase({ priority: 'critical' });
    const items = buildWorklist(input({ cases: [mineAndUrgent] }));
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('urgent');
  });

  it('leaves out closed cases, done tasks, later tasks, processing debriefs and teammates’ cases', () => {
    const items = buildWorklist(
      input({
        cases: [kase({ status: 'resolved' }), kase({ assigned_worker_id: 'someone-else' })],
        tasks: [task({ status: 'done', due_at: ago(10) }), task({ due_at: null }), task({ due_at: ahead(60 * 48) })],
        records: [{ id: 'r2', status: 'processing', created_at: ago(1) } as unknown as DebriefRecord],
      }),
    );
    expect(items).toEqual([]);
  });

  it('puts the assigned case left longest first', () => {
    const recent = kase({ last_activity_at: ago(5) });
    const stale = kase({ last_activity_at: ago(600) });
    expect(buildWorklist(input({ cases: [recent, stale] })).map((i) => i.key)).toEqual([`case-${stale.id}`, `case-${recent.id}`]);
  });

  it('includes a handoff written to me in the last 12 hours only', () => {
    const fresh = { id: 'h1', recipient_id: 'me', author_id: 'them', author_name: 'Ana', created_at: ago(30) } as ShiftHandoff;
    const old = { id: 'h2', recipient_id: 'me', author_id: 'them', author_name: 'Ana', created_at: ago(13 * 60) } as ShiftHandoff;
    const items = buildWorklist(input({ handoffs: [fresh, old] }));
    expect(items.map((i) => i.key)).toEqual(['handoff-h1']);
    expect(items[0].title).toBe('Read the handoff from Ana');
  });
});

describe('caseReason', () => {
  it('reads as plain words', () => {
    expect(caseReason({ priority: 'high', category: 'incident_deescalation', assigned_worker_id: null, assigned_worker_name: null })).toBe(
      'High priority · Calming support · No worker assigned',
    );
  });
});
