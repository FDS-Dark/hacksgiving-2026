import { describe, expect, it } from '@jest/globals';
import { TokenError } from 'expo-auth-session';

import { refreshFailure } from '@/lib/authRefresh';

describe('a failed token refresh', () => {
  it('ends the session when Auth0 refuses the refresh token', () => {
    expect(refreshFailure(new TokenError({ error: 'invalid_grant' }))).toBe('rejected');
  });

  it('keeps the session when Auth0 could not be reached', () => {
    expect(refreshFailure(new TypeError('Network request failed'))).toBe('unavailable');
    expect(refreshFailure(new Error('The request timed out'))).toBe('unavailable');
  });
});
