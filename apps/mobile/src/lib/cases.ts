/**
 * What staff call each case category, status, priority and referral status.
 * The keys are the API's enums, so a renamed or dropped value fails the
 * typecheck. (Residents see their own wording: components/resident.tsx.)
 */
import type { CaseCategory, CasePriority, CaseStatus, Referral, ReferralStatus } from '@/api/types';
import type { IconName } from '@/components/ui';

/**
 * Who delivered a completed referral's help, for staff:
 * "Delivered by Harbor House · confirmed by Maria, Nov 22". Null until it's completed.
 */
export function deliveredLine(r: Referral): string | null {
  if (r.status !== 'completed' || !r.delivered_by) return null;
  const by = r.delivered_by === 'comforce' ? `ComForce MKE${r.delivered_by_worker_name ? ` (${r.delivered_by_worker_name})` : ''}` : r.resource_name;
  const when = r.confirmed_at ? new Date(r.confirmed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
  const confirmed = r.confirmed_by_name ? ` · confirmed by ${r.confirmed_by_name}${when ? `, ${when}` : ''}` : '';
  return `Delivered by ${by}${confirmed}`;
}

export const CATEGORY_LABEL: Record<CaseCategory, string> = {
  homelessness: 'Housing & shelter',
  meal_programs: 'Food & meals',
  transportation: 'Ride help',
  violence_prevention: 'Violence prevention',
  incident_deescalation: 'Calming support',
  missing_persons: 'Missing persons',
  burial_assistance: 'Burial assistance',
  bridge_to_employment: 'Bridge to employment',
  other: 'General support',
};

export const CATEGORY_ICON: Record<CaseCategory, IconName> = {
  homelessness: 'home-outline',
  meal_programs: 'restaurant-outline',
  transportation: 'bus-outline',
  violence_prevention: 'shield-outline',
  incident_deescalation: 'hand-left-outline',
  missing_persons: 'search-outline',
  burial_assistance: 'flower-outline',
  bridge_to_employment: 'briefcase-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

export const STATUS_LABEL: Record<CaseStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  awaiting_resources: 'Awaiting resources',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const PRIORITY_LABEL: Record<CasePriority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const REFERRAL_LABEL: Record<ReferralStatus, string> = {
  suggested: 'Suggested',
  shared: 'Shared',
  accepted: 'Accepted',
  completed: 'Completed',
  declined: 'Declined',
};

/**
 * Whether a case has someone outside staff to message: a request sent from
 * the app (signed in, or with a saved code). Staff-opened cases have no
 * resident thread, so their only "message" is an internal note.
 */
export function canMessageResident(c: { requester_id?: string | null; source: string }) {
  return !!c.requester_id || c.source === 'public';
}

/** "Family evicted today and nowhere to sleep. Two kids." → a short title for the queue. */
export function titleFrom(description: string) {
  const first = description.trim().split(/(?<=[.!?])\s|\n/)[0] ?? '';
  return first.length > 80 ? `${first.slice(0, 77).trimEnd()}…` : first;
}
