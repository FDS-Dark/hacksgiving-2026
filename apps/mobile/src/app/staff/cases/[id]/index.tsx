import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Case } from '@/api/types';
import { Avatar } from '@/components/Avatar';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { Segmented } from '@/components/Segmented';
import { ServiceGuide } from '@/components/ServiceGuide';
import { CardSkeleton, CaseListSkeleton } from '@/components/Skeleton';
import { CaseAssist } from '@/components/staff/case/CaseAssist';
import { CaseAttachments } from '@/components/staff/case/CaseAttachments';
import { CaseHistory } from '@/components/staff/case/CaseHistory';
import { CaseReferrals } from '@/components/staff/case/CaseReferrals';
import { CaseShares } from '@/components/staff/case/CaseShares';
import { CaseTasks } from '@/components/staff/case/CaseTasks';
import { UpdateCaseSheet } from '@/components/staff/case/UpdateCaseSheet';
import { Badge, Card, PriorityBadge, StatusBadge } from '@/components/staff/kit';
import { Button, ErrorBanner, success } from '@/components/ui';
import { CATEGORY_ICON, CATEGORY_LABEL } from '@/lib/cases';
import { dateTime, timeAgo } from '@/lib/format';
import { callPhone } from '@/lib/phone';
import { useCase, useUpdateCase } from '@/services/cases';
import { useMarkCaseRead } from '@/services/notifications';
import { useStaffStatus } from '@/services/staff';
import { space, type, useTheme } from '@/theme/tokens';

type Tab = 'tasks' | 'history' | 'referrals' | 'files' | 'guide';

/**
 * Figma S3 "Case": status and owner at the top, the next actions as
 * buttons (Update opens S4, Message opens S5), then tasks, the full
 * history, referrals, and the service's handling guide.
 */
export default function CaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useCase(id);
  const [tab, setTab] = useState<Tab>('tasks');
  const [updating, setUpdating] = useState(false);
  // Opening a case clears its notifications; again when a refetch brings new updates.
  useMarkCaseRead(id, !!detail.data, detail.data?.updates.length);

  if (detail.isPending) {
    return (
      <Page contentStyle={{ maxWidth: 720, gap: space.lg }}>
        <BackLink to="/staff/cases" label="Queue" />
        <CardSkeleton lines={2} />
        <CaseListSkeleton rows={3} />
      </Page>
    );
  }
  if (detail.error) {
    return (
      <Page contentStyle={{ maxWidth: 720 }}>
        <BackLink to="/staff/cases" label="Queue" />
        <ErrorBanner error={detail.error} onRetry={() => detail.refetch()} />
      </Page>
    );
  }
  const { case: c, updates, referrals, tasks } = detail.data;
  const taskCount = tasks.filter((t) => t.status === 'open').length;

  return (
    <Page refreshing={detail.isRefetching} onRefresh={() => detail.refetch()} contentStyle={{ maxWidth: 720, gap: space.lg }}>
      <BackLink to="/staff/cases" label="Queue" />
      <Header item={c} />
      <Person item={c} />

      <View style={styles.actions}>
        <View style={{ flex: 1 }}>
          <Button label="Update" icon="create-outline" variant="tinted" onPress={() => setUpdating(true)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Message"
            icon="send"
            onPress={() => router.push({ pathname: '/staff/cases/[id]/messages', params: { id: c.id } })}
          />
        </View>
      </View>
      <QuickActions item={c} />

      <Segmented
        label="Case sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'tasks', label: taskCount ? `Tasks ${taskCount}` : 'Tasks' },
          { value: 'history', label: 'History' },
          { value: 'referrals', label: referrals.length ? `Referrals ${referrals.length}` : 'Referrals' },
          { value: 'files', label: 'Files' },
          { value: 'guide', label: 'Guide' },
        ]}
      />

      {tab === 'tasks' ? <CaseTasks caseId={c.id} tasks={tasks} /> : null}
      {tab === 'history' ? <CaseHistory updates={updates} /> : null}
      {tab === 'referrals' ? <CaseReferrals item={c} referrals={referrals} /> : null}
      {tab === 'referrals' ? <CaseShares item={c} /> : null}
      {tab === 'files' ? <CaseAttachments caseId={c.id} /> : null}
      {tab === 'guide' ? (
        <View style={{ gap: space.md }}>
          {/* Re-routing the case to another service swaps in that service's guide. */}
          <ServiceGuide key={c.category} category={c.category} initiallyOpen />
          <CaseAssist item={c} />
        </View>
      ) : null}

      <UpdateCaseSheet item={c} visible={updating} onClose={() => setUpdating(false)} />
    </Page>
  );
}

function Header({ item: c }: { item: Case }) {
  const theme = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[styles.kicker, { color: theme.textSecondary }]}>
        CASE #{c.number} · {c.kind === 'incident' ? 'INCIDENT' : 'REQUEST'} · {c.source === 'public' ? 'FROM THE APP' : 'OPENED BY STAFF'}
      </Text>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]} selectable>
        {c.title}
      </Text>
      <View style={styles.badges}>
        <StatusBadge status={c.status} />
        <PriorityBadge priority={c.priority} />
        <Badge label={CATEGORY_LABEL[c.category]} color={theme.accent} icon={CATEGORY_ICON[c.category]} />
      </View>
      <Text style={[type.footnote, { color: theme.textSecondary }]}>
        Opened {timeAgo(c.created_at)} · {c.assigned_worker_name ? `Assigned to ${c.assigned_worker_name}` : 'Unassigned'}
      </Text>
      {c.description ? (
        <Text style={[type.body, { color: theme.text }]} selectable>
          {c.description}
        </Text>
      ) : null}
    </View>
  );
}

/** Who asked, how to reach them (staff only), and where. */
function Person({ item: c }: { item: Case }) {
  const theme = useTheme();
  const reach = [c.contact_phone, c.contact_email].filter(Boolean).length ? null : 'No contact details shared';
  return (
    <Card style={styles.person}>
      {/* The person page: their contact details and every case that looks like them. */}
      <Pressable
        onPress={() => router.push({ pathname: '/staff/cases/[id]/person', params: { id: c.id } })}
        accessibilityRole="button"
        accessibilityLabel={`${c.contact_name ?? 'This person'}: see all their cases`}
        style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md }, pressed && { opacity: 0.7 }]}
      >
      <Avatar name={c.contact_name ?? '?'} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.subhead, { color: theme.text, fontWeight: '700' }]}>{c.contact_name ?? 'Name not given'}</Text>
        {c.location ? (
          <Text style={[type.caption, { color: theme.textSecondary }]} numberOfLines={2}>
            {c.location}
          </Text>
        ) : null}
        {reach ? <Text style={[type.caption, { color: theme.textTertiary }]}>{reach}</Text> : null}
        {c.resolved_at ? <Text style={[type.caption, { color: theme.textSecondary }]}>Resolved {dateTime(c.resolved_at)}</Text> : null}
        <Text style={[type.caption, { color: theme.accent, fontWeight: '600' }]}>All their cases ›</Text>
      </View>
      </Pressable>
      {c.contact_phone ? <IconButton icon="call-outline" label={`Call ${c.contact_phone}`} onPress={() => callPhone(c.contact_phone!)} /> : null}
      {c.contact_email ? <IconButton icon="mail-outline" label={`Email ${c.contact_email}`} onPress={() => Linking.openURL(`mailto:${c.contact_email}`)} /> : null}
    </Card>
  );
}

/** One-tap moves that don't need the sheet: take the case, or close or reopen it. */
function QuickActions({ item: c }: { item: Case }) {
  const me = useStaffStatus();
  const update = useUpdateCase(c.id);
  const closed = c.status === 'resolved' || c.status === 'closed';
  const mine = !!me.data && c.assigned_worker_id === me.data.id;
  return (
    <View style={styles.quick}>
      {me.data && !mine && !closed ? (
        <Button
          label="Assign to me"
          icon="hand-right-outline"
          variant="plain"
          disabled={update.isPending}
          onPress={() => update.mutate({ assigned_worker_id: me.data.id, ...(c.status === 'new' ? { status: 'in_progress' } : {}) })}
        />
      ) : null}
      {closed ? (
        <Button label="Reopen" icon="refresh" variant="plain" disabled={update.isPending} onPress={() => update.mutate({ status: 'in_progress' })} />
      ) : (
        <Button label="Mark resolved" icon="checkmark-done" variant="plain" disabled={update.isPending} onPress={() => update.mutate({ status: 'resolved' }, { onSuccess: () => success() })} />
      )}
      {update.error ? <ErrorBanner error={update.error} /> : null}
    </View>
  );
}

function IconButton({ icon, label, onPress }: { icon: 'call-outline' | 'mail-outline'; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.icon, { backgroundColor: theme.fill }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={icon} size={18} color={theme.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '800' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  actions: { flexDirection: 'row', gap: space.sm },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: -space.sm },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
