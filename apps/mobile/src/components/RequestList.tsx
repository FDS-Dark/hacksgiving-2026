/**
 * A resident's requests (Figma R1), shared by the Requests tab (signed in)
 * and /help/requests (signed out, requests saved on this phone).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { PublicRequest } from '@/api/types';
import { BigButton, Card, Input, RequestProgress, StatusChip, isOpenStatus, requestHeading, updatedAgo } from '@/components/resident';
import { Button, Chip, Chips, EmptyState, ErrorBanner, Loading } from '@/components/ui';
import { useFindRequest, useForgetRequest, useResidentRequests } from '@/services/requests';
import { space, useTheme } from '@/theme/tokens';

export function RequestList() {
  const list = useResidentRequests();
  const forget = useForgetRequest();
  const [show, setShow] = useState<'open' | 'closed'>('open');

  if (list.isPending) return <Loading label="Loading your requests" />;

  const open = list.requests.filter((r) => isOpenStatus(r.status));
  const closed = list.requests.filter((r) => !isOpenStatus(r.status));
  const shown = show === 'open' ? open : closed;

  return (
    <View style={{ gap: space.md }}>
      {list.error ? <ErrorBanner error={list.error} onRetry={list.refetch} /> : null}

      {list.requests.length ? (
        <>
          <Chips>
            <Chip label={`Open (${open.length})`} active={show === 'open'} onPress={() => setShow('open')} />
            <Chip label={`Closed (${closed.length})`} active={show === 'closed'} onPress={() => setShow('closed')} />
          </Chips>
          {shown.length ? (
            shown.map((r) => <RequestCard key={r.id} request={r} />)
          ) : (
            <QuietText>{show === 'open' ? 'Nothing open right now.' : 'No closed requests yet.'}</QuietText>
          )}
        </>
      ) : (
        <EmptyState
          icon="file-tray-outline"
          title="No requests yet"
          body="When you ask ComForce for help, it shows up here with every reply and where it stands."
        />
      )}

      {list.unavailable.map((r) => (
        <Card key={r.id}>
          <QuietText>Request #{r.number} can’t be opened right now.</QuietText>
          <Button label="Forget it on this phone" variant="plain" onPress={() => forget.mutate(r.id)} />
        </Card>
      ))}
    </View>
  );
}

/** A request in a list (Figma R1): number, status, title, progress, last change. */
export function RequestCard({ request, label }: { request: PublicRequest; label?: string }) {
  const theme = useTheme();
  const open = isOpenStatus(request.status);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/help/request/[id]', params: { id: request.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${label ? `${label}: ` : ''}${requestHeading(request)}`}
      style={({ pressed }) => pressed && { opacity: 0.7 }}
    >
      <Card style={{ gap: 10 }}>
        <View style={styles.row}>
          <Text style={[styles.small, { color: theme.textSecondary, flex: 1 }]}>{label ?? `#${request.number}`}</Text>
          <StatusChip status={request.status} />
        </View>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
          {request.title}
        </Text>
        {open ? <RequestProgress status={request.status} /> : null}
        <View style={styles.row}>
          {open ? null : <Ionicons name="checkmark" size={14} color={theme.accent} />}
          <Text style={[styles.small, { color: theme.textSecondary }]}>{updatedAgo(request.updated_at)}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

/** Open a request sent without an account, from its receipt (number + access code). */
export function FindRequest() {
  const theme = useTheme();
  const find = useFindRequest();
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const parsed = Number.parseInt(number.replace(/\D/g, ''), 10);
  const ready = parsed > 0 && code.replace(/[^a-z0-9]/gi, '').length >= 8;

  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: theme.text }}>Have a reference number and code?</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 2 }}>
          <Input label="Reference #" value={number} onChangeText={setNumber} placeholder="1042" keyboardType="number-pad" maxLength={10} />
        </View>
        <View style={{ flex: 3 }}>
          <Input
            label="Access code"
            value={code}
            onChangeText={setCode}
            placeholder="K7QM-4XPA"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
          />
        </View>
      </View>
      {find.error ? <ErrorBanner error={find.error} /> : null}
      <BigButton
        label="Open request"
        variant="outline"
        disabled={!ready}
        loading={find.isPending}
        onPress={() =>
          find.mutate(
            { number: parsed, code: code.trim() },
            { onSuccess: (request) => router.push({ pathname: '/help/request/[id]', params: { id: request.id } }) },
          )
        }
      />
    </Card>
  );
}

function QuietText({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return <Text style={{ fontSize: 15, color: theme.textSecondary }}>{children}</Text>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  small: { fontSize: 13 },
  title: { fontSize: 17, fontWeight: '700' },
});
