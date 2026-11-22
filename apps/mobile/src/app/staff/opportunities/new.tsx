import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AUDIENCES, COSTS, OPPORTUNITY_KINDS, type Audience, type Cost, type CreateOpportunity, type OpportunityKind } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { AUDIENCE_INFO, COST_LABEL, KIND_INFO } from '@/components/OpportunityCard';
import { Page } from '@/components/Page';
import { MoreDetails, PageTitle } from '@/components/staff/kit';
import { Button, Chip, Chips, ErrorBanner, Field, FieldLabel, success } from '@/components/ui';
import { useCreateOpportunity } from '@/services/opportunities';
import { radius, space, type, useTheme } from '@/theme/tokens';

const EMPTY = {
  title: '',
  organization: '',
  description: '',
  location: '',
  schedule: '',
  pay: '',
  contact_phone: '',
  contact_email: '',
  apply_url: '',
};

/**
 * Post a job or program, on its own screen. Seven fields first (kind,
 * title, who offers it, what it is, where, how to apply, a phone); the
 * schedule, pay, email, who it's open to and cost sit under "More details".
 * Back to the list once it's posted.
 */
export default function PostOpportunityScreen() {
  const theme = useTheme();
  const create = useCreateOpportunity();
  const [kind, setKind] = useState<OpportunityKind>('job');
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [cost, setCost] = useState<Cost | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [tried, setTried] = useState(false);
  const set = (key: keyof typeof EMPTY) => (text: string) => setForm((f) => ({ ...f, [key]: text }));
  const toggleAudience = (a: Audience) => setAudiences((all) => (all.includes(a) ? all.filter((x) => x !== a) : [...all, a]));

  const url = form.apply_url.trim();
  const badUrl = url.length > 0 && !/^https?:\/\/\S+$/.test(url);
  const ready = form.title.trim() && form.organization.trim() && !badUrl;

  const submit = () => {
    setTried(true);
    if (!ready) return;
    const blank = (s: string) => s.trim() || null;
    const body: CreateOpportunity = {
      kind,
      title: form.title.trim(),
      organization: form.organization.trim(),
      description: form.description.trim(),
      location: blank(form.location),
      schedule: blank(form.schedule),
      pay: kind === 'job' ? blank(form.pay) : null,
      contact_phone: blank(form.contact_phone),
      contact_email: blank(form.contact_email),
      apply_url: blank(form.apply_url),
      audiences,
      cost,
    };
    create.mutate(body, {
      onSuccess: () => {
        success();
        if (router.canGoBack()) router.back();
        else router.replace('/staff/opportunities');
      },
    });
  };

  return (
    <Page contentStyle={{ gap: space.lg, maxWidth: 640 }}>
      <BackLink fallback="/staff/opportunities" />
      <PageTitle title="Post a job or program" subtitle="Residents see it in the app right away." />

      <Chips>
        {OPPORTUNITY_KINDS.map((k) => (
          <Chip key={k} label={KIND_INFO[k].label} active={kind === k} onPress={() => setKind(k)} />
        ))}
      </Chips>

      <Field label="Title (required)" value={form.title} onChangeText={set('title')} placeholder={kind === 'job' ? 'Line cook' : 'Food pantry helper'} maxLength={160} accessibilityLabel="Title, required" />
      <Field label="Who offers it (required)" value={form.organization} onChangeText={set('organization')} placeholder="Organization name" maxLength={160} accessibilityLabel="Who offers it, required" />
      {tried && (!form.title.trim() || !form.organization.trim()) ? (
        <Text style={[type.footnote, { color: theme.danger }]}>Add a title and who offers it.</Text>
      ) : null}

      <View style={{ gap: 6 }}>
        <FieldLabel>What it is</FieldLabel>
        <TextInput
          value={form.description}
          onChangeText={set('description')}
          multiline
          maxLength={4000}
          placeholder="The work, who it’s for, anything to bring."
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.accent}
          textAlignVertical="top"
          accessibilityLabel="What it is"
          style={[styles.textarea, { backgroundColor: theme.fill, color: theme.text }]}
        />
      </View>

      <Field label="Where" icon="location-outline" value={form.location} onChangeText={set('location')} placeholder="Address or neighborhood" maxLength={300} accessibilityLabel="Where" />
      <Field
        label="Link to apply or sign up"
        icon="link-outline"
        value={form.apply_url}
        onChangeText={set('apply_url')}
        placeholder="https://"
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={500}
        accessibilityLabel="Link to apply or sign up"
      />
      {badUrl ? <Text style={[type.footnote, { color: theme.danger }]}>The link must start with http:// or https://.</Text> : null}
      <Field label="Phone" icon="call-outline" value={form.contact_phone} onChangeText={set('contact_phone')} keyboardType="phone-pad" maxLength={160} accessibilityLabel="Phone" />

      <MoreDetails hint="Schedule, pay, email, who it’s open to, cost">
        <Field label="Schedule" icon="time-outline" value={form.schedule} onChangeText={set('schedule')} placeholder="Weekday evenings, 10 hours a week" maxLength={160} accessibilityLabel="Schedule" />
        {kind === 'job' ? <Field label="Pay" icon="cash-outline" value={form.pay} onChangeText={set('pay')} placeholder="$17 an hour" maxLength={160} accessibilityLabel="Pay" /> : null}
        <Field
          label="Email"
          icon="mail-outline"
          value={form.contact_email}
          onChangeText={set('contact_email')}
          keyboardType="email-address"
          autoCapitalize="none"
          maxLength={160}
          accessibilityLabel="Email"
        />
        <View style={{ gap: 6 }}>
          <FieldLabel>Open to</FieldLabel>
          <Text style={[type.footnote, { color: theme.textSecondary }]}>Tag who it works for, so residents can find it.</Text>
          <Chips>
            {AUDIENCES.map((a) => (
              <Chip key={a} label={AUDIENCE_INFO[a].label} active={audiences.includes(a)} onPress={() => toggleAudience(a)} />
            ))}
          </Chips>
        </View>
        <View style={{ gap: 6 }}>
          <FieldLabel>Cost</FieldLabel>
          <Chips>
            <Chip label="Not stated" active={cost === null} onPress={() => setCost(null)} />
            {COSTS.map((c) => (
              <Chip key={c} label={COST_LABEL[c]} active={cost === c} onPress={() => setCost(c)} />
            ))}
          </Chips>
        </View>
      </MoreDetails>

      {create.isError ? <ErrorBanner error={create.error} /> : null}
      <Button label="Post it" icon="add-circle-outline" size="lg" loading={create.isPending} onPress={submit} />
    </Page>
  );
}

const styles = StyleSheet.create({
  textarea: { minHeight: 100, padding: space.md, borderRadius: radius.sm, fontSize: 16, lineHeight: 22 },
});
