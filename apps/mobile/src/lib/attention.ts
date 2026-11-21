import type { Case } from '@/api/types';
import { isOpenCase, isUrgentCase } from '@/lib/queue';

export type AttentionReason = 'urgent' | 'new' | 'unassigned';

export interface AttentionItem {
  item: Case;
  reason: AttentionReason;
}

/**
 * Today's "Needs attention" list: urgent open cases first, then new
 * (untriaged) ones, then anything still unassigned. Each case shows once,
 * under its most pressing reason. Keeps the API's order within each group
 * (most urgent, then newest).
 */
export function needsAttention(cases: readonly Case[], limit = 5): AttentionItem[] {
  const open = cases.filter(isOpenCase);
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
  take('urgent', isUrgentCase);
  take('new', (c) => c.status === 'new');
  take('unassigned', (c) => !c.assigned_worker_id);
  return out;
}
