import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Opportunity, OpportunityKind } from '@/api/types';
import { radius, space, useTheme } from '@/theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

export const KIND_INFO: Record<OpportunityKind, { label: string; icon: IconName }> = {
  job: { label: 'Job', icon: 'briefcase' },
  volunteer: { label: 'Volunteer', icon: 'heart' },
};

/** One posting: what, who, where and when, and how to apply or get in touch. */
export function OpportunityCard({ item, footer }: { item: Opportunity; footer?: ReactNode }) {
  const theme = useTheme();
  const kind = KIND_INFO[item.kind];
  const open = (url: string) => Linking.openURL(url).catch(() => undefined);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.separator, opacity: item.active ? 1 : 0.65 },
      ]}
    >
      <View style={styles.top}>
        <View style={[styles.kind, { backgroundColor: item.kind === 'job' ? theme.accentSoft : theme.warningSoft }]}>
          <Ionicons name={kind.icon} size={13} color={item.kind === 'job' ? theme.accent : theme.soon} />
          <Text style={[styles.kindText, { color: item.kind === 'job' ? theme.accent : theme.soon }]}>{kind.label}</Text>
        </View>
        {!item.active ? <Text style={[styles.closed, { color: theme.textTertiary }]}>Closed</Text> : null}
      </View>

      <View style={{ gap: 2 }}>
        <Text style={[styles.title, { color: theme.text }]}>{item.title}</Text>
        <Text style={[styles.org, { color: theme.textSecondary }]}>{item.organization}</Text>
      </View>

      {item.description ? <Text style={[styles.body, { color: theme.text }]}>{item.description}</Text> : null}

      <View style={{ gap: 4 }}>
        {item.location ? <Meta icon="location-outline" text={item.location} /> : null}
        {item.schedule ? <Meta icon="time-outline" text={item.schedule} /> : null}
        {item.pay ? <Meta icon="cash-outline" text={item.pay} /> : null}
      </View>

      <View style={styles.actions}>
        {item.apply_url ? <Action icon="open-outline" label={item.kind === 'job' ? 'Apply' : 'Sign up'} primary onPress={() => open(item.apply_url!)} /> : null}
        {item.contact_phone ? (
          <Action icon="call-outline" label={item.contact_phone} onPress={() => open(`tel:${item.contact_phone!.replace(/[^\d+]/g, '')}`)} />
        ) : null}
        {item.contact_email ? <Action icon="mail-outline" label="Email" onPress={() => open(`mailto:${item.contact_email}`)} /> : null}
      </View>

      {footer}
    </View>
  );
}

function Meta({ icon, text }: { icon: IconName; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.meta}>
      <Ionicons name={icon} size={15} color={theme.textSecondary} />
      <Text style={[styles.metaText, { color: theme.textSecondary }]}>{text}</Text>
    </View>
  );
}

function Action({ icon, label, onPress, primary = false }: { icon: IconName; label: string; onPress: () => void; primary?: boolean }) {
  const theme = useTheme();
  const fg = primary ? theme.onAccent : theme.accent;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: primary ? theme.accent : theme.surface, borderColor: theme.accent },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Ionicons name={icon} size={15} color={fg} />
      <Text style={[styles.actionText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderWidth: 1, borderRadius: radius.md },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: 999 },
  kindText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
  closed: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  title: { fontSize: 18, fontWeight: '900' },
  org: { fontSize: 14, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  metaText: { fontSize: 14, flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 8, borderWidth: 1, borderRadius: radius.sm },
  actionText: { fontSize: 14, fontWeight: '800' },
});
