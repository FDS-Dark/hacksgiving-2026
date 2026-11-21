import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { useTheme } from '@/theme/tokens';

/** The app mark from the Figma shell: a white shield on a rounded green tile. */
export function LogoTile({ size = 64 }: { size?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{ width: size, height: size, borderRadius: size * 0.22, backgroundColor: theme.brand, alignItems: 'center', justifyContent: 'center' }}
      accessible
      accessibilityLabel="ComForce MKE"
    >
      <Ionicons name="shield-outline" size={size * 0.5} color="#FFFFFF" />
    </View>
  );
}
