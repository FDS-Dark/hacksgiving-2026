/**
 * What staff call each case category, status, priority and referral status.
 * The keys are the API's enums, so a renamed or dropped value fails the
 * typecheck. (Residents see their own wording: components/resident.tsx.)
 */
import type { CaseCategory, CasePriority, CaseStatus, ReferralStatus } from '@/api/types';
import type { IconName } from '@/components/ui';

export const CATEGORY_LABEL: Record<CaseCategory, string> = {
  homelessness: 'Housing & shelter',
  meal_programs: 'Food & meals',
  transportation: 'Transportation',
  violence_prevention: 'Violence prevention',
  incident_deescalation: 'De-escalation',
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
