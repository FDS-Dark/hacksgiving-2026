import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import type { PublicRequestUpdate } from '@/api/types';
import { BigButton, Card, Pill, ResidentScreen, StatusChip, opened, requestHeading, when } from '@/components/resident';
import { Button, ErrorBanner, Loading, success } from '@/components/ui';
import { useReply, useResidentRequest } from '@/services/requests';
import { useTheme } from '@/theme/tokens';

/** My request (Figma A4): status, and only what staff chose to share. */
export default function MyRequestScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const request = useResidentRequest(id);
  const reply = useReply(id);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');

  const send = (content: string) =>
    reply.mutate(content, {
      onSuccess: () => {
        success();
        setDraft('');
        setComposing(false);
      },
    });

  // Signed out and not saved on this phone: they need the number and code.
  if (request.needsCode) return <Redirect href="/help/requests" />;

  const detail = request.data;
  const updates = detail ? [...detail.updates].reverse() : [];
  // Offer "Call me" on the newest message until they've answered it.
  const messageAt = updates.findIndex((u) => u.update_type === 'message');
  const replyAt = updates.findIndex((u) => u.update_type === 'reply');
  const answerable = messageAt >= 0 && (replyAt === -1 || replyAt > messageAt) ? updates[messageAt] : undefined;

  return (
    <ResidentScreen
      title="My request"
      refreshing={request.isRefetching}
      onRefresh={request.refetch}
      footer={
        detail ? (
          composing ? (
            <View style={{ gap: 8 }}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Write to ComForce"
                placeholderTextColor={theme.textTertiary}
                selectionColor={theme.accent}
                accessibilityLabel="Message to ComForce"
                multiline
                autoFocus
                maxLength={2000}
                style={[styles.composer, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.separator }]}
              />
              {reply.error ? <ErrorBanner error={reply.error} /> : null}
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Button label="Cancel" variant="plain" onPress={() => setComposing(false)} />
                <View style={{ flex: 1 }}>
                  <BigButton label="Send" onPress={() => send(draft.trim())} loading={reply.isPending} disabled={!draft.trim()} />
                </View>
              </View>
            </View>
          ) : (
            <BigButton label="Message ComForce" onPress={() => setComposing(true)} />
          )
        ) : null
      }
    >
      {request.error ? <ErrorBanner error={request.error} onRetry={request.refetch} /> : null}
      {!detail ? (
        request.isPending ? <Loading /> : null
      ) : (
        <>
          <Text style={[styles.heading, { color: theme.text }]} accessibilityRole="header">
            {requestHeading(detail.request)}
          </Text>
          <View style={styles.row}>
            <StatusChip status={detail.request.status} />
            <Text style={{ fontSize: 13, color: theme.textSecondary }}>{opened(detail.request.created_at)}</Text>
          </View>

          {updates.map((u) => (
            <Update
              key={u.id}
              update={u}
              onCallMe={u.id === answerable?.id && !reply.isPending ? () => send('Please call me.') : undefined}
            />
          ))}

          <Text style={{ fontSize: 12, color: theme.textSecondary }}>
            Only messages staff send you appear here. Internal notes stay private.
          </Text>
        </>
      )}
    </ResidentScreen>
  );
}

function Update({ update, onCallMe }: { update: PublicRequestUpdate; onCallMe?: () => void }) {
  const theme = useTheme();
  if (update.update_type === 'message') {
    return (
      <Card tone="accent">
        <Text style={[styles.meta, { color: theme.accent }]}>ComForce · {when(update.created_at)}</Text>
        <Text style={[styles.body, { color: theme.text }]}>{update.content}</Text>
        {onCallMe ? (
          <View style={styles.row}>
            <Pill label="Call me" icon="call-outline" tone="light" onPress={onCallMe} />
          </View>
        ) : null}
      </Card>
    );
  }
  if (update.update_type === 'reply') {
    return (
      <Card style={{ marginLeft: 32 }}>
        <Text style={[styles.meta, { color: theme.textSecondary }]}>You · {when(update.created_at)}</Text>
        <Text style={[styles.body, { color: theme.text }]}>{update.content}</Text>
      </Card>
    );
  }
  return (
    <Card style={{ gap: 4 }}>
      <Text style={[styles.meta, { color: theme.textSecondary, fontSize: 12 }]}>{when(update.created_at)}</Text>
      <Text style={[styles.body, { color: theme.text }]}>{readable(update)}</Text>
    </Card>
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
  heading: { fontSize: 22, fontWeight: '800' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  meta: { fontSize: 13, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21 },
  composer: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15, minHeight: 80, maxHeight: 160, textAlignVertical: 'top' },
});
