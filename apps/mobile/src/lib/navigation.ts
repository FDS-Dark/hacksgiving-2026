import type Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface NavItem {
  label: string;
  href: '/location' | '/opportunities' | '/resources' | '/safety' | '/tools';
  icon: IconName;
  /** One line for the homepage cards. */
  blurb: string;
}

/** The sections in the header bar, in order. The homepage cards use the same list. */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Location', href: '/location', icon: 'location-outline', blurb: 'Find ComForce sites and services near you.' },
  { label: 'Opportunities', href: '/opportunities', icon: 'briefcase-outline', blurb: 'Jobs and volunteer openings across Milwaukee.' },
  { label: 'Resources', href: '/resources', icon: 'library-outline', blurb: 'Food, shelter, transportation, and crisis support.' },
  { label: 'Safety', href: '/safety', icon: 'shield-checkmark-outline', blurb: 'Domestic violence support, safety planning, and help.' },
  { label: 'Tools', href: '/tools', icon: 'construct-outline', blurb: 'Handy tools for residents and volunteers.' },
];
