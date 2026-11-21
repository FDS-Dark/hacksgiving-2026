import { Stack } from 'expo-router';

import { useTheme } from '@/theme/tokens';

/** Asking for help: open signed in or out (see the root layout). */
export default function HelpLayout() {
  const theme = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />;
}
