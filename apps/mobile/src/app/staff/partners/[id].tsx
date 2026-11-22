import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { Badge, Card, PageTitle } from '@/components/staff/kit';
import { Button, ErrorBanner, Group, Loading, Row } from '@/components/ui';
import { CATEGORY_LABEL } from '@/lib/cases';
import { callPhone } from '@/lib/phone';
import { usePartner } from '@/services/partners';
import { space, type, useTheme } from '@/theme/tokens';

/** A partner: how to reach them, what they take, and staff notes. */
export default function PartnerScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const partner = usePartner(id);

  if (partner.isPending) return <Loading label="Loading partner" />;
  if (partner.error) {
    return (
      <Page>
        <BackLink label="Partners" fallback="/staff/partners" />
        <ErrorBanner error={partner.error} onRetry={() => partner.refetch()} />
      </Page>
    );
  }
  const p = partner.data;
  const website = p.website ? (p.website.startsWith('http') ? p.website : `https://${p.website}`) : null;

  return (
    <Page refreshing={partner.isRefetching} onRefresh={() => partner.refetch()} contentStyle={{ maxWidth: 720, gap: space.md }}>
      <BackLink label="Partners" fallback="/staff/partners" />
      <PageTitle title={p.name} subtitle={p.active ? undefined : 'Inactive'} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {p.accepts_shares ? <Badge label="Accepts shared cases" color={theme.accent} icon="shield-checkmark-outline" /> : <Badge label="No sharing agreement" color={theme.textSecondary} />}
        {p.categories.map((c) => (
          <Badge key={c} label={CATEGORY_LABEL[c]} color={theme.info} />
        ))}
      </View>
      {p.description ? <Text style={[type.body, { color: theme.text }]}>{p.description}</Text> : null}

      <Group header="Contact">
        {p.contact_name ? <Row title={p.contact_name} icon="person-outline" /> : null}
        {p.phone ? <Row title={p.phone} icon="call-outline" accessory="chevron" onPress={() => callPhone(p.phone!)} /> : null}
        {p.email ? <Row title={p.email} icon="mail-outline" accessory="chevron" onPress={() => Linking.openURL(`mailto:${p.email}`)} /> : null}
        {website ? <Row title={p.website!} icon="globe-outline" accessory="chevron" onPress={() => Linking.openURL(website)} /> : null}
        {p.address ? <Row title={p.address} icon="location-outline" /> : null}
        {p.languages.length ? <Row title="Languages" detail={p.languages.join(', ')} icon="language-outline" /> : null}
      </Group>

      {p.notes ? (
        <Card style={{ gap: 4 }}>
          <Text style={[type.footnote, { color: theme.textSecondary, fontWeight: '600' }]}>Staff notes</Text>
          <Text style={[type.body, { color: theme.text }]}>{p.notes}</Text>
        </Card>
      ) : null}

      <Button label="Edit" icon="create-outline" variant="tinted" onPress={() => router.push({ pathname: '/staff/partners/edit', params: { id: p.id } })} />
    </Page>
  );
}
