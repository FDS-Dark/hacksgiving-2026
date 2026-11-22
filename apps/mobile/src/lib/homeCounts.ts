/**
 * The live line under each "Find support" tile on Home (Mockups flow 1:
 * "12 open beds tonight", "8 new this week"). Only numbers we really have:
 * staff-entered bed counts, and postings by date. Opening hours are free
 * text, so there is no "serving now".
 */
import type { Opportunity, Resource } from '@/api/types';
import { totalBeds } from '@/lib/beds';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function places(n: number) {
  return `${n} place${n === 1 ? '' : 's'}`;
}

/** Shelter: beds open tonight when any shelter has a fresh count, else how many shelters. */
export function shelterLine(shelters: Resource[]) {
  const beds = totalBeds(shelters);
  if (beds === null) return places(shelters.length);
  return beds === 0 ? 'No open beds reported' : `${beds} open bed${beds === 1 ? '' : 's'} tonight`;
}

/** Jobs and training: postings that are new this week, else how many are open. */
export function jobsLine(opportunities: Opportunity[], now = Date.now()) {
  const fresh = opportunities.filter((o) => now - new Date(o.posted_at ?? o.created_at).getTime() < WEEK_MS).length;
  if (fresh) return `${fresh} new this week`;
  return `${opportunities.length} open`;
}
