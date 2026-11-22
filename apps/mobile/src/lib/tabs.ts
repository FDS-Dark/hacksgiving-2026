/**
 * What a tap on a bottom tab does (components/TabBar.tsx). A selected tab
 * is never inert: on a screen nested under it (Me → Jobs and programs,
 * Queue → a case) it goes back to the tab's own root.
 */
import type { Href } from 'expo-router';

export interface TabTarget {
  href?: Href;
  push?: Href;
  match: (path: string) => boolean;
}

export type TabAction = { kind: 'none' } | { kind: 'push'; href: Href } | { kind: 'root'; href: Href };

function pathOf(href: Href): string | null {
  if (typeof href === 'string') return href.split(/[?#]/)[0];
  return typeof href.pathname === 'string' ? href.pathname : null;
}

/** Trailing slashes don't make a different screen. */
function same(a: string, b: string) {
  const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
  return trim(a) === trim(b);
}

export function tabAction(tab: TabTarget, pathname: string): TabAction {
  const active = tab.match(pathname);
  if (tab.push) return active ? { kind: 'none' } : { kind: 'push', href: tab.push };
  if (!tab.href) return { kind: 'none' };
  const root = pathOf(tab.href);
  if (active && root !== null && same(root, pathname)) return { kind: 'none' };
  return { kind: 'root', href: tab.href };
}
