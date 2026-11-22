import Ionicons from '@expo/vector-icons/Ionicons';
import { File } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { DebriefRecord } from '@/api/types';
import { Page } from '@/components/Page';
import { Segmented } from '@/components/Segmented';
import { ConfirmSheet, DraftRestored } from '@/components/staff/kit';
import { VoiceRecorder } from '@/components/staff/VoiceRecorder';
import { Button, ErrorBanner, Field, Notice } from '@/components/ui';
import { draftKey } from '@/lib/drafts';
import { useDraft } from '@/lib/useDraft';
import { useCreateRecord, useSubmitVoice } from '@/services/records';
import { useStaffStatus } from '@/services/staff';
import { space, type, useTheme } from '@/theme/tokens';

type Mode = 'speak' | 'type';
type Recording = { uri: string; durationMs: number };

/** The local recording isn't needed once it's uploaded (or thrown away). */
function deleteLocal(uri: string | null) {
  if (!uri) return;
  try {
    new File(uri).delete();
  } catch {
    // Already gone, or the OS cleans its cache directory anyway.
  }
}

/**
 * Phantom, step 1: capture a debrief right after a call or a visit, by
 * voice or typed. It's processed in the background (speech to text, names we
 * can spot removed, then read by the AI) and comes back as a suggested case
 * to review.
 *
 * A typed debrief autosaves on this phone as the worker types, so leaving
 * (for an alert, say) keeps it; coming back restores it. A recording isn't
 * kept that way: closing with one asks first, then deletes the file.
 */
export default function NewDebriefScreen() {
  const theme = useTheme();
  const me = useStaffStatus();
  // From the Responding screen: the debrief is about the accepted case, and
  // confirming it updates that case instead of opening a new one.
  const { caseId, caseNumber } = useLocalSearchParams<{ caseId?: string; caseNumber?: string }>();
  // Recording needs the phone's microphone; on the web, type it.
  const [mode, setMode] = useState<Mode>(Platform.OS === 'web' ? 'type' : 'speak');
  const [form, setForm] = useState({ text: '' });
  const [recording, setRecording] = useState<Recording | null>(null);
  const [confirming, setConfirming] = useState<'close' | 'discard' | null>(null);

  const draft = useDraft(
    me.data?.id ? draftKey('debrief', me.data.id, caseId) : null,
    form,
    useCallback((d: { text: string }) => {
      setForm({ text: d.text ?? '' });
      setMode('type');
    }, []),
  );

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/staff'));
  const close = () => (recording ? setConfirming('close') : leave());
  const opened = async (record: DebriefRecord) => {
    await draft.clear();
    router.replace({ pathname: '/staff/records/[id]', params: { id: record.id } });
  };

  return (
    <Page contentStyle={{ maxWidth: 640, gap: space.lg }}>
      <View style={styles.header}>
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Close and throw away the recording' : 'Close. A typed draft is kept on this phone.'}
          style={styles.close}
        >
          <Ionicons name="close" size={26} color={theme.text} />
        </Pressable>
        <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">
          Debrief
        </Text>
      </View>

      {caseId ? (
        <Notice icon="link-outline">
          This debrief is for case{caseNumber ? ` #${caseNumber}` : ''}. When you confirm it, its notes and next steps are added to that case.
        </Notice>
      ) : (
        <Text style={[type.subhead, { color: theme.textSecondary }]}>Describe the visit. You can review everything before you save the case.</Text>
      )}

      {draft.restoredAt ? <DraftRestored savedAt={draft.restoredAt} onDiscard={() => setConfirming('discard')} /> : null}

      {Platform.OS !== 'web' ? (
        <Segmented
          label="How to capture it"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'speak', label: 'Speak' },
            { value: 'type', label: 'Type' },
          ]}
        />
      ) : null}

      {mode === 'speak' ? (
        <Speak caseId={caseId} recording={recording} setRecording={setRecording} onDone={opened} />
      ) : (
        <Type caseId={caseId} text={form.text} setText={(text) => setForm({ text })} autoFocus={!draft.restoredAt} onDone={opened} />
      )}

      <ConfirmSheet
        visible={confirming === 'close'}
        title="Throw away this recording?"
        body="It hasn’t been sent yet. Closing deletes it from this phone."
        confirmLabel="Throw away and close"
        destructive
        onConfirm={() => {
          deleteLocal(recording?.uri ?? null);
          setRecording(null);
          setConfirming(null);
          leave();
        }}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmSheet
        visible={confirming === 'discard'}
        title="Discard this draft?"
        body="What you typed is deleted from this phone. This can’t be undone."
        confirmLabel="Discard draft"
        destructive
        onConfirm={() => {
          setConfirming(null);
          setForm({ text: '' });
          void draft.clear();
        }}
        onCancel={() => setConfirming(null)}
      />
    </Page>
  );
}

function Speak({
  caseId,
  recording,
  setRecording,
  onDone,
}: {
  caseId?: string;
  recording: Recording | null;
  setRecording: (r: Recording | null) => void;
  onDone: (record: DebriefRecord) => void;
}) {
  const theme = useTheme();
  const submit = useSubmitVoice();

  const again = () => {
    deleteLocal(recording?.uri ?? null);
    setRecording(null);
    submit.reset();
  };

  const send = () => {
    if (!recording) return;
    submit.mutate(
      { fileUri: recording.uri, caseId },
      {
        onSuccess: (record) => {
          deleteLocal(recording.uri);
          setRecording(null);
          onDone(record);
        },
      },
    );
  };

  return (
    <View style={{ gap: space.lg }}>
      {recording ? (
        <View style={[styles.done, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
          <Ionicons name="checkmark-circle" size={22} color={theme.accent} />
          <Text style={[type.subhead, { color: theme.text, flex: 1 }]}>Recorded {Math.max(1, Math.round(recording.durationMs / 1000))} seconds</Text>
          <Button label="Record again" variant="plain" disabled={submit.isPending} onPress={again} />
        </View>
      ) : (
        <VoiceRecorder onRecorded={(uri, durationMs) => setRecording({ uri, durationMs })} />
      )}

      <Notice icon="lock-closed-outline">
        Only you and admins can see this while we process it. Our transcription service turns the recording into text, then it’s deleted.
        Names we can spot, phone numbers and emails are removed before the AI reads it.
      </Notice>

      {submit.error ? <ErrorBanner error={submit.error} /> : null}
      <Button
        label={submit.isPending ? 'Uploading…' : 'Process debrief'}
        icon="sparkles-outline"
        size="lg"
        disabled={!recording}
        loading={submit.isPending}
        onPress={send}
      />
    </View>
  );
}

function Type({
  caseId,
  text,
  setText,
  autoFocus,
  onDone,
}: {
  caseId?: string;
  text: string;
  setText: (text: string) => void;
  autoFocus: boolean;
  onDone: (record: DebriefRecord) => void;
}) {
  const theme = useTheme();
  const create = useCreateRecord();
  return (
    <View style={{ gap: space.lg }}>
      <Field
        label="What happened?"
        placeholder="Who you met (no names needed), where, what they need, anything urgent or unsafe, a number to call back"
        value={text}
        onChangeText={setText}
        multiline
        maxLength={20000}
        style={styles.multiline}
        autoFocus={autoFocus}
        accessibilityLabel="What happened?"
      />
      {text.trim() ? <Text style={[type.footnote, { color: theme.textSecondary }]}>Saved on this phone as you type, until you process it.</Text> : null}
      <Notice icon="lock-closed-outline">
        Only you and admins can see this while we process it. Names we can spot, phone numbers and emails are removed before the AI reads it.
      </Notice>
      {create.error ? <ErrorBanner error={create.error} /> : null}
      <Button
        label="Process debrief"
        icon="sparkles-outline"
        size="lg"
        disabled={!text.trim()}
        loading={create.isPending}
        onPress={() => create.mutate({ text: text.trim(), case_id: caseId ?? null }, { onSuccess: onDone })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -space.sm },
  title: { fontSize: 22, fontWeight: '800' },
  multiline: { minHeight: 220, textAlignVertical: 'top', paddingTop: space.sm },
  done: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: 14, padding: space.md },
});
