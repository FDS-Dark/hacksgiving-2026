import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BackLink } from '@/components/admin/BackLink';
import { Actions, Input, Picker, Section, Toggle } from '@/components/admin/form';
import { ConfidentialBadge, OverdueBadge, PriorityBadge, StatusBadge } from '@/components/admin/requestBits';
import { Page } from '@/components/Page';
import { Button, EmptyState, FieldLabel, Group, Notice, Row, Txt, success, type IconName } from '@/components/ui';
import { useAdmin } from '@/lib/admin';
import { ASSIGNABLE, CURRENT_USER } from '@/lib/directory';
import {
  OUTCOMES,
  PRIORITIES,
  PRIORITY_LABEL,
  REFERRAL_LABEL,
  STATUSES,
  STATUS_LABEL,
  activity,
  ago,
  followUpDue,
  isOpen,
  isOverdue,
  referralPacket,
  type Activity,
  type AssistRequest,
  type Priority,
  type ReferralStatus,
  type Status,
} from '@/lib/requests';
import { radius, space, useTheme } from '@/theme/tokens';

const UNASSIGNED = 'Unassigned';
const LOG_KINDS = { note: 'Note', contact: 'Contact attempt' } as const;
const ACTIVITY_ICON: Record<Activity['kind'], IconName> = {
  created: 'add-circle-outline',
  note: 'chatbox-ellipses-outline',
  contact: 'call-outline',
  status: 'swap-horizontal-outline',
  assign: 'person-outline',
  priority: 'flag-outline',
  referral: 'git-network-outline',
};

/** One request: who, what, safe contact, triage, referral, log, and close-out. */
export default function RequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { requests, saveRequest } = useAdmin();
  const r = requests.find((x) => x.id === id);

  if (!r) {
    return (
      <Page>
        <BackLink label="All requests" href="/admin/requests" />
        <EmptyState icon="search-outline" title="Request not found" body="It may have been logged on another device." />
      </Page>
    );
  }

  /** Apply a change and record it in the log. */
  const update = (change: Partial<AssistRequest>, kind?: Activity['kind'], text?: string) => {
    saveRequest({ ...r, ...change, activity: kind && text ? [...r.activity, activity(CURRENT_USER, kind, text)] : r.activity });
  };

  return (
    <Page contentStyle={{ maxWidth: 820 }}>
      <BackLink label="All requests" href="/admin/requests" />
      <Header r={r} />
      <SafetyNotices r={r} />
      <Resident r={r} />
      <Triage key={`triage-${r.id}`} r={r} update={update} />
      <ReferralSection key={`referralsection-${r.id}`} r={r} update={update} />
      <LogEntry key={`logentry-${r.id}`} r={r} update={update} />
      <CloseOut key={`closeout-${r.id}`} r={r} update={update} />
      <Timeline r={r} />
    </Page>
  );
}

type Update = (change: Partial<AssistRequest>, kind?: Activity['kind'], text?: string) => void;

function Header({ r }: { r: AssistRequest }) {
  const theme = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.badges}>
        <Text style={[styles.ref, { color: theme.textSecondary }]}>{r.ref}</Text>
        <PriorityBadge priority={r.priority} />
        <StatusBadge status={r.status} />
        {isOverdue(r) ? <OverdueBadge /> : null}
        {r.confidential ? <ConfidentialBadge /> : null}
      </View>
      <Txt variant="title" accessibilityRole="header">
        {r.summary}
      </Txt>
      <Txt variant="subhead" tone="secondary">
        {r.needs.join(' · ')} — via {r.source.toLowerCase()}, {ago(r.createdAt)}
      </Txt>
      {r.details ? <Txt style={{ marginTop: space.xs }}>{r.details}</Txt> : null}
    </View>
  );
}

function SafetyNotices({ r }: { r: AssistRequest }) {
  const limits = [
    !r.safeToCall && 'do not call',
    !r.safeToText && 'do not text',
    !r.safeToVoicemail && 'do not leave voicemail',
  ].filter(Boolean) as string[];
  return (
    <>
      {limits.length || r.safeTimes ? (
        <Notice icon="shield-outline" tone="warning">
          Safe contact: {[...limits, r.safeTimes].filter(Boolean).join('; ')}.
        </Notice>
      ) : null}
      {followUpDue(r) ? <Notice icon="alarm-outline">Follow-up was due {r.followUpOn}.</Notice> : null}
    </>
  );
}

function Resident({ r }: { r: AssistRequest }) {
  return (
    <Group header="Resident" headerIcon="person-outline">
      <Row title="Name" detail={r.name} />
      {r.phone ? <Row title="Phone" detail={r.safeToCall || r.safeToText ? r.phone : `${r.phone} (not safe)`} /> : null}
      {r.email ? <Row title="Email" detail={r.email} /> : null}
      <Row title="Best way to reach" detail={r.preferredContact} />
      <Row title="Language" detail={r.language} />
      {r.neighborhood ? <Row title="Neighborhood" detail={r.neighborhood} /> : null}
      {r.householdSize ? <Row title="People in household" detail={r.householdSize} /> : null}
      <Row title="Consent to share with partners" detail={r.consentToShare ? 'Yes' : 'Not yet'} />
    </Group>
  );
}

function Triage({ r, update }: { r: AssistRequest; update: Update }) {
  const [followUp, setFollowUp] = useState(r.followUpOn);
  const validDate = !followUp || /^\d{4}-\d{2}-\d{2}$/.test(followUp);
  return (
    <Section title="Triage" icon="flag-outline">
      <Picker
        label="Priority"
        options={PRIORITIES}
        labels={PRIORITY_LABEL}
        value={r.priority}
        onChange={(v) => v !== r.priority && update({ priority: v as Priority }, 'priority', `Priority set to ${PRIORITY_LABEL[v as Priority]}`)}
      />
      <Picker
        label="Assigned to"
        options={[UNASSIGNED, ...ASSIGNABLE]}
        value={r.assignee ?? UNASSIGNED}
        onChange={(v) => {
          const assignee = v === UNASSIGNED ? null : v;
          if (assignee === r.assignee) return;
          // Picking up a new request moves it out of "New".
          const status: Status = assignee && r.status === 'new' ? 'in_progress' : r.status;
          update({ assignee, status }, 'assign', assignee ? `Assigned to ${assignee}` : 'Unassigned');
        }}
      />
      <Picker
        label="Status"
        options={STATUSES.filter((s) => s !== 'resolved' && s !== 'closed')}
        labels={STATUS_LABEL}
        value={r.status}
        onChange={(v) => v !== r.status && update({ status: v as Status }, 'status', `Status changed to ${STATUS_LABEL[v as Status]}`)}
      />
      <View style={styles.inline}>
        <View style={{ flex: 1 }}>
          <Input
            label="Follow up on"
            placeholder="YYYY-MM-DD"
            value={followUp}
            onChangeText={setFollowUp}
            error={validDate ? undefined : 'Use YYYY-MM-DD.'}
          />
        </View>
        <Button
          label="Set"
          variant="tinted"
          disabled={!validDate || followUp === r.followUpOn}
          onPress={() => update({ followUpOn: followUp }, 'note', followUp ? `Follow-up set for ${followUp}` : 'Follow-up cleared')}
        />
      </View>
    </Section>
  );
}

function ReferralSection({ r, update }: { r: AssistRequest; update: Update }) {
  const theme = useTheme();
  const { services, trackServiceEvent } = useAdmin();
  // Partners first, then other active services; skip inactive ones.
  const referable = [...services.filter((x) => x.status === 'partner'), ...services.filter((x) => x.status === 'contacted' || x.status === 'listed')];
  const [partner, setPartner] = useState<string | null>(null);
  const [note, setNote] = useState('');

  if (r.referral) {
    const ref = r.referral;
    return (
      <Section title="Referral" icon="git-network-outline">
        <Txt variant="headline">{ref.partner}</Txt>
        <Txt variant="footnote" tone="secondary">
          Sent {ago(ref.sentAt)}
          {ref.note ? ` · ${ref.note}` : ''}
        </Txt>
        <Picker
          label="Partner’s response"
          options={Object.keys(REFERRAL_LABEL)}
          labels={REFERRAL_LABEL}
          value={ref.status}
          onChange={(v) => {
            if (v === ref.status) return;
            const status = v as ReferralStatus;
            update({ referral: { ...ref, status } }, 'referral', `${ref.partner}: ${REFERRAL_LABEL[status]}`);
          }}
        />
        {ref.status === 'declined' ? (
          <Notice icon="information-circle-outline">Declined. Refer to another partner so the need doesn’t get dropped.</Notice>
        ) : null}
        {ref.status === 'declined' || ref.status === 'completed' ? (
          <Button
            label="Refer to someone else"
            variant="tinted"
            onPress={() => update({ referral: null, status: 'in_progress' }, 'referral', `Referral to ${ref.partner} ended`)}
            style={{ alignSelf: 'flex-start' }}
          />
        ) : null}
      </Section>
    );
  }

  if (!r.consentToShare) {
    return (
      <Section title="Referral" icon="git-network-outline">
        <Notice icon="hand-left-outline" tone="warning">
          Ask the resident before sharing anything with a partner.
        </Notice>
        <Toggle
          label="Resident agreed to share their details"
          detail="Record the moment you got consent."
          value={false}
          onChange={() => update({ consentToShare: true }, 'note', 'Resident consented to sharing details with a partner')}
        />
      </Section>
    );
  }

  const packet = referralPacket(r);
  return (
    <Section title="Refer to a partner" icon="git-network-outline">
      <Picker
        label="Service"
        options={referable.map((x) => x.name)}
        value={partner}
        onChange={setPartner}
      />
      <Txt variant="footnote" tone="secondary">
        Partners first, then other services in the directory. Manage the list in Admin → Services.
      </Txt>
      {r.confidential ? (
        <Notice icon="lock-closed-outline" tone="warning">
          This request is confidential. Only the details below are sent, and only because the resident agreed.
        </Notice>
      ) : null}
      <Input label="Note for the partner" placeholder="What you’re asking them to do" value={note} onChangeText={setNote} multiline />
      <View style={{ gap: 6 }}>
        <FieldLabel>What the partner receives</FieldLabel>
        <View style={[styles.packet, { backgroundColor: theme.fill }]}>
          <Text selectable style={[styles.packetText, { color: theme.text }]}>
            {packet}
            {note ? `\nNote: ${note}` : ''}
          </Text>
        </View>
      </View>
      <Button
        label="Send referral"
        icon="send-outline"
        disabled={!partner}
        onPress={() => {
          success();
          const service = services.find((x) => x.name === partner);
          if (service) trackServiceEvent(service.id, 'referral', 'staff');
          update(
            { referral: { partner: partner!, status: 'sent', sentAt: new Date().toISOString(), note }, status: 'referred' },
            'referral',
            `Referred to ${partner}`,
          );
        }}
        style={{ alignSelf: 'flex-start' }}
      />
    </Section>
  );
}

function LogEntry({ r, update }: { r: AssistRequest; update: Update }) {
  const [kind, setKind] = useState<keyof typeof LOG_KINDS>('note');
  const [text, setText] = useState('');
  return (
    <Section title="Add to the log" icon="create-outline">
      <Picker label="Type" options={Object.keys(LOG_KINDS)} labels={LOG_KINDS} value={kind} onChange={(v) => setKind(v as keyof typeof LOG_KINDS)} />
      <Input
        label={kind === 'contact' ? 'What happened' : 'Note'}
        placeholder={kind === 'contact' ? 'e.g. Called, no answer. Did not leave voicemail.' : 'Keep it factual; the resident may ask to see it.'}
        value={text}
        onChangeText={setText}
        multiline
      />
      <Button
        label="Add"
        variant="tinted"
        disabled={!text.trim()}
        onPress={() => {
          update({}, kind, text.trim());
          setText('');
        }}
        style={{ alignSelf: 'flex-start' }}
      />
    </Section>
  );
}

function CloseOut({ r, update }: { r: AssistRequest; update: Update }) {
  const [outcome, setOutcome] = useState<string | null>(null);
  if (!isOpen(r)) {
    return (
      <Section title="Closed out" icon="checkmark-done-outline">
        <Txt>
          {STATUS_LABEL[r.status]}: {r.outcome || 'No outcome recorded'}
        </Txt>
        <Button
          label="Reopen"
          variant="tinted"
          onPress={() => update({ status: r.assignee ? 'in_progress' : 'new', outcome: '' }, 'status', 'Reopened')}
          style={{ alignSelf: 'flex-start' }}
        />
      </Section>
    );
  }
  const referralOpen = r.referral && (r.referral.status === 'sent' || r.referral.status === 'accepted');
  return (
    <Section title="Close out" icon="checkmark-done-outline">
      <Picker label="Outcome" options={OUTCOMES} value={outcome} onChange={setOutcome} />
      {referralOpen ? (
        <Notice icon="git-network-outline">The referral is still open. Confirm with {r.referral!.partner} that they followed through before closing.</Notice>
      ) : null}
      <Actions>
        <Button
          label="Resolve"
          icon="checkmark-circle-outline"
          disabled={!outcome}
          onPress={() => {
            success();
            update({ status: 'resolved', outcome: outcome! }, 'status', `Resolved: ${outcome}`);
          }}
        />
        <Button
          label="Close without resolving"
          variant="plain"
          disabled={!outcome}
          onPress={() => update({ status: 'closed', outcome: outcome! }, 'status', `Closed: ${outcome}`)}
        />
      </Actions>
    </Section>
  );
}

function Timeline({ r }: { r: AssistRequest }) {
  const theme = useTheme();
  return (
    <Section title="Activity" icon="list-outline">
      {[...r.activity].reverse().map((a, i, all) => (
        <View key={a.id} style={styles.event}>
          <View style={{ alignItems: 'center' }}>
            <View style={[styles.dot, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name={ACTIVITY_ICON[a.kind]} size={14} color={theme.accent} />
            </View>
            {i < all.length - 1 ? <View style={[styles.line, { backgroundColor: theme.separator }]} /> : null}
          </View>
          <View style={{ flex: 1, paddingBottom: space.md }}>
            <Txt variant="subhead">{a.text}</Txt>
            <Txt variant="caption" tone="secondary">
              {a.by} · {ago(a.at)}
            </Txt>
          </View>
        </View>
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  ref: { fontSize: 14, fontWeight: '800' },
  inline: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  packet: { padding: space.md, borderRadius: radius.md },
  packetText: { fontSize: 14, lineHeight: 20 },
  event: { flexDirection: 'row', gap: space.md },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  line: { width: 2, flex: 1, marginTop: 2 },
});
