import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';

import { CASE_CATEGORIES, CASE_PRIORITIES, CASE_STATUSES, type CaseDetail, type CaseUpdate, type Visibility } from '@/api/types';
import { Page } from '@/components/Page';
import { StaffGate } from '@/components/StaffGate';
import { RedRule } from '@/components/brand';
import { Button, Chip, Chips, ErrorBanner, FieldLabel, Loading, success } from '@/components/ui';
import { PRIORITY_INFO, SERVICE_INFO, STAFF_STATUS_LABEL, formatWhen } from '@/lib/requests';
import { useAddCaseUpdate, useCase, useStaffStatus, useUpdateCase } from '@/services/cases';
import { radius, space, useTheme } from '@/theme/tokens';

/** One case for ComForce staff: triage it, take it, and talk to the requester. */
export default function WorkerCaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Page contentStyle={{ maxWidth: 900 }}>
      <Button label="Back to the queue" variant="plain" icon="chevron-back" onPress={() => router.navigate('/worker')} style={{ alignSelf: 'flex-start' }} />
      <StaffGate>
        <CaseView id={id} />
      </StaffGate>
    </Page>
  );
}

function CaseView({ id }: { id: string }) {
  const detail = useCase(id);
  if (detail.isPending) return <Loading label="Loading case" />;
  if (detail.isError) return <ErrorBanner error={detail.error} onRetry={() => detail.refetch()} />;
  return <CaseBody id={id} data={detail.data} />;
}

function CaseBody({ id, data: { case: item, updates } }: { id: string; data: CaseDetail }) {
  const theme = useTheme();
  const me = useStaffStatus();
  const update = useUpdateCase(id);
  const service = SERVICE_INFO[item.category];
  const mine = me.data?.id === item.assigned_worker_id;

  return (
    <>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator, boxShadow: theme.shadow }]}>
        <View style={styles.headRow}>
          <Ionicons name={service.icon} size={22} color={theme.accent} />
          <Text style={[styles.kicker, { color: theme.accent }]}>{service.label}</Text>
          <Text style={[styles.kicker, { color: theme.textTertiary, marginLeft: 'auto' }]}>Case #{item.number}</Text>
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {item.title}
        </Text>
        <RedRule />
        <Text style={[styles.body, { color: theme.text }]} selectable>
          {item.description || 'No description.'}
        </Text>

        <View style={styles.facts}>
          <Fact icon="time-outline" label="Received" value={formatWhen(item.created_at)} />
          <Fact icon="person-outline" label="Contact" value={item.contact_name ?? 'Not given'} />
          {item.contact_phone ? (
            <Fact icon="call-outline" label="Phone" value={item.contact_phone} onPress={() => Linking.openURL(`tel:${item.contact_phone}`)} />
          ) : null}
          {item.contact_email ? (
            <Fact icon="mail-outline" label="Email" value={item.contact_email} onPress={() => Linking.openURL(`mailto:${item.contact_email}`)} />
          ) : null}
          {item.location ? <Fact icon="location-outline" label="Location" value={item.location} /> : null}
          <Fact
            icon="people-outline"
            label="Assigned to"
            value={item.assigned_worker_name ?? 'Nobody yet'}
          />
        </View>

        {me.data ? (
          <Button
            label={mine ? 'Unassign me' : item.assigned_worker_id ? 'Take over this case' : 'Assign to me'}
            icon={mine ? 'person-remove-outline' : 'person-add-outline'}
            variant={mine ? 'tinted' : 'filled'}
            loading={update.isPending && update.variables?.assigned_worker_id !== undefined}
            onPress={() => update.mutate({ assigned_worker_id: mine ? null : me.data.id }, { onSuccess: success })}
          />
        ) : null}
      </View>

      {update.isError ? <ErrorBanner error={update.error} /> : null}

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
        <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
          Triage
        </Text>
        <FieldLabel>Status</FieldLabel>
        <Chips>
          {CASE_STATUSES.map((s) => (
            <Chip key={s} label={STAFF_STATUS_LABEL[s]} active={item.status === s} onPress={() => item.status !== s && update.mutate({ status: s })} />
          ))}
        </Chips>
        <FieldLabel>Priority</FieldLabel>
        <Chips>
          {CASE_PRIORITIES.map((p) => (
            <Chip key={p} label={PRIORITY_INFO[p].label} active={item.priority === p} onPress={() => item.priority !== p && update.mutate({ priority: p })} />
          ))}
        </Chips>
        <FieldLabel>ComForce service (re-route if it landed in the wrong place)</FieldLabel>
        <Chips>
          {CASE_CATEGORIES.map((c) => (
            <Chip
              key={c}
              label={SERVICE_INFO[c].label}
              active={item.category === c}
              onPress={() => item.category !== c && update.mutate({ category: c })}
            />
          ))}
        </Chips>
      </View>

      <Composer id={id} fromCommunity={item.source === 'public'} />

      <View style={{ gap: space.md }}>
        <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
          History
        </Text>
        {[...updates]
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((u) => (
            <HistoryItem key={u.id} update={u} />
          ))}
      </View>
    </>
  );
}

function Fact({
  icon,
  label,
  value,
  onPress,
}: {
  icon: 'time-outline' | 'person-outline' | 'call-outline' | 'mail-outline' | 'location-outline' | 'people-outline';
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={16} color={theme.textSecondary} />
      <Text style={[styles.factLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text
        style={[styles.factValue, { color: onPress ? theme.accent : theme.text }]}
        onPress={onPress}
        accessibilityRole={onPress ? 'link' : undefined}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

/** An internal note for staff, or a message the requester sees on their request. */
function Composer({ id, fromCommunity }: { id: string; fromCommunity: boolean }) {
  const theme = useTheme();
  const add = useAddCaseUpdate(id);
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('internal');

  const send = () => {
    if (!text.trim()) return;
    add.mutate(
      { content: text.trim(), visibility },
      {
        onSuccess: () => {
          success();
          setText('');
        },
      },
    );
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
        Add an update
      </Text>
      <Chips>
        <Chip label="Internal note" active={visibility === 'internal'} onPress={() => setVisibility('internal')} />
        {fromCommunity ? (
          <Chip label="Message to requester" active={visibility === 'public'} onPress={() => setVisibility('public')} />
        ) : null}
      </Chips>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        placeholder={visibility === 'public' ? 'The requester will see this on their request.' : 'Only ComForce staff will see this.'}
        placeholderTextColor={theme.textTertiary}
        selectionColor={theme.accent}
        textAlignVertical="top"
        accessibilityLabel="Update text"
        style={[styles.textarea, { backgroundColor: theme.fill, color: theme.text }]}
      />
      {add.isError ? <ErrorBanner error={add.error} /> : null}
      <Button
        label={visibility === 'public' ? 'Send to requester' : 'Save note'}
        icon={visibility === 'public' ? 'send' : 'create-outline'}
        disabled={!text.trim()}
        loading={add.isPending}
        onPress={send}
      />
    </View>
  );
}

function HistoryItem({ update }: { update: CaseUpdate }) {
  const theme = useTheme();
  const shared = update.visibility === 'public';
  return (
    <View style={[styles.history, { backgroundColor: theme.surface, borderColor: theme.separator, borderLeftColor: shared ? theme.accent : theme.separator }]}>
      <View style={styles.historyTop}>
        <Text style={[styles.factLabel, { color: theme.textSecondary }]}>
          {update.author_name ?? 'System'} · {formatWhen(update.created_at)}
        </Text>
        <Text style={[styles.tag, { color: shared ? theme.accent : theme.textTertiary }]}>{shared ? 'Shared with requester' : 'Internal'}</Text>
      </View>
      <Text style={[styles.body, { color: theme.text }]}>{update.content}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.xl, borderWidth: 1, borderRadius: radius.md },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  kicker: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  title: { fontSize: 26, lineHeight: 31, fontWeight: '900' },
  heading: { fontSize: 19, fontWeight: '900' },
  body: { fontSize: 16, lineHeight: 23 },
  facts: { gap: space.sm, marginTop: space.sm },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  factLabel: { fontSize: 13, width: 90 },
  factValue: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  textarea: { minHeight: 100, padding: space.md, borderRadius: radius.sm, fontSize: 16, lineHeight: 22 },
  history: { gap: space.xs, padding: space.lg, borderWidth: 1, borderLeftWidth: 4, borderRadius: radius.sm },
  historyTop: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' },
  tag: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
});
