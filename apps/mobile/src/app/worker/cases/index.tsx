import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  CASE_CATEGORIES,
  CASE_PRIORITIES,
  CASE_STATUSES,
  type CaseCategory,
  type CaseFilters,
  type CaseKind,
  type CasePriority,
  type CaseStatus,
} from '@/api/types';
import { Page } from '@/components/Page';
import { Button, EmptyState, ErrorBanner, Field, Loading } from '@/components/ui';
import { CaseTable } from '@/components/worker/CaseTable';
import { CATEGORY_LABEL, Card, ChoiceRow, PRIORITY_LABEL, PageTitle, STATUS_LABEL, priorityColor, statusColor } from '@/components/worker/kit';
import { useCases, useStaffStatus } from '@/services/cases';
import { space, type, useTheme } from '@/theme/tokens';

type Assignment = 'mine' | 'unassigned';
type StatusChoice = CaseStatus | 'open';

const STATUS_CHOICES = ['open', ...CASE_STATUSES] as const;
const STATUS_CHOICE_LABEL: Record<StatusChoice, string> = { open: 'All open', ...STATUS_LABEL };
const ASSIGNMENTS = ['mine', 'unassigned'] as const;
const ASSIGNMENT_LABEL: Record<Assignment, string> = { mine: 'Assigned to me', unassigned: 'Unassigned' };
const KINDS = ['request', 'incident'] as const;
const KIND_LABEL: Record<CaseKind, string> = { request: 'Requests', incident: 'Incidents' };

function one<T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/**
 * The case queue: every request and incident, filterable and searchable.
 * The dashboard's numbers open it pre-filtered (?status=new, ?open=1&urgent=1…).
 */
export default function CaseQueueScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ status?: string; priority?: string; category?: string; assigned?: string; open?: string; urgent?: string }>();
  const me = useStaffStatus();

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusChoice | null>(params.open === '1' ? 'open' : one(params.status, CASE_STATUSES));
  const [priority, setPriority] = useState<CasePriority | null>(one(params.priority, CASE_PRIORITIES));
  const [category, setCategory] = useState<CaseCategory | null>(one(params.category, CASE_CATEGORIES));
  const [assigned, setAssigned] = useState<Assignment | null>(one(params.assigned, ASSIGNMENTS));
  const [kind, setKind] = useState<CaseKind | null>(null);
  const [urgentOnly, setUrgentOnly] = useState(params.urgent === '1');

  const filters: Partial<CaseFilters> = {
    q: query.trim() || undefined,
    status: status && status !== 'open' ? status : undefined,
    open_only: status === 'open' || undefined,
    priority: priority ?? undefined,
    category: category ?? undefined,
    kind: kind ?? undefined,
    unassigned: assigned === 'unassigned' || undefined,
    assigned_worker_id: assigned === 'mine' ? me.data?.id : undefined,
    limit: 500,
  };
  const cases = useCases(filters, assigned !== 'mine' || !!me.data);
  const shown = useMemo(
    () => (urgentOnly ? (cases.data ?? []).filter((c) => c.priority === 'critical' || c.priority === 'high') : (cases.data ?? [])),
    [cases.data, urgentOnly],
  );
  const filtered = !!(query || status || priority || category || assigned || kind || urgentOnly);

  const clear = () => {
    setQuery('');
    setStatus(null);
    setPriority(null);
    setCategory(null);
    setAssigned(null);
    setKind(null);
    setUrgentOnly(false);
  };

  return (
    <Page refreshing={cases.isRefetching} onRefresh={() => cases.refetch()}>
      <PageTitle
        title="Cases"
        subtitle="Requests for help and incidents. Open cases first, most urgent at the top."
        right={<Button label="New case" icon="add" onPress={() => router.push('/worker/cases/new')} />}
      />

      <Card style={{ gap: space.md }}>
        <Field
          icon="search"
          placeholder="Search by #number, title, description or location"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search cases"
        />
        <ChoiceRow label="Status" options={STATUS_CHOICES} labels={STATUS_CHOICE_LABEL} value={status} onChange={setStatus} allowNone
          colorOf={(s) => (s === 'open' ? theme.accent : statusColor(theme, s))} />
        <ChoiceRow label="Priority" options={CASE_PRIORITIES} labels={PRIORITY_LABEL} value={priority} onChange={(p) => { setPriority(p); setUrgentOnly(false); }} allowNone
          colorOf={(p) => priorityColor(theme, p)} />
        <ChoiceRow label="Category" options={CASE_CATEGORIES} labels={CATEGORY_LABEL} value={category} onChange={setCategory} allowNone />
        <View style={styles.inline}>
          <View style={{ flexGrow: 1 }}>
            <ChoiceRow label="Assignment" options={ASSIGNMENTS} labels={ASSIGNMENT_LABEL} value={assigned} onChange={setAssigned} allowNone noneLabel="Anyone" />
          </View>
          <View style={{ flexGrow: 1 }}>
            <ChoiceRow label="Type" options={KINDS} labels={KIND_LABEL} value={kind} onChange={setKind} allowNone noneLabel="All" />
          </View>
        </View>
        {urgentOnly ? <Text style={[type.footnote, { color: theme.danger }]}>Showing high and critical priority only.</Text> : null}
      </Card>

      <View style={styles.inline}>
        <Text style={[type.subhead, { color: theme.textSecondary, flex: 1 }]}>
          {cases.isPending ? 'Loading…' : `${shown.length} case${shown.length === 1 ? '' : 's'}`}
        </Text>
        {filtered ? <Button label="Clear filters" variant="plain" onPress={clear} /> : null}
      </View>

      {cases.isPending ? (
        <Loading />
      ) : cases.error ? (
        <ErrorBanner error={cases.error} onRetry={() => cases.refetch()} />
      ) : shown.length ? (
        <CaseTable cases={shown} />
      ) : (
        <Card>
          <EmptyState
            icon="file-tray-outline"
            title={filtered ? 'No cases match' : 'No cases yet'}
            body={filtered ? 'Try fewer filters or a different search.' : 'New requests from the community will appear here.'}
            action={filtered ? <Button label="Clear filters" variant="tinted" onPress={clear} /> : undefined}
          />
        </Card>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.lg },
});
