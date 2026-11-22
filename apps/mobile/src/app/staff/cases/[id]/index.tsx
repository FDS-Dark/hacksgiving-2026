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
import { Badge, Card, ConfirmSheet, PriorityBadge, StatusBadge } from '@/components/staff/kit';
import { Button, ErrorBanner, success } from '@/components/ui';
import { CATEGORY_ICON, CATEGORY_LABEL, canMessageResident } from '@/lib/cases';
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
          {/* Say before tapping whether anyone outside staff will read it (review S1). */}
          <Button
            label={canMessageResident(c) ? 'Message resident' : 'Internal note'}
            icon={canMessageResident(c) ? 'send' : 'document-text-outline'}
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
        Case #{c.number}
        {c.kind === 'incident' ? ' · Incident' : ''}
      </Text>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]} selectable>
        {c.title}
      </Text>
      <View style={styles.badges}>
        <StatusBadge status={c.status} />
        <PriorityBadge priority={c.priority} />
        <Badge label={CATEGORY_LABEL[c.category]} color={theme.accent} icon={CATEGORY_ICON[c.category]} />
        {/* Where it came from: "Resident request" is only ever this badge; everywhere else it's a case. */}
        {c.source === 'public' ? <Badge label="Resident request" color={theme.textSecondary} icon="phone-portrait-outline" /> : null}
      </View>
      <Text style={[type.footnote, { color: theme.textSecondary }]}>
        {c.source === 'public' ? 'Opened' : 'Opened by staff'} {timeAgo(c.created_at)} · {c.assigned_worker_name ? `Assigned to ${c.assigned_worker_name}` : 'No worker assigned'}
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
  const reach = [c.contact_phone, c.contact_email].filter(Boolean).length ? null : 'No phone or email on the case';
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
  const [resolving, setResolving] = useState(false);
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
        <Button label="Mark resolved" icon="checkmark-done" variant="plain" disabled={update.isPending} onPress={() => setResolving(true)} />
      )}
      {update.error ? <ErrorBanner error={update.error} /> : null}
      <ConfirmSheet
        visible={resolving}
        title={`Mark case #${c.number} resolved?`}
        body={`It leaves the open queue${canMessageResident(c) ? ' and the resident sees it as resolved' : ''}. You can reopen it later.`}
        confirmLabel="Mark resolved"
        loading={update.isPending}
        onConfirm={() =>
          update.mutate(
            { status: 'resolved' },
            {
              onSuccess: () => {
                setResolving(false);
                success();
              },
              onError: () => setResolving(false),
            },
          )
        }
        onCancel={() => setResolving(false)}
      />
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
  kicker: { fontSize: 13, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '800' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  actions: { flexDirection: 'row', gap: space.sm },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: -space.sm },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
