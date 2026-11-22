import { describe, expect, it } from '@jest/globals';

import { ApiError } from '@/api/client';
import { FALLBACK_MESSAGE, technicalDetails, userMessage } from '@/lib/errors';

const UUID = '3f2b8c1e-9d4a-4e6b-8f1a-2c3d4e5f6a7b';

describe('userMessage', () => {
  it('never shows a validation failure or its request id', () => {
    const e = new ApiError(422, 'validation_error', 'Request validation failed', UUID);
    expect(userMessage(e, 'resident')).toBe(FALLBACK_MESSAGE.resident);
    expect(userMessage(e, 'resident')).toBe('We couldn’t load this page. Try again. If it keeps happening, contact ComForce.');
  });

  it('turns a network failure into a connection hint without the address', () => {
    const e = new ApiError(0, 'network_error', "Can't reach the server (no answer)");
    expect(userMessage(e, 'resident')).toMatch(/couldn’t reach ComForce/);
    expect(userMessage(e, 'staff')).toMatch(/couldn’t reach the server/);
    expect(userMessage(e)).not.toMatch(/http|Hacksgiving/i);
  });

  it('uses the fallback for server errors and generic not-found', () => {
    expect(userMessage(new ApiError(500, 'internal_error', 'Something went wrong'))).toBe(FALLBACK_MESSAGE.resident);
    expect(userMessage(new ApiError(404, 'partner_not_found', 'Partner not found'), 'staff')).toBe(FALLBACK_MESSAGE.staff);
  });

  it('explains an expired phone-call code', () => {
    const e = new ApiError(404, 'handoff_not_found', 'That call code is invalid, expired, or already claimed');
    expect(userMessage(e)).toMatch(/phone-call code/);
    expect(userMessage(e)).toMatch(/new one/);
  });

  it('keeps a domain message written for people', () => {
    const e = new ApiError(409, 'shift_overlap', 'That person already has a shift at that time.');
    expect(userMessage(e, 'staff')).toBe('That person already has a shift at that time.');
    const down = new ApiError(503, 'voice_unavailable', "Voice debriefs aren't set up on this server; type it instead");
    expect(userMessage(down, 'staff')).toBe("Voice debriefs aren't set up on this server; type it instead");
  });

  it('hides a domain message that leaks a UUID or address', () => {
    expect(userMessage(new ApiError(409, 'odd', `Case ${UUID} is locked`))).toBe(FALLBACK_MESSAGE.resident);
    expect(userMessage(new ApiError(409, 'odd', 'See https://example.org'))).toBe(FALLBACK_MESSAGE.resident);
  });

  it('keeps an app-written sentence but not a JavaScript error', () => {
    expect(userMessage(new Error('Files can be up to 10 MB.'))).toBe('Files can be up to 10 MB.');
    expect(userMessage(new TypeError("undefined is not an object (evaluating 'a.b')"))).toBe(FALLBACK_MESSAGE.resident);
    expect(userMessage('boom')).toBe(FALLBACK_MESSAGE.resident);
  });

  it('asks to sign in again when the session is gone', () => {
    expect(userMessage(new ApiError(401, 'not_signed_in', 'Not signed in'))).toBe('Please sign in again.');
  });
});

describe('technicalDetails', () => {
  it('keeps the request id and server text for whoever fixes it', () => {
    const lines = technicalDetails(new ApiError(422, 'validation_error', 'Request validation failed', UUID));
    expect(lines).toContain(`Request ID: ${UUID}`);
    expect(lines).toContain('Message: Request validation failed');
  });

  it('names the server address only for network failures', () => {
    expect(technicalDetails(new ApiError(0, 'network_error', 'x')).some((l) => l.startsWith('Server: '))).toBe(true);
    expect(technicalDetails(new ApiError(500, 'internal_error', 'x')).some((l) => l.startsWith('Server: '))).toBe(false);
  });
});
