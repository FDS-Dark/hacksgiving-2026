import { NativeTabs } from 'expo-router/native-tabs';

import { useRecentCalls } from '@/services/recentCalls';
import { useTheme } from '@/theme/tokens';

/** The platform tab bar. Add a Trigger here for each new tab screen. */
export default function TabsLayout() {
  const theme = useTheme();
  const calls = useRecentCalls();
  const alertCount = Math.min(calls.data?.length ?? 0, 99);
  return (
    <NativeTabs tintColor={theme.accent} disableTransparentOnScrollEdge>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Nearby</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'map', selected: 'map.fill' }} md="map" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="alerts">
        <NativeTabs.Trigger.Label>Alerts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bell', selected: 'bell.fill' }} md="notifications" />
        <NativeTabs.Trigger.Badge hidden={alertCount === 0}>{String(alertCount)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
