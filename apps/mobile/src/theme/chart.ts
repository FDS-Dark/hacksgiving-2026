import { useColorScheme } from 'react-native';

/**
 * Chart colors. Series hues are the dataviz reference palette, validated
 * (scripts/validate_palette.js) against this app's card surfaces:
 * light #FFFFFF and dark #172225. The first five slots pass every gate in
 * both modes. In light mode aqua, yellow, and magenta sit under 3:1
 * contrast, so every chart ships a legend and a table view.
 *
 * Assign series slots in order and keep them with the entity; never
 * recolor by rank. Text never wears a series color: labels use the app's
 * text tokens.
 */
const light = {
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'],
  /** Label color inside each series fill (near-black on yellow). */
  onSeries: ['#ffffff', '#ffffff', '#ffffff', '#0b0b0b', '#ffffff'],
  /** Blue ramp, low → high, for heatmaps. */
  sequential: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
  /** Meter tracks: a lighter step of the fill's ramp. */
  track: '#cde2fb',
  grid: '#E8EDEA',
  baseline: '#C3CCC8',
  /** Neutral reference lines (targets, goals). */
  reference: '#5D666D',
  /** Diverging poles (blue <-> red) for above/below a baseline. */
  diverging: { neg: '#2a78d6', pos: '#e34948' },
};

type ChartTheme = typeof light;

const dark: ChartTheme = {
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'],
  onSeries: ['#ffffff', '#ffffff', '#ffffff', '#0b0b0b', '#ffffff'],
  // Dark mode is selected, not flipped: low values sit near the dark surface, high values brighten.
  sequential: ['#13314f', '#104281', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4'],
  track: '#1c3550',
  grid: 'rgba(220,228,224,0.08)',
  baseline: 'rgba(220,228,224,0.24)',
  reference: '#A3ADA8',
  diverging: { neg: '#3987e5', pos: '#e66767' },
};

/**
 * Status colors (dataviz reference, fixed in both modes). Reserved for
 * state, never a series, and always shown with an icon + a text label.
 */
export const STATUS = {
  good: { color: '#0ca30c', icon: 'checkmark-circle', label: 'On track' },
  warning: { color: '#fab219', icon: 'warning', label: 'Watch' },
  serious: { color: '#ec835a', icon: 'alert-circle', label: 'Act soon' },
  critical: { color: '#d03b3b', icon: 'close-circle', label: 'Act now' },
} as const;
export type StatusLevel = keyof typeof STATUS;

export function useChartTheme(): ChartTheme {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Round an axis max up to a clean number and give ~4 ticks. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  if (ticks[ticks.length - 1] < max) ticks.push(Math.round((ticks[ticks.length - 1] + step) * 100) / 100);
  return ticks;
}

export function compact(n: number) {
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  return n.toLocaleString('en-US');
}
