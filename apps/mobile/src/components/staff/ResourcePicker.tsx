import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CASE_CATEGORIES, type Case, type CaseCategory, type Resource } from '@/api/types';
import { Button, ErrorBanner, Field, Loading, Sheet } from '@/components/ui';
import { ChoiceRow, SampleBadge } from '@/components/staff/kit';
import { CATEGORY_ICON, CATEGORY_LABEL } from '@/lib/cases';
import { useAddReferral, useCaseAssist } from '@/services/cases';
import { useResources } from '@/services/resources';
import { space, type, useTheme } from '@/theme/tokens';

/**
 * Connect a case with a resource: suggestions first (AI when it's set up,
 * otherwise the case's category), then the whole directory to search.
 */
export function ResourcePicker({ visible, onClose, item: c, referred }: { visible: boolean; onClose: () => void; item: Case; referred: string[] }) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CaseCategory | null>(c.category === 'other' ? null : c.category);
  const resources = useResources(query.trim() || undefined, category);
  const { resources: suggest } = useCaseAssist(c.id);
  const add = useAddReferral(c.id);

  useEffect(() => {
    if (visible && !suggest.data && !suggest.isPending) suggest.mutate();
    // Ask once each time the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const taken = new Set(referred);
  // The suggestion list hides whatever is already on the case, so it stays put after an add.
  const addResource = (r: Resource) => add.mutate({ resource_id: r.id });
  const suggestions = (suggest.data?.suggestions ?? []).filter((s) => !taken.has(s.resource.id));

  return (
    <Sheet visible={visible} onClose={onClose} title="Connect a resource" subtitle={`Case #${c.number}: ${c.title}`}>
      <View style={{ gap: space.sm }}>
        <View style={styles.row}>
          <Ionicons name="sparkles-outline" size={16} color={theme.accent} />
          <Text style={[type.headline, { color: theme.text, flex: 1 }]}>Suggested</Text>
          {suggest.data ? (
            <Text style={[type.caption, { color: theme.textSecondary }]}>
              {suggest.data.method === 'ai' ? 'Picked by AI from the directory' : 'Matched on the case’s category'}
            </Text>
          ) : null}
        </View>
        {suggest.isPending ? <Loading /> : null}
        {suggest.error ? <ErrorBanner error={suggest.error} onRetry={() => suggest.mutate()} /> : null}
        {suggest.data && !suggestions.length ? (
          <Text style={[type.subhead, { color: theme.textSecondary }]}>No suggestions left; search the directory below.</Text>
        ) : null}
        {suggestions.map((s) => (
          <ResourceRow key={s.resource.id} resource={s.resource} reason={s.reason} onAdd={() => addResource(s.resource)} busy={add.isPending} />
        ))}
      </View>

      <View style={{ gap: space.sm }}>
        <Text style={[type.headline, { color: theme.text }]}>Directory</Text>
        <Field icon="search" placeholder="Search by name, service or neighborhood" value={query} onChangeText={setQuery} autoCorrect={false} />
        <ChoiceRow options={CASE_CATEGORIES} labels={CATEGORY_LABEL} value={category} onChange={setCategory} allowNone noneLabel="All" />
        {resources.isPending ? <Loading /> : null}
        {resources.error ? <ErrorBanner error={resources.error} /> : null}
        {resources.data?.length === 0 ? <Text style={[type.subhead, { color: theme.textSecondary }]}>Nothing matches.</Text> : null}
        {resources.data?.map((r) => (
          <ResourceRow key={r.id} resource={r} onAdd={() => addResource(r)} added={taken.has(r.id)} busy={add.isPending} />
        ))}
      </View>
      {add.error ? <ErrorBanner error={add.error} /> : null}
    </Sheet>
  );
}

function ResourceRow({ resource: r, reason, onAdd, added, busy }: { resource: Resource; reason?: string; onAdd: () => void; added?: boolean; busy: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.resource, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          <Ionicons name={CATEGORY_ICON[r.category]} size={15} color={theme.accent} />
          <Text style={[type.subhead, { color: theme.text, fontWeight: '700', flexShrink: 1 }]}>{r.name}</Text>
          {r.is_sample ? <SampleBadge /> : null}
        </View>
        {reason ? <Text style={[type.footnote, { color: theme.accent }]}>{reason}</Text> : null}
        <Text style={[type.footnote, { color: theme.textSecondary }]} numberOfLines={2}>{r.description}</Text>
        <Text style={[type.caption, { color: theme.textSecondary }]}>
          {[r.neighborhood, r.hours, r.phone].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {added ? (
        <Text style={[type.footnote, { color: theme.textSecondary }]}>On case</Text>
      ) : (
        <Button label="Add" icon="add" variant="tinted" disabled={busy} onPress={onAdd} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  resource: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderWidth: 1, borderRadius: 10 },
});
