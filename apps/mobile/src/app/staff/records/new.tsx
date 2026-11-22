import Ionicons from '@expo/vector-icons/Ionicons';
import { File } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { DebriefRecord } from '@/api/types';
import { Page } from '@/components/Page';
import { Segmented } from '@/components/Segmented';
import { VoiceRecorder } from '@/components/staff/VoiceRecorder';
import { Button, ErrorBanner, Field, Notice } from '@/components/ui';
import { useCreateRecord, useSubmitVoice } from '@/services/records';
import { space, type, useTheme } from '@/theme/tokens';

type Mode = 'speak' | 'type';

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
 */
export default function NewDebriefScreen() {
  const theme = useTheme();
  // From the Responding screen: the debrief is about the accepted case, and
  // confirming it updates that case instead of opening a new one.
  const { caseId, caseNumber } = useLocalSearchParams<{ caseId?: string; caseNumber?: string }>();
  // Recording needs the phone's microphone; on the web, type it.
  const [mode, setMode] = useState<Mode>(Platform.OS === 'web' ? 'type' : 'speak');

  const opened = (record: DebriefRecord) => router.replace({ pathname: '/staff/records/[id]', params: { id: record.id } });

  return (
    <Page contentStyle={{ maxWidth: 640, gap: space.lg }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={10}>
          <Ionicons name="close" size={26} color={theme.text} />
        </Pressable>
        <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">
          Debrief
        </Text>
      </View>

      {caseId ? (
        <Notice icon="link-outline">
          This debrief is for case{caseNumber ? ` #${caseNumber}` : ''}. When you confirm it, its notes and next steps are added
          to that case.
        </Notice>
      ) : (
        <Text style={[type.subhead, { color: theme.textSecondary }]}>
          Say what happened in your own words, right after the call or visit. We’ll turn it into a case for you to check before
          anything is saved.
        </Text>
      )}

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

      {mode === 'speak' ? <Speak caseId={caseId} onDone={opened} /> : <Type caseId={caseId} onDone={opened} />}
    </Page>
  );
}

function Speak({ caseId, onDone }: { caseId?: string; onDone: (record: DebriefRecord) => void }) {
  const theme = useTheme();
  const submit = useSubmitVoice();
  const [recording, setRecording] = useState<{ uri: string; durationMs: number } | null>(null);

  const again = () => {
    deleteLocal(recording?.uri ?? null);
    setRecording(null);
    submit.reset();
  };

  const send = () => {
    if (!recording) return;
    submit.mutate({ fileUri: recording.uri, caseId }, {
      onSuccess: (record) => {
        deleteLocal(recording.uri);
        onDone(record);
      },
    });
  };

  return (
    <View style={{ gap: space.lg }}>
      {recording ? (
        <View style={[styles.done, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
          <Ionicons name="checkmark-circle" size={22} color={theme.accent} />
          <Text style={[type.subhead, { color: theme.text, flex: 1 }]}>
            Recorded {Math.max(1, Math.round(recording.durationMs / 1000))} seconds
          </Text>
          <Button label="Record again" variant="plain" disabled={submit.isPending} onPress={again} />
        </View>
      ) : (
        <VoiceRecorder onRecorded={(uri, durationMs) => setRecording({ uri, durationMs })} />
      )}

      <Notice icon="lock-closed-outline">
        Only you (and admins) can see this. The recording is turned into text by our transcription service, then deleted. Names
        we can spot, phone numbers and emails are removed before the AI reads the text.
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

function Type({ caseId, onDone }: { caseId?: string; onDone: (record: DebriefRecord) => void }) {
  const create = useCreateRecord();
  const [text, setText] = useState('');
  return (
    <View style={{ gap: space.lg }}>
      <Field
        label="What happened?"
        placeholder="Who you met (no need for names), where, what they need, anything urgent or unsafe"
        value={text}
        onChangeText={setText}
        multiline
        maxLength={20000}
        style={styles.multiline}
        autoFocus
      />
      <Notice icon="lock-closed-outline">
        Only you (and admins) can see this. Names we can spot, phone numbers and emails are removed before the AI reads it.
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
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { fontSize: 22, fontWeight: '800' },
  multiline: { minHeight: 220, textAlignVertical: 'top', paddingTop: space.sm },
  done: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: 14, padding: space.md },
});
