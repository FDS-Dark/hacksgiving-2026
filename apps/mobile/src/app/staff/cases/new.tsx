import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { CASE_CATEGORIES, CASE_PRIORITIES, type CaseCategory, type CaseKind, type CasePriority } from '@/api/types';
import { Page } from '@/components/Page';
import { Segmented } from '@/components/Segmented';
import { ChoiceRow, ConfirmSheet, DraftRestored, MoreDetails, priorityColor } from '@/components/staff/kit';
import { Button, ErrorBanner, Field, Notice, success } from '@/components/ui';
import { CATEGORY_LABEL, PRIORITY_LABEL, titleFrom } from '@/lib/cases';
import { draftKey } from '@/lib/drafts';
import { useDraft } from '@/lib/useDraft';
import { useCreateCase } from '@/services/cases';
import { categoryFor, useRouteRequest } from '@/services/routing';
import { useStaffStatus } from '@/services/staff';
import { space, type, useTheme } from '@/theme/tokens';

interface CaseDraft {
  kind: CaseKind;
  description: string;
  category: CaseCategory;
  priority: CasePriority;
  location: string;
  contactName: string;
  contactPhone: string;
  assignToMe: boolean;
}

const EMPTY: CaseDraft = {
  kind: 'request',
  description: '',
  category: 'other',
  priority: 'medium',
  location: '',
  contactName: '',
  contactPhone: '',
  assignToMe: true,
};

/** Only the preset choices: nothing worth keeping. */
const isEmptyCase = (d: CaseDraft) => ![d.description, d.location, d.contactName, d.contactPhone].some((v) => v.trim());

/**
 * Figma S6 "New case": for someone on the street, a phone call or a
 * walk-in. The essentials come first (what's going on, where, how to reach
 * them); Suggest fills in the type of help and priority, and the rest sits
 * under "More details". The form autosaves on this phone as the worker
 * types, so an interruption never loses it (cognitive-load review S2).
 */
export default function NewCaseScreen() {
  const theme = useTheme();
  const me = useStaffStatus();
  const create = useCreateCase();
  const suggest = useRouteRequest();
  const [form, setForm] = useState<CaseDraft>(EMPTY);
  const [discarding, setDiscarding] = useState(false);
  const set = <K extends keyof CaseDraft>(key: K, value: CaseDraft[K]) => setForm((f) => ({ ...f, [key]: value }));

  const draft = useDraft(me.data?.id ? draftKey('case', me.data.id) : null, form, useCallback((d: CaseDraft) => setForm({ ...EMPTY, ...d }), []), isEmptyCase);

  const ready = form.description.trim().length > 0;
  // Never send "assigned to nobody" while "Assign to me" is on (fix plan 2D).
  const waitingForMe = form.assignToMe && !me.data;

  const askForSuggestion = () =>
    suggest.mutate(form.description.trim(), {
      onSuccess: (r) => setForm((f) => ({ ...f, category: categoryFor(r.service), priority: r.urgent ? 'high' : f.priority })),
    });

  const save = () =>
    create.mutate(
      {
        title: titleFrom(form.description),
        description: form.description.trim(),
        kind: form.kind,
        category: form.category,
        priority: form.priority,
        location: form.location.trim() || null,
        contact_name: form.contactName.trim() || null,
        contact_phone: form.contactPhone.trim() || null,
        assigned_worker_id: form.assignToMe ? (me.data?.id ?? null) : null,
      },
      {
        onSuccess: async (created) => {
          success();
          await draft.clear();
          router.replace({ pathname: '/staff/cases/[id]', params: { id: created.id } });
        },
      },
    );

  const discard = async () => {
    setDiscarding(false);
    await draft.clear();
    setForm(EMPTY);
    suggest.reset();
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/staff/cases'));

  return (
    <Page contentStyle={{ maxWidth: 640, gap: space.lg }}>
      <View style={styles.header}>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close. Your draft is kept on this phone." style={styles.close}>
          <Ionicons name="close" size={26} color={theme.text} />
        </Pressable>
        <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">
          New case
        </Text>
        <Button label="Save" variant="plain" disabled={!ready || waitingForMe} loading={create.isPending} onPress={save} />
      </View>

      {draft.restoredAt ? <DraftRestored savedAt={draft.restoredAt} onDiscard={() => setDiscarding(true)} /> : null}

      <Field
        label="What’s going on?"
        placeholder="In their words: what they need, who’s involved, anything urgent"
        value={form.description}
        onChangeText={(text) => {
          set('description', text);
          // The suggestion was for the old wording: ask again (fix plan 2D).
          if (suggest.data || suggest.error) suggest.reset();
        }}
        multiline
        maxLength={4000}
        style={styles.multiline}
        autoFocus={!draft.restoredAt}
        accessibilityLabel="What’s going on?"
      />

      <View style={[styles.suggest, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
        <View style={styles.suggestHead}>
          <Ionicons name="sparkles-outline" size={16} color={theme.accent} />
          <Text style={[type.subhead, { color: theme.text, fontWeight: '700', flex: 1 }]}>
            {suggest.isSuccess ? `${CATEGORY_LABEL[form.category]} · ${PRIORITY_LABEL[form.priority]} priority` : 'Type of help and priority'}
          </Text>
          <Button label={suggest.isSuccess ? 'Suggest again' : 'Suggest'} variant="plain" disabled={!ready} loading={suggest.isPending} onPress={askForSuggestion} />
        </View>
        {suggest.data?.reason ? <Text style={[type.footnote, { color: theme.textSecondary }]}>{suggest.data.reason}</Text> : null}
        {!suggest.isSuccess && !suggest.error ? (
          <Text style={[type.footnote, { color: theme.textSecondary }]}>Suggest fills these in from what you wrote. Change them under More details.</Text>
        ) : null}
        {suggest.error ? <Notice icon="cloud-offline-outline">Suggestions aren’t working right now. Pick the type of help and priority under More details.</Notice> : null}
      </View>

      <Field label="Where" icon="location-outline" placeholder="Address, intersection or neighborhood" value={form.location} onChangeText={(v) => set('location', v)} maxLength={300} accessibilityLabel="Where" />

      <View style={{ gap: space.sm }}>
        <Field label="Contact details (optional; staff only)" icon="person-outline" placeholder="Name" value={form.contactName} onChangeText={(v) => set('contactName', v)} maxLength={160} accessibilityLabel="Contact name" />
        <Field icon="call-outline" placeholder="Phone" value={form.contactPhone} onChangeText={(v) => set('contactPhone', v)} keyboardType="phone-pad" maxLength={40} accessibilityLabel="Contact phone" />
      </View>

      <MoreDetails
        hint={`${form.kind === 'incident' ? 'Incident' : 'Request'} · ${CATEGORY_LABEL[form.category]} · ${PRIORITY_LABEL[form.priority]} · ${form.assignToMe ? 'Assigned to me' : 'No worker assigned'}`}
      >
        <Segmented
          label="Kind of case"
          value={form.kind}
          onChange={(v) => set('kind', v)}
          options={[
            { value: 'request', label: 'Request' },
            { value: 'incident', label: 'Incident' },
          ]}
        />
        <ChoiceRow label="Type of help" options={CASE_CATEGORIES} labels={CATEGORY_LABEL} value={form.category} onChange={(c) => c && set('category', c)} />
        <ChoiceRow label="Priority" options={CASE_PRIORITIES} labels={PRIORITY_LABEL} value={form.priority} onChange={(p) => p && set('priority', p)} colorOf={(p) => priorityColor(theme, p)} />
        <View style={[styles.toggles, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
          <View style={styles.toggle}>
            <Ionicons name="person-outline" size={18} color={theme.accent} />
            <Text style={[type.subhead, { color: theme.text, flex: 1 }]}>Assign to me</Text>
            <Switch value={form.assignToMe} onValueChange={(v) => set('assignToMe', v)} trackColor={{ true: theme.accent }} accessibilityLabel="Assign to me" />
          </View>
        </View>
      </MoreDetails>

      {me.error && form.assignToMe ? (
        <Notice icon="alert-circle-outline" tone="warning">
          We couldn’t check who you are, so the case can’t be assigned to you. Turn off Assign to me under More details, or try again later.
        </Notice>
      ) : null}
      {create.error ? <ErrorBanner error={create.error} /> : null}
      <Button label="Open case" icon="checkmark" size="lg" disabled={!ready || waitingForMe} loading={create.isPending} onPress={save} />
      {ready ? <Text style={[type.footnote, { color: theme.textSecondary, textAlign: 'center' }]}>Saved on this phone as you type, until you open the case.</Text> : null}

      <ConfirmSheet
        visible={discarding}
        title="Discard this draft?"
        body="What you typed is deleted from this phone. This can’t be undone."
        confirmLabel="Discard draft"
        destructive
        onConfirm={() => void discard()}
        onCancel={() => setDiscarding(false)}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -space.sm },
  title: { flex: 1, fontSize: 20, fontWeight: '800' },
  multiline: { minHeight: 120, textAlignVertical: 'top', paddingTop: space.sm },
  suggest: { borderWidth: 1, borderRadius: 14, padding: space.md, gap: space.sm },
  suggestHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  toggles: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: 10, minHeight: 44 },
});
