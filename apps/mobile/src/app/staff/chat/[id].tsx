import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toApiError } from '@/api/client';
import { BackLink } from '@/components/BackLink';
import { CaseListSkeleton } from '@/components/Skeleton';
import { EmptyState, ErrorBanner, Notice, success, tap } from '@/components/ui';
import { readState } from '@/lib/chat';
import { dateTime } from '@/lib/format';
import { useChatThread, useMarkChatRead, useSendChatMessage, type ChatMessage, type ChatThread } from '@/services/chat';
import { useStaffStatus } from '@/services/staff';
import { space, type, useTheme } from '@/theme/tokens';

/**
 * One chat channel: Team, On call, or a case's (staff only). Polls every 5 s
 * while open, marks itself read as messages arrive, and keeps the composer
 * above the keyboard and the home indicator.
 */
export default function ChatThreadScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const thread = useChatThread(id);
  const theme = useTheme();
  const markRead = useMarkChatRead(id);
  const { mutate: read } = markRead;
  // Where I had read up to when the thread opened: later messages from others show as new.
  const [readUpTo, setReadUpTo] = useState<string | null | undefined>(undefined);
  // Pull to refresh shows the spinner; the 5 s poll doesn't.
  const [pulling, setPulling] = useState(false);
  const data = thread.data;
  const loadedKey = data?.channel.key;
  const count = data?.messages.length ?? 0;
  const lastAt = data?.messages.at(-1)?.created_at;

  if (data && readUpTo === undefined) setReadUpTo(data.channel.last_read_at ?? null);
  // On screen means read: on open, and again whenever a poll brings a new message.
  useEffect(() => {
    if (loadedKey) read();
  }, [loadedKey, count, lastAt, read]);

  if (thread.isPending) {
    return (
      <View style={styles.page}>
        <BackLink label="Team chat" fallback="/staff/chat" />
        <CaseListSkeleton rows={4} />
      </View>
    );
  }
  if (!data) {
    const missing = toApiError(thread.error).status === 404;
    return (
      <View style={styles.page}>
        <BackLink label="Team chat" fallback="/staff/chat" />
        {missing ? (
          <EmptyState icon="chatbubbles-outline" title="No such chat" body="This channel or case doesn’t exist any more." />
        ) : (
          <ErrorBanner error={thread.error} onRetry={() => thread.refetch()} />
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header thread={data} />
      {thread.error ? (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
          <ErrorBanner error={thread.error} onRetry={() => thread.refetch()} />
        </View>
      ) : null}
      <Messages
        thread={data}
        readUpTo={readUpTo}
        refreshing={pulling}
        onRefresh={() => {
          setPulling(true);
          thread.refetch().finally(() => setPulling(false));
        }}
      />
      <Composer channelKey={data.channel.key} name={data.channel.name} />
    </KeyboardAvoidingView>
  );
}

function Header({ thread }: { thread: ChatThread }) {
  const theme = useTheme();
  const c = thread.channel;
  const who =
    c.channel === 'team' ? 'Everyone on staff' : c.channel === 'oncall' ? 'Whoever is on call now, plus admins' : `Staff only · ${c.case_title ?? ''}`;
  return (
    <View style={[styles.header, { borderBottomColor: theme.separator }]}>
      <BackLink label="Team chat" fallback="/staff/chat" />
      <View style={styles.headerRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" style={[styles.name, { color: theme.text }]} numberOfLines={1}>
            {c.name}
          </Text>
          <Text style={[type.caption, { color: theme.textSecondary }]} numberOfLines={1}>
            {who}
          </Text>
        </View>
        {c.channel === 'case' && c.case_id ? (
          <Pressable
            onPress={() => router.push({ pathname: '/staff/cases/[id]', params: { id: c.case_id! } })}
            accessibilityRole="link"
            accessibilityLabel={`Open case ${c.case_number ?? ''}`}
            hitSlop={8}
            style={({ pressed }) => [styles.caseLink, { backgroundColor: theme.fill }, pressed && { opacity: 0.7 }]}
          >
            <Text style={[type.footnote, { color: theme.accent, fontWeight: '700' }]}>Open case</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function Messages({ thread, readUpTo, refreshing, onRefresh }: { thread: ChatThread; readUpTo: string | null | undefined; refreshing: boolean; onRefresh: () => void }) {
  const theme = useTheme();
  const me = useStaffStatus().data?.id;
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  return (
    <ScrollView
      ref={scroll}
      style={{ flex: 1 }}
      contentContainerStyle={styles.thread}
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textSecondary} />}
    >
      {thread.messages.length ? (
        thread.messages.map((m) => <Bubble key={m.id} message={m} mine={m.author_id === me} readUpTo={readUpTo} />)
      ) : (
        <EmptyState
          icon="chatbubbles-outline"
          title="No messages yet"
          body={thread.channel.channel === 'case' ? 'Talk this case over with the team. The resident never sees it.' : 'Say hello, or share what the team should know.'}
        />
      )}
    </ScrollView>
  );
}

function Bubble({ message: m, mine, readUpTo }: { message: ChatMessage; mine: boolean; readUpTo: string | null | undefined }) {
  const theme = useTheme();
  const state = readState(m, mine, readUpTo);
  const meta = [mine ? 'You' : (m.author_name ?? 'Staff'), dateTime(m.created_at), state].filter(Boolean).join(' · ');
  return (
    <View
      style={[styles.bubbleRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}
      accessible
      accessibilityLabel={`${m.rapid ? 'Rapid response. ' : ''}${mine ? 'You' : (m.author_name ?? 'Staff')}: ${m.body}. ${dateTime(m.created_at)}${state ? `. ${state}` : ''}`}
    >
      <View
        style={[
          styles.bubble,
          mine ? { backgroundColor: theme.text } : { backgroundColor: theme.surface, borderColor: theme.separator, borderWidth: 1 },
          m.rapid && { borderColor: theme.danger, borderWidth: 1.5 },
        ]}
      >
        {m.rapid ? (
          <View style={styles.rapid}>
            <Ionicons name="flash" size={12} color={theme.danger} />
            <Text style={[styles.rapidLabel, { color: theme.danger }]}>RAPID RESPONSE</Text>
          </View>
        ) : null}
        <Text style={[type.subhead, { color: mine ? theme.bg : theme.text }]} selectable>
          {m.body}
        </Text>
        <Text style={[type.caption, { color: mine ? theme.textTertiary : theme.textSecondary }]}>{meta}</Text>
      </View>
    </View>
  );
}

function Composer({ channelKey, name }: { channelKey: string; name: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const send = useSendChatMessage(channelKey);
  const [text, setText] = useState('');
  const [rapid, setRapid] = useState(false);
  const body = text.trim();

  const submit = () => {
    if (!body) return;
    send.mutate(
      { body, rapid },
      {
        onSuccess: () => {
          setText('');
          setRapid(false);
          success();
        },
      },
    );
  };

  return (
    <View style={[styles.composer, { borderTopColor: theme.separator, backgroundColor: theme.surface, paddingBottom: space.md + insets.bottom }]}>
      <Pressable
        onPress={() => {
          tap();
          setRapid((on) => !on);
        }}
        accessibilityRole="switch"
        accessibilityState={{ checked: rapid }}
        accessibilityLabel="Rapid response"
        accessibilityHint="Marks the message urgent and notifies the channel's phones"
        style={({ pressed }) => [
          styles.rapidToggle,
          { backgroundColor: rapid ? theme.dangerSoft : theme.fill },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Ionicons name={rapid ? 'flash' : 'flash-outline'} size={16} color={rapid ? theme.danger : theme.textSecondary} />
        <Text style={[type.footnote, { color: rapid ? theme.danger : theme.textSecondary, fontWeight: '700' }]}>
          {rapid ? 'Rapid response: notifies everyone in this chat' : 'Rapid response'}
        </Text>
      </Pressable>
      {rapid ? <Notice icon="lock-closed-outline">Lock screens only say “New message in {name}”, never the text.</Notice> : null}
      {send.error ? <ErrorBanner error={send.error} /> : null}
      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={`Message ${name}`}
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.accent}
          multiline
          maxLength={2000}
          accessibilityLabel={`Message ${name}`}
          style={[styles.input, { backgroundColor: theme.fill, color: theme.text }]}
        />
        <Pressable
          onPress={submit}
          disabled={!body || send.isPending}
          accessibilityRole="button"
          accessibilityLabel={rapid ? 'Send rapid response' : 'Send message'}
          accessibilityState={{ disabled: !body || send.isPending }}
          style={({ pressed }) => [
            styles.send,
            { backgroundColor: rapid ? theme.danger : theme.accent },
            (!body || send.isPending) && { opacity: 0.4 },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Ionicons name={rapid ? 'flash' : 'send'} size={18} color={theme.onAccent} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: space.lg, gap: space.lg },
  header: { paddingHorizontal: space.lg, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { fontSize: 20, fontWeight: '800' },
  caseLink: { minHeight: 44, paddingHorizontal: space.md, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  thread: { padding: space.lg, gap: space.md, flexGrow: 1, justifyContent: 'flex-end' },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '82%', borderRadius: 16, padding: space.md, gap: 4 },
  rapid: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rapidLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, paddingTop: space.md, gap: space.sm },
  rapidToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: space.md, borderRadius: 22 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: { flex: 1, minHeight: 44, maxHeight: 140, borderRadius: 22, paddingHorizontal: space.md, paddingTop: 12, paddingBottom: 12, fontSize: 15 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
