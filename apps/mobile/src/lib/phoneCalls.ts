/**
 * Me > Phone calls: a resident's calls with the ComForce phone assistant,
 * each with the places ComForce recommended on it. The API returns calls
 * (follow-ups) and places (referrals) separately; this joins them by call
 * and puts the API's status codes into words a resident uses.
 */
import type { VoiceFollowUp, VoiceReferralDetail } from '@/api/types';

export interface CallHistory {
  callId: string;
  /** "Shelter", "Food", or "Phone call" when the call named no need. */
  need: string;
  /** When the call was linked to this account (or its first place, if the call itself isn't listed). */
  at: string;
  places: VoiceReferralDetail[];
  /** Place names the call itself lists, for when its places have no detail yet. */
  names: string[];
}

/** "mental-health-crisis" reads "Mental health crisis". */
export function readable(slug: string | null | undefined): string | null {
  const words = slug?.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

export function callHistory(calls: VoiceFollowUp[], places: VoiceReferralDetail[]): CallHistory[] {
  const byCall = new Map<string, CallHistory>();
  for (const call of calls) {
    byCall.set(call.call_id, { callId: call.call_id, need: readable(call.need_category) ?? 'Phone call', at: call.linked_at, places: [], names: call.resources });
  }
  for (const place of places) {
    let entry = byCall.get(place.call_id);
    if (!entry) {
      entry = { callId: place.call_id, need: readable(place.need_category) ?? 'Phone call', at: place.created_at, places: [], names: [] };
      byCall.set(place.call_id, entry);
    }
    entry.places.push(place);
  }
  return [...byCall.values()].sort((a, b) => b.at.localeCompare(a.at));
}

const PLACE_STATUS: Record<VoiceReferralDetail['status'], string> = {
  offered: 'Suggested on your call',
  accepted: 'You wanted this one',
  transfer_attempted: 'We tried to connect you',
  connected: 'Connected on your call',
  declined: 'You said no thanks',
  unavailable: 'Not open to new people right now',
};

const OUTCOME: Record<NonNullable<VoiceReferralDetail['outcome_status']>, string> = {
  connected: 'You reached them',
  voicemail: 'Left a voicemail',
  no_answer: 'No one answered',
  declined: 'You said no thanks',
  unavailable: 'Not available',
  follow_up_needed: 'You asked for more help',
  completed: 'You said it helped',
};

/** Where things stand with one recommended place. */
export function placeStatus(place: Pick<VoiceReferralDetail, 'status' | 'outcome_status'>): string {
  return place.outcome_status ? OUTCOME[place.outcome_status] : PLACE_STATUS[place.status];
}

/** The check-in ComForce planned, or null when there is none. */
export function followUpLabel(place: Pick<VoiceReferralDetail, 'follow_up_status' | 'follow_up_due_at'>): string | null {
  switch (place.follow_up_status) {
    case 'pending':
      return place.follow_up_due_at
        ? `ComForce will check in around ${new Date(place.follow_up_due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
        : 'ComForce will check in with you';
    case 'needs_help':
      return 'You asked for more help';
    case 'completed':
      return 'Check-in done';
    default:
      return null;
  }
}

/** What the request says when a resident asks ComForce to link a call they have no code for. */
export const LINK_CALL_REQUEST = {
  title: 'Link my earlier phone call',
  description:
    'I talked with the ComForce phone assistant earlier and don’t have a phone-call code. Please link that call to my account.',
} as const;
