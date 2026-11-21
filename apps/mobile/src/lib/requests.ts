/**
 * Requests for assistance: intake, triage, assignment, referral to a
 * partner, follow-up, and close-out. Modeled on common case-management
 * practice (closed-loop referrals, consent before sharing, safe contact).
 * Client-side only until the API stores them.
 */

export const NEEDS = [
  'Food',
  'Housing & shelter',
  'Transportation',
  'Utilities',
  'Employment',
  'Safety / domestic violence',
  'Mental health',
  'Medical',
  'Childcare',
  'Legal',
  'Other',
] as const;

export const SOURCES = ['Phone', 'Walk-in', 'Text', 'Email', 'Outreach', 'Partner referral'] as const;
export const CONTACT_METHODS = ['Phone call', 'Text', 'Email', 'In person'] as const;
export const REQUEST_LANGUAGES = ['English', 'Spanish', 'Hmong', 'Arabic', 'Somali', 'ASL', 'Other'] as const;

export type Priority = 'urgent' | 'high' | 'normal' | 'low';
export const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low'];
export const PRIORITY_LABEL: Record<Priority, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
/** How long before an unanswered request of each priority is overdue. */
export const RESPONSE_HOURS: Record<Priority, number> = { urgent: 1, high: 24, normal: 72, low: 168 };

export type Status = 'new' | 'in_progress' | 'referred' | 'waiting' | 'resolved' | 'closed';
export const STATUSES: Status[] = ['new', 'in_progress', 'referred', 'waiting', 'resolved', 'closed'];
export const STATUS_LABEL: Record<Status, string> = {
  new: 'New',
  in_progress: 'In progress',
  referred: 'Referred',
  waiting: 'Waiting on resident',
  resolved: 'Resolved',
  closed: 'Closed',
};
export const OPEN_STATUSES: Status[] = ['new', 'in_progress', 'referred', 'waiting'];

export type ReferralStatus = 'sent' | 'accepted' | 'declined' | 'completed';
export const REFERRAL_LABEL: Record<ReferralStatus, string> = {
  sent: 'Sent, awaiting reply',
  accepted: 'Accepted by partner',
  declined: 'Declined by partner',
  completed: 'Service provided',
};

export const OUTCOMES = ['Need met', 'Referred, partner confirmed', 'Resident declined', 'Could not reach', 'Duplicate', 'Out of service area'] as const;

export interface Activity {
  id: string;
  at: string;
  by: string;
  kind: 'created' | 'note' | 'contact' | 'status' | 'assign' | 'priority' | 'referral';
  text: string;
}

export interface Referral {
  partner: string;
  status: ReferralStatus;
  sentAt: string;
  note: string;
}

export interface AssistRequest {
  id: string;
  /** Short reference staff read out on the phone, e.g. "R-1042". */
  ref: string;
  createdAt: string;
  source: string;
  needs: string[];
  priority: Priority;
  status: Status;
  summary: string;
  details: string;

  name: string;
  phone: string;
  email: string;
  preferredContact: string;
  language: string;
  neighborhood: string;
  householdSize: string;

  // Safe contact: some residents (especially in DV situations) can't receive calls or messages safely.
  safeToCall: boolean;
  safeToText: boolean;
  safeToVoicemail: boolean;
  /** e.g. "Weekdays 9–11am only". */
  safeTimes: string;

  /** Staff only: hidden from partners, details never included in referrals. */
  confidential: boolean;
  /** The resident agreed that their details may be shared with a partner for a referral. */
  consentToShare: boolean;

  assignee: string | null;
  referral: Referral | null;
  followUpOn: string;
  outcome: string;
  activity: Activity[];
}

let nextRef = 1046;

export function emptyRequest(by: string): AssistRequest {
  const now = new Date().toISOString();
  return {
    id: `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ref: `R-${nextRef++}`,
    createdAt: now,
    source: 'Phone',
    needs: [],
    priority: 'normal',
    status: 'new',
    summary: '',
    details: '',
    name: '',
    phone: '',
    email: '',
    preferredContact: 'Phone call',
    language: 'English',
    neighborhood: '',
    householdSize: '',
    safeToCall: true,
    safeToText: true,
    safeToVoicemail: true,
    safeTimes: '',
    confidential: false,
    consentToShare: false,
    assignee: null,
    referral: null,
    followUpOn: '',
    outcome: '',
    activity: [{ id: 'a0', at: now, by, kind: 'created', text: 'Request logged' }],
  };
}

export function activity(by: string, kind: Activity['kind'], text: string): Activity {
  return { id: `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), by, kind, text };
}

// ── Validation ──────────────────────────────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateRequest(r: AssistRequest): Partial<Record<keyof AssistRequest, string>> {
  const e: Partial<Record<keyof AssistRequest, string>> = {};
  if (!r.needs.length) e.needs = 'Pick at least one need.';
  if (!r.summary.trim()) e.summary = 'Say in a line what they need.';
  if (!r.name.trim()) e.name = 'Add a name. A first name or “Anonymous” is fine.';
  if (r.email.trim() && !EMAIL.test(r.email.trim())) e.email = 'Enter an email address.';
  if (r.phone.trim() && r.phone.replace(/\D/g, '').length < 10) e.phone = 'Enter a phone number.';
  if (r.preferredContact === 'Phone call' || r.preferredContact === 'Text') {
    if (!r.phone.trim()) e.phone = 'Add a phone number, or pick another way to reach them.';
  }
  if (r.preferredContact === 'Email' && !r.email.trim()) e.email = 'Add an email, or pick another way to reach them.';
  if (r.followUpOn && !DATE.test(r.followUpOn)) e.followUpOn = 'Use YYYY-MM-DD.';
  return e;
}

// ── Queue helpers ───────────────────────────────────────────────────────

export function isOpen(r: AssistRequest) {
  return OPEN_STATUSES.includes(r.status);
}

/** New and still unanswered past the response target for its priority. */
export function isOverdue(r: AssistRequest, now = Date.now()) {
  return r.status === 'new' && now - Date.parse(r.createdAt) > RESPONSE_HOURS[r.priority] * 3600_000;
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function followUpDue(r: AssistRequest) {
  return isOpen(r) && !!r.followUpOn && r.followUpOn <= today();
}

/** Urgent first, then overdue, then oldest. */
export function queueOrder(a: AssistRequest, b: AssistRequest) {
  const rank = (r: AssistRequest) => (isOpen(r) ? 0 : 10) + PRIORITIES.indexOf(r.priority) - (isOverdue(r) ? 0.5 : 0);
  return rank(a) - rank(b) || Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

export function ago(iso: string, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** What a partner receives with a referral: only what the resident agreed to share. */
export function referralPacket(r: AssistRequest) {
  return [
    `Referral ${r.ref} from ComForce MKE`,
    `Needs: ${r.needs.join(', ')}`,
    `Summary: ${r.summary}`,
    `Name: ${r.name}`,
    r.preferredContact ? `Contact by: ${r.preferredContact}` : '',
    (r.safeToCall || r.safeToText) && r.phone ? `Phone: ${r.phone}${r.safeToCall ? '' : ' (text only)'}` : '',
    r.email ? `Email: ${r.email}` : '',
    r.safeTimes ? `Safe times: ${r.safeTimes}` : '',
    !r.safeToVoicemail ? 'Do NOT leave voicemail.' : '',
    r.language !== 'English' ? `Language: ${r.language}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ── Samples ─────────────────────────────────────────────────────────────

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

function sample(over: Partial<AssistRequest> & Pick<AssistRequest, 'ref' | 'summary' | 'name'>, createdHoursAgo: number): AssistRequest {
  const base = emptyRequest('Intake line');
  const createdAt = hoursAgo(createdHoursAgo);
  return {
    ...base,
    ...over,
    id: `sample-${over.ref}`,
    createdAt,
    activity: [{ id: 'a0', at: createdAt, by: 'Intake line', kind: 'created', text: 'Request logged' }, ...(over.activity ?? [])],
  };
}

export const SAMPLE_REQUESTS: AssistRequest[] = [
  sample(
    {
      ref: 'R-1041',
      source: 'Phone',
      needs: ['Food'],
      priority: 'high',
      summary: 'Family of 5, out of groceries until the 1st.',
      details: 'Two kids under 5. No car; can pick up near the 19 bus line.',
      name: 'Denise W.',
      phone: '(414) 555-0142',
      neighborhood: 'Sherman Park',
      householdSize: '5',
    },
    30,
  ),
  sample(
    {
      ref: 'R-1042',
      source: 'Text',
      needs: ['Safety / domestic violence', 'Housing & shelter'],
      priority: 'urgent',
      summary: 'Needs a safe place to stay tonight.',
      name: 'Anonymous',
      phone: '(414) 555-0199',
      preferredContact: 'Text',
      safeToCall: false,
      safeToVoicemail: false,
      safeTimes: 'Text only, before 3pm',
      confidential: true,
    },
    2,
  ),
  sample(
    {
      ref: 'R-1043',
      source: 'Walk-in',
      needs: ['Employment', 'Transportation'],
      priority: 'normal',
      status: 'in_progress',
      assignee: 'Maria Santos',
      summary: 'Looking for work; needs bus fare to get to interviews.',
      name: 'Marcus T.',
      phone: '(414) 555-0175',
      neighborhood: 'Harambee',
      followUpOn: today(),
      consentToShare: true,
      activity: [
        { id: 'a1', at: hoursAgo(20), by: 'Maria Santos', kind: 'assign', text: 'Assigned to Maria Santos' },
        { id: 'a2', at: hoursAgo(19), by: 'Maria Santos', kind: 'contact', text: 'Called. Interested in the outreach worker job; sending bus passes.' },
      ],
    },
    26,
  ),
  sample(
    {
      ref: 'R-1044',
      source: 'Partner referral',
      needs: ['Utilities', 'Food'],
      priority: 'normal',
      status: 'referred',
      assignee: 'Aisha Brown',
      summary: 'Disconnection notice; skipping groceries to pay the bill.',
      name: 'Luz R.',
      phone: '(414) 555-0110',
      language: 'Spanish',
      consentToShare: true,
      referral: { partner: 'Northside Food Pantry', status: 'accepted', sentAt: hoursAgo(40), note: 'Weekly groceries while the energy assistance application goes through.' },
    },
    72,
  ),
  sample(
    {
      ref: 'R-1045',
      source: 'Outreach',
      needs: ['Food'],
      priority: 'low',
      status: 'resolved',
      assignee: 'Jordan Ellis',
      summary: 'Asked about the holiday food drive.',
      name: 'Pat O.',
      outcome: 'Need met',
    },
    120,
  ),
];
