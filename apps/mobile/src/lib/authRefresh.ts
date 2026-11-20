import { TokenError } from 'expo-auth-session';

/** What a failed token refresh means for the session.
 *
 * `rejected`: Auth0 answered with an OAuth error (invalid_grant: revoked,
 * expired or rotated away), so the session is over. `unavailable`: no
 * answer (offline, a timeout, a dropped connection); the session is fine and
 * the next request tries again. Signing out on `unavailable` would sign
 * people out every time the network blips. */
export type RefreshFailure = 'rejected' | 'unavailable';

export function refreshFailure(error: unknown): RefreshFailure {
  return error instanceof TokenError ? 'rejected' : 'unavailable';
}
