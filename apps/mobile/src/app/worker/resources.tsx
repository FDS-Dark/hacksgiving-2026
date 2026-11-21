import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CASE_CATEGORIES, type CaseCategory } from '@/api/types';
import { Page } from '@/components/Page';
import { Button, EmptyState, ErrorBanner, Field, Loading, Notice, Sheet, success } from '@/components/ui';
import { CATEGORY_ICON, CATEGORY_LABEL, Card, ChoiceRow, PageTitle, SampleBadge } from '@/components/worker/kit';
import { useCreateResource, useResources } from '@/services/cases';
import { space, type, useTheme } from '@/theme/tokens';

/** The community resource directory workers refer people to. */
export default function ResourcesScreen() {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CaseCategory | null>(null);
  const [adding, setAdding] = useState(false);
  const resources = useResources(query.trim() || undefined, category);
  const samples = resources.data?.filter((r) => r.is_sample).length ?? 0;

  return (
    <Page refreshing={resources.isRefetching} onRefresh={() => resources.refetch()}>
      <PageTitle
        title="Resources"
        subtitle="Services ComForce refers people to. Add one from a case with “Resources & referrals”."
        right={<Button label="Add resource" icon="add" onPress={() => setAdding(true)} />}
      />
      {samples ? (
        <Notice icon="flask-outline" tone="warning">
          Entries marked “Sample data” are demonstration records with fictional 555 numbers, not real services. Replace them with ComForce’s real partners.
        </Notice>
      ) : null}
      <Card style={{ gap: space.md }}>
        <Field icon="search" placeholder="Search by name, service or neighborhood" value={query} onChangeText={setQuery} autoCorrect={false} />
        <ChoiceRow label="Category" options={CASE_CATEGORIES} labels={CATEGORY_LABEL} value={category} onChange={setCategory} allowNone noneLabel="All" />
      </Card>

      {resources.isPending ? (
        <Loading />
      ) : resources.error ? (
        <ErrorBanner error={resources.error} onRetry={() => resources.refetch()} />
      ) : resources.data.length ? (
        <View style={styles.grid}>
          {resources.data.map((r) => (
            <Card key={r.id} style={styles.cell}>
              <View style={styles.row}>
                <View style={[styles.icon, { backgroundColor: theme.accentSoft }]}>
                  <Ionicons name={CATEGORY_ICON[r.category]} size={18} color={theme.accent} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[type.headline, { color: theme.text }]}>{r.name}</Text>
                  <Text style={[type.caption, { color: theme.textSecondary }]}>{CATEGORY_LABEL[r.category]}</Text>
                </View>
              </View>
              {r.is_sample ? <SampleBadge /> : null}
              <Text style={[type.subhead, { color: theme.text }]}>{r.description}</Text>
              <View style={{ gap: 4 }}>
                {r.neighborhood ? <Line icon="location-outline" text={r.neighborhood + (r.address ? ` · ${r.address}` : '')} /> : null}
                {r.hours ? <Line icon="time-outline" text={r.hours} /> : null}
                {r.phone ? <Line icon="call-outline" text={r.phone} /> : null}
                {r.website ? <Line icon="globe-outline" text={r.website} /> : null}
              </View>
            </Card>
          ))}
        </View>
      ) : (
        <Card>
          <EmptyState icon="library-outline" title="No resources match" body="Try another search, or add the service you have in mind." />
        </Card>
      )}
      <AddResource visible={adding} onClose={() => setAdding(false)} />
    </Page>
  );
}

function Line({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={14} color={theme.textSecondary} />
      <Text style={[type.footnote, { color: theme.textSecondary, flex: 1 }]} selectable>{text}</Text>
    </View>
  );
}

function AddResource({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const create = useCreateResource();
  const [form, setForm] = useState({ name: '', description: '', neighborhood: '', address: '', phone: '', website: '', hours: '' });
  const [category, setCategory] = useState<CaseCategory>('other');
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const save = () =>
    create.mutate(
      { category, ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null])), name: form.name.trim(), description: form.description.trim() },
      {
        onSuccess: () => {
          success();
          setForm({ name: '', description: '', neighborhood: '', address: '', phone: '', website: '', hours: '' });
          onClose();
        },
      },
    );

  return (
    <Sheet visible={visible} onClose={onClose} title="Add a resource" dismissLabel="Cancel">
      <Field label="Name" value={form.name} onChangeText={set('name')} maxLength={160} />
      <ChoiceRow label="Category" options={CASE_CATEGORIES} labels={CATEGORY_LABEL} value={category} onChange={(c) => c && setCategory(c)} />
      <Field label="What they offer" value={form.description} onChangeText={set('description')} multiline maxLength={4000} />
      <Field label="Neighborhood" value={form.neighborhood} onChangeText={set('neighborhood')} maxLength={160} />
      <Field label="Address" value={form.address} onChangeText={set('address')} maxLength={300} />
      <Field label="Phone" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" maxLength={160} />
      <Field label="Website" value={form.website} onChangeText={set('website')} autoCapitalize="none" maxLength={160} />
      <Field label="Hours" value={form.hours} onChangeText={set('hours')} maxLength={160} />
      {create.error ? <ErrorBanner error={create.error} /> : null}
      <Button label="Add to directory" icon="checkmark" size="lg" disabled={!form.name.trim()} loading={create.isPending} onPress={save} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { flexGrow: 1, flexBasis: 300, maxWidth: 620 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
