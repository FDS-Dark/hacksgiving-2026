import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { CASE_CATEGORIES, CASE_STATUSES, type Case, type CaseCategory, type CaseFilters, type CaseStatus } from '@/api/types';
import { Page } from '@/components/Page';
import { StaffGate } from '@/components/StaffGate';
import { SectionHeading } from '@/components/brand';
import { Chip, Chips, EmptyState, ErrorBanner, Loading } from '@/components/ui';
import { PRIORITY_INFO, SERVICE_INFO, STAFF_STATUS_LABEL, timeAgo } from '@/lib/requests';
import { useCases } from '@/services/cases';
import { radius, space, useTheme } from '@/theme/tokens';

type StatusFilter = 'open' | 'all' | CaseStatus;

/**
 * The ComForce portal: every request (community or worker-opened) grouped by
 * the ComForce service it was routed to. Tiles count each service and narrow
 * the list to it; the status chips pick which cases are counted.
 */
export default function WorkerScreen() {
  return (
    <Page contentStyle={{ gap: space.lg }}>
      <SectionHeading title="ComForce Portal" kicker="Every request from the community, sorted by ComForce service." />
      <StaffGate>
        <Queue />
      </StaffGate>
    </Page>
  );
}

function filtersFor(status: StatusFilter, q: string): Partial<CaseFilters> {
  const search = q.trim() || undefined;
  if (status === 'open') return { open_only: true, limit: 500, q: search };
  if (status === 'all') return { limit: 500, q: search };
  return { status, limit: 500, q: search };
}

function Queue() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [status, setStatus] = useState<StatusFilter>('open');
  const [service, setService] = useState<CaseCategory | null>(null);
  const [q, setQ] = useState('');
  const cases = useCases(filtersFor(status, q));

  const byService = useMemo(() => {
    const groups = new Map<CaseCategory, Case[]>(CASE_CATEGORIES.map((c) => [c, []]));
    for (const c of cases.data ?? []) groups.get(c.category)?.push(c);
    return groups;
  }, [cases.data]);

  const tileColumns = width >= 1100 ? 5 : width >= 700 ? 3 : 2;
  const shown = service ? [service] : CASE_CATEGORIES.filter((c) => (byService.get(c)?.length ?? 0) > 0);
  const total = cases.data?.length ?? 0;

  return (
    <View style={{ gap: space.lg }}>
      <Chips scroll>
        <Chip label="Open" active={status === 'open'} onPress={() => setStatus('open')} />
        <Chip label="All" active={status === 'all'} onPress={() => setStatus('all')} />
        {CASE_STATUSES.map((s) => (
          <Chip key={s} label={STAFF_STATUS_LABEL[s]} active={status === s} onPress={() => setStatus(s)} />
        ))}
      </Chips>

      <View style={[styles.search, { backgroundColor: theme.fill }]}>
        <Ionicons name="search" size={18} color={theme.textSecondary} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search by number, title, description or location"
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.accent}
          style={[styles.searchInput, { color: theme.text }]}
          accessibilityLabel="Search requests"
          autoCorrect={false}
        />
      </View>

      {/* One tile per service, plus "All". */}
      <View style={styles.tiles}>
        <View style={{ width: `${100 / tileColumns}%`, padding: space.xs }}>
          <ServiceTile icon="apps" label="All services" count={total} active={service === null} onPress={() => setService(null)} />
        </View>
        {CASE_CATEGORIES.map((c) => (
          <View key={c} style={{ width: `${100 / tileColumns}%`, padding: space.xs }}>
            <ServiceTile
              icon={SERVICE_INFO[c].icon}
              label={SERVICE_INFO[c].label}
              count={byService.get(c)?.length ?? 0}
              active={service === c}
              onPress={() => setService(service === c ? null : c)}
            />
          </View>
        ))}
      </View>

      {cases.isPending ? (
        <Loading label="Loading requests" />
      ) : cases.isError ? (
        <ErrorBanner error={cases.error} onRetry={() => cases.refetch()} />
      ) : shown.every((c) => (byService.get(c)?.length ?? 0) === 0) ? (
        <EmptyState
          icon="file-tray-outline"
          title="No requests here"
          body={service ? `Nothing for ${SERVICE_INFO[service].label} with this filter.` : 'Nothing matches this filter yet.'}
        />
      ) : (
        shown.map((c) => <ServiceSection key={c} category={c} cases={byService.get(c) ?? []} />)
      )}
    </View>
  );
}

function ServiceTile({
  icon,
  label,
  count,
  active,
  onPress,
}: {
  icon: (typeof SERVICE_INFO)[CaseCategory]['icon'];
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}, ${count} ${count === 1 ? 'request' : 'requests'}`}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: active ? theme.accent : theme.surface, borderColor: active ? theme.accent : theme.separator },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={styles.tileTop}>
        <Ionicons name={icon} size={20} color={active ? theme.onAccent : theme.accent} />
        <Text style={[styles.tileCount, { color: active ? theme.onAccent : theme.text }]}>{count}</Text>
      </View>
      <Text style={[styles.tileLabel, { color: active ? theme.onAccent : theme.textSecondary }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function ServiceSection({ category, cases }: { category: CaseCategory; cases: Case[] }) {
  const theme = useTheme();
  const info = SERVICE_INFO[category];
  return (
    <View style={{ gap: space.sm }}>
      <View style={[styles.sectionHeader, { borderBottomColor: theme.accent }]}>
        <Ionicons name={info.icon} size={20} color={theme.accent} />
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>
          {info.label}
        </Text>
        <Text style={[styles.sectionCount, { color: theme.textSecondary }]}>{cases.length}</Text>
      </View>
      {cases.length === 0 ? (
        <Text style={{ color: theme.textTertiary, fontSize: 14, paddingVertical: space.sm }}>No requests with this filter.</Text>
      ) : (
        cases.map((c) => <CaseRow key={c.id} item={c} />)
      )}
    </View>
  );
}

function CaseRow({ item }: { item: Case }) {
  const theme = useTheme();
  const urgent = item.priority === 'critical' || item.priority === 'high';
  const priorityColor = urgent ? theme.danger : theme.textSecondary;
  return (
    <Pressable
      onPress={() => router.navigate({ pathname: '/worker/[id]', params: { id: item.id } })}
      accessibilityRole="link"
      accessibilityLabel={`Case ${item.number}, ${item.title}, ${PRIORITY_INFO[item.priority].label} priority, ${STAFF_STATUS_LABEL[item.status]}`}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.surface, borderColor: theme.separator, borderLeftColor: urgent ? theme.danger : theme.separator },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.rowTop}>
          <Text style={[styles.number, { color: theme.textTertiary }]}>#{item.number}</Text>
          <Badge label={PRIORITY_INFO[item.priority].label} color={priorityColor} bg={urgent ? theme.dangerSoft : theme.fill} />
          <Badge label={STAFF_STATUS_LABEL[item.status]} color={theme.accent} bg={theme.accentSoft} />
          {item.source === 'public' ? <Badge label="Community" color={theme.textSecondary} bg={theme.fill} /> : null}
        </View>
        <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.textSecondary }]} numberOfLines={1}>
          {[item.contact_name, item.location, timeAgo(item.created_at)].filter(Boolean).join(' · ')}
        </Text>
        <Text style={[styles.rowMeta, { color: item.assigned_worker_name ? theme.textSecondary : theme.soon }]}>
          {item.assigned_worker_name ? `Assigned to ${item.assigned_worker_name}` : 'Unassigned'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
    </Pressable>
  );
}

function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.sm, minHeight: 44 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: space.sm },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs },
  tile: { gap: space.sm, padding: space.md, borderWidth: 1, borderRadius: radius.md, minHeight: 86 },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileCount: { fontSize: 24, fontWeight: '900' },
  tileLabel: { fontSize: 13, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingBottom: space.sm, borderBottomWidth: 2, marginTop: space.md },
  sectionTitle: { flex: 1, fontSize: 18, fontWeight: '900', textTransform: 'uppercase' },
  sectionCount: { fontSize: 15, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderWidth: 1, borderLeftWidth: 4, borderRadius: radius.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  number: { fontSize: 13, fontWeight: '800' },
  rowTitle: { fontSize: 16, fontWeight: '800' },
  rowMeta: { fontSize: 13, lineHeight: 18 },
  badge: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
});
