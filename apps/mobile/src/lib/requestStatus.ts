/**
 * Where a resident's request stands, in words: who it is waiting on and
 * what happens next. Used by the request list, the request screen, Home
 * and the receipt, so they never disagree. Only a worker's first name
 * ever reaches a resident. No time is promised: the API has no estimate
 * to give, so "next" says what will happen, not when.
 */
import type { CaseStatus, ContactMethod, PublicRequest } from '@/api/types';

export interface RequestStanding {
  /** "Waiting for ComForce", "With Dana". */
  owner: string;
  /** "A worker will reach out by text." */
  next: string;
}

/** What a worker does first, by how the resident asked to be reached. */
export function firstContact(method: ContactMethod | null | undefined): string {
  switch (method) {
    case 'text':
      return 'A worker will reach out by text.';
    case 'call':
      return 'A worker will call you.';
    case 'none':
      return 'You asked us not to contact you. A worker will reply here.';
    default:
      return 'A worker will read it and reply here.';
  }
}

export function requestStanding(
  request: Pick<PublicRequest, 'status'> & Partial<Pick<PublicRequest, 'contact_method' | 'worker_first_name'>>,
): RequestStanding {
  const name = request.worker_first_name?.trim() || null;
  const status: CaseStatus = request.status;
  switch (status) {
    case 'new':
      return name
        ? { owner: `With ${name} at ComForce`, next: firstContact(request.contact_method).replace('A worker', name) }
        : { owner: 'Waiting for ComForce', next: firstContact(request.contact_method) };
    case 'in_progress':
      return {
        owner: name ? `With ${name} at ComForce` : 'With a ComForce worker',
        next: `${name ?? 'A worker'} is working on it. New messages show up here.`,
      };
    case 'awaiting_resources':
      return {
        owner: 'Waiting for a partner',
        next: `${name ?? 'ComForce'} asked a partner group for help. You’ll see news here.`,
      };
    case 'resolved':
      return { owner: 'Done', next: 'ComForce marked this as done. Need more help? Ask again anytime.' };
    case 'closed':
      return { owner: 'Closed', next: 'This request is closed. Need more help? Ask again anytime.' };
  }
}
