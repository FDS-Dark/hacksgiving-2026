import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Page } from '@/components/Page';
import { CaseListSkeleton } from '@/components/Skeleton';
import { Card } from '@/components/staff/kit';
import { NotificationBell } from '@/components/staff/NotificationBell';
import { PushBlockedNotice, useOncallSwitch } from '@/components/staff/OncallCard';
import { alertHref } from '@/components/staff/Urgent';
import { Button, ErrorBanner, Group, Row, Toggle, type TileIcon } from '@/components/ui';
import { oncallSubtitle, oncallTitle } from '@/lib/oncall';
import { TODAY_LIMIT, buildWorklist, type WorkItem, type WorkKind } from '@/lib/today';
import { useCases } from '@/services/cases';
import { useHandoffs, useOpenAlerts } from '@/services/oncall';
import { useRecords } from '@/services/records';
import { useStaffStatus } from '@/services/staff';
import { useTasks } from '@/services/tasks';
import { space, type, useTheme, type Theme } from '@/theme/tokens';

function hrefFor(item: WorkItem): Href {
  const t = item.target;
  switch (t.screen) {
    case 'alert':
      return alertHref(t.id);
    case 'case':
      return { pathname: '/staff/cases/[id]', params: { id: t.id } };
    case 'record':
      return { pathname: '/staff/records/[id]', params: { id: t.id } };
    case 'handoff':
      return { pathname: '/staff/handoffs/[id]', params: { id: t.id } };
    case 'tasks':
      return '/staff/tasks';
  }
}

const KIND_ICON: Record<WorkKind, TileIcon> = {
  urgent: 'alert-circle',
  overdue: 'clock-alert-outline',
  due_today: 'calendar-today',
  review: 'file-document-edit-outline',
  assigned: 'account-check-outline',
};

function kindColor(theme: Theme, kind: WorkKind) {
  return kind === 'urgent' || kind === 'overdue' ? theme.danger : kind === 'due_today' ? theme.soon : theme.accent;
}

/**
 * Staff Today: one ordered worklist, "Do this next" (cognitive-load review,
 * top 10 #6). Urgent offers, tasks due, debriefs and handoffs to read, and
 * my cases, most pressing first; the first row is the next action. At most
 * TODAY_LIMIT rows show before "See all". Every source that fails says so,
 * so a failed load never reads as "nothing to do".
 */
export default function TodayScreen() {
  const theme = useTheme();
  const me = useStaffStatus();
  const myId = me.data?.id;
  // Open urgent alerts refresh every 15 s, but only while Today is on screen.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const alerts = useOpenAlerts(focused);
  const cases = useCases({ open_only: true, limit: 100 });
  const tasks = useTasks({ mine: true, open_only: true, limit: 200 });
  const records = useRecords();
  const handoffs = useHandoffs(Boolean(myId));
  const oncall = useOncallSwitch();
  const [showAll, setShowAll] = useState(false);
  // "Overdue" and "fresh" are judged against when Today opened (or was refreshed).
  const [now, setNow] = useState(() => new Date());

  const sources = [
    { what: 'urgent alerts', query: alerts },
    { what: 'your cases', query: cases },
    { what: 'your tasks', query: tasks },
    { what: 'your debriefs', query: records },
    { what: 'handoffs', query: handoffs },
  ];
  const failed = sources.filter((s) => s.query.error && s.query.data === undefined);
  const stale = sources.filter((s) => s.query.error && s.query.data !== undefined);
  const loading = sources.filter((s) => s.query.isPending && !s.query.error);
  const refresh = () => {
    setNow(new Date());
    for (const s of sources) void s.query.refetch();
    void oncall.now.refetch();
  };

  const items = useMemo(
    () =>
      buildWorklist({
        alerts: alerts.data ?? [],
        tasks: tasks.data ?? [],
        records: records.data ?? [],
        handoffs: handoffs.data ?? [],
        cases: cases.data ?? [],
        myId,
        now,
      }),
    [alerts.data, tasks.data, records.data, handoffs.data, cases.data, myId, now],
  );
  const [next, ...rest] = items;
  const shown = showAll ? rest : rest.slice(0, TODAY_LIMIT - 1);
  const hidden = rest.length - shown.length;
  const nothingLoadedYet = loading.length === sources.length;

  return (
    <Page refreshing={sources.some((s) => s.query.isRefetching)} onRefresh={refresh} contentStyle={{ maxWidth: 720, gap: space.lg }}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
            Today
          </Text>
          <Text style={[type.subhead, { color: theme.textSecondary }]}>
            {now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </Text>
        </View>
        <NotificationBell />
      </View>

      {failed.length ? <Problem text={`Couldn’t load ${listOf(failed.map((s) => s.what))}. Your list may be missing work.`} onRetry={refresh} /> : null}
      {stale.length ? <Problem text={`Couldn’t refresh ${listOf(stale.map((s) => s.what))}. Showing what you had.`} onRetry={refresh} /> : null}
      {oncall.pushBlocked ? <PushBlockedNotice /> : null}

      <View style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.headline, { color: theme.text }]}>
          Do this next
        </Text>
        {nothingLoadedYet ? (
          <CaseListSkeleton rows={3} />
        ) : next ? (
          <>
            <NextCard item={next} />
            {shown.length ? (
              <Group>
                {shown.map((item) => (
                  <Row
                    key={item.key}
                    title={item.title}
                    subtitle={item.line}
                    tile={{ icon: KIND_ICON[item.kind], color: kindColor(theme, item.kind) }}
                    accessory="chevron"
                    accessibilityLabel={`${item.title}. ${item.line}`}
                    onPress={() => router.push(hrefFor(item))}
                  />
                ))}
              </Group>
            ) : null}
            {hidden > 0 || showAll ? (
              <Button label={showAll ? 'Show less' : `See all ${items.length}`} variant="plain" onPress={() => setShowAll((s) => !s)} />
            ) : null}
            {loading.length ? <Text style={[type.footnote, { color: theme.textSecondary }]}>Still checking {listOf(loading.map((s) => s.what))}…</Text> : null}
          </>
        ) : loading.length ? (
          <CaseListSkeleton rows={2} />
        ) : failed.length ? null : (
          <Card style={styles.quiet}>
            <Ionicons name="checkmark-circle" size={20} color={theme.accent} />
            <Text style={[type.subhead, { color: theme.textSecondary, flex: 1 }]}>Nothing needs you right now. Take a case from the Queue.</Text>
            <Button label="Queue" variant="plain" onPress={() => router.replace('/staff/cases')} />
          </Card>
        )}
      </View>

      {/* Team: the shift, and (from feat/track-gaps) team chat. */}
      <Group header="Team">
        <Row
          title={oncall.now.data ? oncallTitle(oncall.now.data) : 'On call'}
          subtitle={oncall.now.data ? oncallSubtitle(oncall.now.data) : oncall.now.error ? 'Couldn’t check who’s on call' : 'Checking who’s on call…'}
          icon="call-outline"
          right={oncall.now.data ? <Toggle value={oncall.on} onChange={oncall.set} disabled={oncall.busy} label="On call" /> : undefined}
        />
        {/*
          TEAM CHAT SLOT. feat/track-gaps adds components/staff/TeamChatCard and
          the /staff/chat routes. At merge, drop a "Team chat" Row here (title
          "Team chat", the unread count as `detail`, chevron, onPress →
          router.push('/staff/chat')) instead of placing TeamChatCard above the
          worklist, so Today keeps one list and ≤10 actions.
        */}
      </Group>
      {oncall.error ? <ErrorBanner error={oncall.error} /> : null}
    </Page>
  );
}

/** A source that failed: what's missing, and one retry. Never reads as "nothing to do". */
function Problem({ text, onRetry }: { text: string; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.problem, { backgroundColor: theme.dangerSoft }]} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={20} color={theme.danger} />
      <Text style={[type.subhead, { color: theme.danger, flex: 1 }]}>{text}</Text>
      <Button label="Retry" icon="refresh" variant="plain" onPress={onRetry} />
    </View>
  );
}

/** "your tasks and your debriefs" */
function listOf(parts: string[]) {
  return parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The single next action: larger, outlined in its color, read first. */
function NextCard({ item }: { item: WorkItem }) {
  const theme = useTheme();
  const color = kindColor(theme, item.kind);
  return (
    <Pressable
      onPress={() => router.push(hrefFor(item))}
      accessibilityRole="button"
      accessibilityLabel={`Next: ${item.title}. ${item.line}`}
      style={({ pressed }) => [styles.next, { backgroundColor: theme.surface, borderColor: color }, pressed && { opacity: 0.8 }]}
    >
      <View style={[styles.rule, { backgroundColor: color }]} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[type.caption, { color, fontWeight: '700' }]}>Next</Text>
        <Text style={[type.headline, { color: theme.text }]} numberOfLines={3}>
          {item.title}
        </Text>
        <Text style={[type.subhead, { color: theme.textSecondary }]} numberOfLines={2}>
          {item.line}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { fontSize: 28, fontWeight: '800' },
  quiet: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  next: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 2, borderRadius: 14, padding: space.md, minHeight: 72 },
  rule: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  problem: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.md, paddingVertical: space.xs, borderRadius: 14, minHeight: 44 },
});
