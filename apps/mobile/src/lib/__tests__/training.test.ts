import { describe, expect, it } from '@jest/globals';

import { TRAINING_MODULES } from '@/lib/training';

// Jest runs on Node; the app's TypeScript config has no Node types, so declare the little this test uses.
declare const require: (id: string) => unknown;
declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
const { join } = require('path') as { join: (...parts: string[]) => string };

describe('training course', () => {
  it('has the same modules, and the same required ones, as the API saves progress for', () => {
    // api/routers/training.py: MODULES = {"orientation": True, ...}
    const source = readFileSync(join(__dirname, '../../../../../api/routers/training.py'), 'utf8');
    const start = source.indexOf('MODULES: dict[str, bool] = {');
    const block = source.slice(start, source.indexOf('}', start));
    const api = Object.fromEntries([...block.matchAll(/"([a-z0-9-]+)": (True|False)/g)].map((m) => [m[1], m[2] === 'True']));
    const app = Object.fromEntries(TRAINING_MODULES.map((m) => [m.id, m.required]));
    expect(app).toEqual(api);
  });
});
