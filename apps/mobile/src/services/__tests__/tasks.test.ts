import { describe, expect, it } from '@jest/globals';

import { tasksPath } from '@/services/tasks';

describe('tasksPath', () => {
  it('sends open_only=false so the Done tab sees finished tasks', () => {
    expect(tasksPath({ open_only: false })).toBe('/tasks?open_only=false');
  });

  it('leaves open_only out when it is not set', () => {
    expect(tasksPath({})).toBe('/tasks');
  });

  it('keeps open_only=true', () => {
    expect(tasksPath({ open_only: true })).toBe('/tasks?open_only=true');
  });
});
