import { useEffect, useMemo, useRef, useState } from 'react';

import { deviceDraftStore } from '@/lib/draftStore';
import { DraftKeeper, isBlankDraft, loadDraft, type IsEmpty } from '@/lib/drafts';

/**
 * Autosaves a form (lib/drafts.ts). On mount it restores a saved draft into
 * a still-empty form (`restore`) and reports when it was saved, for the
 * "Draft restored · Discard" notice. Leaving the screen keeps the draft.
 * Call `clear` after a successful save or a confirmed discard.
 *
 * `key` is null until the worker is known: nothing loads or saves before.
 */
export function useDraft<T extends object>(key: string | null, value: T, restore: (draft: T) => void, isEmpty: IsEmpty<T> = isBlankDraft) {
  const [empty] = useState(() => isEmpty);
  const keeper = useMemo(() => (key ? new DraftKeeper<T>(deviceDraftStore, key, 400, undefined, empty) : null), [key, empty]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const latest = useRef({ value, restore });
  useEffect(() => {
    latest.current = { value, restore };
  });

  useEffect(() => {
    if (!keeper || !key) return;
    let live = true;
    void loadDraft<T>(deviceDraftStore, key, new Date(), empty).then((draft) => {
      if (!live) return;
      // Never write over what the worker already started typing.
      if (draft && empty(latest.current.value)) {
        latest.current.restore(draft.value);
        setRestoredAt(draft.savedAt);
      }
      setLoaded(key);
    });
    return () => {
      live = false;
      void keeper.flush();
    };
  }, [keeper, key, empty]);

  const serialized = JSON.stringify(value);
  useEffect(() => {
    if (keeper && loaded === key) keeper.change(JSON.parse(serialized) as T);
  }, [keeper, key, loaded, serialized]);

  return {
    /** When the restored draft was saved; null when nothing was restored (or after clear). */
    restoredAt,
    /** Drop the draft: after a successful save, or a confirmed discard. */
    clear: async () => {
      setRestoredAt(null);
      await keeper?.clear();
    },
    /** Hide the notice but keep autosaving. */
    dismissNotice: () => setRestoredAt(null),
  };
}
