import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { BackLink } from '@/components/admin/BackLink';
import { RequestForm } from '@/components/admin/RequestForm';
import { ConfidentialBadge, OverdueBadge, PriorityBadge, StatusBadge, priorityColors } from '@/components/admin/requestBits';
import { Page } from '@/components/Page';
import { SectionHeading } from '@/components/brand';
import { Button, Chip, Chips, EmptyState, Field, Notice, Txt, success } from '@/components/ui';
import { useAdmin } from '@/lib/admin';
import { CURRENT_USER } from '@/lib/directory';
import { ago, emptyRequest, followUpDue, isOpen, isOverdue, queueOrder, type AssistRequest } from '@/lib/requests';
import { radius, space, useTheme } from '@/theme/tokens';

type Filter = 'open' | 'overdue' | 'unassigned' | 'mine' | 'urgent' | 'followup' | 'referred' | 'done' | 'all';

const FILTERS: { key: Filter; label: string; test: (r: AssistRequest) => boolean }[] = [
  { key: 'open', label: 'Open', test: isOpen },
  { key: 'overdue', label: 'Overdue', test: (r) => isOverdue(r) },
  { key: 'unassigned', label: 'Unassigned', test: (r) => isOpen(r) && !r.assignee },
  { key: 'mine', label: 'Mine', test: (r) => isOpen(r) && r.assignee === CURRENT_USER },
  { key: 'urgent', label: 'Urgent', test: (r) => isOpen(r) && r.priority === 'urgent' },
  { key: 'followup', label: 'Follow-up due', test: followUpDue },
  { key: 'referred', label: 'Referred', test: (r) => r.status === 'referred' },
  { key: 'done', label: 'Resolved & closed', test: (r) => !isOpen(r) },
  { key: 'all', label: 'All', test: () => true },
];

/** The queue of requests for assistance, and intake for a new one. */
export default function RequestsScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { requests, saveRequest } = useAdmin();
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');
  const [intake, setIntake] = useState<AssistRequest | null>(null);

  if (intake) {
    return (
      <Page contentStyle={{ maxWidth: 820 }}>
        <SectionHeading title="Log a Request" kicker="For calls, texts, walk-ins, and partner referrals." />
        <RequestForm
          key={intake.id}
          initial={intake}
          by={CURRENT_USER}
          onCancel={() => setIntake(null)}
          onSave={(r) => {
            success();
            saveRequest(r);
            setIntake(null);
            router.navigate({ pathname: '/admin/requests/[id]', params: { id: r.id } });
          }}
        />
      </Page>
    );
  }

  const q = query.trim().toLowerCase();
  const test = FILTERS.find((f) => f.key === filter)!.test;
  const shown = requests
    .filter(test)
    .filter((r) => !q || [r.ref, r.name, r.summary, r.neighborhood, r.assignee ?? '', ...r.needs].join(' ').toLowerCase().includes(q))
    .sort(queueOrder);

  const open = requests.filter(isOpen);
  const tiles: { label: string; value: number; filter: Filter; alert?: boolean }[] = [
    { label: 'Open', value: open.length, filter: 'open' },
    { label: 'Unassigned', value: open.filter((r) => !r.assignee).length, filter: 'unassigned' },
    { label: 'Overdue', value: open.filter((r) => isOverdue(r)).length, filter: 'overdue', alert: true },
    { label: 'Follow-ups due', value: requests.filter(followUpDue).length, filter: 'followup' },
  ];

  return (
    <Page contentStyle={{ maxWidth: 900 }}>
      <BackLink label="Admin" href="/admin" />
      <SectionHeading title="Assistance Requests" kicker="Triage, assign, refer, and follow up until every need is met." />

      <Notice icon="construct-outline" tone="warning">
        Sample requests, kept on this device. Confidential requests are for ComForce staff only.
      </Notice>

      <View style={styles.tiles}>
        {tiles.map((t) => (
          <View key={t.label} style={{ width: width >= 700 ? '25%' : '50%', padding: space.xs }}>
            <Pressable
              onPress={() => setFilter(t.filter)}
              accessibilityRole="button"
              accessibilityLabel={`${t.label}: ${t.value}`}
              style={({ pressed }) => [
                styles.tile,
                { backgroundColor: theme.surface, borderColor: t.alert && t.value ? theme.danger : theme.separator },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.tileValue, { color: t.alert && t.value ? theme.danger : theme.text }]}>{t.value}</Text>
              <Text style={[styles.tileLabel, { color: theme.textSecondary }]}>{t.label}</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <View style={styles.toolbar}>
        <View style={{ flexGrow: 1, flexBasis: 240 }}>
          <Field icon="search" placeholder="Search name, ref, need, neighborhood" value={query} onChangeText={setQuery} autoCapitalize="none" />
        </View>
        <Button label="Log a request" icon="add-circle-outline" onPress={() => setIntake(emptyRequest(CURRENT_USER))} />
      </View>

      <Chips scroll>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} count={requests.filter(f.test).length} active={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </Chips>

      {shown.length ? (
        <View style={{ gap: space.sm }}>
          {shown.map((r) => (
            <RequestRow key={r.id} request={r} />
          ))}
        </View>
      ) : (
        <EmptyState icon="checkmark-done-outline" title="Nothing here" body={q ? 'No requests match your search.' : 'No requests in this view.'} />
      )}
    </Page>
  );
}

function RequestRow({ request: r }: { request: AssistRequest }) {
  const theme = useTheme();
  const overdue = isOverdue(r);
  const due = followUpDue(r);
  return (
    <Pressable
      onPress={() => router.navigate({ pathname: '/admin/requests/[id]', params: { id: r.id } })}
      accessibilityRole="link"
      accessibilityLabel={`${r.ref}, ${r.summary}, ${r.priority} priority${overdue ? ', overdue' : ''}`}
      style={({ pressed }) => [styles.row, { backgroundColor: theme.surface, borderColor: theme.separator }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.stripe, { backgroundColor: priorityColors(theme, r.priority).fg }]} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={styles.badges}>
          <Text style={[styles.ref, { color: theme.textSecondary }]}>{r.ref}</Text>
          <PriorityBadge priority={r.priority} />
          <StatusBadge status={r.status} />
          {overdue ? <OverdueBadge /> : null}
          {r.confidential ? <ConfidentialBadge /> : null}
        </View>
        <Txt variant="headline" numberOfLines={2}>
          {r.summary}
        </Txt>
        <Txt variant="footnote" tone="secondary" numberOfLines={2}>
          {[r.name, r.needs.join(', '), r.neighborhood].filter(Boolean).join(' · ')}
        </Txt>
        <View style={styles.meta}>
          <Meta icon="time-outline" text={ago(r.createdAt)} />
          <Meta icon="person-outline" text={r.assignee ?? 'Unassigned'} warn={!r.assignee && isOpen(r)} />
          {r.referral ? <Meta icon="git-network-outline" text={r.referral.partner} /> : null}
          {due ? <Meta icon="alarm-outline" text="Follow-up due" warn /> : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
    </Pressable>
  );
}

function Meta({ icon, text, warn }: { icon: 'time-outline' | 'person-outline' | 'git-network-outline' | 'alarm-outline'; text: string; warn?: boolean }) {
  const theme = useTheme();
  const color = warn ? theme.soon : theme.textSecondary;
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={13} color={color} />
      <Text style={[styles.metaText, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', margin: -space.xs },
  tile: { padding: space.lg, borderWidth: 1, borderRadius: radius.md, gap: 2 },
  tileValue: { fontSize: 28, fontWeight: '900' },
  tileLabel: { fontSize: 14, fontWeight: '700' },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, paddingLeft: space.lg + 4, borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  ref: { fontSize: 13, fontWeight: '800' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13 },
});
