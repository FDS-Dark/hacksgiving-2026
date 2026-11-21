import type Ionicons from '@expo/vector-icons/Ionicons';
import type { Href } from 'expo-router';
import type { ComponentProps } from 'react';

import { useStaffStatus } from '@/services/cases';

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface NavItem {
  label: string;
  href: Href & string;
  icon: IconName;
  /** One line for the homepage cards. */
  blurb: string;
  /** Only ComForce workers and admins see it. */
  staffOnly?: boolean;
}

/**
 * The sections in the header bar, in order. The homepage cards use the same
 * list. Add each section here as its page lands (the old ones are on the
 * archive/full-prototype branch).
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Get Help', href: '/help', icon: 'hand-left', blurb: 'Tell us what you need and we will connect you with the right ComForce service.' },
  { label: 'Safety Map', href: '/safety', icon: 'map', blurb: 'Explore generalized Milwaukee public-safety activity without exposing identities or exact addresses.' },
  { label: 'Alerts', href: '/alerts', icon: 'notifications', blurb: 'See nearby public incident and dispatch updates, plus your ComForce call follow-ups.' },
  {
    label: 'ComForce Portal',
    href: '/worker',
    icon: 'briefcase',
    blurb: 'Staff: every request from the community, sorted by ComForce service.',
    staffOnly: true,
  },
];

/** The sections this user may open: staff items only once /staff/me says so. */
export function useNavItems(): readonly NavItem[] {
  const staff = useStaffStatus();
  const isStaff = staff.data?.is_worker ?? false;
  return NAV_ITEMS.filter((item) => !item.staffOnly || isStaff);
}
