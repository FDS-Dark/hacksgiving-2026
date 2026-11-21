import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CASE_CATEGORIES, CASE_PRIORITIES, type CaseCategory, type CaseKind, type CasePriority } from '@/api/types';
import { Page } from '@/components/Page';
import { Button, ErrorBanner, Field, success } from '@/components/ui';
import { Card, CardTitle, ChoiceRow, PageTitle, priorityColor } from '@/components/staff/kit';
import { CATEGORY_LABEL, PRIORITY_LABEL } from '@/lib/cases';
import { useCreateCase } from '@/services/cases';
import { useStaffStatus, useWorkers } from '@/services/staff';
import { space, type, useTheme } from '@/theme/tokens';

const KINDS = ['request', 'incident'] as const;
const KIND_LABEL: Record<CaseKind, string> = { request: 'Request for help', incident: 'Incident' };

/** A case a worker opens: a phone call, a walk-in, something seen in the neighborhood. */
export default function NewCaseScreen() {
  const theme = useTheme();
  const me = useStaffStatus();
  const workers = useWorkers();
  const create = useCreateCase();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<CaseKind>('request');
  const [category, setCategory] = useState<CaseCategory>('other');
  const [priority, setPriority] = useState<CasePriority>('medium');
  const [location, setLocation] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);

  const workerIds = (workers.data ?? []).map((w) => w.id);
  const workerLabels = Object.fromEntries((workers.data ?? []).map((w) => [w.id, w.id === me.data?.id ? 'Me' : (w.display_name ?? 'Unnamed worker')]));

  const submit = () =>
    create.mutate(
      {
        title: title.trim(),
        description: description.trim(),
        kind,
        category,
        priority,
        location: location.trim() || null,
        contact_name: contactName.trim() || null,
        contact_phone: contactPhone.trim() || null,
        contact_email: contactEmail.trim() || null,
        assigned_worker_id: assignee,
      },
      {
        onSuccess: (created) => {
          success();
          router.replace({ pathname: '/staff/cases/[id]', params: { id: created.id } });
        },
      },
    );

  return (
    <Page contentStyle={{ maxWidth: 820 }}>
      <PageTitle title="New case" subtitle="For a call, a walk-in or an incident. Community members' own requests arrive by themselves." />

      <Card>
        <CardTitle title="What's going on" icon="create-outline" />
        <ChoiceRow label="Type" options={KINDS} labels={KIND_LABEL} value={kind} onChange={(k) => k && setKind(k)} />
        <Field label="Title" placeholder="e.g. Family evicted, needs shelter tonight" value={title} onChangeText={setTitle} maxLength={160} />
        <Field
          label="Description"
          placeholder="What the person needs, what's been tried, anything urgent"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={4000}
          style={styles.multiline}
        />
        <Field label="Location" icon="location-outline" placeholder="Address, intersection or neighborhood" value={location} onChangeText={setLocation} maxLength={300} />
      </Card>

      <Card>
        <CardTitle title="Triage" icon="flag-outline" />
        <ChoiceRow label="Category" options={CASE_CATEGORIES} labels={CATEGORY_LABEL} value={category} onChange={(c) => c && setCategory(c)} />
        <ChoiceRow label="Priority" options={CASE_PRIORITIES} labels={PRIORITY_LABEL} value={priority} onChange={(p) => p && setPriority(p)} colorOf={(p) => priorityColor(theme, p)} />
        {workerIds.length ? (
          <ChoiceRow label="Assign to" options={workerIds} labels={workerLabels} value={assignee} onChange={setAssignee} allowNone noneLabel="Nobody yet" />
        ) : null}
      </Card>

      <Card>
        <CardTitle title="Contact (staff only)" icon="call-outline" />
        <Text style={[type.footnote, { color: theme.textSecondary }]}>Only ComForce staff see these. Leave blank if the person didn’t share them.</Text>
        <View style={styles.row}>
          <View style={styles.cell}><Field label="Name" value={contactName} onChangeText={setContactName} maxLength={160} /></View>
          <View style={styles.cell}><Field label="Phone" value={contactPhone} onChangeText={setContactPhone} keyboardType="phone-pad" maxLength={160} /></View>
          <View style={styles.cell}><Field label="Email" value={contactEmail} onChangeText={setContactEmail} keyboardType="email-address" autoCapitalize="none" maxLength={160} /></View>
        </View>
      </Card>

      {create.error ? <ErrorBanner error={create.error} /> : null}
      <View style={styles.actions}>
        <Button label="Cancel" variant="plain" onPress={() => router.back()} />
        <Button label="Open case" icon="checkmark" size="lg" disabled={!title.trim()} loading={create.isPending} onPress={submit} />
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 110, textAlignVertical: 'top', paddingTop: space.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { flexGrow: 1, flexBasis: 200 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.md },
});
