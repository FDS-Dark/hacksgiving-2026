/**
 * On call (/v1/oncall): who is on now, the shift schedule (A3), and turning
 * yourself on or off. Staff only; editing the schedule is for admins.
 * Every change invalidates everything under 'oncall', so the Today card,
 * Me and the schedule move together.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, queryString, request, toApiError } from '@/api/client';

import type { CreateShift, OncallNow, OncallShift, ToggleOncall, UpdateShift } from '@/api/types';

export type { CreateShift, OncallNow, OncallShift, OncallSource, ToggleOncall, UpdateShift } from '@/api/types';

export const oncallApi = {
  now: () => request<OncallNow>('/oncall/now'),
  toggle: (body: ToggleOncall) => request<OncallNow>('/oncall/me', { method: 'POST', body: { on: body.on, until: body.until ?? null } }),
  shifts: (from: string, to: string) => request<OncallShift[]>(`/oncall/shifts${queryString({ from, to })}`),
  createShift: (body: CreateShift) => request<OncallShift>('/oncall/shifts', { method: 'POST', body }),
  updateShift: (id: string, body: UpdateShift) => request<OncallShift>(`/oncall/shifts/${id}`, { method: 'PATCH', body }),
  deleteShift: (id: string) => request<void>(`/oncall/shifts/${id}`, { method: 'DELETE' }),
};

export const oncallKeys = {
  all: ['oncall'] as const,
  now: ['oncall', 'now'] as const,
  shifts: (from: string, to: string) => ['oncall', 'shifts', from, to] as const,
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
