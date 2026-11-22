import { describe, expect, it } from '@jest/globals';

import type { VoiceFollowUp, VoiceReferralDetail } from '@/api/types';
import { callHistory, followUpLabel, placeStatus, readable } from '@/lib/phoneCalls';

function call(id: string, linkedAt: string, need: string | null = 'food'): VoiceFollowUp {
  return { id: `f-${id}`, call_id: id, disposition: null, linked_at: linkedAt, need_category: need, resources: [], urgency_tier: null };
}

function place(id: string, callId: string, overrides: Partial<VoiceReferralDetail> = {}): VoiceReferralDetail {
  return {
    id,
    call_id: callId,
    created_at: '2026-11-20T10:00:00Z',
    follow_up_due_at: null,
    follow_up_status: 'not_scheduled',
    hours_label: null,
    languages: ['English'],
    need_category: 'food',
    outcome_reason_code: null,
    outcome_status: null,
    phone_e164: null,
    resource_category: 'food-pantry',
    resource_description: '',
    resource_name: `Place ${id}`,
    resource_slug: id,
    service_area: 'Milwaukee',
    status: 'offered',
    ...overrides,
  };
}

describe('callHistory', () => {
  it('groups places under their call, newest call first', () => {
    const history = callHistory(
      [call('a', '2026-11-19T10:00:00Z'), call('b', '2026-11-21T10:00:00Z', 'mental-health-crisis')],
      [place('1', 'a'), place('2', 'b'), place('3', 'a')],
    );
    expect(history.map((h) => h.callId)).toEqual(['b', 'a']);
    expect(history[0].need).toBe('Mental health crisis');
    expect(history[1].places.map((p) => p.id)).toEqual(['1', '3']);
  });

  it('keeps places whose call is not listed, and calls with no places', () => {
    const history = callHistory([call('a', '2026-11-19T10:00:00Z', null)], [place('9', 'z')]);
    expect(history.map((h) => [h.callId, h.places.length])).toEqual([
      ['z', 1],
      ['a', 0],
    ]);
    expect(history[1].need).toBe('Phone call');
  });
});

describe('labels', () => {
  it('reads API codes as plain words', () => {
    expect(readable('city-services')).toBe('City services');
    expect(readable(null)).toBeNull();
    expect(placeStatus({ status: 'offered', outcome_status: null })).toBe('Suggested on your call');
    expect(placeStatus({ status: 'connected', outcome_status: 'follow_up_needed' })).toBe('You asked for more help');
  });

  it('describes the planned check-in, or nothing', () => {
    expect(followUpLabel({ follow_up_status: 'not_scheduled', follow_up_due_at: null })).toBeNull();
    expect(followUpLabel({ follow_up_status: 'pending', follow_up_due_at: null })).toBe('ComForce will check in with you');
    expect(followUpLabel({ follow_up_status: 'pending', follow_up_due_at: '2026-11-25T15:00:00Z' })).toMatch(/^ComForce will check in around /);
    expect(followUpLabel({ follow_up_status: 'needs_help', follow_up_due_at: null })).toBe('You asked for more help');
  });
});
