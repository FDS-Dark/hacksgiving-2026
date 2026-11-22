import { describe, expect, it } from '@jest/globals';
import { expoGoRedirectUri } from '../redirect';

describe('expoGoRedirectUri', () => {
  it('builds the exp:// callback from Metro host in Expo Go', () => {
    expect(expoGoRedirectUri(true, '100.102.172.1:8081')).toBe('exp://100.102.172.1:8081/--/auth');
  });

  it('tolerates a scheme or trailing slash on the host', () => {
    expect(expoGoRedirectUri(true, 'exp://100.102.172.1:8081/')).toBe('exp://100.102.172.1:8081/--/auth');
  });

  it('returns null outside Expo Go so builds keep hacksgiving://auth', () => {
    expect(expoGoRedirectUri(false, '100.102.172.1:8081')).toBeNull();
  });

  it('returns null without a host', () => {
    expect(expoGoRedirectUri(true, undefined)).toBeNull();
  });
});
