import { Platform, useColorScheme } from 'react-native';

/**
 * Design tokens, taken from the Community Task Force MKE website
 * (comforcemilwaukee.com). One palette per color scheme; every component
 * reads colors through useTheme() so dark mode is automatic.
 *
 * - brand / accent (ComForce green): the logo, links, primary buttons.
 * - red: the short "red rule" accent under headings and cards, and urgent things.
 * - charcoal: dark bands (stats, footer).
 */

const light = {
  scheme: 'light' as 'light' | 'dark',
  /** Page background (the site's "paper"). */
  bg: '#F7F9F8',
  /** Cards, header bar, sheets. */
  surface: '#FFFFFF',
  /** Inputs, unselected filters, pressed rows. */
  fill: '#E8F3ED',
  /** Hairlines and card borders (the site's "line"). */
  separator: '#DCE4E0',
  text: '#141A1F',
  textSecondary: '#5D666D',
  textTertiary: '#8C979B',
  accent: '#0F6B3A',
  accentPressed: '#0A5830',
  accentSoft: 'rgba(15,107,58,0.10)',
  onAccent: '#FFFFFF',
  brand: '#0F6B3A',
  red: '#E92626',
  /** Dark bands: stats, footer. Stays dark in both schemes. */
  charcoal: '#10191B',
  onCharcoal: '#FFFFFF',
  soon: '#9A5800',
  danger: '#B42318',
  dangerSoft: 'rgba(180,35,24,0.09)',
  warningSoft: 'rgba(154,88,0,0.10)',
  overlay: 'rgba(10,16,20,0.4)',
  /** Card drop shadow (CSS box-shadow syntax). */
  shadow: '0 18px 45px rgba(16, 25, 27, 0.10)',
  /** Glyphs on colored tiles. */
  onTile: '#FFFFFF',
};

export type Theme = typeof light;

const dark: Theme = {
  scheme: 'dark',
  bg: '#0E1517',
  surface: '#172225',
  fill: '#1F2D30',
  separator: 'rgba(220,228,224,0.14)',
  text: '#EEF2F0',
  textSecondary: '#A3ADA8',
  textTertiary: '#6E7975',
  accent: '#4DBB7E',
  accentPressed: '#3FA36C',
  accentSoft: 'rgba(77,187,126,0.14)',
  onAccent: '#0E1517',
  brand: '#4DBB7E',
  red: '#FF5A5A',
  charcoal: '#0A1012',
  onCharcoal: '#FFFFFF',
  soon: '#E5A64A',
  danger: '#F0796D',
  dangerSoft: 'rgba(240,121,109,0.14)',
  warningSoft: 'rgba(229,166,74,0.14)',
  overlay: 'rgba(0,0,0,0.55)',
  shadow: '0 18px 45px rgba(0, 0, 0, 0.35)',
  onTile: '#FFFFFF',
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

/** 4pt grid. 16 is the screen margin and the row inset. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

/** The site uses 7–8px corners on buttons and cards. */
export const radius = { sm: 7, md: 8, lg: 12 };

/** Widest the content gets on large screens (the site's .container). */
export const MAX_CONTENT_WIDTH = 1290;

/** Headlines and big numbers are set in Georgia, like the site. */
export const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, "Times New Roman", serif' });

/** iOS text styles at their default Dynamic Type sizes. */
export const type = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' as const },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  section: { fontSize: 20, lineHeight: 25, fontWeight: '600' as const },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' as const },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
};
