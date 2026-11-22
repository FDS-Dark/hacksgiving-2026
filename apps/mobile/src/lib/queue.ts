/**
 * The staff queue's quick views (Figma S1 chips) and search, as pure
 * functions over the loaded cases so they're tested and the chips can show
 * counts without another request.
 */
import type { Case, UpdateType, WorkedCase } from '@/api/types';

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

// ── Recently worked (cognitive-load review S2) ─────────────────────────────

/** The Queue's chips: the views above, plus the cases I touched lately. */
export type QueueMode = QueueView | 'recent';

export const RECENT_LABEL = 'Recently worked';

export function modeFromParams(params: { view?: string; status?: string; assigned?: string; urgent?: string }): QueueMode {
  return params.view === 'recent' ? 'recent' : viewFromParams(params);
}

/** Newest touch first (the API sends them so; sorting here keeps the screen honest either way). */
export function sortRecentlyWorked<T extends Pick<WorkedCase, 'worked_at' | 'number'>>(cases: readonly T[]): T[] {
  return [...cases].sort((a, b) => Date.parse(b.worked_at) - Date.parse(a.worked_at) || b.number - a.number);
}

const WORKED_VERB: Partial<Record<UpdateType, string>> = {
  created: 'opened this',
  note: 'added a note',
  message: 'messaged the resident',
  status_change: 'changed the status',
  priority_change: 'changed the priority',
  category_change: 'changed the type of help',
  assignment: 'changed who has it',
  referral: 'updated a referral',
  alert: 'responded',
};

/** "You added a note 10 min ago": the last thing I did on the case, and when. */
export function workedLabel(c: Pick<WorkedCase, 'worked_at' | 'worked_type'>, now = Date.now()) {
  return `You ${WORKED_VERB[c.worked_type] ?? 'updated this'} ${agoInWords(c.worked_at, now)}`;
}

/** "just now", "10 min ago", "3 hours ago", "2 days ago", then the date. */
export function agoInWords(iso: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return `on ${new Date(iso).toLocaleDateString()}`;
}
