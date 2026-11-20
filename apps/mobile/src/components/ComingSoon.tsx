import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { Page } from '@/components/Page';
import { RedRule, SectionHeading } from '@/components/brand';
import type { NavItem } from '@/lib/navigation';
import { radius, space, useTheme } from '@/theme/tokens';

/** A placeholder for a header section that hasn't been built yet. */
export function ComingSoon({ item }: { item: NavItem }) {
  const theme = useTheme();
  return (
    <Page>
      <SectionHeading title={item.label} kicker={item.blurb} />
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator, boxShadow: theme.shadow }]}>
        <Ionicons name={item.icon} size={40} color={theme.accent} />
        <Text style={[styles.title, { color: theme.text }]}>Coming soon</Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>This section is still being built.</Text>
        <RedRule width={26} />
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: space.sm, padding: space.xxl, borderWidth: 1, borderRadius: radius.md, maxWidth: 520, width: '100%', alignSelf: 'center' },
  title: { fontSize: 18, fontWeight: '800' },
  body: { fontSize: 15, textAlign: 'center' },
});
