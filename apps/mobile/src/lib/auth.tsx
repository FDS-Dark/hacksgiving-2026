/**
 * Sign-in. Auth0 Universal Login through the system browser with OIDC + PKCE
 * (design §4.3): the app holds only a public client id, asks for an access
 * token for the Hacksgiving API audience, and keeps tokens in the Keychain via
 * SecureStore. Refresh tokens (offline_access) keep people signed in.
 *
 * Until the EXPO_PUBLIC_AUTH0_* values are set, a local dev token
 * (EXPO_PUBLIC_DEV_ACCESS_TOKEN) can stand in so the app stays usable.
 */
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ApiError, setAccessTokenProvider, setUnauthorizedHandler } from '@/api/client';
import { appScheme } from '@/lib/appScheme';
import { refreshFailure } from '@/lib/authRefresh';
import { debug } from '@/lib/debug';
import { queryClient } from '@/services/queryClient';
import { userApi } from '@/services/user';

WebBrowser.maybeCompleteAuthSession();

const AUTH0_DOMAIN = (process.env.EXPO_PUBLIC_AUTH0_DOMAIN ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const AUTH0_CLIENT_ID = process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID ?? '';
const AUTH0_AUDIENCE = process.env.EXPO_PUBLIC_AUTH0_AUDIENCE ?? '';
const DEV_TOKEN = process.env.EXPO_PUBLIC_DEV_ACCESS_TOKEN ?? '';

export const auth0Configured = Boolean(AUTH0_DOMAIN && AUTH0_CLIENT_ID && AUTH0_AUDIENCE);
export const devSignInAvailable = Boolean(DEV_TOKEN);

/** Register this in the Auth0 application's Allowed Callback URLs. In Expo
 * Go it's exp://<host>:8081/--/auth; in a build it's hacksgiving://auth (or
 * hacksgiving-staging://auth in the staging app). */
export const redirectUri = AuthSession.makeRedirectUri({ scheme: appScheme, path: 'auth' });

const SESSION_KEY = 'hacksgiving.session';
const ISSUER = `https://${AUTH0_DOMAIN}`;
// Refresh this long before expiry so a request never goes out with a token
// that dies in flight.
const REFRESH_MARGIN_SECONDS = 60;

interface Session {
  mode: 'auth0' | 'dev';
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** Epoch seconds; absent means "until the API says otherwise". */
  expiresAt?: number;
}

export interface Profile {
  sub: string;
  name: string | null;
  email: string | null;
  picture: string | null;
}

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: Status;
  profile: Profile | null;
  mode: Session['mode'] | null;
  busy: boolean;
  error: string | null;
  signIn: (opts?: { signUp?: boolean }) => Promise<void>;
  signInWithDevToken: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function decodeJwt(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
    const json = decodeURIComponent(
      Array.from(atob(padded), (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** A name fit to show other members. Auth0 makes a password user's `name`
 * their email, and Hacksgiving keeps no email addresses. */
function personName(...candidates: unknown[]): string | null {
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim() && !value.includes('@')) return value.trim();
  }
  return null;
}

function profileOf(session: Session): Profile | null {
  // The ID token is for showing who's signed in, never an API credential.
  const claims = decodeJwt(session.idToken) ?? decodeJwt(session.accessToken);
  if (!claims || typeof claims.sub !== 'string') return null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return { sub: claims.sub, name: personName(claims.name, claims.nickname), email: str(claims.email), picture: str(claims.picture) };
}

function expiryOf(session: Session): number | undefined {
  if (session.expiresAt) return session.expiresAt;
  const exp = decodeJwt(session.accessToken)?.exp;
  return typeof exp === 'number' ? exp : undefined;
}

const now = () => Math.floor(Date.now() / 1000);

async function loadSession(): Promise<Session | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

async function saveSession(session: Session | null) {
  if (session) await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  else await SecureStore.deleteItemAsync(SESSION_KEY);
}

let discoveryPromise: Promise<AuthSession.DiscoveryDocument> | null = null;
function discovery() {
  discoveryPromise ??= AuthSession.fetchDiscoveryAsync(ISSUER).catch((e) => {
    discoveryPromise = null;
    throw e;
  });
  return discoveryPromise;
}

function fromTokenResponse(response: AuthSession.TokenResponse, previous?: Session): Session {
  return {
    mode: 'auth0',
    accessToken: response.accessToken,
    // Auth0 rotates refresh tokens; keep the old one if none came back.
    refreshToken: response.refreshToken ?? previous?.refreshToken,
    idToken: response.idToken ?? previous?.idToken,
    expiresAt: response.expiresIn ? (response.issuedAt ?? now()) + response.expiresIn : undefined,
  };
}

/** See lib/authRefresh.ts for what `rejected` and `unavailable` mean. */
type Refresh = { kind: 'refreshed'; session: Session } | { kind: 'rejected' } | { kind: 'unavailable' };

// Auth0 not answering at launch must not hold the splash forever.
const REFRESH_TIMEOUT_MS = 15_000;

async function refresh(session: Session): Promise<Refresh> {
  if (session.mode !== 'auth0' || !session.refreshToken) {
    debug('auth · refresh: no refresh token, rejected');
    return { kind: 'rejected' };
  }
  const started = Date.now();
  debug('auth · refreshing the access token with Auth0');
  try {
    const response = await Promise.race([
      discovery().then((d) =>
        AuthSession.refreshAsync({ clientId: AUTH0_CLIENT_ID, refreshToken: session.refreshToken! }, d),
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new TypeError('Network request timed out')), REFRESH_TIMEOUT_MS),
      ),
    ]);
    debug('auth · refreshed', `${Date.now() - started}ms`);
    return { kind: 'refreshed', session: fromTokenResponse(response, session) };
  } catch (e) {
    const kind = refreshFailure(e);
    debug('auth · refresh failed:', kind, e instanceof Error ? e.message : String(e), `${Date.now() - started}ms`);
    return { kind };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const refreshing = useRef<Promise<Refresh> | null>(null);

  const adopt = useCallback(async (next: Session | null) => {
    sessionRef.current = next;
    setSession(next);
    await saveSession(next);
    // Nothing from the last account may show for the next one.
    if (!next) queryClient.clear();
    setStatus(next ? 'signedIn' : 'signedOut');
  }, []);

  const signOut = useCallback(async () => {
    const current = sessionRef.current;
    await adopt(null);
    // Best effort: revoke the refresh token so it can't be reused.
    const refreshToken = current?.mode === 'auth0' ? current.refreshToken : undefined;
    if (refreshToken) {
      discovery()
        .then((d) =>
          AuthSession.revokeAsync(
            { clientId: AUTH0_CLIENT_ID, token: refreshToken, tokenTypeHint: AuthSession.TokenTypeHint.RefreshToken },
            { revocationEndpoint: d.revocationEndpoint ?? `${ISSUER}/oauth/revoke` },
          ),
        )
        .catch(() => {});
    }
  }, [adopt]);

  // A valid access token for the API, refreshing it first when it's about
  // to expire. Concurrent callers share one refresh. Only Auth0 refusing the
  // refresh token ends the session; when Auth0 can't be reached the current
  // token is used while it lasts, then the request fails as a network error.
  const accessToken = useCallback(async (): Promise<string | null> => {
    const current = sessionRef.current;
    if (!current) return null;
    const exp = expiryOf(current);
    if (exp === undefined || exp - REFRESH_MARGIN_SECONDS > now()) return current.accessToken;
    if (current.mode === 'dev') {
      await signOut();
      return null;
    }
    refreshing.current ??= refresh(current).finally(() => {
      refreshing.current = null;
    });
    const result = await refreshing.current;
    if (result.kind === 'refreshed') {
      await adopt(result.session);
      return result.session.accessToken;
    }
    if (result.kind === 'rejected') {
      await signOut();
      return null;
    }
    if (exp > now()) return current.accessToken;
    throw new ApiError(0, 'network_error', 'Can’t reach sign-in right now. Check your connection and try again.');
  }, [adopt, signOut]);

  useEffect(() => {
    setAccessTokenProvider(accessToken);
    setUnauthorizedHandler(() => {
      signOut();
    });
  }, [accessToken, signOut]);

  // Restore the last session on launch.
  useEffect(() => {
    (async () => {
      debug('auth · restoring the saved session');
      const saved = await loadSession();
      const exp = saved ? expiryOf(saved) : undefined;
      debug('auth · saved session:', saved
        ? {
            mode: saved.mode,
            expiresIn: exp === undefined ? 'unknown' : `${exp - now()}s`,
            hasRefreshToken: saved.mode === 'auth0' && Boolean(saved.refreshToken),
            hasIdToken: saved.mode === 'auth0' && Boolean(saved.idToken),
          }
        : 'none');
      if (!saved || (saved.mode === 'auth0' && !auth0Configured) || (saved.mode === 'dev' && saved.accessToken !== DEV_TOKEN)) {
        await adopt(null);
        debug('auth · signed out');
        return;
      }
      sessionRef.current = saved;
      // Offline at launch: keep the saved session; requests retry later.
      const token = await accessToken().catch(() => saved.accessToken);
      if (token && sessionRef.current) await adopt(sessionRef.current);
      debug('auth · restore done:', token && sessionRef.current ? 'signed in' : 'signed out');
    })().catch((e) => {
      debug('auth · restore crashed:', e instanceof Error ? e.message : String(e));
      adopt(null).catch(() => {});
    });
  }, [accessToken, adopt]);

  // Access tokens carry no profile, so tell the API who this is.
  const syncProfile = useCallback(async (next: Session) => {
    const profile = profileOf(next);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      await userApi.updateMe({ ...(profile?.name ? { display_name: profile.name } : {}), ...(timezone ? { timezone } : {}) });
    } catch {
      // Not fatal: the name is cosmetic and the next sign-in retries.
    }
  }, []);

  const signIn = useCallback(
    async ({ signUp = false }: { signUp?: boolean } = {}) => {
      if (!auth0Configured) {
        setError('Auth0 isn’t configured yet. Set EXPO_PUBLIC_AUTH0_* in .env.local.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const doc = await discovery();
        const request = new AuthSession.AuthRequest({
          clientId: AUTH0_CLIENT_ID,
          redirectUri,
          scopes: ['openid', 'profile', 'email', 'offline_access'],
          usePKCE: true,
          extraParams: { audience: AUTH0_AUDIENCE, ...(signUp ? { screen_hint: 'signup' } : {}) },
        });
        // Ephemeral: no shared Safari cookies, so signing out here really
        // signs out, and the next person can use their own account.
        const result = await request.promptAsync(doc, { preferEphemeralSession: true });
        if (result.type !== 'success') {
          if (result.type === 'error') setError(result.params.error_description ?? result.error?.message ?? 'Sign-in failed');
          return;
        }
        const tokens = await AuthSession.exchangeCodeAsync(
          {
            clientId: AUTH0_CLIENT_ID,
            code: result.params.code,
            redirectUri,
            extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : undefined,
          },
          doc,
        );
        const next = fromTokenResponse(tokens);
        await adopt(next);
        await syncProfile(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [adopt, syncProfile],
  );

  const signInWithDevToken = useCallback(async () => {
    if (!DEV_TOKEN) return;
    setError(null);
    const exp = decodeJwt(DEV_TOKEN)?.exp;
    if (typeof exp === 'number' && exp <= now()) {
      setError('The dev token has expired. Run api/scripts/dev_token.py and update .env.local.');
      return;
    }
    const next: Session = { mode: 'dev', accessToken: DEV_TOKEN };
    await adopt(next);
    await syncProfile(next);
  }, [adopt, syncProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      profile: session ? profileOf(session) : null,
      mode: session?.mode ?? null,
      busy,
      error,
      signIn,
      signInWithDevToken,
      signOut,
    }),
    [status, session, busy, error, signIn, signInWithDevToken, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
