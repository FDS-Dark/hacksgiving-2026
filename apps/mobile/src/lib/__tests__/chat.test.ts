import { describe, expect, it } from '@jest/globals';

import type { ChatChannel, ChatMessage, Referral } from '@/api/types';
import { deliveredLine } from '@/lib/cases';
import { channelSubtitle, readState, unreadLabel } from '@/lib/chat';
import { unreadTotals } from '@/services/chat';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

function channel(overrides: Partial<ChatChannel> = {}): ChatChannel {
  return {
    key: 'team', channel: 'team', name: 'Team', case_id: null, case_number: null, case_title: null,
    last_message_at: null, last_message: null, last_author_name: null, last_read_at: null, unread: 0, rapid_unread: 0,
    ...overrides,
  };
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1', channel: 'team', case_id: null, author_id: 'u1', author_name: 'Maria', body: 'On my way', rapid: false,
    created_at: at(5), read_by: 0, ...overrides,
  };
}

describe('team chat words', () => {
  it('flags urgent unread first, and caps the count', () => {
    expect(unreadLabel({ unread: 0, rapid_unread: 0 })).toBeNull();
    expect(unreadLabel({ unread: 3, rapid_unread: 0 })).toBe('3 new');
    expect(unreadLabel({ unread: 3, rapid_unread: 1 })).toBe('1 urgent');
    expect(unreadLabel({ unread: 140, rapid_unread: 0 })).toBe('99+ new');
  });

  it('shows the latest message, or what an empty channel is for', () => {
    expect(channelSubtitle(channel({ last_message: 'On my way', last_author_name: 'Maria', last_message_at: at(5) }), NOW)).toBe(
      'Maria: On my way · 5m ago',
    );
    expect(channelSubtitle(channel({ channel: 'oncall' }), NOW)).toBe('Whoever is on call now, plus admins');
    expect(channelSubtitle(channel({ channel: 'case' }), NOW)).toBe('No messages yet');
  });

  it('says who has seen my messages and which of theirs are new', () => {
    expect(readState(message({ read_by: 2 }), true, null)).toBe('Seen by 2');
    expect(readState(message(), true, null)).toBe('Sent');
    expect(readState(message({ created_at: at(5) }), false, at(10))).toBe('New');
    expect(readState(message({ created_at: at(15) }), false, at(10))).toBeNull();
    expect(readState(message(), false, null)).toBe('New');
  });

  it('adds up unread across channels for Today', () => {
    expect(unreadTotals([channel({ unread: 2 }), channel({ key: 'oncall', unread: 1, rapid_unread: 1 })])).toEqual({ unread: 3, rapid: 1 });
  });
});

describe('deliveredLine', () => {
  const referral = {
    resource_name: 'Harbor House', status: 'completed', delivered_by: 'provider', delivered_by_worker_name: null,
    confirmed_by_name: 'Devon', confirmed_at: '2026-11-22T15:00:00Z',
  } as Referral;

  it('names the provider or ComForce, and who confirmed it', () => {
    expect(deliveredLine(referral)).toMatch(/^Delivered by Harbor House · confirmed by Devon, /);
    expect(deliveredLine({ ...referral, delivered_by: 'comforce', delivered_by_worker_name: 'Maria' })).toMatch(
      /^Delivered by ComForce MKE \(Maria\) · confirmed by Devon/,
    );
    expect(deliveredLine({ ...referral, status: 'accepted' })).toBeNull();
  });
});
