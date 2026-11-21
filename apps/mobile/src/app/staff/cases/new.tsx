import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { CASE_CATEGORIES, CASE_PRIORITIES, type CaseCategory, type CaseKind, type CasePriority } from '@/api/types';
import { Page } from '@/components/Page';
import { Segmented } from '@/components/Segmented';
import { ChoiceRow, priorityColor } from '@/components/staff/kit';
import { Button, ErrorBanner, Field, Notice, success } from '@/components/ui';
import { CATEGORY_LABEL, PRIORITY_LABEL, titleFrom } from '@/lib/cases';
import { useCreateCase } from '@/services/cases';
import { categoryFor, useRouteRequest } from '@/services/routing';
import { useStaffStatus } from '@/services/staff';
import { space, type, useTheme } from '@/theme/tokens';

/**
 * Figma S6 "New case": for a phone call or a walk-in. Describe it in plain
 * words; the assistant suggests the service and urgency and the worker
 * confirms. Opens assigned to the worker by default.
 */
export default function NewCaseScreen() {
  const theme = useTheme();
  const me = useStaffStatus();
  const create = useCreateCase();
  const suggest = useRouteRequest();

  const [kind, setKind] = useState<CaseKind>('request');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<CaseCategory>('other');
  const [priority, setPriority] = useState<CasePriority>('medium');
  const [location, setLocation] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [assignToMe, setAssignToMe] = useState(true);

  const ready = description.trim().length > 0;

  const askForSuggestion = () =>
    suggest.mutate(description.trim(), {
      onSuccess: (r) => {
        setCategory(categoryFor(r.service));
        if (r.urgent) setPriority('high');
      },
    });

  const save = () =>
    create.mutate(
      {
        title: titleFrom(description),
        description: description.trim(),
        kind,
        category,
        priority,
        location: location.trim() || null,
        contact_name: contactName.trim() || null,
        contact_phone: contactPhone.trim() || null,
        assigned_worker_id: assignToMe ? (me.data?.id ?? null) : null,
      },
      {
        onSuccess: (created) => {
          success();
          router.replace({ pathname: '/staff/cases/[id]', params: { id: created.id } });
        },
      },
    );

  return (
    <Page contentStyle={{ maxWidth: 640, gap: space.lg }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={10}>
          <Ionicons name="close" size={26} color={theme.text} />
        </Pressable>
        <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">
          New case
        </Text>
        <Button label="Save" variant="plain" disabled={!ready} loading={create.isPending} onPress={save} />
      </View>

      <Segmented
        label="Kind of case"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'request', label: 'Request' },
          { value: 'incident', label: 'Incident' },
        ]}
      />

      <Field
        label="What’s going on?"
        placeholder="In their words: what they need, who's involved, anything urgent"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={4000}
        style={styles.multiline}
        autoFocus
      />

      <View style={[styles.suggest, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
        <View style={styles.suggestHead}>
          <Ionicons name="sparkles-outline" size={16} color={theme.accent} />
          <Text style={[type.subhead, { color: theme.text, fontWeight: '700', flex: 1 }]}>{suggest.isSuccess ? 'Suggested' : 'Service and urgency'}</Text>
          <Button label={suggest.isSuccess ? 'Suggest again' : 'Suggest'} variant="plain" disabled={!ready} loading={suggest.isPending} onPress={askForSuggestion} />
        </View>
        {suggest.data?.reason ? <Text style={[type.footnote, { color: theme.textSecondary }]}>{suggest.data.reason}</Text> : null}
        {suggest.error ? <Notice icon="cloud-offline-outline">Suggestions aren’t available right now. Pick the service and urgency below.</Notice> : null}
        <ChoiceRow label="Service" options={CASE_CATEGORIES} labels={CATEGORY_LABEL} value={category} onChange={(c) => c && setCategory(c)} />
        <ChoiceRow label="Urgency" options={CASE_PRIORITIES} labels={PRIORITY_LABEL} value={priority} onChange={(p) => p && setPriority(p)} colorOf={(p) => priorityColor(theme, p)} />
      </View>

      <Field label="Where" icon="location-outline" placeholder="Address, intersection or neighborhood" value={location} onChangeText={setLocation} maxLength={300} />

      <View style={{ gap: space.sm }}>
        <Field label="Contact (staff only)" icon="person-outline" placeholder="Name" value={contactName} onChangeText={setContactName} maxLength={160} />
        <Field icon="call-outline" placeholder="Phone" value={contactPhone} onChangeText={setContactPhone} keyboardType="phone-pad" maxLength={40} />
      </View>

      <View style={[styles.toggles, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
        <Toggle icon="person-outline" label="Assign to me" value={assignToMe} onChange={setAssignToMe} />
      </View>

      {create.error ? <ErrorBanner error={create.error} /> : null}
      <Button label="Open case" icon="checkmark" size="lg" disabled={!ready} loading={create.isPending} onPress={save} />
    </Page>
  );
}

function Toggle({ icon, label, value, onChange }: { icon: 'person-outline'; label: string; value: boolean; onChange: (v: boolean) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.toggle}>
      <Ionicons name={icon} size={18} color={theme.accent} />
      <Text style={[type.subhead, { color: theme.text, flex: 1 }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: theme.accent }} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { flex: 1, fontSize: 20, fontWeight: '800' },
  multiline: { minHeight: 120, textAlignVertical: 'top', paddingTop: space.sm },
  suggest: { borderWidth: 1, borderRadius: 14, padding: space.md, gap: space.md },
  suggestHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  toggles: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: 10 },
});
