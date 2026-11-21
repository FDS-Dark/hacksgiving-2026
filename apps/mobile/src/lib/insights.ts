/**
 * Business insights: the numbers that run the organization (budget,
 * funding, cost per resident, volunteers, partner follow-through) and
 * the rules that turn them into actions.
 *
 * Operational insights read the live case records; training, postings and
 * the info hub read the admin state on this device. Finance and program figures are SAMPLE DATA until
 * accounting and grant records are connected; replace sampleBusiness().
 */
import type { Href } from 'expo-router';

import type { StatusLevel } from '@/theme/chart';
import type { InfoPost } from '@/lib/infohub';
import type { Posting } from '@/lib/opportunities';
import type { CaseStats } from '@/api/types';
import { REQUIRED_MODULES } from '@/lib/training';

export type Period = 'month' | 'quarter' | 'ytd';
export const PERIODS: { key: Period; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'ytd', label: 'Year to date' },
];

/**
 * Dollar value of a volunteer hour: Independent Sector's national
 * estimate. Update it each year when the new figure is published.
 */
export const VOLUNTEER_HOUR_VALUE = 34.79;

export const ANNUAL_BUDGET = 1_240_000;
export const FUNDING_GOAL = 1_300_000;

export interface BusinessData {
  residentsServed: number;
  residentsPrev: number;
  programSpend: number;
  volunteerHours: number;
  volunteerHoursPrev: number;
  /** Cumulative spend by month vs plan, $ thousands. */
  months: string[];
  spendActual: number[];
  spendPlan: number[];
  /** Each month's spend minus its plan, $ thousands (+ over, − under). */
  monthlyVariance: number[];
  /** Share of the year elapsed (the pace line for budget categories). */
  yearElapsed: number;
  categories: { name: string; budget: number; spent: number }[];
  pipeline: { stage: string; amount: number; count: number }[];
  deadlines: { name: string; due: string; daysLeft: number; kind: 'Report' | 'Application'; amount: number }[];
  programs: { name: string; cost: number; residents: number }[];
  funnel: { stage: string; count: number }[];
  partnerCompletion: { name: string; sent: number; completed: number }[];
}

function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const PERIOD_SCALE: Record<Period, number> = { month: 1, quarter: 2.9, ytd: 10.6 };

export function sampleBusiness(period: Period): BusinessData {
  const k = PERIOD_SCALE[period];
  const now = new Date();
  const monthIndex = now.getMonth();
  const yearElapsed = (monthIndex + now.getDate() / 31) / 12;
  const plan = Array.from({ length: 12 }, (_, i) => Math.round(((ANNUAL_BUDGET / 12) * (i + 1)) / 1000));
  // Spending ran ahead of plan from the summer on (vehicle repairs, overtime during the heat wave).
  const actualMonthly = [96, 98, 101, 99, 104, 112, 121, 118, 109, 107, 112].map((v) => v * 1000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const spendActual: number[] = [];
  actualMonthly.slice(0, monthIndex + 1).reduce((sum, v) => {
    spendActual.push(Math.round((sum + v) / 1000));
    return sum + v;
  }, 0);

  return {
    residentsServed: Math.round(910 * k),
    residentsPrev: Math.round(860 * k),
    programSpend: Math.round(104_000 * k),
    volunteerHours: Math.round(1_480 * k),
    volunteerHoursPrev: Math.round(1_610 * k),
    months: months.slice(0, spendActual.length),
    spendActual,
    spendPlan: plan.slice(0, spendActual.length),
    monthlyVariance: actualMonthly.slice(0, spendActual.length).map((v) => Math.round((v - ANNUAL_BUDGET / 12) / 100) / 10),
    yearElapsed,
    categories: [
      { name: 'Staff & overtime', budget: 720_000, spent: 668_000 },
      { name: 'Vehicles & fuel', budget: 96_000, spent: 97_500 },
      { name: 'Supplies & naloxone', budget: 84_000, spent: 61_000 },
      { name: 'Training', budget: 48_000, spent: 22_000 },
      { name: 'Rent & admin', budget: 292_000, spent: 258_000 },
    ],
    pipeline: [
      { stage: 'Prospects', amount: 640_000, count: 9 },
      { stage: 'Applied', amount: 415_000, count: 5 },
      { stage: 'Awarded', amount: 980_000, count: 7 },
      { stage: 'Received', amount: 742_000, count: 6 },
    ],
    deadlines: [
      { name: 'State overdose prevention grant', due: addDays(6), daysLeft: 6, kind: 'Report', amount: 120_000 },
      { name: 'Community safety foundation', due: addDays(18), daysLeft: 18, kind: 'Application', amount: 150_000 },
      { name: 'County violence interruption contract', due: addDays(34), daysLeft: 34, kind: 'Report', amount: 260_000 },
    ],
    programs: [
      { name: 'Rapid response', cost: Math.round(52_000 * k), residents: Math.round(410 * k) },
      { name: 'Food access', cost: Math.round(14_000 * k), residents: Math.round(260 * k) },
      { name: 'Job placement', cost: Math.round(19_000 * k), residents: Math.round(64 * k) },
      { name: 'Youth programs', cost: Math.round(11_000 * k), residents: Math.round(118 * k) },
      { name: 'DV support', cost: Math.round(8_000 * k), residents: Math.round(58 * k) },
    ],
    funnel: [
      { stage: 'Signed up', count: Math.round(64 * k) },
      { stage: 'Finished training', count: Math.round(41 * k) },
      { stage: 'Worked a first shift', count: Math.round(22 * k) },
      { stage: 'Still active at 90 days', count: Math.round(15 * k) },
    ],
    partnerCompletion: [
      { name: 'Northside Food Pantry', sent: Math.round(38 * k), completed: Math.round(34 * k) },
      { name: 'Harbor House Shelter', sent: Math.round(22 * k), completed: Math.round(13 * k) },
      { name: 'Sojourner Family Peace Center', sent: Math.round(15 * k), completed: Math.round(13 * k) },
    ],
  };
}

export const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `$${Math.round(n / 1000)}K` : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

// ── Insights ────────────────────────────────────────────────────────────

export interface Insight {
  id: string;
  level: StatusLevel;
  area: 'Operations' | 'Finance' | 'Funding' | 'Volunteers' | 'Partners' | 'Programs';
  title: string;
  detail: string;
  action: string;
  href?: Href;
  /** Turn on admin mode before following href (pages that show staff tools in place). */
  adminMode?: boolean;
}

const LEVEL_ORDER: StatusLevel[] = ['critical', 'serious', 'warning', 'good'];

/** The rules. Each finding names the problem, the stakes, and one next step. */
export function buildInsights(
  data: BusinessData,
  live: { cases?: CaseStats; postings: Posting[]; posts: InfoPost[]; staff: readonly { name: string; trainingDone: number }[] },
): Insight[] {
  const out: Insight[] = [];
  // Operations: live from the case records (GET /v1/cases/insights).
  const c = live.cases;
  if (c?.high_priority_active) {
    out.push({
      id: 'high-priority',
      level: 'critical',
      area: 'Operations',
      title: `${c.high_priority_active} high-priority case${c.high_priority_active > 1 ? 's are' : ' is'} still open`,
      detail: 'Residents who wait drop off, and response times are what funders ask about first.',
      action: 'Assign and respond',
      href: { pathname: '/worker/cases', params: { open: '1', urgent: '1' } },
    });
  }
  if (c?.new) {
    out.push({
      id: 'new',
      level: 'serious',
      area: 'Operations',
      title: `${c.new} request${c.new > 1 ? 's are' : ' is'} waiting for triage`,
      detail: 'Set a priority and category so the right worker picks it up.',
      action: 'Triage new requests',
      href: { pathname: '/worker/cases', params: { status: 'new' } },
    });
  }
  if (c?.unassigned_active) {
    out.push({
      id: 'unassigned',
      level: 'warning',
      area: 'Operations',
      title: `${c.unassigned_active} open case${c.unassigned_active > 1 ? 's have' : ' has'} no owner`,
      detail: 'Cases without an owner are the ones that get missed.',
      action: 'Open the queue',
      href: { pathname: '/worker/cases', params: { open: '1', assigned: 'unassigned' } },
    });
  }
  if (c?.awaiting_resources) {
    out.push({
      id: 'awaiting',
      level: 'warning',
      area: 'Operations',
      title: `${c.awaiting_resources} case${c.awaiting_resources > 1 ? 's are' : ' is'} waiting on a resource`,
      detail: 'Closing the loop with the partner is what turns a referral into a met need.',
      action: 'Follow up on referrals',
      href: { pathname: '/worker/cases', params: { status: 'awaiting_resources' } },
    });
  }

  const notReady = live.staff.filter((s) => s.trainingDone < REQUIRED_MODULES.length);
  if (notReady.length) {
    out.push({
      id: 'training',
      level: 'warning',
      area: 'Volunteers',
      title: `${notReady.length} people can’t take field shifts yet`,
      detail: `${notReady.map((s) => s.name).join(', ')} still have required training left. That’s capacity you’re already paying to recruit.`,
      action: 'Review training',
      href: '/worker/team',
    });
  }

  const [signed, trained, firstShift, retained] = data.funnel;
  const shiftRate = firstShift.count / (trained.count || 1);
  if (shiftRate < 0.7) {
    out.push({
      id: 'first-shift',
      level: 'serious',
      area: 'Volunteers',
      title: `Only ${Math.round(shiftRate * 100)}% of trained volunteers work a first shift`,
      detail: `${trained.count - firstShift.count} people finished training and never showed up. The biggest drop in the pipeline (${signed.count} signed up, ${retained.count} still active at 90 days).`,
      action: 'Post more volunteer shifts',
      href: '/opportunities',
      adminMode: true,
    });
  }

  const drafts = live.postings.filter((p) => p.status === 'draft');
  if (drafts.length) {
    out.push({
      id: 'drafts',
      level: 'warning',
      area: 'Programs',
      title: `${drafts.length} posting${drafts.length > 1 ? 's are' : ' is'} still in draft`,
      detail: drafts.map((d) => d.title || 'Untitled').join(', '),
      action: 'Finish and publish',
      href: '/opportunities',
      adminMode: true,
    });
  }

  for (const d of data.deadlines) {
    const days = d.daysLeft;
    if (days <= 21) {
      out.push({
        id: `deadline-${d.name}`,
        level: days <= 7 ? 'critical' : 'serious',
        area: 'Funding',
        title: `${d.kind} due in ${days} day${days === 1 ? '' : 's'}: ${d.name}`,
        detail: `${money(d.amount)} at stake. ${d.kind === 'Report' ? 'Late reports put renewals at risk.' : 'Pull response-time and outcome numbers from this dashboard.'}`,
        action: 'Share the task',
        href: '/worker/info',
      });
    }
  }

  const spent = data.spendActual[data.spendActual.length - 1] ?? 0;
  const planned = data.spendPlan[data.spendPlan.length - 1] ?? 1;
  const projected = Math.round((spent / data.yearElapsed) * 1000);
  if (spent > planned) {
    out.push({
      id: 'budget',
      level: projected > ANNUAL_BUDGET * 1.03 ? 'serious' : 'warning',
      area: 'Finance',
      title: `Spending is ${money((spent - planned) * 1000)} ahead of plan`,
      detail: `At this pace the year ends near ${money(projected)} against a ${money(ANNUAL_BUDGET)} budget.`,
      action: 'See where it’s going',
    });
  }
  const monthsLeft = Math.max(0, Math.round((1 - data.yearElapsed) * 12));
  for (const c of data.categories) {
    if (c.spent > c.budget) {
      out.push({
        id: `cat-${c.name}`,
        level: 'serious',
        area: 'Finance',
        title: `${c.name} is over its annual budget`,
        detail: `${money(c.spent)} spent of ${money(c.budget)} with ${monthsLeft} month${monthsLeft === 1 ? '' : 's'} of the year left. Move funds or cut back now.`,
        action: 'Plan a budget transfer',
      });
    } else if (c.spent / c.budget < data.yearElapsed - 0.25) {
      out.push({
        id: `under-${c.name}`,
        level: 'warning',
        area: 'Finance',
        title: `${c.name} is underspent`,
        detail: `${Math.round((c.spent / c.budget) * 100)}% used with ${Math.round(data.yearElapsed * 100)}% of the year gone. Restricted funds may have to be returned if they aren’t used.`,
        action: 'Schedule the spend',
      });
    }
  }

  const weak = data.partnerCompletion.filter((p) => p.completed / (p.sent || 1) < 0.7);
  for (const p of weak) {
    out.push({
      id: `partner-${p.name}`,
      level: 'warning',
      area: 'Partners',
      title: `${p.name} completes ${Math.round((p.completed / (p.sent || 1)) * 100)}% of referrals`,
      detail: `${p.sent - p.completed} of ${p.sent} referrals didn’t end in service. Check capacity and intake rules with them before sending more.`,
      action: 'Post a partner note',
      href: '/worker/info',
    });
  }

  const unread = live.posts.filter((p) => p.requireAck && p.acknowledgedBy.length < live.staff.length);
  if (unread.length) {
    out.push({
      id: 'acks',
      level: 'warning',
      area: 'Operations',
      title: `${unread.length} must-read post${unread.length > 1 ? 's' : ''} not confirmed by everyone`,
      detail: 'Safety and policy updates only work if the whole team has read them.',
      action: 'See who hasn’t',
      href: '/worker/info',
    });
  }

  const growth = data.residentsServed / (data.residentsPrev || 1) - 1;
  if (growth > 0.03) {
    out.push({
      id: 'growth',
      level: 'good',
      area: 'Programs',
      title: `Residents served up ${Math.round(growth * 100)}% from last period`,
      detail: 'Put this in the next funder update with a resident story.',
      action: 'Draft an announcement',
      href: '/worker/info',
    });
  }

  return out.sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));
}
