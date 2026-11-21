/**
 * How the community app names ComForce MKE's services and a request's
 * status. The keys are the API's enums, so a renamed or dropped value fails
 * the typecheck.
 */
import type Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import type { CaseCategory, CasePriority, CaseStatus } from '@/api/types';

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface ServiceInfo {
  label: string;
  icon: IconName;
  /** One line, in the requester's words, for the picker. */
  blurb: string;
}

export const SERVICE_INFO: Record<CaseCategory, ServiceInfo> = {
  homelessness: { label: 'Housing & Shelter', icon: 'home', blurb: 'No safe place to sleep, eviction, or shelter help.' },
  meal_programs: { label: 'Meals & Food', icon: 'restaurant', blurb: 'No food at home, meals, groceries or a pantry.' },
  transportation: { label: 'Transportation', icon: 'car', blurb: 'A ride to an appointment, court, work or a service.' },
  violence_prevention: { label: 'Violence Prevention', icon: 'shield-checkmark', blurb: 'Threats, conflict or retaliation, before it escalates.' },
  incident_deescalation: { label: 'De-escalation', icon: 'hand-left', blurb: 'A tense situation that needs someone to calm it down.' },
  missing_persons: { label: 'Missing Persons', icon: 'search', blurb: "Someone is missing or can't be reached." },
  burial_assistance: { label: 'Burial Assistance', icon: 'flower', blurb: 'Help paying for or arranging a funeral.' },
  bridge_to_employment: { label: 'Bridge to Employment', icon: 'briefcase', blurb: 'A job, training, a resume or interview help.' },
  other: { label: 'General Support', icon: 'people', blurb: 'Something else: tell us and we will find the right help.' },
};

/** The services a requester can pick, in display order ("other" is the
 *  "not sure" choice, which lets ComForce sort it instead). */
export const PICKABLE_SERVICES = [
  'homelessness',
  'meal_programs',
  'transportation',
  'violence_prevention',
  'incident_deescalation',
  'missing_persons',
  'burial_assistance',
  'bridge_to_employment',
] as const satisfies readonly CaseCategory[];

export const STATUS_INFO: Record<CaseStatus, { label: string; detail: string; open: boolean }> = {
  new: { label: 'Received', detail: 'Your request is in the queue for a ComForce team member.', open: true },
  in_progress: { label: 'In progress', detail: 'A ComForce team member is working on your request.', open: true },
  awaiting_resources: { label: 'Finding resources', detail: 'We are lining up the right partner or resource for you.', open: true },
  resolved: { label: 'Resolved', detail: 'This request has been taken care of.', open: false },
  closed: { label: 'Closed', detail: 'This request is closed.', open: false },
};

/** Staff-facing names: plainer and shorter than what the requester sees. */
export const STAFF_STATUS_LABEL: Record<CaseStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  awaiting_resources: 'Awaiting resources',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const PRIORITY_INFO: Record<CasePriority, { label: string; rank: number }> = {
  critical: { label: 'Critical', rank: 0 },
  high: { label: 'High', rank: 1 },
  medium: { label: 'Medium', rank: 2 },
  low: { label: 'Low', rank: 3 },
};

/** "5m ago", "3h ago", "2d ago": how long a request has waited. */
export function timeAgo(iso: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
