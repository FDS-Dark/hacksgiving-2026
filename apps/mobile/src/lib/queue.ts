/**
 * The staff queue's quick views (Figma S1 chips) and search, as pure
 * functions over the loaded cases so they're tested and the chips can show
 * counts without another request.
 */
import type { Case } from '@/api/types';

export const QUEUE_VIEWS = ['open', 'mine', 'new', 'unassigned', 'urgent', 'closed'] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];

export const QUEUE_VIEW_LABEL: Record<QueueView, string> = {
  open: 'Open',
  mine: 'Mine',
  new: 'New',
  unassigned: 'Unassigned',
  urgent: 'Urgent',
  closed: 'Closed',
};

export const isOpenCase = (c: Case) => c.status !== 'resolved' && c.status !== 'closed';
export const isUrgentCase = (c: Case) => c.priority === 'critical' || c.priority === 'high';

export function inView(c: Case, view: QueueView, myId: string | undefined): boolean {
  if (view === 'closed') return !isOpenCase(c);
  if (!isOpenCase(c)) return false;
  switch (view) {
    case 'open':
      return true;
    case 'mine':
      return !!myId && c.assigned_worker_id === myId;
    case 'new':
      return c.status === 'new';
    case 'unassigned':
      return !c.assigned_worker_id;
    case 'urgent':
      return isUrgentCase(c);
  }
}

/** Matches "#1047", "1047", or words in the title, description or location. */
export function matchesSearch(c: Case, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const number = q.replace(/^#/, '');
  if (/^\d+$/.test(number)) return String(c.number).startsWith(number);
  return [c.title, c.description, c.location].some((text) => text?.toLowerCase().includes(q));
}

export function viewCounts(cases: readonly Case[], myId: string | undefined): Record<QueueView, number> {
  const counts = Object.fromEntries(QUEUE_VIEWS.map((v) => [v, 0])) as Record<QueueView, number>;
  for (const c of cases) for (const v of QUEUE_VIEWS) if (inView(c, v, myId)) counts[v] += 1;
  return counts;
}

/** The deep links Today uses (?view=urgent …), plus the older ?status=new / ?assigned=… forms. */
export function viewFromParams(params: { view?: string; status?: string; assigned?: string; urgent?: string }): QueueView {
  if (params.view && (QUEUE_VIEWS as readonly string[]).includes(params.view)) return params.view as QueueView;
  if (params.urgent === '1') return 'urgent';
  if (params.assigned === 'mine') return 'mine';
  if (params.assigned === 'unassigned') return 'unassigned';
  if (params.status === 'new') return 'new';
  return 'open';
}
