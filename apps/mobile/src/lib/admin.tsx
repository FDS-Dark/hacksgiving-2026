import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { SAMPLE_POSTS, type InfoPost } from '@/lib/infohub';
import { SAMPLE_POSTINGS, type Posting } from '@/lib/opportunities';
import { SAMPLE_REQUESTS, type AssistRequest } from '@/lib/requests';
import { SAMPLE_SERVICES, sampleEvents, type EventKind, type Service, type ServiceEvent } from '@/lib/services';

interface AdminState {
  /**
   * Shows staff and partner tools on regular pages (e.g. posting on
   * Opportunities). Turned on from the Admin page.
   * TODO: derive from the user's role once admin requires sign-in.
   */
  adminMode: boolean;
  setAdminMode: (on: boolean) => void;
  postings: Posting[];
  savePosting: (posting: Posting) => void;
  removePosting: (id: string) => void;
  requests: AssistRequest[];
  saveRequest: (request: AssistRequest) => void;
  posts: InfoPost[];
  savePost: (post: InfoPost) => void;
  removePost: (id: string) => void;
  services: Service[];
  saveService: (service: Service) => void;
  removeService: (id: string) => void;
  serviceEvents: ServiceEvent[];
  /** Record a use of a service. The residents' Resources page calls this with source 'resident'. */
  trackServiceEvent: (serviceId: string, kind: EventKind, source?: ServiceEvent['source']) => void;
}

/** Replace the item with the same id, or add it to the front. */
function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list];
}

const AdminContext = createContext<AdminState | null>(null);

/** Holds admin mode, postings, requests, and info hub posts in memory until the API stores them. */
export function AdminProvider({ children }: { children: ReactNode }) {
  const [adminMode, setAdminMode] = useState(false);
  const [postings, setPostings] = useState<Posting[]>(SAMPLE_POSTINGS);
  const [requests, setRequests] = useState<AssistRequest[]>(SAMPLE_REQUESTS);
  const [posts, setPosts] = useState<InfoPost[]>(SAMPLE_POSTS);
  const [services, setServices] = useState<Service[]>(SAMPLE_SERVICES);
  const [serviceEvents, setServiceEvents] = useState<ServiceEvent[]>(() => sampleEvents());

  const value = useMemo<AdminState>(
    () => ({
      adminMode,
      setAdminMode,
      postings,
      savePosting: (posting) => setPostings((list) => upsert(list, { ...posting, updatedAt: new Date().toISOString() })),
      removePosting: (id) => setPostings((list) => list.filter((p) => p.id !== id)),
      requests,
      saveRequest: (request) => setRequests((list) => upsert(list, request)),
      posts,
      savePost: (post) => setPosts((list) => upsert(list, post)),
      removePost: (id) => setPosts((list) => list.filter((p) => p.id !== id)),
      services,
      saveService: (service) => setServices((list) => upsert(list, service)),
      removeService: (id) => setServices((list) => list.filter((s) => s.id !== id)),
      serviceEvents,
      trackServiceEvent: (serviceId, kind, source = 'staff') =>
        setServiceEvents((list) => [...list, { serviceId, kind, source, at: Date.now() }]),
    }),
    [adminMode, postings, requests, posts, services, serviceEvents],
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminState {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used inside AdminProvider');
  return ctx;
}
