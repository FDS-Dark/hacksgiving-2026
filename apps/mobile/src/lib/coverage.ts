/** Coloring for the need-versus-coverage map (components/staff/CoverageMap.tsx). */

/** Five shades from light to dark for low to high (need, or incidents). */
export const SHADES = ['#FDE7D3', '#F9C49A', '#F29B63', '#E26A36', '#B9401C'];

/** Which shade a value gets, by quintile of the values present. */
export function shadeOf(value: number | null | undefined, values: number[]) {
  if (value === null || value === undefined || !values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = sorted.filter((v) => v <= value).length / sorted.length;
  return SHADES[Math.min(SHADES.length - 1, Math.floor(rank * SHADES.length - 1e-9))];
}
