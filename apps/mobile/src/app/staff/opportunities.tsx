import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { OPPORTUNITY_KINDS, type CreateOpportunity, type OpportunityKind } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { OpportunityCard } from '@/components/OpportunityCard';
import { Page } from '@/components/Page';
import { Card, CardTitle, PageTitle } from '@/components/staff/kit';
import { Button, Chip, Chips, EmptyState, ErrorBanner, Field, FieldLabel, Loading, success } from '@/components/ui';
import { useCreateOpportunity, useOpportunities, useSetOpportunityActive } from '@/services/opportunities';
import { radius, space, useTheme } from '@/theme/tokens';

/** Staff post volunteer and job opportunities, and close or reopen them.
 *  Opened from Me → Manage; the staff layout already gates it to workers. */
export default function StaffOpportunitiesScreen() {
  return (
    <Page contentStyle={{ gap: space.lg, maxWidth: 900 }}>
      <BackLink label="Me" fallback="/staff/me" />
      <PageTitle title="Opportunities" subtitle="Post jobs and volunteer work for residents to find in the app." />
      <NewOpportunity />
      <Posted />
    </Page>
  );
}

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

function NewOpportunity() {
  const theme = useTheme();
  const create = useCreateOpportunity();
  const [kind, setKind] = useState<OpportunityKind>('job');
  const [form, setForm] = useState(EMPTY);
  const [tried, setTried] = useState(false);
  const set = (key: keyof typeof EMPTY) => (text: string) => setForm((f) => ({ ...f, [key]: text }));

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
    };
    create.mutate(body, {
      onSuccess: () => {
        success();
        setForm(EMPTY);
        setTried(false);
      },
    });
  };

  return (
    <Card style={{ gap: space.md }}>
      <CardTitle title="Post an opportunity" icon="add-circle-outline" />
      <Chips>
        {OPPORTUNITY_KINDS.map((k) => (
          <Chip key={k} label={k === 'job' ? 'Job' : 'Volunteer'} active={kind === k} onPress={() => setKind(k)} />
        ))}
      </Chips>

      <Field label="Title *" value={form.title} onChangeText={set('title')} placeholder={kind === 'job' ? 'Line cook' : 'Food pantry helper'} maxLength={160} />
      <Field label="Organization *" value={form.organization} onChangeText={set('organization')} placeholder="Who is offering it" maxLength={160} />
      {tried && (!form.title.trim() || !form.organization.trim()) ? (
        <Text style={[styles.hint, { color: theme.danger }]}>A title and an organization are required.</Text>
      ) : null}

      <View style={{ gap: 6 }}>
        <FieldLabel>Description</FieldLabel>
        <TextInput
          value={form.description}
          onChangeText={set('description')}
          multiline
          maxLength={4000}
          placeholder="What the work is, who it's for, anything to bring."
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.accent}
          textAlignVertical="top"
          accessibilityLabel="Description"
          style={[styles.textarea, { backgroundColor: theme.fill, color: theme.text }]}
        />
      </View>

      <Field label="Location" icon="location-outline" value={form.location} onChangeText={set('location')} placeholder="Address or neighborhood" maxLength={300} />
      <Field label="Schedule" icon="time-outline" value={form.schedule} onChangeText={set('schedule')} placeholder="Weekday evenings, 10 hrs/week" maxLength={160} />
      {kind === 'job' ? <Field label="Pay" icon="cash-outline" value={form.pay} onChangeText={set('pay')} placeholder="$17/hour" maxLength={160} /> : null}
      <Field label="Contact phone" icon="call-outline" value={form.contact_phone} onChangeText={set('contact_phone')} keyboardType="phone-pad" maxLength={160} />
      <Field
        label="Contact email"
        icon="mail-outline"
        value={form.contact_email}
        onChangeText={set('contact_email')}
        keyboardType="email-address"
        autoCapitalize="none"
        maxLength={160}
      />
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
      />
      {badUrl ? <Text style={[styles.hint, { color: theme.danger }]}>The link must start with http:// or https://.</Text> : null}

      {create.isError ? <ErrorBanner error={create.error} /> : null}
      <Button label="Post opportunity" icon="add-circle-outline" loading={create.isPending} onPress={submit} />
    </Card>
  );
}

function Posted() {
  const theme = useTheme();
  const list = useOpportunities({ includeClosed: true });
  const toggle = useSetOpportunityActive();

  return (
    <View style={{ gap: space.md }}>
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
        Posted {list.data ? `(${list.data.filter((o) => o.active).length} open)` : ''}
      </Text>
      {toggle.isError ? <ErrorBanner error={toggle.error} /> : null}
      {list.isPending ? (
        <Loading label="Loading opportunities" />
      ) : list.isError ? (
        <ErrorBanner error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState icon="briefcase-outline" title="Nothing posted yet" body="Opportunities you post show up here and in the resident app." />
      ) : (
        list.data.map((o) => (
          <OpportunityCard
            key={o.id}
            item={o}
            footer={
              <Button
                label={o.active ? 'Close posting' : 'Reopen posting'}
                icon={o.active ? 'eye-off-outline' : 'eye-outline'}
                variant={o.active ? 'destructive' : 'tinted'}
                loading={toggle.isPending && toggle.variables?.id === o.id}
                onPress={() => toggle.mutate({ id: o.id, active: !o.active })}
              />
            }
          />
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 19, fontWeight: '900' },
  hint: { fontSize: 13, lineHeight: 18 },
  textarea: { minHeight: 100, padding: space.md, borderRadius: radius.sm, fontSize: 16, lineHeight: 22 },
});
