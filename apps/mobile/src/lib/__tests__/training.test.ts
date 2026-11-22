import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { TRAINING_MODULES } from '@/lib/training';

describe('training course', () => {
  it('has the same modules, and the same required ones, as the API saves progress for', () => {
    // api/routers/training.py: MODULES = {"orientation": True, ...}
    const source = readFileSync(join(__dirname, '../../../../../api/routers/training.py'), 'utf8');
    const block = source.slice(source.indexOf('MODULES: dict[str, bool] = {'), source.indexOf('}', source.indexOf('MODULES: dict')));
    const api = Object.fromEntries([...block.matchAll(/"([a-z0-9-]+)": (True|False)/g)].map((m) => [m[1], m[2] === 'True']));
    const app = Object.fromEntries(TRAINING_MODULES.map((m) => [m.id, m.required]));
    expect(app).toEqual(api);
  });
});
