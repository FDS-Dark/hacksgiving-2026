/**
 * The info hub: what staff and partners need to know and keep on hand
 * (announcements, how-to guides, contacts, forms, links). Each post says
 * who may see it. Client-side only until the API stores them.
 */

import type { Attachment } from '@/lib/opportunities';

export type PostKind = 'announcement' | 'guide' | 'contact' | 'file' | 'link';
export const POST_KINDS: PostKind[] = ['announcement', 'guide', 'contact', 'file', 'link'];
export const KIND_LABEL: Record<PostKind, string> = {
  announcement: 'Announcement',
  guide: 'Guide',
  contact: 'Contact',
  file: 'Form or file',
  link: 'Link',
};
export const KIND_ICON = {
  announcement: 'megaphone-outline',
  guide: 'book-outline',
  contact: 'call-outline',
  file: 'document-attach-outline',
  link: 'link-outline',
} as const;

export const FOLDERS = ['Shift updates', 'Policies & procedures', 'Resource guides', 'Partner directory', 'Forms & templates', 'Training'] as const;

export type Audience = 'staff' | 'partners';
export const AUDIENCE_LABEL: Record<Audience, string> = { staff: 'ComForce staff only', partners: 'Staff and partners' };

export interface InfoPost {
  id: string;
  kind: PostKind;
  title: string;
  body: string;
  folder: string;
  tags: string[];
  audience: Audience;
  pinned: boolean;
  /** Ask everyone who can see it to confirm they've read it. */
  requireAck: boolean;
  acknowledgedBy: string[];
  link: string;
  phone: string;
  email: string;
  attachment: Attachment | null;
  author: string;
  updatedAt: string;
  /** Drop out of the hub after this date (YYYY-MM-DD). */
  expiresOn: string;
}

export function emptyPost(author: string): InfoPost {
  return {
    id: `post-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    kind: 'announcement',
    title: '',
    body: '',
    folder: 'Shift updates',
    tags: [],
    audience: 'staff',
    pinned: false,
    requireAck: false,
    acknowledgedBy: [],
    link: '',
    phone: '',
    email: '',
    attachment: null,
    author,
    updatedAt: new Date().toISOString(),
    expiresOn: '',
  };
}

const URL_RE = /^https?:\/\/\S+\.\S+/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validatePost(p: InfoPost): Partial<Record<keyof InfoPost, string>> {
  const e: Partial<Record<keyof InfoPost, string>> = {};
  if (!p.title.trim()) e.title = 'Add a title.';
  if (p.kind !== 'contact' && p.kind !== 'link' && p.kind !== 'file' && !p.body.trim()) e.body = 'Write the post.';
  if (p.kind === 'link' && !URL_RE.test(p.link.trim())) e.link = 'Enter a link starting with https://';
  if (p.link.trim() && !URL_RE.test(p.link.trim())) e.link = 'Enter a link starting with https://';
  if (p.kind === 'contact' && !p.phone.trim() && !p.email.trim()) e.phone = 'Add a phone number or email.';
  if (p.email.trim() && !EMAIL.test(p.email.trim())) e.email = 'Enter an email address.';
  if (p.kind === 'file' && !p.attachment) e.attachment = 'Upload the file.';
  if (p.expiresOn && !DATE.test(p.expiresOn)) e.expiresOn = 'Use YYYY-MM-DD.';
  return e;
}

/** Tags typed as "a, b, c". */
export function parseTags(text: string) {
  return [...new Set(text.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/** Plain text for the share sheet (text message, email, Slack, …). */
export function shareText(p: InfoPost) {
  return [p.title, p.body, p.phone && `Phone: ${p.phone}`, p.email && `Email: ${p.email}`, p.link].filter(Boolean).join('\n\n');
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();

export const SAMPLE_POSTS: InfoPost[] = [
  {
    ...emptyPost('Aisha Brown'),
    id: 'post-cold',
    title: 'Cold weather protocol starts Monday',
    body: 'Overnight lows below 20°F. Outreach teams carry hand warmers and blankets, and check the warming-center list before each shift. Call dispatch for anyone who refuses shelter and seems at risk.',
    folder: 'Shift updates',
    tags: ['winter', 'outreach'],
    audience: 'partners',
    pinned: true,
    requireAck: true,
    acknowledgedBy: ['Maria Santos', 'Jordan Ellis'],
    updatedAt: daysAgo(1),
  },
  {
    ...emptyPost('Maria Santos'),
    id: 'post-dv',
    kind: 'guide',
    title: 'Handling a domestic violence call',
    body: '1. Make sure the person can talk safely.\n2. Ask before calling back, texting, or leaving a voicemail.\n3. Mark the request Confidential.\n4. Offer the 24/7 hotline and a warm handoff to Sojourner.\n5. Never share details with other partners without consent.',
    folder: 'Policies & procedures',
    tags: ['safety', 'dv', 'intake'],
    audience: 'staff',
    updatedAt: daysAgo(12),
  },
  {
    ...emptyPost('Aisha Brown'),
    id: 'post-sojourner',
    kind: 'contact',
    title: 'Sojourner Family Peace Center: 24/7 hotline',
    body: 'Domestic violence crisis line, shelter intake, and safety planning.',
    folder: 'Partner directory',
    tags: ['dv', 'hotline'],
    audience: 'partners',
    phone: '(414) 555-0100',
    updatedAt: daysAgo(30),
  },
  {
    ...emptyPost('Aisha Brown'),
    id: 'post-211',
    kind: 'link',
    title: 'IMPACT 2-1-1 resource search',
    body: 'Countywide search for food, housing, utilities, and more.',
    folder: 'Resource guides',
    tags: ['referrals'],
    audience: 'partners',
    link: 'https://www.impactinc.org/211/',
    updatedAt: daysAgo(45),
  },
];
