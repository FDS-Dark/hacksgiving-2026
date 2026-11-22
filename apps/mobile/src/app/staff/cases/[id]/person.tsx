import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Person } from '@/api/types';
import { Avatar } from '@/components/Avatar';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { CaseLine } from '@/components/staff/CaseLine';
import { Badge, Card, StatTile, priorityColor } from '@/components/staff/kit';
import { ErrorBanner, Loading, Notice } from '@/components/ui';
import { CATEGORY_LABEL, STATUS_LABEL } from '@/lib/cases';
import { dateTime, timeAgo } from '@/lib/format';
import { callPhone } from '@/lib/phone';
import { usePerson } from '@/services/cases';
import { space, type, useTheme } from '@/theme/tokens';

const MATCH_LABEL: Record<Person['matched_by'][number], string> = {
  account: 'their resident account',
  phone: 'the same phone number',
  email: 'the same email',
};

const CONTACT_LABEL: Record<NonNullable<Person['contact_method']>, string> = {
  call: 'Prefers a call',
  text: 'Prefers a text',
  none: 'Don’t reach out',
};

/**
 * The person page (A2): who a case is about, how to reach them safely, and
 * every case that looks like the same person. There's no separate person
 * record; cases are matched by resident account, phone or email.
 */
export default function PersonScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const person = usePerson(id);
  const p = person.data;
  const open = p?.cases.filter((c) => c.status !== 'resolved' && c.status !== 'closed') ?? [];
  const past = p?.cases.filter((c) => c.status === 'resolved' || c.status === 'closed') ?? [];

  return (
    <Page refreshing={person.isRefetching} onRefresh={() => person.refetch()} contentStyle={{ maxWidth: 720, gap: space.lg }}>
      <BackLink fallback={`/staff/cases/${id}`} />
      {person.isPending ? (
        <Loading label="Loading" />
      ) : !p ? (
        <ErrorBanner error={person.error} onRetry={() => person.refetch()} />
      ) : (
        <>
          <View style={styles.head}>
            <Avatar name={p.name ?? '?'} size={56} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text accessibilityRole="header" style={[styles.name, { color: theme.text }]}>
                {p.name ?? 'Name not given'}
              </Text>
              <View style={styles.badges}>
                {p.has_account ? <Badge label="Has the app" color={theme.accent} icon="phone-portrait-outline" /> : null}
                {p.contact_method ? <Badge label={CONTACT_LABEL[p.contact_method]} color={theme.textSecondary} /> : null}
              </View>
            </View>
          </View>

          {p.contact_method === 'none' ? (
            <Notice icon="hand-left-outline" tone="warning">
              They asked not to be contacted. Wait for them to reach out.
            </Notice>
          ) : p.safe_to_contact === false ? (
            <Notice icon="warning-outline" tone="warning">
              Be careful: no voicemail, and don’t say why you’re calling to anyone else who answers.
            </Notice>
          ) : null}

          <Card style={{ gap: 0, padding: 0 }}>
            <Contact icon="call-outline" label="Phone" value={p.phone} onPress={p.phone && p.contact_method !== 'none' ? () => callPhone(p.phone!) : undefined} />
            <Contact icon="mail-outline" label="Email" value={p.email} first={false} onPress={p.email && p.contact_method !== 'none' ? () => Linking.openURL(`mailto:${p.email}`) : undefined} />
          </Card>

          <View style={styles.stats}>
            <StatTile label="Open" value={String(p.open_cases)} />
            <StatTile label="All cases" value={String(p.cases.length)} />
            <StatTile label="First contact" value={timeAgo(p.first_contact_at)} />
          </View>
          <Text style={[type.caption, { color: theme.textSecondary }]}>
            {p.matched_by.length
              ? `Cases matched by ${p.matched_by.map((m) => MATCH_LABEL[m]).join(' and ')}. Check before sharing anything between them.`
              : 'No other cases found for this person.'}{' '}
            Last activity {dateTime(p.last_activity_at)}.
          </Text>

          <CaseGroup title={`Open · ${open.length}`} cases={open} />
          {past.length ? <CaseGroup title={`Past · ${past.length}`} cases={past} /> : null}
        </>
      )}
    </Page>
  );
}

function CaseGroup({ title, cases }: { title: string; cases: Person['cases'] }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.section, { color: theme.textSecondary }]}>{title}</Text>
      {cases.length ? (
        cases.map((c) => (
          <CaseLine
            key={c.id}
            item={c}
            color={priorityColor(theme, c.priority)}
            line={`${CATEGORY_LABEL[c.category]} · ${STATUS_LABEL[c.status]}`}
            sub={`Opened ${dateTime(c.created_at)}`}
          />
        ))
      ) : (
        <Text style={[type.subhead, { color: theme.textSecondary }]}>None.</Text>
      )}
    </View>
  );
}

function Contact({ icon, label, value, first = true, onPress }: { icon: 'call-outline' | 'mail-outline'; label: string; value: string | null | undefined; first?: boolean; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={value ? `${label}: ${value}` : `${label}: not given`}
      style={({ pressed }) => [styles.contact, !first && { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={icon} size={20} color={onPress ? theme.accent : theme.textTertiary} />
      <View style={{ flex: 1 }}>
        <Text style={[type.caption, { color: theme.textSecondary }]}>{label}</Text>
        <Text style={[type.subhead, { color: value ? theme.text : theme.textTertiary }]} selectable>
          {value ?? 'Not given'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  name: { fontSize: 26, fontWeight: '800' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stats: { flexDirection: 'row', gap: space.sm },
  section: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  contact: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
});
