import { Text } from 'react-native';

import { WORDMARK_FONT, useTheme } from '@/theme/tokens';

/** "hacksgiving", the only text set in the brand face. */
export function Wordmark({ size = 40 }: { size?: number }) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole="header"
      accessibilityLabel="Hacksgiving"
      style={{ fontFamily: WORDMARK_FONT, fontSize: size, lineHeight: size * 1.1, letterSpacing: -size * 0.03, color: theme.brand }}
    >
      hacksgiving
    </Text>
  );
}
