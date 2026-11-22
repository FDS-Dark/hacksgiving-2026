/**
 * Urgent escalation (phase 3): the copy and state of an on-call alert on the
 * Respond screen, Today's banner and S7's urgent card. Pure; every helper
 * that depends on the clock takes `now` (ms or Date).
 *
 * Distances are worked out here from the phone's own position and the
 * case's coordinates. They are never sent to the server.
 */

import type { AlertStatus, OfferOutcome } from '@/api/types';

export type { AlertStatus, OfferOutcome } from '@/api/types';

/** The fields of an OncallAlert these helpers read. */
export interface AlertLike {
  case_number: number;
  case_title: string;
  status: AlertStatus;
  accepted_by: string | null;
  accepted_by_name: string | null;
  my_offer: { expires_at: string; outcome: OfferOutcome } | null;
  next_name: string | null;
}

type Clock = number | Date;
const ms = (now: Clock) => (typeof now === 'number' ? now : now.getTime());

// ── State ────────────────────────────────────────────────────────────────

/** Still looking for someone: anyone on staff may accept. */
export function isOpen(alert: Pick<AlertLike, 'status'>) {
  return alert.status === 'offering' || alert.status === 'unanswered';
}

/** I was offered this step and haven't answered yet. */
export function hasPendingOffer(alert: Pick<AlertLike, 'status' | 'my_offer'>) {
  return isOpen(alert) && alert.my_offer?.outcome === 'pending';
}

export type AlertView = 'respond' | 'responding' | 'taken' | 'closed';

/**
 * Which screen /staff/alerts/[id] shows:
 * - respond: still open (my pending offer, or nobody has accepted yet)
 * - responding: I accepted
 * - taken: someone else accepted
 * - closed: assigned by hand, or the case was resolved or closed
 */
export function alertView(alert: Pick<AlertLike, 'status' | 'accepted_by' | 'my_offer'>, myId: string | null | undefined): AlertView {
  if (isOpen(alert)) return 'respond';
  if (alert.status !== 'accepted') return 'closed';
  const mine = (!!myId && alert.accepted_by === myId) || alert.my_offer?.outcome === 'accepted';
  return mine ? 'responding' : 'taken';
}

/** "Taken by Maria"; nobody named → "Taken by someone else". */
export function takenLabel(alert: Pick<AlertLike, 'accepted_by_name'>) {
  return `Taken by ${alert.accepted_by_name?.trim() || 'someone else'}`;
}

// ── Countdown ────────────────────────────────────────────────────────────

/** Whole seconds until `expiresAt`, never below 0. */
export function secondsLeft(expiresAt: string, now: Clock) {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - ms(now)) / 1000));
}

/** 272 → "4:32", 5 → "0:05". */
export function mmss(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "Devon Harris" → "Devon"; null stays null. */
function first(name: string | null) {
  return name?.trim().split(/\s+/)[0] || null;
}

/** Respond's countdown: "Moves to Devon in 4:32", "Moves on in 4:32", or "Moving on now" once it runs out. */
export function movesOnLabel(alert: Pick<AlertLike, 'next_name'>, expiresAt: string, now: Clock) {
  const left = secondsLeft(expiresAt, now);
  const next = first(alert.next_name);
  if (left === 0) return next ? `Moving to ${next} now` : 'Moving on now';
  return next ? `Moves to ${next} in ${mmss(left)}` : `Moves on in ${mmss(left)}`;
}

/** S7's urgent card: "You're on call. Accept within 4:12 or it goes to Devon." */
export function offerLine(alert: Pick<AlertLike, 'next_name'>, expiresAt: string, now: Clock) {
  const left = secondsLeft(expiresAt, now);
  const next = first(alert.next_name);
  if (left === 0) return next ? `You’re on call. Time’s up: it’s going to ${next}.` : 'You’re on call. Time’s up: it’s moving on.';
  return `You’re on call. Accept within ${mmss(left)} or it ${next ? `goes to ${next}` : 'moves on'}.`;
}

// ── Today's banner ───────────────────────────────────────────────────────

/** "Urgent: Conflict near N 27th & Wells". */
export function bannerTitle(alert: Pick<AlertLike, 'case_title'>) {
  return `Urgent: ${alert.case_title}`;
}

/**
 * The line under it:
 * - unanswered: "Nobody has accepted #1048"
 * - offered to me: "#1048 · offered to you, tap to respond"
 * - otherwise: "#1048 · finding someone on call"
 */
export function bannerLine(alert: Pick<AlertLike, 'case_number' | 'status' | 'my_offer'>) {
  if (alert.status === 'unanswered') return `Nobody has accepted #${alert.case_number}`;
  if (hasPendingOffer(alert)) return `#${alert.case_number} · offered to you, tap to respond`;
  return `#${alert.case_number} · finding someone on call`;
}

// ── Distance ─────────────────────────────────────────────────────────────

export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_MILES = 3958.8;

/** Straight-line miles between two points (haversine). */
export function milesBetween(a: LatLng, b: LatLng) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rough city speeds: walking 3 mph; driving 15 mph plus a minute to get going. Streets aren't straight lines, so round up. */
const WALK_MPH = 3;
const DRIVE_MPH = 15;
const WALK_UP_TO_MILES = 0.75;

/**
 * "0.4 mi away · about 8 min walk", "1.2 mi away · about 6 min drive";
 * under a tenth of a mile → "Right nearby".
 */
export function distanceLabel(miles: number) {
  if (miles < 0.1) return 'Right nearby';
  const shown = miles < 10 ? miles.toFixed(1) : String(Math.round(miles));
  const walk = miles <= WALK_UP_TO_MILES;
  const minutes = Math.max(1, Math.ceil(walk ? (miles / WALK_MPH) * 60 : (miles / DRIVE_MPH) * 60 + 1));
  return `${shown} mi away · about ${minutes} min ${walk ? 'walk' : 'drive'}`;
}

// ── Insights ─────────────────────────────────────────────────────────────

/** Average time to accept: 45 → "45 sec", 250 → "4 min", 4500 → "1 h 15 min"; nothing yet → "—". */
export function responseTime(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
