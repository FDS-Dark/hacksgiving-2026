import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { DRAFT_MAX_AGE_MS, DraftKeeper, draftKey, isBlankDraft, loadDraft, memoryStore } from '@/lib/drafts';

const NOW = new Date('2026-11-22T15:00:00Z');
const KEY = draftKey('case', 'worker-1');

describe('draftKey', () => {
  it('keeps one draft per worker, form and case', () => {
    expect(draftKey('case', 'w1')).toBe('draft.case.w1.new');
    expect(draftKey('debrief', 'w1', 'case-9')).toBe('draft.debrief.w1.case-9');
    expect(draftKey('debrief', 'w1', null)).not.toBe(draftKey('debrief', 'w2', null));
  });
});

describe('isBlankDraft', () => {
  it('ignores whitespace and non-text fields', () => {
    expect(isBlankDraft({ description: '  ', kind: 'request' })).toBe(false);
    expect(isBlankDraft({ description: '  ', location: '' })).toBe(true);
    expect(isBlankDraft({ description: 'Needs a ride' })).toBe(false);
  });
});

describe('DraftKeeper', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('autosaves after typing stops, and restores it later', async () => {
    const store = memoryStore();
    const keeper = new DraftKeeper<{ description: string }>(store, KEY, 400, () => NOW);
    keeper.change({ description: 'Ride to' });
    keeper.change({ description: 'Ride to court at 9' });
    expect(store.data[KEY]).toBeUndefined();

    await jest.advanceTimersByTimeAsync(400);

    const restored = await loadDraft<{ description: string }>(store, KEY, NOW);
    expect(restored).toEqual({ savedAt: NOW.toISOString(), value: { description: 'Ride to court at 9' } });
  });

  it('saves right away when the screen is left', async () => {
    const store = memoryStore();
    const keeper = new DraftKeeper<{ text: string }>(store, KEY, 400, () => NOW);
    keeper.change({ text: 'Met someone at 6th and National' });
    await keeper.flush();
    expect(JSON.parse(store.data[KEY]).value.text).toBe('Met someone at 6th and National');
  });

  it('clears after a save, and a later flush does not write it back', async () => {
    const store = memoryStore();
    const keeper = new DraftKeeper<{ text: string }>(store, KEY, 400, () => NOW);
    keeper.change({ text: 'Saved for real' });
    await keeper.flush();
    keeper.change({ text: 'Saved for real' });
    await keeper.clear();
    await keeper.flush();
    await jest.advanceTimersByTimeAsync(1000);
    expect(store.data[KEY]).toBeUndefined();
  });

  it('treats a form with only its preset choices as empty when told so', async () => {
    const store = memoryStore();
    const isEmpty = (v: { description: string; kind: string }) => !v.description.trim();
    const keeper = new DraftKeeper(store, KEY, 400, () => NOW, isEmpty);
    keeper.change({ description: '', kind: 'request' });
    await keeper.flush();
    expect(store.data[KEY]).toBeUndefined();
    keeper.change({ description: 'Walk-in, needs food', kind: 'request' });
    await keeper.flush();
    expect(await loadDraft(store, KEY, NOW, isEmpty)).not.toBeNull();
  });

  it('removes the draft when the form is emptied', async () => {
    const store = memoryStore();
    const keeper = new DraftKeeper<{ text: string }>(store, KEY, 400, () => NOW);
    keeper.change({ text: 'Something' });
    await keeper.flush();
    keeper.change({ text: '' });
    await keeper.flush();
    expect(store.data[KEY]).toBeUndefined();
  });
});

describe('loadDraft', () => {
  it('drops old, blank and broken drafts', async () => {
    const old = new Date(NOW.getTime() - DRAFT_MAX_AGE_MS - 1000).toISOString();
    const store = memoryStore({
      a: JSON.stringify({ savedAt: old, value: { text: 'Old' } }),
      b: JSON.stringify({ savedAt: NOW.toISOString(), value: { text: ' ' } }),
      c: '{not json',
    });
    expect(await loadDraft(store, 'a', NOW)).toBeNull();
    expect(await loadDraft(store, 'b', NOW)).toBeNull();
    expect(await loadDraft(store, 'c', NOW)).toBeNull();
    expect(await loadDraft(store, 'missing', NOW)).toBeNull();
    expect(store.data.a).toBeUndefined();
  });
});
