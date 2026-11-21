/**
 * Rapid response and EMS metrics for the admin dashboard. SAMPLE DATA:
 * generated from a fixed seed per filter so numbers are stable and agree
 * across charts. Replace generate() with an API query; the shape is what
 * the charts need.
 */

export type RangeDays = 7 | 30 | 90;
export const RANGES: { days: RangeDays; label: string }[] = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];

export const DISTRICTS = ['All districts', 'North', 'Central', 'South'] as const;
export type District = (typeof DISTRICTS)[number];

/** Response-time goal for ComForce teams, minutes. */
export const RESPONSE_TARGET_MIN = 10;

export const INCIDENT_TYPES = [
  'Wellness check',
  'Mental health crisis',
  'Medical (EMS)',
  'Overdose',
  'Conflict / violence',
  'Domestic violence',
  'Unhoused outreach',
  'Other',
] as const;

export const OUTCOMES = ['Resolved on scene', 'Connected to services', 'EMS transport', 'Police assist', 'Declined / gone on arrival'] as const;

export const HEAT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const HEAT_BLOCKS = ['12–4a', '4–8a', '8a–12p', '12–4p', '4–8p', '8p–12a'] as const;

export const PRIORITIES = [
  { name: 'Priority 1: life-threatening', targetMin: 8 },
  { name: 'Priority 2: urgent', targetMin: 15 },
  { name: 'Priority 3: non-urgent', targetMin: 30 },
] as const;
/** Share of calls that should be reached within target. */
export const PRIORITY_GOAL = 0.9;

export interface Day {
  date: Date;
  incidents: number;
  /** Median minutes from dispatch to ComForce on scene. */
  comforceMin: number;
  /** Median minutes from 911 call to EMS on scene, for calls both answered. */
  emsMin: number;
  transports: number;
  naloxone: number;
  reversals: number;
}

export interface Totals {
  incidents: number;
  comforceMin: number;
  emsMin: number;
  transports: number;
  naloxone: number;
  reversals: number;
}

export interface ResponseData {
  days: Day[];
  totals: Totals;
  previous: Totals;
  types: { name: string; count: number }[];
  /** [day of week][4-hour block] incident counts. */
  heat: number[][];
  priorities: { name: string; targetMin: number; within: number; calls: number }[];
  outcomes: { name: string; count: number }[];
}

function rng(seed: number) {
  // mulberry32
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DISTRICT_SCALE: Record<District, number> = { 'All districts': 1, North: 0.42, Central: 0.33, South: 0.25 };
const TYPE_WEIGHTS = [0.24, 0.18, 0.15, 0.09, 0.11, 0.07, 0.1, 0.06];
const OUTCOME_WEIGHTS = [0.41, 0.27, 0.16, 0.07, 0.09];
const BLOCK_WEIGHTS = [0.08, 0.04, 0.14, 0.22, 0.28, 0.24];
const DAY_WEIGHTS = [0.9, 0.85, 0.9, 0.95, 1.15, 1.3, 1.1];

function makeDays(count: number, endOffset: number, district: District, rand: () => number): Day[] {
  const scale = DISTRICT_SCALE[district];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: Day[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i - endOffset);
    const dow = (date.getDay() + 6) % 7;
    // Response times improve slowly over the period (new staging site).
    const progress = 1 - (i + endOffset) / 180;
    const incidents = Math.round((16 + rand() * 8) * DAY_WEIGHTS[dow] * scale);
    const naloxone = Math.round(rand() * 2.4 * scale);
    days.push({
      date,
      incidents,
      comforceMin: round1(10.8 - progress * 2.2 + (rand() - 0.5) * 2.6 + (district === 'South' ? 1.4 : 0)),
      emsMin: round1(12.6 - progress * 0.6 + (rand() - 0.5) * 3 + (district === 'South' ? 1.8 : 0)),
      transports: Math.round(incidents * (0.12 + rand() * 0.08)),
      naloxone,
      reversals: Math.max(0, naloxone - (rand() < 0.15 ? 1 : 0)),
    });
  }
  return days;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function totals(days: Day[]): Totals {
  const sum = (k: keyof Omit<Day, 'date'>) => days.reduce((s, d) => s + d[k], 0);
  return {
    incidents: sum('incidents'),
    comforceMin: round1(median(days.map((d) => d.comforceMin))),
    emsMin: round1(median(days.map((d) => d.emsMin))),
    transports: sum('transports'),
    naloxone: sum('naloxone'),
    reversals: sum('reversals'),
  };
}

export function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Split n into whole numbers by weight (largest remainder). */
function split(n: number, weights: number[], rand: () => number) {
  const jittered = weights.map((w) => w * (0.85 + rand() * 0.3));
  const total = jittered.reduce((a, b) => a + b, 0);
  const raw = jittered.map((w) => (w / total) * n);
  const out = raw.map(Math.floor);
  let left = n - out.reduce((a, b) => a + b, 0);
  raw
    .map((r, i) => [r - Math.floor(r), i] as const)
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => {
      if (left-- > 0) out[i]++;
    });
  return out;
}

export function generate(range: RangeDays, district: District): ResponseData {
  const rand = rng(range * 1000 + DISTRICTS.indexOf(district) * 7 + 11);
  const days = makeDays(range, 0, district, rand);
  const previous = totals(makeDays(range, range, district, rand));
  const t = totals(days);

  const typeCounts = split(t.incidents, TYPE_WEIGHTS, rand);
  const types = INCIDENT_TYPES.map((name, i) => ({ name, count: typeCounts[i] })).sort((a, b) => b.count - a.count);

  const heat = HEAT_DAYS.map((_, d) => {
    const dayTotal = days.filter((x) => (x.date.getDay() + 6) % 7 === d).reduce((s, x) => s + x.incidents, 0);
    return split(dayTotal, BLOCK_WEIGHTS, rand);
  });

  const priorityCalls = split(t.incidents, [0.22, 0.43, 0.35], rand);
  const priorities = PRIORITIES.map((p, i) => ({
    ...p,
    calls: priorityCalls[i],
    within: Math.min(0.99, [0.78, 0.88, 0.95][i] + (rand() - 0.5) * 0.06 - (district === 'South' ? 0.06 : 0)),
  }));

  const outcomeCounts = split(t.incidents, OUTCOME_WEIGHTS, rand);
  const outcomes = OUTCOMES.map((name, i) => ({ name, count: outcomeCounts[i] }));

  return { days, totals: t, previous, types, heat, priorities, outcomes };
}

/** Group days into buckets of `size` (1 = daily, 7 = weekly), oldest first. */
export function bucket(days: Day[], size: number) {
  const out: { label: string; span: string; days: Day[] }[] = [];
  for (let i = days.length; i > 0; i -= size) {
    const chunk = days.slice(Math.max(0, i - size), i);
    const first = shortDate(chunk[0].date);
    const last = shortDate(chunk[chunk.length - 1].date);
    // The oldest bucket can be a partial week; the span says so.
    out.unshift({ label: first, span: first === last ? first : `${first}–${last}`, days: chunk });
  }
  return out;
}

export function shortDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
