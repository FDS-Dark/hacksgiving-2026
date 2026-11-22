import { useState } from 'react';
import { Linking, Share, StyleSheet, Text, View } from 'react-native';

import { CASE_CATEGORIES, type Case, type CaseCategory, type PartnerRequest, type SentPartnerRequest } from '@/api/types';
import { Card, CardTitle, ChoiceRow } from '@/components/staff/kit';
import { Button, ErrorBanner, Field, Group, Notice, Row, Sheet, success } from '@/components/ui';
import { CATEGORY_LABEL } from '@/lib/cases';
import { dateTime } from '@/lib/format';
import { shareMailto, smsLink, usePartnerRequests, usePartners, useRequestPartnerHelp } from '@/services/partners';
import { space, type, useTheme } from '@/theme/tokens';

const STATUS_WORDS: Record<PartnerRequest['status'], string> = {
  pending: 'texting now',
  sent: 'texted',
  failed: 'text failed',
  composed: 'sent from your phone or email',
};

/**
 * A case's requests for help to partners: who asked which partner for what,
 * and "Request help from a partner". Partners have no accounts, so the
 * request is texted (when texts are set up and the partner has a number) or
 * handed to the worker's own email or Messages.
 */
export function PartnerRequests({ item }: { item: Case }) {
  const theme = useTheme();
  const requests = usePartnerRequests(item.id);
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ gap: space.sm }}>
      <CardTitle title="Requests to partners" icon="paper-plane-outline" />
      {requests.isPending ? (
        <Text style={[type.footnote, { color: theme.textSecondary }]}>Loading requests…</Text>
      ) : !requests.data ? (
        <ErrorBanner error={requests.error} onRetry={() => requests.refetch()} />
      ) : requests.data.length ? (
        requests.data.map((r) => (
          <View key={r.id} style={[styles.line, { borderTopColor: theme.separator }]}>
            <Text style={[type.subhead, { color: theme.text, fontWeight: '600' }]}>
              {r.partner_name} · {CATEGORY_LABEL[r.need]}
            </Text>
            <Text style={[type.caption, { color: theme.textSecondary }]}>
              {r.requested_by_name ?? 'Staff'}, {dateTime(r.created_at)} · {STATUS_WORDS[r.status]}
              {r.included_contact ? ' · with name and phone (consented share)' : ''}
            </Text>
            <Text style={[type.footnote, { color: theme.text }]}>{r.note}</Text>
          </View>
        ))
      ) : (
        <Text style={[type.footnote, { color: theme.textSecondary }]}>No partner has been asked for help on this case yet.</Text>
      )}
      <Button label="Request help from a partner" icon="paper-plane-outline" variant="tinted" onPress={() => setOpen(true)} />
      <RequestSheet item={item} visible={open} onClose={() => setOpen(false)} />
    </Card>
  );
}

function RequestSheet({ item, visible, onClose }: { item: Case; visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const partners = usePartners('', null);
  const ask = useRequestPartnerHelp(item.id);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [need, setNeed] = useState<CaseCategory>(item.category);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<SentPartnerRequest | null>(null);

  // Active partners; those taking this kind of case first.
  const active = (partners.data ?? [])
    .filter((p) => p.active)
    .sort((a, b) => Number(b.categories.includes(need)) - Number(a.categories.includes(need)));
  const close = () => {
    setSent(null);
    setPartnerId(null);
    setNeed(item.category);
    setNote('');
    ask.reset();
    onClose();
  };
  const submit = () =>
    partnerId &&
    ask.mutate(
      { partner_id: partnerId, need, note: note.trim() },
      {
        onSuccess: (result) => {
          success();
          setSent(result);
        },
      },
    );

  if (sent) {
    const r = sent.request;
    return (
      <Sheet
        visible={visible}
        onClose={close}
        title={`Asked ${r.partner_name}`}
        subtitle={r.delivery === 'sms' ? 'It’s on the case’s history. We’re texting them now.' : 'It’s on the case’s history. Now send it from your phone.'}
      >
        <Card>
          <Text style={[type.footnote, { color: theme.text }]} selectable>
            {sent.message}
          </Text>
        </Card>
        {r.delivery === 'compose' ? (
          <>
            {r.partner_email ? (
              <Button label={`Email ${r.partner_email}`} icon="mail-outline" onPress={() => Linking.openURL(shareMailto(r.partner_email!, sent.subject, sent.message))} />
            ) : null}
            {r.partner_phone ? (
              <Button label={`Text ${r.partner_phone}`} icon="chatbubble-outline" variant={r.partner_email ? 'tinted' : 'filled'} onPress={() => Linking.openURL(smsLink(r.partner_phone!, sent.message))} />
            ) : null}
            <Button label="Send another way" icon="share-outline" variant="plain" onPress={() => Share.share({ title: sent.subject, message: sent.message })} />
          </>
        ) : null}
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={close} title="Request help from a partner" dismissLabel="Cancel">
      {partners.isPending ? (
        <Text style={[type.footnote, { color: theme.textSecondary }]}>Loading partners…</Text>
      ) : !partners.data ? (
        <ErrorBanner error={partners.error} onRetry={() => partners.refetch()} />
      ) : active.length ? (
        <Group header="Partner">
          {active.map((p) => (
            <Row
              key={p.id}
              title={p.name}
              subtitle={[p.categories.includes(need) ? 'Takes this kind of case' : null, p.phone ? 'Text' : p.email ? 'Email' : 'No phone or email on file']
                .filter(Boolean)
                .join(' · ')}
              icon={partnerId === p.id ? 'checkmark-circle' : 'ellipse-outline'}
              onPress={() => setPartnerId(p.id)}
              accessibilityLabel={`${p.name}${partnerId === p.id ? ', selected' : ''}`}
            />
          ))}
        </Group>
      ) : (
        <Text style={[type.footnote, { color: theme.textSecondary }]}>No partners yet. Add them under Me &gt; Partners.</Text>
      )}
      <ChoiceRow label="What's needed" options={CASE_CATEGORIES} labels={CATEGORY_LABEL} value={need} onChange={(c) => setNeed(c ?? item.category)} />
      <Field label="Your message *" value={note} onChangeText={setNote} placeholder="Do you have a family bed tonight?" multiline maxLength={1000} />
      <Notice icon="lock-closed-outline">
        They get the need, your message, the case number and your name. The person’s name and phone go only if this case is shared with them, with consent.
      </Notice>
      {ask.error ? <ErrorBanner error={ask.error} /> : null}
      <Button label="Send request" size="lg" loading={ask.isPending} disabled={!partnerId || !note.trim()} onPress={submit} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  line: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, gap: 2 },
});
