import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { CASE_CATEGORIES, type CaseCategory, type Partner, type PartnerBody } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { PageTitle } from '@/components/staff/kit';
import { Button, Chip, Chips, ErrorBanner, Field, FieldLabel, Group, Loading, Row, Toggle, success } from '@/components/ui';
import { CATEGORY_LABEL } from '@/lib/cases';
import { usePartner, useSavePartner } from '@/services/partners';
import { space } from '@/theme/tokens';

type Form = Omit<PartnerBody, 'languages'> & { languages: string };

function formFrom(p?: Partner): Form {
  return {
    name: p?.name ?? '',
    description: p?.description ?? '',
    categories: p?.categories ?? [],
    contact_name: p?.contact_name ?? '',
    phone: p?.phone ?? '',
    email: p?.email ?? '',
    website: p?.website ?? '',
    address: p?.address ?? '',
    languages: (p?.languages ?? []).join(', '),
    accepts_shares: p?.accepts_shares ?? false,
    notes: p?.notes ?? '',
    active: p?.active ?? true,
  };
}

function bodyFrom(f: Form): PartnerBody {
  const blank = (v?: string | null) => (v ?? '').trim() || null;
  return {
    ...f,
    name: f.name.trim(),
    contact_name: blank(f.contact_name),
    phone: blank(f.phone),
    email: blank(f.email),
    website: blank(f.website),
    address: blank(f.address),
    languages: f.languages.split(',').map((l) => l.trim().toLowerCase()).filter((l) => l.length >= 2),
  };
}

/** Add a partner, or edit one (`?id=`). */
export default function EditPartnerScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = usePartner(id ?? '');
  if (!id) return <PartnerForm />;
  if (existing.error) return <ErrorBanner error={existing.error} onRetry={() => existing.refetch()} />;
  if (!existing.data) return <Loading label="Loading partner" />;
  return <PartnerForm key={id} partner={existing.data} />;
}

function PartnerForm({ partner }: { partner?: Partner }) {
  const id = partner?.id;
  const save = useSavePartner(id);
  const [form, setForm] = useState<Form>(() => formFrom(partner));

  const set = (key: keyof Form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const toggleCategory = (c: CaseCategory) =>
    setForm((f) => ({ ...f, categories: f.categories?.includes(c) ? f.categories.filter((x) => x !== c) : [...(f.categories ?? []), c] }));
  const submit = () =>
    save.mutate(bodyFrom(form), {
      onSuccess: (p) => {
        success();
        router.replace({ pathname: '/staff/partners/[id]', params: { id: p.id } });
      },
    });

  return (
    <Page contentStyle={{ maxWidth: 720, gap: space.md }}>
      <BackLink label={id ? 'Partner' : 'Partners'} fallback="/staff/partners" />
      <PageTitle title={id ? 'Edit partner' : 'Add a partner'} />
      <Field label="Name *" value={form.name} onChangeText={set('name')} placeholder="Harbor House" maxLength={160} />
      <Field label="What they do" value={form.description ?? ''} onChangeText={set('description')} multiline maxLength={4000} placeholder="Family shelter with 24-hour intake" />
      <View style={{ gap: 6 }}>
        <FieldLabel>Services they take cases for</FieldLabel>
        <Chips>
          {CASE_CATEGORIES.map((c) => (
            <Chip key={c} label={CATEGORY_LABEL[c]} active={!!form.categories?.includes(c)} onPress={() => toggleCategory(c)} />
          ))}
        </Chips>
      </View>
      <Field label="Contact person" value={form.contact_name ?? ''} onChangeText={set('contact_name')} maxLength={160} />
      <Field label="Phone" icon="call-outline" value={form.phone ?? ''} onChangeText={set('phone')} keyboardType="phone-pad" maxLength={160} />
      <Field label="Email" icon="mail-outline" value={form.email ?? ''} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" maxLength={160} />
      <Field label="Website" icon="globe-outline" value={form.website ?? ''} onChangeText={set('website')} autoCapitalize="none" maxLength={160} />
      <Field label="Address" icon="location-outline" value={form.address ?? ''} onChangeText={set('address')} maxLength={500} />
      <Field label="Languages" value={form.languages} onChangeText={set('languages')} placeholder="en, es, hmn" autoCapitalize="none" />
      <Group footer="Only partners with a data-sharing agreement can receive shared cases.">
        <Row title="Accepts shared cases" right={<Toggle label="Accepts shared cases" value={!!form.accepts_shares} onChange={(v) => setForm((f) => ({ ...f, accepts_shares: v }))} />} />
        <Row title="Active" right={<Toggle label="Active" value={form.active ?? true} onChange={(v) => setForm((f) => ({ ...f, active: v }))} />} />
      </Group>
      <Field label="Staff notes" value={form.notes ?? ''} onChangeText={set('notes')} multiline maxLength={4000} placeholder="Ask for the intake desk; beds open after 6 PM" />
      {save.error ? <ErrorBanner error={save.error} /> : null}
      <Button label={id ? 'Save' : 'Add partner'} size="lg" loading={save.isPending} disabled={!form.name.trim()} onPress={submit} />
    </Page>
  );
}
