import type { Case } from '@/api/types';

export type AttentionReason = 'urgent' | 'new' | 'unassigned';

export interface AttentionItem {
  item: Case;
  reason: AttentionReason;
}

const isOpen = (c: Case) => c.status !== 'resolved' && c.status !== 'closed';
const isUrgent = (c: Case) => c.priority === 'critical' || c.priority === 'high';

/**
 * The dashboard's "Needs attention" list: urgent open cases first, then new
 * (untriaged) ones, then anything still unassigned. Each case shows once,
 * under its most pressing reason. Keeps the API's order within each group
 * (most urgent, then newest).
 */
export function needsAttention(cases: readonly Case[], limit = 5): AttentionItem[] {
  const open = cases.filter(isOpen);
  const seen = new Set<string>();
  const out: AttentionItem[] = [];
  const take = (reason: AttentionReason, match: (c: Case) => boolean) => {
    for (const c of open) {
      if (out.length >= limit) return;
      if (!seen.has(c.id) && match(c)) {
        seen.add(c.id);
        out.push({ item: c, reason });
      }
    }
  };
  take('urgent', isUrgent);
  take('new', (c) => c.status === 'new');
  take('unassigned', (c) => !c.assigned_worker_id);
  return out;
}
