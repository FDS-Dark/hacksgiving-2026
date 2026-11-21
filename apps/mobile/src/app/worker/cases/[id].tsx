import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { toApiError } from '@/api/client';
import {
  CASE_CATEGORIES,
  CASE_PRIORITIES,
  CASE_STATUSES,
  REFERRAL_STATUSES,
  type Case,
  type CaseUpdate,
  type Referral,
  type Visibility,
} from '@/api/types';
import { Page } from '@/components/Page';
import { Button, ErrorBanner, Field, Loading, Notice, success } from '@/components/ui';
import { ResourcePicker } from '@/components/worker/ResourcePicker';
import {
  Badge,
  CATEGORY_ICON,
  CATEGORY_LABEL,
  Card,
  CardTitle,
  ChoiceRow,
  Detail,
  PRIORITY_LABEL,
  PriorityBadge,
  REFERRAL_LABEL,
  STATUS_LABEL,
  SampleBadge,
  StatusBadge,
  dateTime,
  priorityColor,
  referralColor,
  statusColor,
  timeAgo,
} from '@/components/worker/kit';
import {
  useAddCaseUpdate,
  useCase,
  useCaseAssist,
  useStaffStatus,
  useUpdateCase,
  useUpdateReferral,
  useWorkers,
} from '@/services/cases';
import { space, type, useTheme } from '@/theme/tokens';

const UNASSIGNED = '__none';

export default function CaseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const detail = useCase(id);
  const [message, setMessage] = useState<{ text: string; visibility: Visibility } | null>(null);

  if (detail.isPending) return <Loading label="Loading the case" />;
  if (detail.error) {
    return (
      <Page>
        <BackLink />
        <ErrorBanner error={detail.error} onRetry={() => detail.refetch()} />
      </Page>
    );
  }
  const { case: c, updates, referrals } = detail.data;

  return (
    <Page refreshing={detail.isRefetching} onRefresh={() => detail.refetch()} contentStyle={{ gap: space.lg }}>
      <BackLink />
      <CaseHeader item={c} />
      <View style={[styles.columns, wide && { flexDirection: 'row' }]}>
        <View style={[styles.column, wide && { flex: 1.7 }]}>
          <DetailsCard item={c} />
          <AssistCard item={c} onUseDraft={(text) => setMessage({ text, visibility: 'public' })} />
          <ActivityCard item={c} updates={updates} draft={message} />
        </View>
        <View style={[styles.column, wide && { flex: 1 }]}>
          <ManageCard item={c} />
          <ReferralsCard item={c} referrals={referrals} />
        </View>
      </View>
    </Page>
  );
}

function BackLink() {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.navigate('/worker/cases'))}
      accessibilityRole="link"
      style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name="arrow-back" size={16} color={theme.accent} />
      <Text style={[type.subhead, { color: theme.accent, fontWeight: '600' }]}>Cases</Text>
    </Pressable>
  );
}

function CaseHeader({ item: c }: { item: Case }) {
  const theme = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.footnote, { color: theme.textSecondary, fontWeight: '700' }]}>
        CASE #{c.number} · {c.kind === 'incident' ? 'INCIDENT' : 'REQUEST'} · {c.source === 'public' ? 'FROM THE COMMUNITY APP' : 'OPENED BY STAFF'}
      </Text>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]} selectable>
        {c.title}
      </Text>
      <View style={styles.badges}>
        <PriorityBadge priority={c.priority} />
        <StatusBadge status={c.status} />
        <Badge label={CATEGORY_LABEL[c.category]} color={theme.accent} icon={CATEGORY_ICON[c.category]} />
        <Text style={[type.footnote, { color: theme.textSecondary }]}>
          Opened {timeAgo(c.created_at)} · {c.assigned_worker_name ? `Assigned to ${c.assigned_worker_name}` : 'Unassigned'}
        </Text>
      </View>
    </View>
  );
}

function DetailsCard({ item: c }: { item: Case }) {
  const theme = useTheme();
  const contact = [c.contact_name, c.contact_phone, c.contact_email].filter(Boolean);
  return (
    <Card>
      <CardTitle title="Details" icon="document-text-outline" />
      <Text style={[type.body, { color: c.description ? theme.text : theme.textTertiary }]} selectable>
        {c.description || 'No description.'}
      </Text>
      <View style={styles.details}>
        <Detail label="Location">{c.location ?? 'Not given'}</Detail>
        <Detail label="Opened">{dateTime(c.created_at)}</Detail>
        <Detail label="Last update">{dateTime(c.updated_at)}</Detail>
        {c.resolved_at ? <Detail label="Resolved">{dateTime(c.resolved_at)}</Detail> : null}
      </View>
      <View style={[styles.contact, { backgroundColor: theme.fill }]}>
        <Ionicons name="lock-closed-outline" size={16} color={theme.textSecondary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.caption, { color: theme.textSecondary, fontWeight: '700' }]}>CONTACT · STAFF ONLY</Text>
          <Text style={[type.subhead, { color: contact.length ? theme.text : theme.textTertiary }]} selectable>
            {contact.length ? contact.join(' · ') : 'No contact details shared'}
          </Text>
        </View>
      </View>
    </Card>
  );
}

/** Triage: status, priority, category and who holds the case. Each change saves at once and goes in the history. */
function ManageCard({ item: c }: { item: Case }) {
  const theme = useTheme();
  const me = useStaffStatus();
  const workers = useWorkers();
  const update = useUpdateCase(c.id);
  const busy = update.isPending;

  const workerOptions = [UNASSIGNED, ...(workers.data ?? []).map((w) => w.id)];
  const workerLabels: Record<string, string> = {
    [UNASSIGNED]: 'Unassigned',
    ...Object.fromEntries((workers.data ?? []).map((w) => [w.id, `${w.id === me.data?.id ? 'Me' : (w.display_name ?? 'Unnamed')} (${w.open_cases})`])),
  };
  const closed = c.status === 'resolved' || c.status === 'closed';

  return (
    <Card>
      <CardTitle title="Manage" icon="options-outline" right={busy ? <Text style={[type.caption, { color: theme.textSecondary }]}>Saving…</Text> : null} />
      <View style={styles.quick}>
        {me.data && c.assigned_worker_id !== me.data.id ? (
          <Button label="Assign to me" icon="hand-right-outline" variant="tinted" disabled={busy}
            onPress={() => update.mutate({ assigned_worker_id: me.data.id, ...(c.status === 'new' ? { status: 'in_progress' } : {}) })} />
        ) : null}
        {closed ? (
          <Button label="Reopen" icon="refresh" variant="tinted" disabled={busy} onPress={() => update.mutate({ status: 'in_progress' })} />
        ) : (
          <Button label="Mark resolved" icon="checkmark-done" disabled={busy} onPress={() => update.mutate({ status: 'resolved' }, { onSuccess: () => success() })} />
        )}
      </View>
      <ChoiceRow label="Status" options={CASE_STATUSES} labels={STATUS_LABEL} value={c.status} disabled={busy}
        onChange={(s) => s && s !== c.status && update.mutate({ status: s })} colorOf={(s) => statusColor(theme, s)} />
      <ChoiceRow label="Priority" options={CASE_PRIORITIES} labels={PRIORITY_LABEL} value={c.priority} disabled={busy}
        onChange={(p) => p && p !== c.priority && update.mutate({ priority: p })} colorOf={(p) => priorityColor(theme, p)} />
      <ChoiceRow label="Category" options={CASE_CATEGORIES} labels={CATEGORY_LABEL} value={c.category} disabled={busy}
        onChange={(v) => v && v !== c.category && update.mutate({ category: v })} />
      <ChoiceRow label="Assigned to" options={workerOptions} labels={workerLabels} value={c.assigned_worker_id ?? UNASSIGNED} disabled={busy}
        onChange={(w) => {
          const next = !w || w === UNASSIGNED ? null : w;
          if (next !== (c.assigned_worker_id ?? null)) update.mutate({ assigned_worker_id: next });
        }} />
      {update.error ? <ErrorBanner error={update.error} /> : null}
    </Card>
  );
}

function ReferralsCard({ item: c, referrals }: { item: Case; referrals: Referral[] }) {
  const theme = useTheme();
  const [picking, setPicking] = useState(false);
  const open = referrals.filter((r) => r.status !== 'completed' && r.status !== 'declined').length;
  return (
    <Card>
      <CardTitle title="Resources & referrals" icon="link-outline" right={<Button label="Add" icon="add" variant="plain" onPress={() => setPicking(true)} />} />
      {referrals.length ? (
        <>
          <Text style={[type.footnote, { color: theme.textSecondary }]}>
            {open ? `${open} referral${open === 1 ? '' : 's'} still in progress.` : 'Every referral has an outcome.'}
          </Text>
          {referrals.map((r) => <ReferralItem key={r.id} caseId={c.id} referral={r} />)}
        </>
      ) : (
        <View style={{ gap: space.sm }}>
          <Text style={[type.subhead, { color: theme.textSecondary }]}>No resources connected yet.</Text>
          <Button label="Find a resource" icon="search" variant="tinted" onPress={() => setPicking(true)} />
        </View>
      )}
      <ResourcePicker visible={picking} onClose={() => setPicking(false)} item={c} referred={referrals.map((r) => r.resource_id)} />
    </Card>
  );
}

function ReferralItem({ caseId, referral: r }: { caseId: string; referral: Referral }) {
  const theme = useTheme();
  const update = useUpdateReferral(caseId);
  const [outcome, setOutcome] = useState('');
  return (
    <View style={[styles.referral, { borderColor: theme.separator }]}>
      <View style={styles.badges}>
        <Ionicons name={CATEGORY_ICON[r.resource_category]} size={16} color={theme.accent} />
        <Text style={[type.subhead, { color: theme.text, fontWeight: '700', flexShrink: 1 }]}>{r.resource_name}</Text>
        {r.resource_is_sample ? <SampleBadge /> : null}
      </View>
      {r.resource_phone ? <Text style={[type.footnote, { color: theme.textSecondary }]} selectable>{r.resource_phone}</Text> : null}
      <ChoiceRow options={REFERRAL_STATUSES} labels={REFERRAL_LABEL} value={r.status} disabled={update.isPending}
        colorOf={(s) => referralColor(theme, s)}
        onChange={(s) => s && s !== r.status && update.mutate({ referralId: r.id, body: { status: s } })} />
      {r.outcome ? (
        <Text style={[type.footnote, { color: theme.text }]}>
          <Text style={{ fontWeight: '700' }}>Outcome: </Text>
          {r.outcome}
        </Text>
      ) : null}
      <View style={styles.inlineField}>
        <View style={{ flex: 1 }}>
          <Field placeholder={r.outcome ? 'Update the outcome' : 'Record the outcome'} value={outcome} onChangeText={setOutcome} maxLength={2000} />
        </View>
        <Button label="Save" variant="tinted" disabled={!outcome.trim()} loading={update.isPending}
          onPress={() => update.mutate({ referralId: r.id, body: { outcome: outcome.trim() } }, { onSuccess: () => setOutcome('') })} />
      </View>
      {update.error ? <ErrorBanner error={update.error} /> : null}
    </View>
  );
}

const UPDATE_ICON: Record<CaseUpdate['update_type'], keyof typeof Ionicons.glyphMap> = {
  created: 'add-circle',
  note: 'document-text',
  message: 'chatbubble-ellipses',
  status_change: 'swap-horizontal',
  priority_change: 'flag',
  category_change: 'pricetag',
  assignment: 'person',
  referral: 'link',
};

function ActivityCard({
  item: c,
  updates,
  draft,
}: {
  item: Case;
  updates: CaseUpdate[];
  draft: { text: string; visibility: Visibility } | null;
}) {
  const theme = useTheme();
  const add = useAddCaseUpdate(c.id);
  const canMessage = !!c.requester_id;
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('internal');
  const [shownDraft, setShownDraft] = useState<typeof draft>(null);
  const [filter, setFilter] = useState<'all' | 'notes'>('all');

  // A draft from the assistant fills the composer once; the worker edits and sends it.
  if (draft && draft !== shownDraft) {
    setShownDraft(draft);
    setText(draft.text);
    setVisibility(canMessage ? draft.visibility : 'internal');
  }

  const shown = [...updates].reverse().filter((u) => filter === 'all' || u.update_type === 'note' || u.update_type === 'message');

  return (
    <Card>
      <CardTitle
        title="Activity"
        icon="chatbubbles-outline"
        right={<ChoiceRow options={['all', 'notes'] as const} labels={{ all: 'Everything', notes: 'Notes & messages' }} value={filter} onChange={(f) => f && setFilter(f)} />}
      />

      <View style={[styles.composer, { borderColor: visibility === 'public' ? theme.accent : theme.separator }]}>
        {canMessage ? (
          <ChoiceRow options={['internal', 'public'] as const} labels={{ internal: 'Internal note', public: 'Message to requester' }} value={visibility}
            onChange={(v) => v && setVisibility(v)} />
        ) : null}
        <Field
          placeholder={visibility === 'public' ? 'The requester will see this on their request' : 'Only ComForce staff see notes'}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={4000}
          style={styles.multiline}
          accessibilityLabel={visibility === 'public' ? 'Message to the requester' : 'Internal note'}
        />
        <View style={styles.composerActions}>
          <Text style={[type.caption, { color: visibility === 'public' ? theme.accent : theme.textSecondary, flex: 1 }]}>
            {visibility === 'public' ? 'Visible to the person who asked for help.' : 'Internal: never shown to the requester.'}
          </Text>
          <Button
            label={visibility === 'public' ? 'Send message' : 'Add note'}
            icon={visibility === 'public' ? 'send' : 'add'}
            disabled={!text.trim()}
            loading={add.isPending}
            onPress={() => add.mutate({ content: text.trim(), visibility }, { onSuccess: () => { setText(''); setVisibility('internal'); success(); } })}
          />
        </View>
        {add.error ? <ErrorBanner error={add.error} /> : null}
      </View>

      <View>
        {shown.map((u, i) => (
          <View key={u.id} style={styles.event}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: u.visibility === 'public' ? theme.accent : theme.fill, borderColor: theme.accent }]}>
                <Ionicons name={UPDATE_ICON[u.update_type]} size={12} color={u.visibility === 'public' ? theme.onAccent : theme.accent} />
              </View>
              {i < shown.length - 1 ? <View style={[styles.line, { backgroundColor: theme.separator }]} /> : null}
            </View>
            <View style={[styles.eventBody, (u.update_type === 'note' || u.update_type === 'message') && { backgroundColor: theme.fill, padding: space.md, borderRadius: 8 }]}>
              <Text style={[type.subhead, { color: theme.text }]} selectable>{u.content}</Text>
              <Text style={[type.caption, { color: theme.textSecondary }]}>
                {u.author_name ?? 'System'} · {dateTime(u.created_at)}
                {u.visibility === 'public' ? ' · visible to requester' : ''}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** On-demand AI help. Suggestions only: the worker reads, edits and decides. */
function AssistCard({ item: c, onUseDraft }: { item: Case; onUseDraft: (text: string) => void }) {
  const theme = useTheme();
  const assist = useCaseAssist(c.id);
  const unavailable = [assist.summary.error, assist.draft.error].some((e) => e && toApiError(e).status === 503);

  return (
    <Card>
      <CardTitle title="Assistant" icon="sparkles-outline" />
      <View style={styles.quick}>
        <Button label="Summarize case" icon="reader-outline" variant="tinted" loading={assist.summary.isPending} onPress={() => assist.summary.mutate()} />
        {c.requester_id ? (
          <Button label="Draft update to requester" icon="create-outline" variant="tinted" loading={assist.draft.isPending}
            onPress={() => assist.draft.mutate(undefined, { onSuccess: (d) => onUseDraft(d.message) })} />
        ) : null}
      </View>
      {unavailable ? (
        <Notice icon="cloud-offline-outline">AI assistance isn’t configured on this server. Everything else works without it.</Notice>
      ) : null}
      {assist.summary.data ? (
        <View style={[styles.summary, { backgroundColor: theme.accentSoft }]}>
          <Text style={[type.subhead, { color: theme.text }]} selectable>{assist.summary.data.summary}</Text>
          {assist.summary.data.next_steps.length ? (
            <View style={{ gap: 4 }}>
              <Text style={[type.caption, { color: theme.textSecondary, fontWeight: '700' }]}>SUGGESTED NEXT STEPS</Text>
              {assist.summary.data.next_steps.map((s) => (
                <Text key={s} style={[type.footnote, { color: theme.text }]}>• {s}</Text>
              ))}
            </View>
          ) : null}
          <Text style={[type.caption, { color: theme.textSecondary }]}>AI-generated from this case’s record. Check it before relying on it.</Text>
        </View>
      ) : null}
      {assist.draft.isSuccess ? (
        <Text style={[type.caption, { color: theme.textSecondary }]}>Draft placed in the message box below. Edit it, then send; nothing is sent automatically.</Text>
      ) : null}
      {[assist.summary.error, assist.draft.error].map((e, i) => (e && !unavailable ? <ErrorBanner key={i} error={e} /> : null))}
    </Card>
  );
}

const styles = StyleSheet.create({
  columns: { gap: space.lg, alignItems: 'flex-start' },
  column: { gap: space.lg, width: '100%', minWidth: 0 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '800' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  details: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  contact: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: 8 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  referral: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.md, gap: space.sm },
  inlineField: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  composer: { borderWidth: 1, borderRadius: 10, padding: space.md, gap: space.sm },
  composerActions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  multiline: { minHeight: 80, textAlignVertical: 'top', paddingTop: space.sm },
  event: { flexDirection: 'row', gap: space.md },
  rail: { alignItems: 'center', width: 24 },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  line: { width: 2, flex: 1, minHeight: 12 },
  eventBody: { flex: 1, gap: 2, paddingBottom: space.md },
  summary: { borderRadius: 8, padding: space.md, gap: space.sm },
});
