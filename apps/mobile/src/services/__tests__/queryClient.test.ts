import { describe, expect, it } from '@jest/globals';

import { ApiError } from '@/api/client';
import { queryClient } from '@/services/queryClient';

type Retry = (failures: number, error: Error) => boolean;
const retry = queryClient.getDefaultOptions().queries?.retry as Retry;

describe('retrying failed reads', () => {
  it('retries what might succeed next time', () => {
    expect(retry(0, new ApiError(0, 'network_error', 'offline'))).toBe(true);
    expect(retry(1, new ApiError(503, 'unavailable', 'later'))).toBe(true);
  });

  it('gives up after two retries', () => {
    expect(retry(2, new ApiError(0, 'network_error', 'offline'))).toBe(false);
  });

  it('never repeats a request the API refused', () => {
    expect(retry(0, new ApiError(404, 'not_found', 'gone'))).toBe(false);
    expect(retry(0, new ApiError(401, 'unauthenticated', 'signed out'))).toBe(false);
  });
});
