import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { toApiError } from '@/api/client';
import type { Case, CaseUpdate, Visibility } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { Segmented } from '@/components/Segmented';
import { CaseListSkeleton } from '@/components/Skeleton';
import { ErrorBanner, Notice, success } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { useAddCaseUpdate, useCase, useCaseAssist } from '@/services/cases';
import { space, type, useTheme } from '@/theme/tokens';

/** What belongs in the conversation: messages both ways and internal notes (not status changes). */
const THREAD_TYPES = new Set<CaseUpdate['update_type']>(['message', 'reply', 'note']);

/**
 * Figma S5 "Message resident": the staff side of the thread. One composer,
 * with a switch between a message the resident sees and an internal note.
 */
export default function MessagesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useCase(id);
  const theme = useTheme();

  if (detail.isPending) {
    return (
      <View style={styles.page}>
        <CaseListSkeleton rows={4} />
      </View>
    );
  }
  if (detail.error) {
    return (
      <View style={styles.page}>
        <ErrorBanner error={detail.error} onRetry={() => detail.refetch()} />
      </View>
    );
  }
  const { case: c, updates } = detail.data;
  const thread = updates.filter((u) => THREAD_TYPES.has(u.update_type));

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { borderBottomColor: theme.separator }]}>
        <BackLink label="Case" fallback={`/staff/cases/${c.id}`} />
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
          {c.contact_name ?? `Case #${c.number}`}
        </Text>
        <Text style={[type.caption, { color: theme.textSecondary }]} numberOfLines={1}>
          #{c.number} · {c.title}
        </Text>
      </View>
      <Thread updates={thread} />
      <Composer item={c} />
    </KeyboardAvoidingView>
  );
}

function Thread({ updates }: { updates: CaseUpdate[] }) {
  const theme = useTheme();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  return (
    <ScrollView
      ref={scroll}
      style={{ flex: 1 }}
      contentContainerStyle={styles.thread}
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
    >
      {updates.length ? (
        updates.map((u) => <Bubble key={u.id} update={u} />)
      ) : (
        <Text style={[type.subhead, { color: theme.textSecondary, textAlign: 'center' }]}>No messages or notes yet.</Text>
      )}
    </ScrollView>
  );
}

function Bubble({ update: u }: { update: CaseUpdate }) {
  const theme = useTheme();
  const when = `${u.author_name ?? 'System'} · ${dateTime(u.created_at)}`;
  if (u.update_type === 'note') {
    return (
      <View style={[styles.note, { backgroundColor: theme.warningSoft }]}>
        <Text style={[styles.noteLabel, { color: theme.soon }]}>INTERNAL NOTE</Text>
        <Text style={[type.subhead, { color: theme.text }]} selectable>
          {u.content}
        </Text>
        <Text style={[type.caption, { color: theme.textSecondary }]}>{when}</Text>
      </View>
    );
  }
  const fromStaff = u.update_type === 'message';
  return (
    <View style={[styles.bubbleRow, { justifyContent: fromStaff ? 'flex-end' : 'flex-start' }]}>
      <View
        style={[
          styles.bubble,
          fromStaff ? { backgroundColor: theme.text } : { backgroundColor: theme.surface, borderColor: theme.separator, borderWidth: 1 },
        ]}
      >
        <Text style={[type.subhead, { color: fromStaff ? theme.bg : theme.text }]} selectable>
          {u.content}
        </Text>
        <Text style={[type.caption, { color: fromStaff ? theme.textTertiary : theme.textSecondary }]}>{when}</Text>
      </View>
    </View>
  );
}

function Composer({ item: c }: { item: Case }) {
  const theme = useTheme();
  const add = useAddCaseUpdate(c.id);
  const assist = useCaseAssist(c.id);
  // Only a request from someone with an account (or a saved code) can be messaged.
  const canMessage = !!c.requester_id || c.source === 'public';
  const [visibility, setVisibility] = useState<Visibility>(canMessage ? 'public' : 'internal');
  const [text, setText] = useState('');
  const aiOff = assist.draft.error && toApiError(assist.draft.error).status === 503;

  const send = () => {
    const content = text.trim();
    if (!content) return;
    add.mutate(
      { content, visibility },
      {
        onSuccess: () => {
          setText('');
          success();
        },
      },
    );
  };

  return (
    <View style={[styles.composer, { borderTopColor: theme.separator, backgroundColor: theme.surface }]}>
      {canMessage ? (
        <View style={styles.controls}>
          <View style={{ flex: 1 }}>
            <Segmented
              label="Send as"
              value={visibility}
              onChange={setVisibility}
              options={[
                { value: 'public', label: 'To resident' },
                { value: 'internal', label: 'Internal note' },
              ]}
            />
          </View>
          {visibility === 'public' ? (
            <Pressable
              onPress={() => assist.draft.mutate(undefined, { onSuccess: (d) => setText(d.message) })}
              disabled={assist.draft.isPending}
              accessibilityRole="button"
              accessibilityLabel="Draft a message with AI"
              style={({ pressed }) => [styles.ai, { backgroundColor: theme.accentSoft }, (pressed || assist.draft.isPending) && { opacity: 0.6 }]}
            >
              <Ionicons name="sparkles-outline" size={14} color={theme.accent} />
              <Text style={[type.caption, { color: theme.accent, fontWeight: '700' }]}>{assist.draft.isPending ? 'Drafting…' : 'AI draft'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <Notice icon="information-circle-outline">This case wasn’t sent from the app, so there’s no one to message. Notes stay internal.</Notice>
      )}
      {aiOff ? <Notice icon="cloud-offline-outline">AI drafting isn’t set up on this server.</Notice> : null}
      {add.error ? <ErrorBanner error={add.error} /> : null}
      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={visibility === 'public' ? `${c.contact_name ?? 'The resident'} will see this` : 'Only ComForce staff see notes'}
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.accent}
          multiline
          maxLength={4000}
          accessibilityLabel={visibility === 'public' ? 'Message to the resident' : 'Internal note'}
          style={[styles.input, { backgroundColor: theme.fill, color: theme.text }]}
        />
        <Pressable
          onPress={send}
          disabled={!text.trim() || add.isPending}
          accessibilityRole="button"
          accessibilityLabel={visibility === 'public' ? 'Send message' : 'Save note'}
          style={({ pressed }) => [styles.send, { backgroundColor: theme.accent }, (!text.trim() || add.isPending) && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name={visibility === 'public' ? 'send' : 'checkmark'} size={18} color={theme.onAccent} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: space.lg },
  header: { paddingHorizontal: space.lg, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  name: { fontSize: 20, fontWeight: '800' },
  thread: { padding: space.lg, gap: space.md, flexGrow: 1, justifyContent: 'flex-end' },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '82%', borderRadius: 16, padding: space.md, gap: 4 },
  note: { borderRadius: 12, padding: space.md, gap: 4, alignSelf: 'flex-end', maxWidth: '82%' },
  noteLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, padding: space.md, gap: space.sm },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ai: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: { flex: 1, minHeight: 42, maxHeight: 140, borderRadius: 21, paddingHorizontal: space.md, paddingTop: 11, paddingBottom: 11, fontSize: 15 },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
