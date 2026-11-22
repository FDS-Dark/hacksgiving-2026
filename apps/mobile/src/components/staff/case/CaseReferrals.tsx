import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { REFERRAL_STATUSES, type Case, type DeliveredBy, type Referral } from '@/api/types';
import { ResourcePicker } from '@/components/staff/ResourcePicker';
import { Card, CardTitle, ChoiceRow, SampleBadge, referralColor } from '@/components/staff/kit';
import { Button, ErrorBanner, Field } from '@/components/ui';
import { CATEGORY_ICON, REFERRAL_LABEL, deliveredLine } from '@/lib/cases';
import { useUpdateReferral } from '@/services/cases';
import { space, type, useTheme } from '@/theme/tokens';

/** Completing a referral records who delivered the help: its provider by default, or ComForce. */
const DELIVERED_BY = ['provider', 'comforce'] as const satisfies readonly DeliveredBy[];

/** The case's Referrals tab: resources it's connected to, each with a status and an outcome. */
export function CaseReferrals({ item: c, referrals }: { item: Case; referrals: Referral[] }) {
  const theme = useTheme();
  const [picking, setPicking] = useState(false);
  const open = referrals.filter((r) => r.status !== 'completed' && r.status !== 'declined').length;
  return (
    <Card>
      <CardTitle title="Resources & referrals" icon="link-outline" right={<Button label="Add" icon="add" variant="plain" onPress={() => setPicking(true)} />} />
      {referrals.length ? (
        <>
          <Text style={[type.footnote, { color: theme.textSecondary }]}>
            {open ? `${open} referral${open === 1 ? '' : 's'} still in progress.` : 'Every referral has an outcome.'}
          </Text>
          {referrals.map((r) => <ReferralItem key={r.id} caseId={c.id} referral={r} />)}
        </>
      ) : (
        <View style={{ gap: space.sm }}>
          <Text style={[type.subhead, { color: theme.textSecondary }]}>No resources connected yet.</Text>
          <Button label="Find a resource" icon="search" variant="tinted" onPress={() => setPicking(true)} />
        </View>
      )}
      <ResourcePicker visible={picking} onClose={() => setPicking(false)} item={c} referred={referrals.map((r) => r.resource_id)} />
    </Card>
  );
}

function ReferralItem({ caseId, referral: r }: { caseId: string; referral: Referral }) {
  const theme = useTheme();
  const update = useUpdateReferral(caseId);
  const [outcome, setOutcome] = useState('');
  const delivered = deliveredLine(r);
  return (
    <View style={[styles.referral, { borderColor: theme.separator }]}>
      <View style={styles.badges}>
        <Ionicons name={CATEGORY_ICON[r.resource_category]} size={16} color={theme.accent} />
        <Text style={[type.subhead, { color: theme.text, fontWeight: '700', flexShrink: 1 }]}>{r.resource_name}</Text>
        {r.resource_is_sample ? <SampleBadge /> : null}
      </View>
      {r.resource_phone ? <Text style={[type.footnote, { color: theme.textSecondary }]} selectable>{r.resource_phone}</Text> : null}
      <ChoiceRow options={REFERRAL_STATUSES} labels={REFERRAL_LABEL} value={r.status} disabled={update.isPending}
        colorOf={(s) => referralColor(theme, s)}
        onChange={(s) => s && s !== r.status && update.mutate({ referralId: r.id, body: { status: s } })} />
      {r.status === 'completed' ? (
        <View style={{ gap: 6 }}>
          {delivered ? (
            <Text style={[type.footnote, { color: theme.text, fontWeight: '600' }]} accessibilityRole="text">
              {delivered}
            </Text>
          ) : null}
          <ChoiceRow
            label="Who delivered the help"
            options={DELIVERED_BY}
            labels={{ provider: r.resource_name, comforce: 'ComForce (me)' }}
            value={r.delivered_by ?? null}
            disabled={update.isPending}
            onChange={(by) => by && by !== r.delivered_by && update.mutate({ referralId: r.id, body: { delivered_by: by } })}
          />
        </View>
      ) : null}
      {r.outcome ? (
        <Text style={[type.footnote, { color: theme.text }]}>
          <Text style={{ fontWeight: '700' }}>Outcome: </Text>
          {r.outcome}
        </Text>
      ) : null}
      <View style={styles.inlineField}>
        <View style={{ flex: 1 }}>
          <Field placeholder={r.outcome ? 'Update the outcome' : 'Record the outcome'} value={outcome} onChangeText={setOutcome} maxLength={2000} />
        </View>
        <Button label="Save" variant="tinted" disabled={!outcome.trim()} loading={update.isPending}
          onPress={() => update.mutate({ referralId: r.id, body: { outcome: outcome.trim() } }, { onSuccess: () => setOutcome('') })} />
      </View>
      {update.error ? <ErrorBanner error={update.error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  referral: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.md, gap: space.sm },
  inlineField: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
