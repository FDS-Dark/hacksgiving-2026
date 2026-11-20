import { NativeTabs } from 'expo-router/native-tabs';

import { useTheme } from '@/theme/tokens';

/** The platform tab bar. Add a Trigger here for each new tab screen. */
export default function TabsLayout() {
  const theme = useTheme();
  return (
    <NativeTabs tintColor={theme.accent} disableTransparentOnScrollEdge>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Nearby</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'map', selected: 'map.fill' }} md="map" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="alerts">
        <NativeTabs.Trigger.Label>Alerts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bell', selected: 'bell.fill' }} md="notifications" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
