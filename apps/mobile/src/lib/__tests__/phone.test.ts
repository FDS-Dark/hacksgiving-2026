import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Alert, Linking } from 'react-native';

import { IS_PRODUCTION, callPhone, isEmergencyNumber } from '@/lib/phone';

describe('callPhone outside production', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('is not production in tests (a dev build)', () => {
    expect(IS_PRODUCTION).toBe(false);
  });

  it('never dials 911; it explains instead', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    callPhone('911');
    callPhone('9-1-1');
    expect(open).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(2);
  });

  it('dials other numbers', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    callPhone('(414) 257-7222');
    expect(open).toHaveBeenCalledWith('tel:4142577222');
  });

  it('knows which numbers are emergencies', () => {
    expect(isEmergencyNumber('911')).toBe(true);
    expect(isEmergencyNumber('211')).toBe(false);
    expect(isEmergencyNumber('988')).toBe(false);
  });
});
