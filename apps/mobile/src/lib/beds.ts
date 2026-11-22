/**
 * Open bed counts on shelters (Figma R3 "12 beds"). Staff enter them on a
 * place's page; the API hides a count older than 24 hours, so what reaches
 * here is recent. The time stays next to the number: a count is a promise
 * only until someone else takes the bed.
 */
import type { Resource } from '@/api/types';
import { timeAgo } from '@/lib/format';

export function bedsLabel(r: Pick<Resource, 'beds_available' | 'beds_updated_at'>, now = Date.now()): string | null {
  if (r.beds_available == null || !r.beds_updated_at) return null;
  const n = r.beds_available;
  const count = n === 0 ? 'No beds open' : `${n} bed${n === 1 ? '' : 's'} open`;
  return `${count} · updated ${timeAgo(r.beds_updated_at, now)}`;
}

/** Beds open tonight across these places, or null when no place has a count. */
export function totalBeds(resources: Pick<Resource, 'beds_available'>[]): number | null {
  const counted = resources.filter((r) => r.beds_available != null);
  return counted.length ? counted.reduce((sum, r) => sum + (r.beds_available ?? 0), 0) : null;
}
