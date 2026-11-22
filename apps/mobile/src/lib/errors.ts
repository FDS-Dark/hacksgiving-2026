/**
 * Failures in plain words. Screens show `userMessage()` as the main line of
 * an error; the request id, the URL and the server's own text sit behind
 * "Technical details" (ErrorBanner in components/ui.tsx). Nobody should
 * read "Request validation failed", a UUID or our API's address as the
 * reason a task didn't work.
 */
import { BASE_URL, toApiError, type ApiError } from '@/api/client';

/** Who reads the message: residents get ComForce's name, staff get "an admin". */
export type Audience = 'resident' | 'staff';

export const FALLBACK_MESSAGE: Record<Audience, string> = {
  resident: 'We couldn’t load this page. Try again. If it keeps happening, contact ComForce.',
  staff: 'We couldn’t load this page. Try again. If it keeps happening, tell an admin.',
};

const OFFLINE: Record<Audience, string> = {
  resident: 'We couldn’t reach ComForce. Check your internet connection and try again.',
  staff: 'We couldn’t reach the server. Check your internet connection and try again.',
};

/** Codes whose server text is plumbing, not something a person can act on. */
const GENERIC_CODES = new Set([
  'validation_error',
  'internal_error',
  'http_error',
  'unknown',
  'not_found',
  'method_not_allowed',
  'unauthenticated',
  'forbidden',
]);

/** Plain lines for codes the app knows by name. */
const KNOWN: Record<string, string | Record<Audience, string>> = {
  not_signed_in: 'Please sign in again.',
  unauthenticated: 'Please sign in again.',
  forbidden: { resident: 'You can’t open this. If you think that’s wrong, contact ComForce.', staff: 'Your role can’t open this. Ask an admin if you need it.' },
  handoff_not_found: 'That phone-call code didn’t work. A code works once, for 15 minutes. Call again and ask for a new one.',
  voice_handoff_unavailable: 'Linking phone calls isn’t working right now. Try again later.',
  request_not_found: 'We couldn’t find that request. Check the number and code, then try again.',
  referral_not_found: 'We couldn’t find this place. It may have been removed.',
  call_not_found: 'We couldn’t find this call.',
};

/** Server text a person should never see as the reason. */
const TECHNICAL = [
  /hacksgiving/i,
  /https?:\/\//i,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /validation failed/i,
  /\b(undefined|null|NaN|TypeError|SyntaxError|JSON)\b/,
  /`/,
];

function looksTechnical(text: string) {
  return !text.trim() || TECHNICAL.some((pattern) => pattern.test(text));
}

/** A sentence someone wrote for people: capitalized, punctuated or short. */
function readsAsSentence(text: string) {
  return /^[A-Z“"']/.test(text) && /[.!?”]$/.test(text.trim());
}

function pick(value: string | Record<Audience, string>, audience: Audience) {
  return typeof value === 'string' ? value : value[audience];
}

/**
 * What went wrong, as one plain line for `audience`. Domain errors from the
 * API (a shift overlap, consent required) keep their message: it was
 * written for people. Generic and technical failures get the fallback.
 */
export function userMessage(error: unknown, audience: Audience = 'resident'): string {
  const e = toApiError(error);
  const known = KNOWN[e.code];
  if (known) return pick(known, audience);
  if (e.code === 'network_error' || (e.status === 0 && e.code !== 'unknown')) return OFFLINE[audience];
  if (e.status >= 500) return FALLBACK_MESSAGE[audience];
  if (GENERIC_CODES.has(e.code) || e.code.endsWith('_not_found')) {
    // Thrown by the app itself with a sentence for people ("Files can be up to 10 MB.").
    if (e.code === 'unknown' && readsAsSentence(e.message) && !looksTechnical(e.message)) return e.message;
    return FALLBACK_MESSAGE[audience];
  }
  return looksTechnical(e.message) ? FALLBACK_MESSAGE[audience] : e.message;
}

/** The lines behind "Technical details": enough for whoever fixes it. */
export function technicalDetails(error: unknown): string[] {
  const e: ApiError = toApiError(error);
  return [
    e.status ? `Status ${e.status} · ${e.code}` : `Code ${e.code}`,
    e.message ? `Message: ${e.message}` : null,
    e.requestId ? `Request ID: ${e.requestId}` : null,
    e.code === 'network_error' ? `Server: ${BASE_URL}` : null,
  ].filter((line): line is string => line !== null);
}
