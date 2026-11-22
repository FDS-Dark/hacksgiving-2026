import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { CASE_CATEGORIES, CASE_PRIORITIES, type ConfirmRecord, type DebriefRecord, type Extraction } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { Segmented } from '@/components/Segmented';
import { CardSkeleton } from '@/components/Skeleton';
import { ChoiceRow, priorityColor } from '@/components/staff/kit';
import { Button, ErrorBanner, Field, Notice, success, tap } from '@/components/ui';
import { CATEGORY_LABEL, PRIORITY_LABEL } from '@/lib/cases';
import { useConfirmRecord, useDiscardRecord, useRecord, useRetryRecord } from '@/services/records';
import { space, type, useTheme } from '@/theme/tokens';

type Step = { stage: DebriefRecord['stage']; label: string };

const TYPED_STEPS: Step[] = [
  { stage: 'redact', label: 'Removing names we can spot' },
  { stage: 'extract', label: 'Reading and summarizing' },
  { stage: 'done', label: 'Ready for you to check' },
];

/** A voice debrief adds the upload and speech to text in front (the audio is deleted after). */
const VOICE_STEPS: Step[] = [
  { stage: 'upload', label: 'Uploading the recording' },
  { stage: 'transcribe', label: 'Turning speech into text, then deleting the audio' },
  ...TYPED_STEPS,
];

/**
 * Phantom, step 2: follow a debrief through the pipeline, then review what
 * the AI suggested. Everything is editable; nothing becomes a case until
 * the author taps Create case.
 */
export default function DebriefScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const record = useRecord(id);

  return (
    <Page refreshing={record.isRefetching} onRefresh={() => record.refetch()} contentStyle={{ maxWidth: 640, gap: space.lg }}>
      <BackLink to="/staff" label="Today" />
      {record.isPending ? (
        <CardSkeleton lines={4} />
      ) : !record.data ? (
        <ErrorBanner error={record.error} onRetry={() => record.refetch()} />
      ) : (
        <Body record={record.data} />
      )}
    </Page>
  );
}

function Body({ record: r }: { record: DebriefRecord }) {
  switch (r.status) {
    case 'processing':
    case 'confirming':
      return <Processing record={r} />;
    case 'failed':
      return <Failed record={r} />;
    case 'ready':
      return r.extraction ? <Review record={r} extraction={r.extraction} /> : <Failed record={r} />;
    case 'confirmed':
      return <Confirmed record={r} />;
    case 'discarded':
      return <Notice icon="trash-outline">This debrief was discarded and its text deleted.</Notice>;
  }
}

function Title({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">
      {children}
    </Text>
  );
}

function Processing({ record: r }: { record: DebriefRecord }) {
  const theme = useTheme();
  const steps = r.source === 'audio' ? VOICE_STEPS : TYPED_STEPS;
  const at = steps.findIndex((s) => s.stage === r.stage);
  return (
    <View style={{ gap: space.lg }}>
      <Title>Working on your debrief</Title>
      <Text style={[type.subhead, { color: theme.textSecondary }]}>
        This usually takes a few seconds. You can leave this screen; it’ll be on Today when it’s ready.
      </Text>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
        {steps.map((step, i) => {
          const done = i < at;
          const current = i === at;
          return (
            <View key={step.stage} style={styles.step}>
              {current ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={done ? theme.accent : theme.textTertiary} />
              )}
              <Text style={[type.subhead, { color: done || current ? theme.text : theme.textTertiary, fontWeight: current ? '700' : '400' }]}>
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Failed({ record: r }: { record: DebriefRecord }) {
  const retry = useRetryRecord(r.id);
  return (
    <View style={{ gap: space.lg }}>
      <Title>Couldn’t finish this debrief</Title>
      <Notice icon="alert-circle-outline" tone="warning">
        {r.error ?? 'Something went wrong while processing it.'} Your text is saved.
      </Notice>
      {retry.error ? <ErrorBanner error={retry.error} /> : null}
      <Button label="Try again" icon="refresh" loading={retry.isPending} onPress={() => retry.mutate()} />
      <Original text={r.raw_text} spoken={r.source === 'audio'} />
      <Discard id={r.id} />
    </View>
  );
}

function Confirmed({ record: r }: { record: DebriefRecord }) {
  return (
    <View style={{ gap: space.lg }}>
      <Title>Saved to a case</Title>
      <Notice icon="checkmark-circle-outline">This debrief is saved on its case, with its tasks. You can keep working on it there.</Notice>
      {r.case_id ? (
        <Button label="Open the case" icon="arrow-forward" onPress={() => router.replace({ pathname: '/staff/cases/[id]', params: { id: r.case_id! } })} />
      ) : null}
    </View>
  );
}

/** The author's version of the AI's suggestion: everything editable, tasks can be dropped. */
function Review({ record: r, extraction: x }: { record: DebriefRecord; extraction: Extraction }) {
  const theme = useTheme();
  const confirm = useConfirmRecord(r.id);
  // A debrief taken from the Responding screen is about an existing case:
  // confirming adds a note and tasks to it (and raises its priority if needed).
  const forCase = Boolean(r.case_id);
  const [title, setTitle] = useState(x.title);
  const [summary, setSummary] = useState(x.summary);
  const [kind, setKind] = useState(x.kind);
  const [category, setCategory] = useState(x.category);
  const [priority, setPriority] = useState(x.priority);
  const [location, setLocation] = useState(x.location ?? '');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [keep, setKeep] = useState<boolean[]>(() => x.tasks.map(() => true));

  const save = () => {
    const body: ConfirmRecord = {
      title: title.trim(),
      summary: summary.trim(),
      kind,
      category,
      priority,
      location: location.trim() || null,
      contact_name: contactName.trim() || null,
      contact_phone: contactPhone.trim() || null,
      tasks: x.tasks.filter((_, i) => keep[i]).map((t) => ({ title: t.title, due_in_hours: t.due_in_hours })),
    };
    confirm.mutate(body, {
      onSuccess: (result) => {
        success();
        router.replace({ pathname: '/staff/cases/[id]', params: { id: result.case.id } });
      },
    });
  };

  return (
    <View style={{ gap: space.lg }}>
      <Title>Check before saving</Title>
      <Text style={[type.subhead, { color: theme.textSecondary }]}>
        {forCase
          ? 'The AI’s reading of your debrief. Fix anything that’s wrong; it’s added to the case you responded to as a note, with the tasks you keep.'
          : 'The AI’s suggestion from your debrief. Fix anything that’s wrong; nothing is saved until you create the case.'}
      </Text>

      {x.risk_flags.length ? (
        <View style={[styles.risks, { backgroundColor: theme.dangerSoft }]}>
          <Text style={[styles.label, { color: theme.danger }]}>SAFETY</Text>
          {x.risk_flags.map((flag) => (
            <View key={flag} style={styles.risk}>
              <Ionicons name="warning" size={14} color={theme.danger} />
              <Text style={[type.subhead, { color: theme.text, flex: 1 }]}>{flag}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Field label="Title" value={title} onChangeText={setTitle} maxLength={160} />
      <Field label="Summary" value={summary} onChangeText={setSummary} multiline maxLength={4000} style={styles.multiline} />
      {forCase ? null : (
      <Segmented
        label="Kind of case"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'request', label: 'Request' },
          { value: 'incident', label: 'Incident' },
        ]}
      />
      )}
      {forCase ? null : (
        <ChoiceRow label="Service" options={CASE_CATEGORIES} labels={CATEGORY_LABEL} value={category} onChange={(c) => c && setCategory(c)} />
      )}
      <ChoiceRow label="Priority" options={CASE_PRIORITIES} labels={PRIORITY_LABEL} value={priority} onChange={(p) => p && setPriority(p)} colorOf={(p) => priorityColor(theme, p)} />
      <Field label="Where" icon="location-outline" value={location} onChangeText={setLocation} maxLength={300} placeholder="Street, intersection or neighborhood" />

      {forCase ? null : (
      <View style={{ gap: space.sm }}>
        <Field label="Contact (staff only, optional)" icon="person-outline" placeholder="Name" value={contactName} onChangeText={setContactName} maxLength={160} />
        <Field icon="call-outline" placeholder="Phone" value={contactPhone} onChangeText={setContactPhone} keyboardType="phone-pad" maxLength={40} />
      </View>
      )}

      {x.tasks.length ? (
        <View style={{ gap: 6 }}>
          <Text style={[type.footnote, { color: theme.textSecondary, fontWeight: '600' }]}>Tasks to create</Text>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator, gap: 0, padding: 0 }]}>
            {x.tasks.map((t, i) => (
              <Pressable
                key={`${t.title}-${i}`}
                onPress={() => {
                  tap();
                  setKeep((k) => k.map((v, j) => (j === i ? !v : v)));
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: keep[i] }}
                accessibilityLabel={t.title}
                style={[styles.task, i > 0 && { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }]}
              >
                <Ionicons name={keep[i] ? 'checkbox' : 'square-outline'} size={22} color={keep[i] ? theme.accent : theme.textTertiary} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.subhead, { color: keep[i] ? theme.text : theme.textTertiary }]}>{t.title}</Text>
                  {t.due_in_hours ? (
                    <Text style={[type.caption, { color: theme.textSecondary }]}>Due in {t.due_in_hours} h</Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
          {forCase ? null : (
            <Text style={[type.caption, { color: theme.textSecondary }]}>The service’s usual follow-ups are added too.</Text>
          )}
        </View>
      ) : null}

      <Original text={r.raw_text} spoken={r.source === 'audio'} />

      {confirm.error ? <ErrorBanner error={confirm.error} /> : null}
      <Button label={forCase ? 'Add to case' : 'Create case'} icon="checkmark" size="lg" disabled={!title.trim()} loading={confirm.isPending} onPress={save} />
      <Discard id={r.id} />
    </View>
  );
}

/** What the author wrote (or said: the transcript), folded away. It can hold names; the AI saw it redacted. */
function Original({ text, spoken = false }: { text: string | null; spoken?: boolean }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <View style={{ gap: space.sm }}>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.row}>
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={theme.textSecondary} />
        <Text style={[type.footnote, { color: theme.textSecondary, fontWeight: '600' }]}>{spoken ? 'What you said' : 'What you wrote'}</Text>
      </Pressable>
      {open ? (
        <Text style={[type.subhead, styles.original, { color: theme.text, backgroundColor: theme.fill }]} selectable>
          {text}
        </Text>
      ) : null}
    </View>
  );
}

function Discard({ id }: { id: string }) {
  const discard = useDiscardRecord(id);
  return (
    <View style={{ gap: space.sm }}>
      {discard.error ? <ErrorBanner error={discard.error} /> : null}
      <Button
        label="Discard debrief"
        icon="trash-outline"
        variant="plain"
        loading={discard.isPending}
        onPress={() => discard.mutate(undefined, { onSuccess: () => router.replace('/staff') })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '800' },
  card: { borderWidth: 1, borderRadius: 14, padding: space.md, gap: space.md },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  risks: { borderRadius: 14, padding: space.md, gap: 6 },
  risk: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  multiline: { minHeight: 100, textAlignVertical: 'top', paddingTop: space.sm },
  task: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  original: { padding: space.md, borderRadius: 10 },
});
