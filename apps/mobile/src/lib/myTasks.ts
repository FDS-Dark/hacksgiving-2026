/**
 * My tasks: a worker's open tasks across every case, grouped by when they're
 * due. Pure so it's tested without a screen.
 */
import type { Task } from '@/api/types';

export type TaskBucket = 'overdue' | 'today' | 'upcoming' | 'undated';

export const BUCKET_LABEL: Record<TaskBucket, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  upcoming: 'Coming up',
  undated: 'No due date',
};

const ORDER: TaskBucket[] = ['overdue', 'today', 'upcoming', 'undated'];

export function bucketOf(task: Pick<Task, 'due_at'>, now: Date): TaskBucket {
  if (!task.due_at) return 'undated';
  const due = new Date(task.due_at);
  if (due.getTime() < now.getTime()) return 'overdue';
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  return due.getTime() <= endOfToday.getTime() ? 'today' : 'upcoming';
}

/** Non-empty groups in order (overdue first), each soonest due first. */
export function groupTasks(tasks: readonly Task[], now: Date): { bucket: TaskBucket; tasks: Task[] }[] {
  const due = (t: Task) => (t.due_at ? Date.parse(t.due_at) : Number.POSITIVE_INFINITY);
  const groups = new Map<TaskBucket, Task[]>();
  for (const task of tasks) {
    const bucket = bucketOf(task, now);
    groups.set(bucket, [...(groups.get(bucket) ?? []), task]);
  }
  return ORDER.filter((b) => groups.has(b)).map((bucket) => ({
    bucket,
    tasks: [...(groups.get(bucket) ?? [])].sort((a, b) => due(a) - due(b) || a.title.localeCompare(b.title)),
  }));
}
