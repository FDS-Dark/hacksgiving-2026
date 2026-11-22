import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ApiError } from '@/api/client';
import type { SubmitRequest } from '@/api/types';
import { isOffline, loadPending, queueRequest, removePending } from '@/lib/pendingRequests';

// jest.mock is hoisted above the imports; the store lives in this Map.
const mockMemory = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockMemory.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void mockMemory.set(key, value),
}));

const body = (description: string): SubmitRequest => ({ description, contact_method: 'none' }) as SubmitRequest;

describe('pending requests', () => {
  beforeEach(() => mockMemory.clear());

  it('queues only when the API could not be reached', () => {
    expect(isOffline(new ApiError(0, 'network_error', 'offline'))).toBe(true);
    expect(isOffline(new ApiError(422, 'invalid', 'bad'))).toBe(false);
    expect(isOffline(new ApiError(503, 'unavailable', 'later'))).toBe(false);
    expect(isOffline(new Error('boom'))).toBe(false);
  });

  it('keeps them in the order they were written, and removes one', async () => {
    await queueRequest(body('first'), new Date('2026-11-21T10:00:00Z'));
    const [, second] = await queueRequest(body('second'), new Date('2026-11-21T10:01:00Z'));
    expect((await loadPending()).map((p) => p.body.description)).toEqual(['first', 'second']);
    expect((await removePending(second.localId)).map((p) => p.body.description)).toEqual(['first']);
  });

  it('keeps at most five, dropping the oldest', async () => {
    for (let i = 0; i < 7; i++) await queueRequest(body(`r${i}`));
    expect((await loadPending()).map((p) => p.body.description)).toEqual(['r2', 'r3', 'r4', 'r5', 'r6']);
  });

  it('reads a broken store as nothing queued', async () => {
    mockMemory.set('hacksgiving.pendingRequests', '{not json');
    expect(await loadPending()).toEqual([]);
  });
});
