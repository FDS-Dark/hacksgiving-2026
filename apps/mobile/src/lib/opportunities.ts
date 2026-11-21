/**
 * Opportunity postings (jobs and volunteer openings) as staff and partners
 * write them. Client-side only until the API has an opportunities table;
 * the field names are meant to carry over to it.
 */

export type PostingKind = 'job' | 'volunteer';
export type PostingStatus = 'draft' | 'published' | 'closed';

export const CATEGORIES = [
  'Community outreach',
  'Food & basic needs',
  'Youth & education',
  'Events',
  'Safety & violence prevention',
  'Construction & trades',
  'Healthcare',
  'Office & admin',
  'Transportation',
  'Other',
] as const;

export const SETTINGS = ['On-site', 'Remote', 'Hybrid', 'Multiple sites'] as const;
export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Temporary', 'Seasonal', 'Contract', 'Internship'] as const;
export const PAY_PERIODS = ['hour', 'week', 'year', 'stipend'] as const;
export const BENEFITS = ['Health', 'Dental & vision', 'Paid time off', 'Retirement', 'Bus pass', 'Paid training', 'Flexible schedule'] as const;
export const PERKS = ['Meals', 'Parking', 'Bus pass', 'Service-hours letter', 'T-shirt', 'Childcare'] as const;
export const LANGUAGES = ['English', 'Spanish', 'Hmong', 'Arabic', 'Somali', 'ASL'] as const;
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const APPLY_METHODS = ['In the app', 'Website', 'Email', 'Phone', 'In person'] as const;

export type ApplyMethod = (typeof APPLY_METHODS)[number];

export interface Attachment {
  name: string;
  uri: string;
  mimeType?: string;
  size?: number;
}

export interface Posting {
  id: string;
  kind: PostingKind;
  status: PostingStatus;
  updatedAt: string;

  // The basics
  title: string;
  organization: string;
  category: string;
  /** One line for the listing card. */
  summary: string;
  description: string;
  /** One per line. */
  responsibilities: string;
  /** One per line. */
  requirements: string;

  // Where
  setting: string;
  address: string;
  neighborhood: string;
  /** Bus routes / transit notes. */
  transit: string;
  accessibility: string;

  // When
  startDate: string;
  endDate: string;
  ongoing: boolean;
  days: string[];
  hours: string;
  /** e.g. "20 hrs/week", "3-hour shifts". */
  commitment: string;

  // Job only
  employmentType: string;
  payMin: string;
  payMax: string;
  payPeriod: string;
  benefits: string[];
  openings: string;

  // Volunteer only
  spots: string;
  minAge: string;
  backgroundCheck: boolean;
  /** TRAINING_MODULES ids a volunteer must finish first. */
  training: string[];
  groupsWelcome: boolean;
  perks: string[];

  // Both
  languages: string[];

  // How to apply
  applyMethod: ApplyMethod;
  /** URL, email, phone, or address, depending on applyMethod. */
  applyValue: string;
  deadline: string;

  // Contact (shown to applicants)
  contactName: string;
  contactEmail: string;
  contactPhone: string;

  attachment: Attachment | null;
  /** Hide the posting after this date. */
  expiresOn: string;
  /** Internal notes, never shown to residents. */
  internalNotes: string;
}

export function emptyPosting(kind: PostingKind): Posting {
  return {
    id: newId(),
    kind,
    status: 'draft',
    updatedAt: new Date().toISOString(),
    title: '',
    organization: 'ComForce MKE',
    category: '',
    summary: '',
    description: '',
    responsibilities: '',
    requirements: '',
    setting: 'On-site',
    address: '',
    neighborhood: '',
    transit: '',
    accessibility: '',
    startDate: '',
    endDate: '',
    ongoing: false,
    days: [],
    hours: '',
    commitment: '',
    employmentType: 'Part-time',
    payMin: '',
    payMax: '',
    payPeriod: 'hour',
    benefits: [],
    openings: '1',
    spots: '10',
    minAge: '16',
    backgroundCheck: false,
    training: [],
    groupsWelcome: false,
    perks: [],
    languages: ['English'],
    applyMethod: 'In the app',
    applyValue: '',
    deadline: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    attachment: null,
    expiresOn: '',
    internalNotes: '',
  };
}

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Validation ──────────────────────────────────────────────────────────

export type Errors = Partial<Record<keyof Posting, string>>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+\.\S+/i;

function badDate(value: string) {
  if (!value) return false;
  if (!DATE.test(value)) return true;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value;
}

function digits(value: string) {
  return value.replace(/\D/g, '').length;
}

/** What placeholder the apply field shows for a method, or null when it needs none. */
export function applyHint(method: ApplyMethod): { label: string; placeholder: string } | null {
  switch (method) {
    case 'Website':
      return { label: 'Application link', placeholder: 'https://…' };
    case 'Email':
      return { label: 'Send applications to', placeholder: 'jobs@example.org' };
    case 'Phone':
      return { label: 'Call or text', placeholder: '(414) 555-0123' };
    case 'In person':
      return { label: 'Where to apply', placeholder: 'Address and hours' };
    case 'In the app':
      return null;
  }
}

/**
 * Drafts only need a title. Publishing needs everything a resident must
 * see to decide and apply.
 */
export function validate(p: Posting, publishing: boolean): Errors {
  const e: Errors = {};
  if (!p.title.trim()) e.title = 'Add a title.';
  if (!publishing) return e;

  if (!p.organization.trim()) e.organization = 'Who is this posting for?';
  if (!p.category) e.category = 'Pick a category.';
  if (!p.summary.trim()) e.summary = 'Add a one-line summary.';
  else if (p.summary.length > 140) e.summary = 'Keep the summary under 140 characters.';
  if (!p.description.trim()) e.description = 'Describe the opportunity.';
  if (p.setting !== 'Remote' && !p.address.trim()) e.address = 'Add an address, or choose Remote.';

  if (!p.startDate) e.startDate = 'Add a start date.';
  for (const key of ['startDate', 'endDate', 'deadline', 'expiresOn'] as const) {
    if (badDate(p[key])) e[key] = 'Use YYYY-MM-DD.';
  }
  if (!p.ongoing && p.endDate && p.startDate && !e.endDate && !e.startDate && p.endDate < p.startDate) {
    e.endDate = 'Ends before it starts.';
  }

  if (p.kind === 'job') {
    const min = Number(p.payMin);
    const max = Number(p.payMax);
    if (!p.payMin.trim()) e.payMin = 'Add pay. Postings with pay get more applicants.';
    else if (!(min > 0)) e.payMin = 'Enter a number.';
    if (p.payMax.trim() && !(max > 0)) e.payMax = 'Enter a number.';
    else if (p.payMax.trim() && min > 0 && max < min) e.payMax = 'Less than the minimum.';
    if (!(Number(p.openings) >= 1)) e.openings = 'At least 1.';
  } else {
    if (!(Number(p.spots) >= 1)) e.spots = 'At least 1.';
    if (p.minAge && !(Number(p.minAge) >= 0)) e.minAge = 'Enter an age.';
  }

  const value = p.applyValue.trim();
  if (p.applyMethod === 'Website' && !URL_RE.test(value)) e.applyValue = 'Enter a link starting with https://';
  if (p.applyMethod === 'Email' && !EMAIL.test(value)) e.applyValue = 'Enter an email address.';
  if (p.applyMethod === 'Phone' && digits(value) < 10) e.applyValue = 'Enter a phone number.';
  if (p.applyMethod === 'In person' && !value) e.applyValue = 'Say where to go.';

  if (!p.contactName.trim()) e.contactName = 'Who should applicants contact?';
  if (!p.contactEmail.trim() && !p.contactPhone.trim()) e.contactEmail = 'Add an email or phone.';
  if (p.contactEmail.trim() && !EMAIL.test(p.contactEmail.trim())) e.contactEmail = 'Enter an email address.';
  if (p.contactPhone.trim() && digits(p.contactPhone) < 10) e.contactPhone = 'Enter a phone number.';

  return e;
}

// ── Display ─────────────────────────────────────────────────────────────

export function payLabel(p: Posting): string | null {
  if (p.kind !== 'job' || !p.payMin) return null;
  const fmt = (v: string) => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const range = p.payMax ? `${fmt(p.payMin)}–${fmt(p.payMax)}` : fmt(p.payMin);
  return p.payPeriod === 'stipend' ? `${range} stipend` : `${range}/${p.payPeriod}`;
}

export function whenLabel(p: Posting): string | null {
  if (!p.startDate) return null;
  if (p.ongoing) return `Starts ${p.startDate}, ongoing`;
  return p.endDate ? `${p.startDate} to ${p.endDate}` : `Starts ${p.startDate}`;
}

// ── Samples ─────────────────────────────────────────────────────────────

export const SAMPLE_POSTINGS: Posting[] = [
  {
    ...emptyPosting('job'),
    id: 'sample-outreach',
    status: 'published',
    title: 'Community Outreach Worker',
    category: 'Community outreach',
    summary: 'Connect residents on the north side with food, housing, and safety resources.',
    description: 'Join our street team to check in with residents, share resources, and follow up on referrals.',
    responsibilities: 'Door-to-door and street outreach in pairs\nLog referrals and follow-ups\nStaff community events',
    requirements: 'Valid driver’s license\nKnowledge of Milwaukee neighborhoods',
    address: '2745 N Dr Martin Luther King Jr Dr, Milwaukee, WI',
    neighborhood: 'Harambee',
    startDate: '2026-12-07',
    ongoing: true,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    hours: '10am–4pm',
    commitment: '30 hrs/week',
    employmentType: 'Part-time',
    payMin: '19',
    payMax: '22',
    benefits: ['Paid training', 'Bus pass'],
    openings: '3',
    languages: ['English', 'Spanish'],
    contactName: 'Hiring team',
    contactEmail: 'jobs@comforcemke.org',
  },
  {
    ...emptyPosting('volunteer'),
    id: 'sample-pantry',
    status: 'draft',
    title: 'Holiday Food Drive Volunteer',
    organization: 'Northside Food Pantry',
    category: 'Food & basic needs',
    summary: 'Sort and hand out holiday meal boxes.',
    startDate: '2026-12-19',
    endDate: '2026-12-20',
    days: ['Sat', 'Sun'],
    hours: '9am–1pm',
    spots: '40',
    groupsWelcome: true,
    perks: ['Meals', 'Service-hours letter'],
  },
];
