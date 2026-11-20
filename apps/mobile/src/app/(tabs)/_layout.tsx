import { NativeTabs } from 'expo-router/native-tabs';

import { useTheme } from '@/theme/tokens';

/** The platform tab bar. Add a Trigger here for each new tab screen. */
export default function TabsLayout() {
  const theme = useTheme();
  return (
    <NativeTabs tintColor={theme.accent} disableTransparentOnScrollEdge>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
