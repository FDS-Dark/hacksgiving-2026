import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { PublicRequest, PublicRequestUpdate } from '@/api/types';
import { CardSkeleton } from '@/components/Skeleton';
import { Pill, REQUEST_STEPS, ResidentScreen, StatusChip, isOpenStatus, opened, requestStep, when } from '@/components/resident';
import { ErrorBanner, success } from '@/components/ui';
import { useReply, useResidentRequest } from '@/services/requests';
import { space, useTheme } from '@/theme/tokens';

/**
 * Figma R2 "Request thread": where the request stands, then the
 * conversation in order (only what staff chose to share), with a quick
 * "Call me" reply and a composer at the bottom.
 */
export default function RequestThreadScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const request = useResidentRequest(id);
  const reply = useReply(id);
  const [draft, setDraft] = useState('');

  const send = (content: string) =>
    reply.mutate(content, {
      onSuccess: () => {
        success();
        setDraft('');
      },
    });

  // Signed out and not saved on this phone: they need the number and code.
  if (request.needsCode) return <Redirect href="/help/requests" />;

  const detail = request.data;
  const updates = detail?.updates ?? [];
  // Offer "Call me" on the newest message until they've answered it.
  const lastMessage = updates.findLastIndex((u) => u.update_type === 'message');
  const lastReply = updates.findLastIndex((u) => u.update_type === 'reply');
  const answerable = lastMessage >= 0 && lastReply < lastMessage ? updates[lastMessage] : undefined;

  return (
    <ResidentScreen
      title={detail?.request.title ?? 'My request'}
      refreshing={request.isRefetching}
      onRefresh={request.refetch}
      footer={
        detail ? (
          <View style={{ gap: space.sm }}>
            {reply.error ? <ErrorBanner error={reply.error} /> : null}
            <View style={styles.inputRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Message ComForce"
                placeholderTextColor={theme.textTertiary}
                selectionColor={theme.accent}
                accessibilityLabel="Message to ComForce"
                multiline
                maxLength={2000}
                style={[styles.input, { color: theme.text, backgroundColor: theme.fill }]}
              />
              <Pressable
                onPress={() => send(draft.trim())}
                disabled={!draft.trim() || reply.isPending}
                accessibilityRole="button"
                accessibilityLabel="Send"
                style={({ pressed }) => [styles.send, { backgroundColor: theme.accent }, (!draft.trim() || reply.isPending) && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="send" size={18} color={theme.onAccent} />
              </Pressable>
            </View>
          </View>
        ) : null
      }
    >
      {request.error && !detail ? <ErrorBanner error={request.error} onRetry={request.refetch} /> : null}
      {!detail ? (
        request.isPending ? <CardSkeleton lines={4} /> : null
      ) : (
        <>
          <Where request={detail.request} />
          {updates.map((u) => (
            <Update
              key={u.id}
              update={u}
              onCallMe={u.id === answerable?.id && !reply.isPending ? () => send('Please call me.') : undefined}
            />
          ))}
          <Text style={[styles.small, { color: theme.textSecondary, textAlign: 'center' }]}>
            Only messages ComForce sends you appear here. Internal notes stay private.
          </Text>
        </>
      )}
    </ResidentScreen>
  );
}

/** The strip under the title: status, which step it's on, and when it was opened. */
function Where({ request: r }: { request: PublicRequest }) {
  const theme = useTheme();
  const open = isOpenStatus(r.status);
  return (
    <View style={[styles.where, { backgroundColor: open ? theme.infoSoft : theme.accentSoft }]}>
      <StatusChip status={r.status} />
      <Text style={[styles.small, { color: theme.text, flex: 1 }]}>
        #{r.number}
        {open ? ` · step ${requestStep(r.status)} of ${REQUEST_STEPS}` : ''} · {opened(r.created_at)}
      </Text>
    </View>
  );
}

function Update({ update, onCallMe }: { update: PublicRequestUpdate; onCallMe?: () => void }) {
  const theme = useTheme();
  if (update.update_type === 'message') {
    return (
      <View style={{ gap: space.sm, alignItems: 'flex-start' }}>
        <View style={[styles.bubble, { backgroundColor: theme.surface, borderColor: theme.separator, borderWidth: 1 }]}>
          <Text style={[styles.body, { color: theme.text }]}>{update.content}</Text>
          <Text style={[styles.meta, { color: theme.textSecondary }]}>ComForce · {when(update.created_at)}</Text>
        </View>
        {onCallMe ? <Pill label="Call me" icon="call-outline" tone="light" onPress={onCallMe} /> : null}
      </View>
    );
  }
  if (update.update_type === 'reply') {
    return (
      <View style={{ alignItems: 'flex-end' }}>
        <View style={[styles.bubble, { backgroundColor: theme.text }]}>
          <Text style={[styles.body, { color: theme.bg }]}>{update.content}</Text>
          <Text style={[styles.meta, { color: theme.textTertiary }]}>You · {when(update.created_at)}</Text>
        </View>
      </View>
    );
  }
  return (
    <Text style={[styles.small, { color: theme.textSecondary, textAlign: 'center' }]}>
      {when(update.created_at)} · {readable(update)}
    </Text>
  );
}

/** "Status changed from new to in progress." reads as the mockup's "Status changed to In progress". */
function readable(update: PublicRequestUpdate) {
  if (update.update_type === 'created') return 'Request received';
  const status = /^Status changed from .+ to (.+)\.$/.exec(update.content);
  if (status) {
    const to = status[1];
    return `Status changed to ${to.charAt(0).toUpperCase()}${to.slice(1)}`;
  }
  return update.content;
}

const styles = StyleSheet.create({
  where: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: 12 },
  bubble: { maxWidth: '85%', borderRadius: 16, padding: space.md, gap: 4 },
  body: { fontSize: 15, lineHeight: 21 },
  meta: { fontSize: 12 },
  small: { fontSize: 12, lineHeight: 17 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: { flex: 1, minHeight: 44, maxHeight: 140, borderRadius: 22, paddingHorizontal: space.md, paddingTop: 12, paddingBottom: 12, fontSize: 15 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
