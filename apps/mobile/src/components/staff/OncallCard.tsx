/** Today's "You're on call" card (Figma 26:122), and the switch it shares with Me. */
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/staff/kit';
import { ErrorBanner, Toggle } from '@/components/ui';
import { oncallSubtitle, oncallTitle } from '@/lib/oncall';
import { shiftError, useOncallNow, useToggleOncall } from '@/services/oncall';
import { type, useTheme } from '@/theme/tokens';

/** Whether I'm on call, and flipping it. While a flip is in flight the switch shows where it's going. */
export function useOncallSwitch() {
  const now = useOncallNow();
  const toggle = useToggleOncall();
  const pending = toggle.isPending ? toggle.variables?.on : undefined;
  return {
    now,
    on: pending ?? now.data?.me.on_call ?? false,
    busy: toggle.isPending,
    error: toggle.error ? shiftError(toggle.error) : null,
    set: (on: boolean) => toggle.mutate({ on }),
  };
}

/** Hidden until /oncall/now answers, so a missing or failing endpoint never blocks Today. */
export function OncallCard() {
  const theme = useTheme();
  const oncall = useOncallSwitch();
  const data = oncall.now.data;
  if (!data) return null;
  return (
    <View style={{ gap: 8 }}>
      <Card style={styles.card}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" style={[type.headline, { color: theme.text, fontWeight: '700' }]}>
            {oncallTitle(data)}
          </Text>
          <Text style={[type.subhead, { color: theme.textSecondary }]}>{oncallSubtitle(data)}</Text>
        </View>
        <Toggle value={oncall.on} onChange={oncall.set} disabled={oncall.busy} label="On call" />
      </Card>
      {oncall.error ? <ErrorBanner error={oncall.error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center' },
});
