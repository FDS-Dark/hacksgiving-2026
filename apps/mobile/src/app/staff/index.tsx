import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Case } from '@/api/types';
import { Page } from '@/components/Page';
import { ErrorBanner, Loading } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { Card, StatTile, priorityColor, statusColor } from '@/components/staff/kit';
import { needsAttention } from '@/lib/attention';
import { CATEGORY_LABEL } from '@/lib/cases';
import { timeAgo } from '@/lib/format';
import { useCases, useInsights } from '@/services/cases';
import { useStaffStatus } from '@/services/staff';
import { space, type, useTheme } from '@/theme/tokens';

/** Figma "Step 3 · Staff · Today": the numbers, your cases, and what needs a person now. */
export default function TodayScreen() {
  const theme = useTheme();
  const me = useStaffStatus();
  const insights = useInsights();
  const open = useCases({ open_only: true, limit: 100 });

  const refresh = () => {
    insights.refetch();
    open.refetch();
  };

  const now = new Date();
  const hour = now.getHours();
  const date = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
  const stats = insights.data?.stats;
  const mine = (open.data ?? []).filter((c) => c.assigned_worker_id === me.data?.id);

  return (
    <Page refreshing={insights.isRefetching || open.isRefetching} onRefresh={refresh} contentStyle={{ maxWidth: 720, gap: space.lg }}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.kicker, { color: theme.accent }]}>COMFORCE STAFF · {date}</Text>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
            {hour >= 17 || hour < 5 ? 'Tonight' : 'Today'}
          </Text>
        </View>
        <Pressable onPress={() => router.replace('/staff/me')} accessibilityRole="button" accessibilityLabel="Me">
          <Avatar name={me.data?.display_name} size={36} />
        </Pressable>
      </View>

      {insights.error ? <ErrorBanner error={insights.error} onRetry={refresh} /> : null}
      {stats ? (
        <View style={styles.tiles}>
          <StatTile label="Active" value={stats.active} onPress={() => router.push('/staff/cases?open=1')} />
          <StatTile label="New" value={stats.new} color={statusColor(theme, 'new')} onPress={() => router.push('/staff/cases?status=new')} />
          <StatTile label="Urgent" value={stats.high_priority_active} color={theme.danger} onPress={() => router.push('/staff/cases?open=1&urgent=1')} />
          <StatTile
            label="Unassigned"
            value={stats.unassigned_active}
            color={priorityColor(theme, 'high')}
            onPress={() => router.push('/staff/cases?open=1&assigned=unassigned')}
          />
        </View>
      ) : insights.isPending ? (
        <Loading />
      ) : null}

      {open.isPending ? (
        <Loading />
      ) : open.error ? (
        <ErrorBanner error={open.error} onRetry={() => open.refetch()} />
      ) : (
        <>
          <Section title="Assigned to you" link={mine.length ? `${mine.length} open` : undefined} href="/staff/cases?open=1&assigned=mine">
            {mine.length ? (
              mine.slice(0, 5).map((c) => (
                <CaseLine key={c.id} item={c} color={priorityColor(theme, c.priority)} line={`${CATEGORY_LABEL[c.category]} · updated ${timeAgo(c.last_activity_at)}`} />
              ))
            ) : (
              <Quiet icon="person-outline" text="Nothing assigned to you. Take a case from the queue." />
            )}
          </Section>

          <Section title="Needs attention" link="Queue" href="/staff/cases?open=1">
            {needsAttention(open.data).map(({ item: c, reason }) => {
              const color = reason === 'urgent' ? theme.danger : reason === 'new' ? statusColor(theme, 'new') : priorityColor(theme, 'high');
              const line =
                reason === 'urgent'
                  ? `Urgent · ${c.assigned_worker_name ?? 'unassigned'}`
                  : reason === 'new'
                    ? `New · not triaged · ${timeAgo(c.created_at)}`
                    : `Unassigned · opened ${timeAgo(c.created_at)}`;
              return <CaseLine key={c.id} item={c} color={color} line={line} />;
            })}
            {needsAttention(open.data).length ? null : <Quiet icon="checkmark-circle" text="Nothing urgent, new or unassigned right now." />}
          </Section>
        </>
      )}
    </Page>
  );
}

function Section({ title, link, href, children }: { title: string; link?: string; href: Href; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.sectionHead}>
        <Text accessibilityRole="header" style={[type.headline, { color: theme.text, flex: 1 }]}>
          {title}
        </Text>
        {link ? (
          <Text onPress={() => router.replace(href)} accessibilityRole="link" style={[type.footnote, { color: theme.accent, fontWeight: '700' }]}>
            {link}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** One case as a row with a colored rule: the reason it's here, in the rule's color. */
function CaseLine({ item: c, color, line }: { item: Case; color: string; line: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/staff/cases/[id]', params: { id: c.id } })}
      accessibilityRole="link"
      accessibilityLabel={`Case ${c.number}: ${c.title}. ${line}`}
      style={({ pressed }) => [styles.line, { backgroundColor: theme.surface, borderColor: theme.separator }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.rule, { backgroundColor: color }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.subhead, { color: theme.text, fontWeight: '600' }]} numberOfLines={1}>
          #{c.number} {c.title}
        </Text>
        <Text style={[type.caption, { color }]} numberOfLines={1}>
          {line}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
    </Pressable>
  );
}

function Quiet({ icon, text }: { icon: 'person-outline' | 'checkmark-circle'; text: string }) {
  const theme = useTheme();
  return (
    <Card style={styles.quiet}>
      <Ionicons name={icon} size={18} color={theme.accent} />
      <Text style={[type.subhead, { color: theme.textSecondary, flex: 1 }]}>{text}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  title: { fontSize: 28, fontWeight: '800' },
  tiles: { flexDirection: 'row', gap: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: space.md },
  rule: { width: 4, height: 34, borderRadius: 2 },
  quiet: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
