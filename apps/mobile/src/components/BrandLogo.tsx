import { Image } from 'react-native';

import { useTheme } from '@/theme/tokens';

const FULL = require('../../assets/brand/comforce-logo.png');
const FULL_DARK = require('../../assets/brand/comforce-logo-dark.png');
const MARK = require('../../assets/brand/comforce-mark.png');
const MARK_DARK = require('../../assets/brand/comforce-mark-dark.png');

/** Source images are trimmed to these sizes, so width alone sets the height. */
const FULL_RATIO = 936 / 225;
const MARK_RATIO = 163 / 215;

/** The Community Task Force MKE logo. `mark` is the knot symbol alone, for tight spots. */
export function BrandLogo({ width = 240, mark = false }: { width?: number; mark?: boolean }) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const source = mark ? (dark ? MARK_DARK : MARK) : dark ? FULL_DARK : FULL;
  const ratio = mark ? MARK_RATIO : FULL_RATIO;
  return (
    <Image
      source={source}
      accessibilityRole="image"
      accessibilityLabel="Community Task Force MKE"
      resizeMode="contain"
      style={{ width, height: width / ratio }}
    />
  );
}
