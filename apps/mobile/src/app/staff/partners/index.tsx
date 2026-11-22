import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { CASE_CATEGORIES, type CaseCategory } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { ChoiceRow, PageTitle } from '@/components/staff/kit';
import { Button, EmptyState, ErrorBanner, Field, Group, Loading, Row } from '@/components/ui';
import { CATEGORY_LABEL } from '@/lib/cases';
import { usePartners } from '@/services/partners';
import { space } from '@/theme/tokens';

/**
 * Figma P1 "Partners": organizations ComForce works with, searchable and
 * by service. Those that accept shared cases are marked; only they can be
 * picked when sharing a case (P2).
 */
export default function PartnersScreen() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<CaseCategory | null>(null);
  const partners = usePartners(q.trim(), category);

  return (
    <Page refreshing={partners.isRefetching} onRefresh={() => partners.refetch()} contentStyle={{ maxWidth: 720, gap: space.md }}>
      <BackLink label="Me" fallback="/staff/me" />
      <PageTitle title="Partners" subtitle="Organizations we refer to and share cases with" />
      <Field icon="search-outline" value={q} onChangeText={setQ} placeholder="Search by name or contact" accessibilityLabel="Search partners" autoCorrect={false} />
      <ChoiceRow label="Service" options={CASE_CATEGORIES} value={category} onChange={setCategory} labels={CATEGORY_LABEL} allowNone noneLabel="All" />
      <View>
        <Button label="Add a partner" icon="add" variant="tinted" onPress={() => router.push('/staff/partners/edit')} />
      </View>

      {partners.isPending ? (
        <Loading label="Loading partners" />
      ) : partners.error ? (
        <ErrorBanner error={partners.error} onRetry={() => partners.refetch()} />
      ) : partners.data.length ? (
        <Group>
          {partners.data.map((p) => (
            <Row
              key={p.id}
              title={p.name}
              subtitle={[p.categories.map((c) => CATEGORY_LABEL[c]).join(', '), p.contact_name].filter(Boolean).join(' · ') || p.description || null}
              detail={p.accepts_shares ? 'Accepts shares' : undefined}
              icon="business-outline"
              accessory="chevron"
              onPress={() => router.push({ pathname: '/staff/partners/[id]', params: { id: p.id } })}
            />
          ))}
        </Group>
      ) : (
        <EmptyState icon="business-outline" title="No partners yet" body={q || category ? 'Nothing matches. Try another search.' : 'Add the organizations ComForce works with.'} />
      )}
    </Page>
  );
}
