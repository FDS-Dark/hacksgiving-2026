/**
 * Today's one worklist, "Do this next" (cognitive-load review, top 10 #6):
 * urgent offers, tasks due, debriefs and handoffs to read, and the cases
 * assigned to me, folded into one ordered list so the first row is the one
 * next action. Pure so the order is tested without a screen.
 *
 * Order: urgent → overdue → due today → needs review → assigned. Within a
 * group the API's order is kept (alerts newest first, tasks soonest due,
 * cases most urgent), except where a group says otherwise below.
 */
import type { Case, DebriefRecord, ShiftHandoff, Task } from '@/api/types';
import { CATEGORY_LABEL, PRIORITY_LABEL } from '@/lib/cases';
import { timeAgo } from '@/lib/format';
import { bucketOf } from '@/lib/myTasks';
import { isOpenCase, isUrgentCase } from '@/lib/queue';
import { bannerLine, bannerTitle, isOpen, type AlertLike } from '@/lib/urgent';

export type WorkKind = 'urgent' | 'overdue' | 'due_today' | 'review' | 'assigned';

export const WORK_ORDER: readonly WorkKind[] = ['urgent', 'overdue', 'due_today', 'review', 'assigned'];

/** Where a row goes when tapped. The screen turns it into a route. */
export type WorkTarget =
  | { screen: 'alert'; id: string }
  | { screen: 'case'; id: string }
  | { screen: 'record'; id: string }
  | { screen: 'handoff'; id: string }
  | { screen: 'tasks' };

export interface WorkItem {
  key: string;
  kind: WorkKind;
  title: string;
  /** Why it's here, in plain words: "Overdue · #1047 Ride to court". */
  line: string;
  target: WorkTarget;
}

/** How many rows Today shows before "See all". */
export const TODAY_LIMIT = 6;

export interface WorklistInput {
  alerts: readonly (AlertLike & { id: string })[];
  tasks: readonly Task[];
  records: readonly DebriefRecord[];
  handoffs: readonly ShiftHandoff[];
  cases: readonly Case[];
  myId: string | undefined;
  now: Date;
}

/** A handoff counts for 12 hours after it was written. */
const FRESH_HANDOFF_MS = 12 * 60 * 60 * 1000;

/** "High priority · Calming support · No worker assigned" (copy rewrite, section 6). */
export function caseReason(c: Pick<Case, 'priority' | 'category' | 'assigned_worker_name' | 'assigned_worker_id'>) {
  const who = c.assigned_worker_id ? (c.assigned_worker_name ?? 'Assigned') : 'No worker assigned';
  return `${PRIORITY_LABEL[c.priority]} priority · ${CATEGORY_LABEL[c.category]} · ${who}`;
}

function recordTitle(r: DebriefRecord) {
  if (r.extraction?.title) return r.extraction.title;
  if (r.raw_text) return r.raw_text.length > 60 ? `${r.raw_text.slice(0, 60)}…` : r.raw_text;
  return 'Debrief';
}

export function buildWorklist({ alerts, tasks, records, handoffs, cases, myId, now }: WorklistInput): WorkItem[] {
  const out: WorkItem[] = [];
  const seenCases = new Set<string>();
  const nowMs = now.getTime();
  const open = cases.filter(isOpenCase);
  const mine = (c: Case) => !!myId && c.assigned_worker_id === myId;

  // Urgent: open on-call alerts, then urgent cases that are mine or nobody's.
  for (const a of alerts.filter(isOpen)) {
    out.push({ key: `alert-${a.id}`, kind: 'urgent', title: bannerTitle(a), line: bannerLine(a), target: { screen: 'alert', id: a.id } });
  }
  for (const c of open.filter((c) => isUrgentCase(c) && (mine(c) || !c.assigned_worker_id))) {
    seenCases.add(c.id);
    out.push({ key: `case-${c.id}`, kind: 'urgent', title: `#${c.number} ${c.title}`, line: caseReason(c), target: { screen: 'case', id: c.id } });
  }

  // Tasks: overdue, then due today, soonest first.
  const due = tasks
    .map((t) => ({ t, bucket: bucketOf(t, now) }))
    .filter(({ t, bucket }) => t.status === 'open' && (bucket === 'overdue' || bucket === 'today'))
    .sort((a, b) => Date.parse(a.t.due_at ?? '') - Date.parse(b.t.due_at ?? ''));
  for (const { t, bucket } of due) {
    out.push({
      key: `task-${t.id}`,
      kind: bucket === 'overdue' ? 'overdue' : 'due_today',
      title: t.title,
      line: `${bucket === 'overdue' ? 'Overdue' : 'Due today'} · #${t.case_number} ${t.case_title}`,
      target: { screen: 'case', id: t.case_id },
    });
  }

  // Needs review: a fresh handoff to me, debriefs to check (or retry), and
  // new cases nobody has reviewed or taken.
  for (const h of handoffs) {
    if (h.recipient_id !== myId || h.author_id === myId || nowMs - Date.parse(h.created_at) >= FRESH_HANDOFF_MS) continue;
    out.push({
      key: `handoff-${h.id}`,
      kind: 'review',
      title: `Read the handoff from ${h.author_name ?? 'a teammate'}`,
      line: `Shift handoff · ${timeAgo(h.created_at, nowMs)}`,
      target: { screen: 'handoff', id: h.id },
    });
  }
  for (const r of records) {
    if (r.status !== 'ready' && r.status !== 'failed') continue;
    out.push({
      key: `record-${r.id}`,
      kind: 'review',
      title: recordTitle(r),
      line: r.status === 'ready' ? `Debrief ready to check · ${timeAgo(r.created_at, nowMs)}` : 'Debrief couldn’t finish · try again',
      target: { screen: 'record', id: r.id },
    });
  }
  for (const c of open.filter((c) => c.status === 'new' && !c.assigned_worker_id && !seenCases.has(c.id))) {
    seenCases.add(c.id);
    out.push({ key: `case-${c.id}`, kind: 'review', title: `#${c.number} ${c.title}`, line: `New · not reviewed · opened ${timeAgo(c.created_at, nowMs)}`, target: { screen: 'case', id: c.id } });
  }

  // Assigned to me: the ones I've left longest first, so nothing goes stale.
  const assigned = open.filter((c) => mine(c) && !seenCases.has(c.id)).sort((a, b) => Date.parse(a.last_activity_at) - Date.parse(b.last_activity_at));
  for (const c of assigned) {
    out.push({
      key: `case-${c.id}`,
      kind: 'assigned',
      title: `#${c.number} ${c.title}`,
      line: `Assigned to you · last update ${timeAgo(c.last_activity_at, nowMs)}`,
      target: { screen: 'case', id: c.id },
    });
  }

  // Stable sort by group keeps each group's own order.
  return out.map((item, i) => ({ item, i })).sort((a, b) => WORK_ORDER.indexOf(a.item.kind) - WORK_ORDER.indexOf(b.item.kind) || a.i - b.i).map(({ item }) => item);
}
