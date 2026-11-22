import { describe, expect, it } from '@jest/globals';

import { firstContact, requestStanding } from '@/lib/requestStatus';

describe('requestStanding', () => {
  it('says a new request waits for ComForce and how they will reach out', () => {
    expect(requestStanding({ status: 'new', contact_method: 'text' })).toEqual({
      owner: 'Waiting for ComForce',
      next: 'A worker will reach out by text.',
    });
    expect(requestStanding({ status: 'new', contact_method: 'call' }).next).toBe('A worker will call you.');
  });

  it('names the assigned worker by first name only', () => {
    const standing = requestStanding({ status: 'in_progress', worker_first_name: 'Dana' });
    expect(standing.owner).toBe('With Dana at ComForce');
    expect(standing.next).toMatch(/^Dana is working on it/);
    expect(requestStanding({ status: 'new', contact_method: 'text', worker_first_name: 'Dana' }).next).toBe(
      'Dana will reach out by text.',
    );
  });

  it('never promises a time', () => {
    for (const status of ['new', 'in_progress', 'awaiting_resources', 'resolved', 'closed'] as const) {
      const { owner, next } = requestStanding({ status, contact_method: 'call' });
      expect(`${owner} ${next}`).not.toMatch(/hour|minute|24\/7|today|tonight|soon/i);
    }
  });

  it('respects a request not to be contacted', () => {
    expect(firstContact('none')).toMatch(/not to contact you/);
    expect(firstContact(null)).toBe('A worker will read it and reply here.');
  });
});
