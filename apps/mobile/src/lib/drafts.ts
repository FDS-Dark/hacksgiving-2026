/**
 * Drafts that survive an interruption (cognitive-load review S2: a worker
 * left New case or a typed debrief to read an alert and came back to an
 * empty form). The form autosaves as the worker types; coming back restores
 * it with "Draft restored · Discard". A successful save or a confirmed
 * discard clears it.
 *
 * Pure apart from the store, which is passed in (lib/draftStore.ts on the
 * phone, an in-memory map in tests).
 */

export interface DraftStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface Draft<T> {
  savedAt: string;
  value: T;
}

export type DraftKind = 'case' | 'debrief';

/** A week: older drafts are dropped rather than restored. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** One draft per worker and form; a debrief about a case has its own. */
export function draftKey(kind: DraftKind, workerId: string, caseId?: string | null) {
  return ['draft', kind, workerId, caseId || 'new'].join('.');
}

/** True when every text field is blank: nothing worth keeping. */
export function isBlankDraft(value: object) {
  return Object.values(value).every((v) => typeof v !== 'string' || v.trim() === '');
}

/** Whether a value is worth keeping. Forms with preset choices (a kind, a priority) pass their own. */
export type IsEmpty<T> = (value: T) => boolean;

export async function loadDraft<T extends object>(
  store: DraftStore,
  key: string,
  now = new Date(),
  isEmpty: IsEmpty<T> = isBlankDraft,
): Promise<Draft<T> | null> {
  try {
    const raw = await store.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft<T>;
    if (!parsed || typeof parsed.savedAt !== 'string' || typeof parsed.value !== 'object' || parsed.value === null) return null;
    if (now.getTime() - Date.parse(parsed.savedAt) > DRAFT_MAX_AGE_MS || isEmpty(parsed.value)) {
      await store.remove(key);
      return null;
    }
    return parsed;
  } catch {
    // A broken entry reads as no draft.
    return null;
  }
}

/**
 * Saves a form's value a moment after the last change, and right away on
 * `flush` (leaving the screen). `clear` drops it and cancels anything
 * pending, so a flush on the way out can't write back a draft that was
 * just saved for real or discarded.
 */
export class DraftKeeper<T extends object> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: T | null = null;

  constructor(
    private readonly store: DraftStore,
    private readonly key: string,
    private readonly delayMs = 400,
    private readonly now: () => Date = () => new Date(),
    private readonly isEmpty: IsEmpty<T> = isBlankDraft,
  ) {}

  change(value: T) {
    this.pending = value;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const value = this.pending;
    this.pending = null;
    if (!value) return;
    try {
      if (this.isEmpty(value)) await this.store.remove(this.key);
      else await this.store.set(this.key, JSON.stringify({ savedAt: this.now().toISOString(), value } satisfies Draft<T>));
    } catch {
      // Best effort: a full or locked store must never block the form.
    }
  }

  async clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    try {
      await this.store.remove(this.key);
    } catch {
      // Nothing to clear.
    }
  }
}

/** An in-memory store, for tests. */
export function memoryStore(initial: Record<string, string> = {}): DraftStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    get: async (key) => data[key] ?? null,
    set: async (key, value) => {
      data[key] = value;
    },
    remove: async (key) => {
      delete data[key];
    },
  };
}
