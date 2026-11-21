import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { MANUAL_SOURCE, type Audience, type Cost, type Opportunity, type OpportunityKind } from '@/api/types';
import { radius, space, useTheme, type Theme } from '@/theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

export const KIND_INFO: Record<OpportunityKind, { label: string; plural: string; icon: IconName }> = {
  job: { label: 'Job', plural: 'Jobs', icon: 'briefcase' },
  education: { label: 'Education', plural: 'Education', icon: 'school' },
  volunteer: { label: 'Volunteer', plural: 'Volunteer', icon: 'heart' },
};

/** Who a posting is open to, as residents read it. */
export const AUDIENCE_INFO: Record<Audience, { label: string; icon: IconName }> = {
  second_chance: { label: 'Second chance', icon: 'refresh-circle-outline' },
  unhoused: { label: 'No address needed', icon: 'home-outline' },
  no_experience: { label: 'No experience needed', icon: 'sparkles-outline' },
  no_id_required: { label: 'No ID required', icon: 'card-outline' },
  youth: { label: 'Ages 16-24', icon: 'people-outline' },
};

export const COST_LABEL: Record<Cost, string> = { free: 'Free', low_cost: 'Low cost', paid: 'Paid' };

/** Where an imported posting came from (the data loader's source names). */
const SOURCE_LABEL: Record<string, string> = {
  usajobs: 'USAJOBS',
  careeronestop_jobs: 'CareerOneStop',
  careeronestop_training: 'CareerOneStop',
};

function kindColors(kind: OpportunityKind, theme: Theme) {
  if (kind === 'job') return { fg: theme.accent, bg: theme.accentSoft };
  if (kind === 'education') return { fg: theme.info, bg: theme.infoSoft };
  return { fg: theme.soon, bg: theme.warningSoft };
}

function closesOn(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** One posting: what, who, where and when, and how to apply or get in touch. */
export function OpportunityCard({ item, footer }: { item: Opportunity; footer?: ReactNode }) {
  const theme = useTheme();
  const kind = KIND_INFO[item.kind];
  const colors = kindColors(item.kind, theme);
  const open = (url: string) => Linking.openURL(url).catch(() => undefined);
  const manual = item.source === MANUAL_SOURCE;
  const from = manual ? 'Posted by ComForce MKE' : `Listed on ${SOURCE_LABEL[item.source] ?? 'a public job board'}`;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.separator, opacity: item.active ? 1 : 0.65 },
      ]}
    >
      <View style={styles.top}>
        <View style={[styles.kind, { backgroundColor: colors.bg }]}>
          <Ionicons name={kind.icon} size={13} color={colors.fg} />
          <Text style={[styles.kindText, { color: colors.fg }]}>{kind.label}</Text>
        </View>
        {!item.active ? <Text style={[styles.closed, { color: theme.textTertiary }]}>Closed</Text> : null}
      </View>

      <View style={{ gap: 2 }}>
        <Text style={[styles.title, { color: theme.text }]}>{item.title}</Text>
        <Text style={[styles.org, { color: theme.textSecondary }]}>{item.organization}</Text>
      </View>

      {item.audiences.length > 0 || item.cost ? (
        <View style={styles.tags}>
          {item.cost ? <Tag icon="pricetag-outline" label={COST_LABEL[item.cost]} /> : null}
          {item.audiences.map((a) => (
            <Tag key={a} icon={AUDIENCE_INFO[a].icon} label={AUDIENCE_INFO[a].label} />
          ))}
        </View>
      ) : null}

      {item.description ? <Text style={[styles.body, { color: theme.text }]}>{item.description}</Text> : null}

      <View style={{ gap: 4 }}>
        {item.location ? <Meta icon="location-outline" text={item.location} /> : null}
        {item.schedule ? <Meta icon="time-outline" text={item.schedule} /> : null}
        {item.pay ? <Meta icon="cash-outline" text={item.pay} /> : null}
        {item.expires_at ? <Meta icon="calendar-outline" text={`Apply by ${closesOn(item.expires_at)}`} /> : null}
      </View>

      <View style={styles.actions}>
        {item.apply_url ? (
          <Action
            icon="open-outline"
            label={item.kind === 'job' ? 'Apply' : item.kind === 'education' ? 'Learn more' : 'Sign up'}
            primary
            onPress={() => open(item.apply_url!)}
          />
        ) : null}
        {item.contact_phone ? (
          <Action icon="call-outline" label={item.contact_phone} onPress={() => open(`tel:${item.contact_phone!.replace(/[^\d+]/g, '')}`)} />
        ) : null}
        {item.contact_email ? <Action icon="mail-outline" label="Email" onPress={() => open(`mailto:${item.contact_email}`)} /> : null}
      </View>

      <Text style={[styles.from, { color: theme.textTertiary }]}>{from}</Text>

      {footer}
    </View>
  );
}

function Tag({ icon, label }: { icon: IconName; label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.tag, { backgroundColor: theme.fill }]}>
      <Ionicons name={icon} size={13} color={theme.text} />
      <Text style={[styles.tagText, { color: theme.text }]}>{label}</Text>
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
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: 999 },
  tagText: { fontSize: 12, fontWeight: '700' },
  from: { fontSize: 12 },
  body: { fontSize: 15, lineHeight: 21 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  metaText: { fontSize: 14, flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 8, borderWidth: 1, borderRadius: radius.sm },
  actionText: { fontSize: 14, fontWeight: '800' },
});
