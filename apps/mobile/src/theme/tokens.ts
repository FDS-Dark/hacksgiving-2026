import { useColorScheme } from 'react-native';

/**
 * Hacksgiving design tokens. One palette per color scheme; every component reads
 * colors through useTheme() so dark mode is automatic.
 *
 * Mostly neutral. Color is only used where it means something:
 * - accent (blue): things you can tap.
 * - brand (green): the wordmark, and "plenty of time left".
 * - soon (amber) / today (red): food to use first. Red is also destructive.
 * - storage kinds: each kind of place (fridge, freezer, pantry, other) has
 *   its own color, used on its icon tiles and filters, so a place reads the
 *   same everywhere.
 * See docs/design/redesign-brief.md.
 */

const light = {
  scheme: 'light' as 'light' | 'dark',
  /** Grouped background behind lists. */
  bg: '#F2F4F5',
  /** Rows, sheets. */
  surface: '#FFFFFF',
  /** Inputs, steppers, unselected filters, pressed rows. */
  fill: '#E8ECEE',
  separator: 'rgba(20,32,38,0.13)',
  text: '#141A1D',
  textSecondary: '#5A6569',
  textTertiary: '#8C979B',
  accent: '#1F5F8B',
  accentSoft: 'rgba(31,95,139,0.10)',
  onAccent: '#FFFFFF',
  brand: '#2F6B4F',
  fresh: '#2F6B4F',
  soon: '#9A5800',
  today: '#B42318',
  danger: '#B42318',
  dangerSoft: 'rgba(180,35,24,0.09)',
  warningSoft: 'rgba(154,88,0,0.10)',
  freshSoft: 'rgba(47,107,79,0.11)',
  overlay: 'rgba(10,16,20,0.4)',
  kinds: { fridge: '#2E78B7', freezer: '#22909E', pantry: '#B9741A', other: '#7468AE' },
  /** Glyphs on colored tiles. */
  onTile: '#FFFFFF',
};

export type Theme = typeof light;

const dark: Theme = {
  scheme: 'dark',
  bg: '#0D1113',
  surface: '#181D20',
  fill: '#252B2E',
  separator: 'rgba(235,242,245,0.14)',
  text: '#ECF0F1',
  textSecondary: '#9BA6AA',
  textTertiary: '#687377',
  accent: '#72B2DE',
  accentSoft: 'rgba(114,178,222,0.14)',
  onAccent: '#0D1113',
  brand: '#86C29F',
  fresh: '#86C29F',
  soon: '#E5A64A',
  today: '#F0796D',
  danger: '#F0796D',
  dangerSoft: 'rgba(240,121,109,0.14)',
  warningSoft: 'rgba(229,166,74,0.14)',
  freshSoft: 'rgba(134,194,159,0.14)',
  overlay: 'rgba(0,0,0,0.55)',
  kinds: { fridge: '#3F8DCF', freezer: '#2EA6B3', pantry: '#C98A2E', other: '#8A7FC4' },
  onTile: '#FFFFFF',
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

/** 4pt grid. 16 is the screen margin and the row inset. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 8, md: 10, lg: 12 };

/** The only custom face, and only for the wordmark. Everything else is the
 *  system font (SF Pro on iOS, Roboto on Android). */
export const WORDMARK_FONT = 'BricolageGrotesque_700Bold';

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
