/**
 * On call (/v1/oncall): who is on now, the shift schedule (A3), turning
 * yourself on or off, and urgent alerts (phase 3: Respond, accept, pass,
 * arrived, and the admin stats). Staff only; editing the schedule and the
 * stats are for admins. Every schedule change invalidates everything under
 * 'oncall', so the Today card, Me and the schedule move together.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, queryString, request, toApiError } from '@/api/client';

import type {
  CreateShift,
  OncallAlert,
  OncallAlertDetail,
  OncallNow,
  OncallShift,
  OncallStats,
  PassReason,
  ToggleOncall,
  UpdateShift,
} from '@/api/types';

export type { CreateShift, OncallNow, OncallShift, OncallSource, ToggleOncall, UpdateShift } from '@/api/types';

export const oncallApi = {
  now: () => request<OncallNow>('/oncall/now'),
  toggle: (body: ToggleOncall) => request<OncallNow>('/oncall/me', { method: 'POST', body: { on: body.on, until: body.until ?? null } }),
  shifts: (from: string, to: string) => request<OncallShift[]>(`/oncall/shifts${queryString({ from, to })}`),
  createShift: (body: CreateShift) => request<OncallShift>('/oncall/shifts', { method: 'POST', body }),
  updateShift: (id: string, body: UpdateShift) => request<OncallShift>(`/oncall/shifts/${id}`, { method: 'PATCH', body }),
  deleteShift: (id: string) => request<void>(`/oncall/shifts/${id}`, { method: 'DELETE' }),
  alerts: (openOnly = true) => request<OncallAlert[]>(`/oncall/alerts${queryString({ open_only: openOnly })}`),
  alert: (id: string) => request<OncallAlertDetail>(`/oncall/alerts/${id}`),
  accept: (id: string) => request<OncallAlertDetail>(`/oncall/alerts/${id}/accept`, { method: 'POST' }),
  pass: (id: string, reason: PassReason | null) => request<OncallAlertDetail>(`/oncall/alerts/${id}/pass`, { method: 'POST', body: reason ? { reason } : {} }),
  arrived: (id: string) => request<OncallAlertDetail>(`/oncall/alerts/${id}/arrived`, { method: 'POST' }),
  stats: (from: string, to: string) => request<OncallStats>(`/oncall/stats${queryString({ from, to })}`),
};

export const oncallKeys = {
  all: ['oncall'] as const,
  now: ['oncall', 'now'] as const,
  shifts: (from: string, to: string) => ['oncall', 'shifts', from, to] as const,
  alerts: ['oncall', 'alerts'] as const,
  openAlerts: ['oncall', 'alerts', 'open'] as const,
  alert: (id: string) => ['oncall', 'alerts', 'detail', id] as const,
  stats: (from: string, to: string) => ['oncall', 'stats', from, to] as const,
};

/** Shifts start and end on the clock, so check about once a minute. */
const NOW_POLL_MS = 60_000;

export function useOncallNow(enabled = true) {
  return useQuery({ queryKey: oncallKeys.now, queryFn: oncallApi.now, refetchInterval: NOW_POLL_MS, enabled });
}

/** Shifts overlapping [from, to) (ISO strings; keep them stable between renders). */
export function useShifts(from: string, to: string, enabled = true) {
  return useQuery({ queryKey: oncallKeys.shifts(from, to), queryFn: () => oncallApi.shifts(from, to), enabled });
}

function useInvalidateOncall() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: oncallKeys.all });
}

/** Go on or off call. The answer is the new "now", so the card flips at once. */
export function useToggleOncall() {
  const qc = useQueryClient();
  const invalidate = useInvalidateOncall();
  return useMutation({
    mutationFn: oncallApi.toggle,
    onSuccess: (now) => {
      qc.setQueryData(oncallKeys.now, now);
      return invalidate();
    },
  });
}

export function useCreateShift() {
  const invalidate = useInvalidateOncall();
  return useMutation({ mutationFn: oncallApi.createShift, onSuccess: invalidate });
}

export function useUpdateShift() {
  const invalidate = useInvalidateOncall();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateShift }) => oncallApi.updateShift(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteShift() {
  const invalidate = useInvalidateOncall();
  return useMutation({ mutationFn: oncallApi.deleteShift, onSuccess: invalidate });
}

const SHIFT_ERRORS: Record<string, string> = {
  shift_overlap: 'That person already has a shift at that time.',
  not_a_worker: 'Only ComForce staff can be on call.',
  invalid_until: 'Pick an end time within the next 24 hours.',
};

/** The API's schedule errors in words, for an ErrorBanner (keeps the request id). */
export function shiftError(error: unknown): ApiError {
  const e = toApiError(error);
  const message = SHIFT_ERRORS[e.code];
  return message ? new ApiError(e.status, e.code, message, e.requestId) : e;
}

// ── Urgent alerts (phase 3) ──────────────────────────────────────────────

export type { OncallAlert, OncallAlertDetail, OncallOffer, OncallStats, PassReason } from '@/api/types';

export const PASS_REASONS: { value: PassReason; label: string }[] = [
  { value: 'busy', label: 'Busy' },
  { value: 'too_far', label: 'Too far' },
  { value: 'not_safe_alone', label: 'Not safe alone' },
];

const OPEN_ALERTS_POLL_MS = 15_000;
const ALERT_POLL_MS = 5_000;

/** Open alerts (offering or unanswered), for Today's banners and S7. Pass `poll: false` while the screen is out of view. */
export function useOpenAlerts(poll = true) {
  return useQuery({
    queryKey: oncallKeys.openAlerts,
    queryFn: () => oncallApi.alerts(true),
    refetchInterval: poll ? OPEN_ALERTS_POLL_MS : false,
  });
}

/** One alert, refreshed every 5 s while its screen is open and the alert isn't closed (the countdown, "Taken by …"). */
export function useAlert(id: string | undefined) {
  return useQuery({
    queryKey: oncallKeys.alert(id ?? ''),
    queryFn: () => oncallApi.alert(id as string),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'resolved' || status === 'cancelled' ? false : ALERT_POLL_MS;
    },
  });
}

/**
 * Accepting assigns the case and writes notifications, so cases, the inbox
 * and "now" refresh too. Invalidated when settled, not only on success: a
 * 409 means someone else changed the alert, and the screen should show it.
 */
function useAlertMutation<V>(fn: (vars: V) => Promise<OncallAlertDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (detail) => qc.setQueryData(oncallKeys.alert(detail.id), detail),
    // Not returned: the caller's onSuccess (navigate, close a sheet) shouldn't wait on these refetches.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: oncallKeys.alerts });
      qc.invalidateQueries({ queryKey: oncallKeys.now });
      qc.invalidateQueries({ queryKey: ['cases'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useAcceptAlert() {
  return useAlertMutation((id: string) => oncallApi.accept(id));
}

export function usePassAlert() {
  return useAlertMutation(({ id, reason }: { id: string; reason: PassReason | null }) => oncallApi.pass(id, reason));
}

export function useArrived() {
  return useAlertMutation((id: string) => oncallApi.arrived(id));
}

/** Admin only: pass `enabled: false` for everyone else (the API answers 403). */
export function useOncallStats(from: string, to: string, enabled = true) {
  return useQuery({ queryKey: oncallKeys.stats(from, to), queryFn: () => oncallApi.stats(from, to), enabled });
}

const ALERT_ERRORS: Record<string, string> = {
  alert_closed: 'This alert is closed: the case was assigned by hand or resolved.',
};

/**
 * The API's alert errors in words, for an ErrorBanner or alert (keeps the
 * request id). `already_accepted` keeps the server's message, which names
 * who took it.
 */
export function oncallAlertError(error: unknown): ApiError {
  const e = toApiError(error);
  if (e.code === 'already_accepted') {
    return e.message ? e : new ApiError(e.status, e.code, 'Someone else already accepted this.', e.requestId);
  }
  const message = ALERT_ERRORS[e.code];
  return message ? new ApiError(e.status, e.code, message, e.requestId) : e;
}
