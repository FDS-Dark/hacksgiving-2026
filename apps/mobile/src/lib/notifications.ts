/** The in-app inbox (S7): grouping and times, in the device's local time. */
import { clock, dayLabel, sameDay } from '@/lib/oncall';

export interface NotificationLike {
  case_id: string | null;
  created_at: string;
  read_at: string | null;
}

export interface NotificationGroup<N> {
  title: 'Today' | 'Earlier';
  items: N[];
}

/** S7's groups, keeping the API's newest-first order; empty groups are left out. */
export function groupNotifications<N extends NotificationLike>(items: N[], now: Date): NotificationGroup<N>[] {
  const today = items.filter((n) => sameDay(new Date(n.created_at), now));
  const earlier = items.filter((n) => !sameDay(new Date(n.created_at), now));
  const groups: NotificationGroup<N>[] = [
    { title: 'Today', items: today },
    { title: 'Earlier', items: earlier },
  ];
  return groups.filter((g) => g.items.length);
}

/** "6:44 PM" today, "Sat, Nov 22" before. */
export function notificationTime(iso: string, now: Date) {
  const d = new Date(iso);
  return sameDay(d, now) ? clock(d) : dayLabel(d);
}

/** The cases with something unread, for the resident's request dots. */
export function unreadCaseIds(items: NotificationLike[]) {
  return new Set(items.filter((n) => !n.read_at && n.case_id).map((n) => n.case_id as string));
}
