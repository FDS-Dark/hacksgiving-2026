/**
 * A resident's requests for help. Signed in, they belong to the account
 * (/requests). Signed out, a request comes back with an access code
 * (/public/requests); this device remembers it (lib/savedRequests.ts), and
 * the number plus the code opens it anywhere.
 */
import { type QueryClient, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { request } from '@/api/client';
import type {
  AnonymousRequestReceipt,
  PublicRequest,
  PublicRequestDetail,
  PublicRequestUpdate,
  SubmitRequest,
} from '@/api/types';
import { useAuth } from '@/lib/auth';
import { isOffline, loadPending, queueRequest, removePending } from '@/lib/pendingRequests';
import { forgetRequest, loadSavedRequests, saveRequest, type SavedRequest } from '@/lib/savedRequests';

const codeHeader = (code: string) => ({ 'X-Access-Code': code });

export const requestsApi = {
  submit: (body: SubmitRequest) => request<PublicRequest>('/requests', { method: 'POST', body }),
  mine: () => request<PublicRequest[]>('/requests'),
  get: (id: string) => request<PublicRequestDetail>(`/requests/${id}`),
  reply: (id: string, content: string) =>
    request<PublicRequestUpdate>(`/requests/${id}/replies`, { method: 'POST', body: { content } }),

  submitAnonymous: (body: SubmitRequest) =>
    request<AnonymousRequestReceipt>('/public/requests', { method: 'POST', body, auth: false }),
  getByCode: (number: number, code: string) =>
    request<PublicRequestDetail>(`/public/requests/${number}`, { auth: false, headers: codeHeader(code) }),
  replyByCode: (number: number, code: string, content: string) =>
    request<PublicRequestUpdate>(`/public/requests/${number}/replies`, {
      method: 'POST',
      body: { content },
      auth: false,
      headers: codeHeader(code),
    }),
};

export const requestKeys = {
  all: ['requests'] as const,
  mine: ['requests', 'mine'] as const,
  saved: ['requests', 'saved'] as const,
  pending: ['requests', 'pending'] as const,
  detail: (id: string) => ['requests', 'detail', id] as const,
};

/** Staff can reply at any time; check every 30 s while a request is open on screen. */
const POLL_MS = 30_000;

function useSignedIn() {
  return useAuth().status === 'signedIn';
}

export function useSavedRequests() {
  return useQuery({ queryKey: requestKeys.saved, queryFn: loadSavedRequests, staleTime: Infinity });
}

/** What the request screen needs to load one request, whichever way it was sent. */
function detailFetcher(id: string, saved: SavedRequest | undefined) {
  return saved ? () => requestsApi.getByCode(saved.number, saved.code) : () => requestsApi.get(id);
}

type Sent = { request: PublicRequest; code: string | null };

/** One send. Signed in, the request joins the account; otherwise it comes
 *  back with an access code that this device keeps. */
async function sendNow(qc: QueryClient, signedIn: boolean, body: SubmitRequest): Promise<Sent> {
  if (signedIn) return { request: await requestsApi.submit(body), code: null };
  const { request: sent, access_code: code } = await requestsApi.submitAnonymous(body);
  const saved = await saveRequest({ id: sent.id, number: sent.number, code, title: sent.title, savedAt: new Date().toISOString() });
  qc.setQueryData(requestKeys.saved, saved);
  return { request: sent, code };
}

/** Send the form. With no connection it is kept on the phone and sent later
 *  (`usePendingRequests`), and the result is `{ queued: true }`. */
export function useSendRequest() {
  const qc = useQueryClient();
  const signedIn = useSignedIn();
  return useMutation({
    mutationFn: async (body: SubmitRequest): Promise<Sent | { queued: true }> => {
      try {
        return await sendNow(qc, signedIn, body);
      } catch (e) {
        if (!isOffline(e)) throw e;
        qc.setQueryData(requestKeys.pending, await queueRequest(body));
        return { queued: true };
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: requestKeys.all }),
  });
}

/** Retry queued requests every 30 s while any are waiting. */
const PENDING_RETRY_MS = 30_000;

/**
 * Requests waiting to be sent, and the sender that empties the queue: on
 * launch, whenever the app comes back to the foreground, and every 30 s
 * while something is waiting. Mounted once, in the root layout.
 */
export function usePendingRequests() {
  return useQuery({ queryKey: requestKeys.pending, queryFn: loadPending, staleTime: Infinity });
}

export function useSendPendingRequests() {
  const qc = useQueryClient();
  const signedIn = useSignedIn();
  const pending = usePendingRequests();
  const waiting = (pending.data?.length ?? 0) > 0;
  const busy = useRef(false);

  const flush = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (const entry of await loadPending()) {
        try {
          await sendNow(qc, signedIn, entry.body);
        } catch (e) {
          // Still offline: try again later. Refused for good: drop it, or it
          // would block every request behind it forever.
          if (isOffline(e)) break;
        }
        qc.setQueryData(requestKeys.pending, await removePending(entry.localId));
        qc.invalidateQueries({ queryKey: requestKeys.all });
      }
    } finally {
      busy.current = false;
    }
  }, [qc, signedIn]);

  useEffect(() => {
    if (!waiting) return;
    flush();
    const timer = setInterval(flush, PENDING_RETRY_MS);
    const sub = AppState.addEventListener('change', (state) => state === 'active' && flush());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [waiting, flush]);
}

/** One request with its public updates. */
export function useResidentRequest(id: string) {
  const saved = useSavedRequests();
  const signedIn = useSignedIn();
  const entry = saved.data?.find((r) => r.id === id);
  const query = useQuery({
    queryKey: requestKeys.detail(id),
    queryFn: detailFetcher(id, entry),
    enabled: saved.isFetched && (!!entry || signedIn),
    refetchInterval: POLL_MS,
  });
  return { ...query, saved: entry, needsCode: saved.isFetched && !entry && !signedIn };
}

export function useReply(id: string) {
  const qc = useQueryClient();
  const saved = useSavedRequests();
  return useMutation({
    mutationFn: (content: string) => {
      const entry = saved.data?.find((r) => r.id === id);
      return entry ? requestsApi.replyByCode(entry.number, entry.code, content) : requestsApi.reply(id, content);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: requestKeys.detail(id) }),
  });
}

/** Open a request by its number and code (sent from another device, or
 *  this one forgot it), and remember it here. */
export function useFindRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ number, code }: { number: number; code: string }) => {
      const detail = await requestsApi.getByCode(number, code);
      const { id, title } = detail.request;
      qc.setQueryData(requestKeys.saved, await saveRequest({ id, number, code, title, savedAt: new Date().toISOString() }));
      qc.setQueryData(requestKeys.detail(id), detail);
      return detail.request;
    },
  });
}

export function useForgetRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: forgetRequest,
    onSuccess: (saved, id) => {
      qc.setQueryData(requestKeys.saved, saved);
      qc.removeQueries({ queryKey: requestKeys.detail(id) });
    },
  });
}

/** Every request this person can see here: the account's, then the ones
 *  saved on this device, newest first. */
export function useResidentRequests() {
  const signedIn = useSignedIn();
  const mine = useQuery({ queryKey: requestKeys.mine, queryFn: requestsApi.mine, enabled: signedIn, refetchInterval: POLL_MS });
  const saved = useSavedRequests();
  const anonymous = useQueries({
    queries: (saved.data ?? []).map((entry) => ({
      queryKey: requestKeys.detail(entry.id),
      queryFn: detailFetcher(entry.id, entry),
      refetchInterval: POLL_MS,
    })),
  });

  const byId = new Map<string, PublicRequest>();
  for (const r of mine.data ?? []) byId.set(r.id, r);
  anonymous.forEach((q) => {
    if (q.data) byId.set(q.data.request.id, q.data.request);
  });
  const requests = [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return {
    requests,
    /** Saved requests the API wouldn't open (e.g. the database was reset). */
    unavailable: (saved.data ?? []).filter((_, i) => anonymous[i]?.isError),
    isPending: (signedIn && mine.isPending) || saved.isPending,
    error: mine.error,
    refetch: () => {
      mine.refetch();
      anonymous.forEach((q) => q.refetch());
    },
    isRefetching: mine.isRefetching || anonymous.some((q) => q.isRefetching),
  };
}
