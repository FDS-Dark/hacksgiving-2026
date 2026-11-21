/**
 * The services directory: outside programs residents are connected to
 * (food, shelter, health, crisis lines, ...), how ComForce works with each
 * provider, and how much each service is used.
 *
 * Usage comes from events. Staff events (opening a link from the admin
 * page, sending a referral) are recorded live. Resident events will be
 * recorded by the Resources page once it lists these services: call
 * useAdmin().trackServiceEvent(id, kind, 'resident') on view/tap. Until
 * then resident events are SAMPLE DATA from sampleEvents().
 */

export const SERVICE_CATEGORIES = [
  'Food',
  'Housing & shelter',
  'Health',
  'Mental health & crisis',
  'Domestic violence',
  'Transportation',
  'Employment',
  'Legal',
  'Utilities',
  'Youth',
] as const;

export type PartnerStatus = 'listed' | 'contacted' | 'partner' | 'inactive';
export const PARTNER_STATUS_LABEL: Record<PartnerStatus, string> = {
  listed: 'Listed only',
  contacted: 'In contact',
  partner: 'Partner',
  inactive: 'Inactive',
};

export type EventKind = 'view' | 'link' | 'call' | 'directions' | 'referral';
export const EVENT_LABEL: Record<EventKind, string> = {
  view: 'Viewed details',
  link: 'Opened website',
  call: 'Tapped to call',
  directions: 'Got directions',
  referral: 'Referred by staff',
};
/** Actions that connect someone to the service (a view alone doesn't). */
export const CONNECT_KINDS: EventKind[] = ['link', 'call', 'directions', 'referral'];

export interface ServiceEvent {
  serviceId: string;
  kind: EventKind;
  /** Epoch ms. */
  at: number;
  source: 'resident' | 'staff';
}

export interface Service {
  id: string;
  name: string;
  category: string;
  description: string;
  phone: string;
  website: string;
  address: string;
  hours: string;
  eligibility: string;
  languages: string;
  status: PartnerStatus;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  /** YYYY-MM-DD: when someone last confirmed hours, phone, and eligibility. */
  lastVerified: string;
  /** YYYY-MM-DD */
  lastContacted: string;
  notes: string;
}

/** Listings older than this are flagged for a check. */
export const STALE_DAYS = 180;
const DAY = 86_400_000;

export function emptyService(): Service {
  return {
    id: `svc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    category: '',
    description: '',
    phone: '',
    website: '',
    address: '',
    hours: '',
    eligibility: '',
    languages: 'English',
    status: 'listed',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    lastVerified: isoDay(0),
    lastContacted: '',
    notes: '',
  };
}

export function isoDay(daysAgo: number, now = Date.now()) {
  return new Date(now - daysAgo * DAY).toISOString().slice(0, 10);
}

export function daysSince(iso: string, now = Date.now()) {
  return iso ? Math.floor((now - Date.parse(`${iso}T00:00:00`)) / DAY) : Infinity;
}

export function isStale(s: Service, now = Date.now()) {
  return daysSince(s.lastVerified, now) > STALE_DAYS;
}

const URL_RE = /^https?:\/\/\S+\.\S+/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateService(s: Service): Partial<Record<keyof Service, string>> {
  const e: Partial<Record<keyof Service, string>> = {};
  if (!s.name.trim()) e.name = 'Add the service name.';
  if (!s.category) e.category = 'Pick a category.';
  if (!s.phone.trim() && !s.website.trim() && !s.address.trim()) e.phone = 'Add at least a phone, website, or address so people can reach it.';
  if (s.website.trim() && !URL_RE.test(s.website.trim())) e.website = 'Enter a link starting with https://';
  if (s.contactEmail.trim() && !EMAIL.test(s.contactEmail.trim())) e.contactEmail = 'Enter an email address.';
  for (const k of ['lastVerified', 'lastContacted'] as const) if (s[k] && !DATE.test(s[k])) e[k] = 'Use YYYY-MM-DD.';
  return e;
}

// ── Usage stats ─────────────────────────────────────────────────────────

export type Counts = Record<EventKind, number> & { total: number; connects: number };

function zero(): Counts {
  return { view: 0, link: 0, call: 0, directions: 0, referral: 0, total: 0, connects: 0 };
}

/** Event counts per service in [now - days, now), plus the period before it for trends. */
export function usage(events: ServiceEvent[], days: number, now = Date.now()) {
  const start = now - days * DAY;
  const prevStart = start - days * DAY;
  const current = new Map<string, Counts>();
  const previous = new Map<string, Counts>();
  for (const e of events) {
    const bucket = e.at >= start ? current : e.at >= prevStart ? previous : null;
    if (!bucket) continue;
    const c = bucket.get(e.serviceId) ?? zero();
    c[e.kind]++;
    c.total++;
    if (CONNECT_KINDS.includes(e.kind)) c.connects++;
    bucket.set(e.serviceId, c);
  }
  return { current, previous, get: (id: string) => current.get(id) ?? zero(), getPrev: (id: string) => previous.get(id) ?? zero() };
}

export function sumCounts(list: Counts[]): Counts {
  return list.reduce((a, c) => {
    (Object.keys(a) as (keyof Counts)[]).forEach((k) => (a[k] += c[k]));
    return a;
  }, zero());
}

/** Connections per day (or week) for a chart, oldest first. */
export function series(events: ServiceEvent[], days: number, serviceId?: string, now = Date.now()) {
  const size = days > 30 ? 7 : 1;
  const n = Math.ceil(days / size);
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  const endMs = end.getTime();
  const values = new Array(n).fill(0);
  for (const e of events) {
    if (serviceId && e.serviceId !== serviceId) continue;
    if (!CONNECT_KINDS.includes(e.kind)) continue;
    const back = Math.floor((endMs - 1 - e.at) / (size * DAY));
    if (back >= 0 && back < n) values[n - 1 - back]++;
  }
  const labels = values.map((_, i) => new Date(endMs - (n - i) * size * DAY).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  return { labels, values, size };
}

/** Share of detail views that led to a connection. */
export function connectRate(c: Counts) {
  return c.view ? Math.min(1, (c.link + c.call + c.directions) / c.view) : 0;
}

// ── Samples ─────────────────────────────────────────────────────────────

export const SAMPLE_SERVICES: Service[] = [
  {
    ...emptyService(),
    id: 'svc-northside-pantry',
    name: 'Northside Food Pantry',
    category: 'Food',
    description: 'Weekly groceries and holiday meal boxes. No ID required.',
    phone: '(414) 555-0131',
    website: 'https://example.org/northside-pantry',
    address: '3200 N 35th St, Milwaukee, WI',
    hours: 'Tue & Thu 10am–4pm, Sat 9am–12pm',
    eligibility: 'Milwaukee County residents',
    languages: 'English, Spanish',
    status: 'partner',
    contactName: 'Pantry coordinator',
    contactEmail: 'coordinator@example.org',
    lastVerified: isoDay(20),
    lastContacted: isoDay(9),
  },
  {
    ...emptyService(),
    id: 'svc-harbor-house',
    name: 'Harbor House Shelter',
    category: 'Housing & shelter',
    description: 'Emergency shelter beds for adults and families; intake 24/7.',
    phone: '(414) 555-0150',
    address: '1500 W North Ave, Milwaukee, WI',
    hours: '24/7 intake',
    eligibility: 'Adults 18+ and families',
    status: 'partner',
    contactName: 'Intake supervisor',
    lastVerified: isoDay(64),
    lastContacted: isoDay(40),
    notes: 'Often full on weekends; call ahead before sending someone.',
  },
  {
    ...emptyService(),
    id: 'svc-sojourner',
    name: 'Sojourner Family Peace Center',
    category: 'Domestic violence',
    description: 'Domestic violence hotline, shelter, and safety planning.',
    phone: '(414) 555-0100',
    hours: 'Hotline 24/7',
    status: 'partner',
    lastVerified: isoDay(30),
    lastContacted: isoDay(14),
  },
  {
    ...emptyService(),
    id: 'svc-988',
    name: '988 Suicide & Crisis Lifeline',
    category: 'Mental health & crisis',
    description: 'Call or text 988 for free, confidential crisis support.',
    phone: '988',
    website: 'https://988lifeline.org',
    hours: '24/7',
    languages: 'English, Spanish, interpreters',
    lastVerified: isoDay(45),
  },
  {
    ...emptyService(),
    id: 'svc-211',
    name: '2-1-1 Community Resource Line',
    category: 'Mental health & crisis',
    description: 'Dial 2-1-1 to find local help with food, housing, bills, and more.',
    phone: '211',
    hours: '24/7',
    lastVerified: isoDay(90),
  },
  {
    ...emptyService(),
    id: 'svc-mke-rides',
    name: 'MKE Rides Collective',
    category: 'Transportation',
    description: 'Free rides to medical appointments and job interviews.',
    phone: '(414) 555-0166',
    website: 'https://example.org/mke-rides',
    hours: 'Weekdays 7am–7pm, book a day ahead',
    status: 'contacted',
    contactName: 'Program manager',
    lastVerified: isoDay(110),
    lastContacted: isoDay(25),
  },
  {
    ...emptyService(),
    id: 'svc-westside-clinic',
    name: 'Westside Community Health Clinic',
    category: 'Health',
    description: 'Sliding-scale primary care, vaccines, and prescriptions.',
    phone: '(414) 555-0177',
    website: 'https://example.org/westside-clinic',
    address: '5100 W Vliet St, Milwaukee, WI',
    hours: 'Mon–Fri 8am–6pm',
    eligibility: 'Uninsured and underinsured welcome',
    lastVerified: isoDay(220),
  },
  {
    ...emptyService(),
    id: 'svc-legal-aid',
    name: 'Eastside Legal Aid Clinic',
    category: 'Legal',
    description: 'Free help with evictions, benefits, and record expungement.',
    website: 'https://example.org/legal-aid',
    address: '700 E Locust St, Milwaukee, WI',
    hours: 'Walk-in Wednesdays 1–5pm',
    status: 'contacted',
    lastVerified: isoDay(150),
    lastContacted: isoDay(60),
  },
  {
    ...emptyService(),
    id: 'svc-energy',
    name: 'Energy Assistance Program office',
    category: 'Utilities',
    description: 'Help paying heating and electric bills; disconnection prevention.',
    phone: '(414) 555-0188',
    website: 'https://example.org/energy-assistance',
    hours: 'Mon–Fri 9am–4pm',
    eligibility: 'Income limits apply',
    lastVerified: isoDay(75),
  },
  {
    ...emptyService(),
    id: 'svc-job-center',
    name: 'Northside Job Center',
    category: 'Employment',
    description: 'Job search help, résumé workshops, and hiring events.',
    phone: '(414) 555-0199',
    website: 'https://example.org/job-center',
    address: '2800 W Fond du Lac Ave, Milwaukee, WI',
    status: 'partner',
    lastVerified: isoDay(40),
    lastContacted: isoDay(18),
  },
  {
    ...emptyService(),
    id: 'svc-warming',
    name: 'Southside Warming Center',
    category: 'Housing & shelter',
    description: 'Overnight warming site when temperatures drop below 20°F.',
    address: '1600 S 13th St, Milwaukee, WI',
    hours: 'Nov–Mar, 7pm–7am on cold nights',
    lastVerified: isoDay(12),
  },
  {
    ...emptyService(),
    id: 'svc-youth-mentoring',
    name: 'Youth Mentoring Network',
    category: 'Youth',
    description: 'One-on-one mentors for ages 10–18.',
    website: 'https://example.org/youth-mentoring',
    lastVerified: isoDay(300),
  },
];

/** Relative popularity of each sample service (0 = never used). */
const POPULARITY: Record<string, number> = {
  'svc-northside-pantry': 9,
  'svc-harbor-house': 6,
  'svc-sojourner': 3,
  'svc-988': 4,
  'svc-211': 5,
  'svc-mke-rides': 3.5,
  'svc-westside-clinic': 2.5,
  'svc-legal-aid': 1.2,
  'svc-energy': 4.5,
  'svc-job-center': 2,
  'svc-warming': 1.5,
  'svc-youth-mentoring': 0,
};

/** 180 days of sample events, stable from run to run. */
export function sampleEvents(now = Date.now()): ServiceEvent[] {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const out: ServiceEvent[] = [];
  for (const [serviceId, pop] of Object.entries(POPULARITY)) {
    for (let d = 0; d < 180; d++) {
      // Winter lifts utilities and the warming center.
      const seasonal = (serviceId === 'svc-energy' || serviceId === 'svc-warming') && d < 30 ? 2.2 : 1;
      const views = Math.floor(rand() * pop * 1.6 * seasonal);
      for (let v = 0; v < views; v++) {
        const at = now - d * DAY - Math.floor(rand() * DAY);
        out.push({ serviceId, kind: 'view', at, source: 'resident' });
        const r = rand();
        if (r < 0.28) out.push({ serviceId, kind: 'call', at: at + 60_000, source: 'resident' });
        else if (r < 0.46) out.push({ serviceId, kind: 'link', at: at + 60_000, source: 'resident' });
        else if (r < 0.56) out.push({ serviceId, kind: 'directions', at: at + 60_000, source: 'resident' });
      }
      if (rand() < pop / 30) out.push({ serviceId, kind: 'referral', at: now - d * DAY, source: 'staff' });
    }
  }
  return out;
}
