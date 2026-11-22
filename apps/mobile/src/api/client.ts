/**
 * The one place the app talks HTTP to the Hacksgiving API. Services in
 * src/services call `request`; screens never do.
 *
 * Response bodies are typed by the generated OpenAPI schema (schema.ts).
 * CI regenerates that schema from the API, so a cast here is a cast to the
 * API's own contract.
 */
import { debug } from '@/lib/debug';

export const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000/v1').replace(/\/$/, '');
debug('API base URL', BASE_URL);

// A request that gets no answer fails instead of hanging.
const TIMEOUT_MS = { read: 20_000, write: 60_000 };

/** A failed request, carrying the API's structured error body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function toApiError(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError(0, 'unknown', errorMessage(e));
}

// ── Session plumbing, set by AuthProvider ──────────────────────────────────

type TokenProvider = () => Promise<string | null>;

let getAccessToken: TokenProvider = async () => null;
let onUnauthorized: () => void = () => {};

export function setAccessTokenProvider(provider: TokenProvider) {
  getAccessToken = provider;
}

/** Called when the API rejects the token: the session is over. */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

// ── Requests ───────────────────────────────────────────────────────────────

/** `?a=1&b=x` from the set values (skips undefined, null, '' and false); '' when none are set. */
export function queryString(params: Record<string, string | number | boolean | null | undefined>) {
  const pairs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false);
  return pairs.length ? `?${pairs.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}` : '';
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-encoded unless it is FormData. */
  body?: unknown;
  /** false for calls that need no sign-in (health, asking for help without an account). */
  auth?: boolean;
  /** Extra headers, e.g. X-Access-Code. */
  headers?: Record<string, string>;
}

interface ErrorBody {
  code?: string;
  message?: string;
  request_id?: string;
}

export async function request<T>(path: string, { method = 'GET', body, auth = true, headers: extra }: RequestOptions = {}) {
  const headers: Record<string, string> = { ...extra, Accept: 'application/json' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body; // FormData sets its own multipart Content-Type with the boundary.
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const label = `${method} ${path}`;
  if (auth) {
    debug(label, '· getting access token');
    const token = await getAccessToken();
    if (!token) throw new ApiError(401, 'not_signed_in', 'Not signed in');
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  const started = Date.now();
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), method === 'GET' ? TIMEOUT_MS.read : TIMEOUT_MS.write);
  debug(label, '→', `${BASE_URL}${path}`);
  try {
    response = await fetch(`${BASE_URL}${path}`, { method, headers, body: payload, signal: abort.signal });
  } catch (e) {
    const timedOut = abort.signal.aborted;
    debug(label, '✗', timedOut ? 'timed out' : errorMessage(e), `${Date.now() - started}ms`);
    // Not always the network: expo/fetch also throws here for a body it
    // can't encode, so keep the cause visible.
    throw new ApiError(
      0,
      'network_error',
      `Can't reach the Hacksgiving API at ${BASE_URL} (${timedOut ? 'no answer' : errorMessage(e)})`,
    );
  } finally {
    clearTimeout(timeout);
  }
  debug(label, '←', response.status, `${Date.now() - started}ms`);

  if (response.status === 204) return undefined as T;
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && auth) onUnauthorized();
    const error = (json ?? {}) as ErrorBody;
    throw new ApiError(
      response.status,
      error.code ?? 'http_error',
      error.message ?? `Request failed (${response.status})`,
      error.request_id,
    );
  }
  return json as T;
}
