import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { SAMPLE_POSTS, type InfoPost } from '@/lib/infohub';
import { SAMPLE_POSTINGS, type Posting } from '@/lib/opportunities';

interface AdminState {
  /**
   * Shows staff tools on regular pages (e.g. posting on Opportunities).
   * Turned on from the staff portal; pages also check the user is staff.
   */
  adminMode: boolean;
  setAdminMode: (on: boolean) => void;
  postings: Posting[];
  savePosting: (posting: Posting) => void;
  removePosting: (id: string) => void;
  posts: InfoPost[];
  savePost: (post: InfoPost) => void;
  removePost: (id: string) => void;
}

/** Replace the item with the same id, or add it to the front. */
function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list];
}

const AdminContext = createContext<AdminState | null>(null);

/**
 * Holds admin mode, postings and info hub posts in memory until the API
 * stores them. Requests and the services directory are live: see
 * services/cases.ts.
 */
export function AdminProvider({ children }: { children: ReactNode }) {
  const [adminMode, setAdminMode] = useState(false);
  const [postings, setPostings] = useState<Posting[]>(SAMPLE_POSTINGS);
  const [posts, setPosts] = useState<InfoPost[]>(SAMPLE_POSTS);

  const value = useMemo<AdminState>(
    () => ({
      adminMode,
      setAdminMode,
      postings,
      savePosting: (posting) => setPostings((list) => upsert(list, { ...posting, updatedAt: new Date().toISOString() })),
      removePosting: (id) => setPostings((list) => list.filter((p) => p.id !== id)),
      posts,
      savePost: (post) => setPosts((list) => upsert(list, post)),
      removePost: (id) => setPosts((list) => list.filter((p) => p.id !== id)),
    }),
    [adminMode, postings, posts],
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminState {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used inside AdminProvider');
  return ctx;
}
