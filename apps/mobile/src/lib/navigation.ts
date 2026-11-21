import type Ionicons from '@expo/vector-icons/Ionicons';
import type { Href } from 'expo-router';
import type { ComponentProps } from 'react';

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface NavItem {
  label: string;
  href: Href & string;
  icon: IconName;
  /** One line for the homepage cards. */
  blurb: string;
}

/**
 * The sections in the header bar, in order. The homepage cards use the same
 * list. Empty while the app is rebuilt step by step: add each section here
 * as its page lands (the old ones are on the archive/full-prototype branch).
 */
export const NAV_ITEMS: readonly NavItem[] = [];
