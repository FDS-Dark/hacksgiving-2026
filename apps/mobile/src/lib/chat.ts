/** Words for team chat (services/chat.ts): channel lines, unread pills, read state. */
import type { ChatChannel, ChatMessage } from '@/api/types';
import { timeAgo } from '@/lib/format';

/** "3 new" or "2 urgent", or null when nothing is unread. */
export function unreadLabel(c: Pick<ChatChannel, 'unread' | 'rapid_unread'>): string | null {
  if (c.rapid_unread) return `${c.rapid_unread} urgent`;
  return c.unread ? `${c.unread > 99 ? '99+' : c.unread} new` : null;
}

/** The latest message ("Maria: on my way · 5m ago"), or what the channel is for when it's empty. */
export function channelSubtitle(c: ChatChannel, now = Date.now()): string {
  if (c.last_message && c.last_message_at) {
    const who = c.last_author_name ? `${c.last_author_name}: ` : '';
    return `${who}${c.last_message} · ${timeAgo(c.last_message_at, now)}`;
  }
  if (c.channel === 'team') return 'Everyone on staff';
  if (c.channel === 'oncall') return 'Whoever is on call now, plus admins';
  return 'No messages yet';
}

/**
 * The read state under a message: for my own, whether teammates have read it;
 * for others', whether it's new to me (after where I'd read up to when the thread opened).
 */
export function readState(m: ChatMessage, mine: boolean, readUpTo: string | null | undefined): string | null {
  if (mine) return m.read_by ? `Seen by ${m.read_by}` : 'Sent';
  if (!readUpTo || Date.parse(m.created_at) > Date.parse(readUpTo)) return 'New';
  return null;
}
