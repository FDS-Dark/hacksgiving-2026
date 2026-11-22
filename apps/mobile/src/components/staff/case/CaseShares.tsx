import { useState } from 'react';
import { Linking, Share, StyleSheet, Text, View } from 'react-native';

import type { Case, CaseShare, ConsentMethod, SharedCase } from '@/api/types';
import { Card, CardTitle, ChoiceRow } from '@/components/staff/kit';
import { Button, ErrorBanner, Field, Group, Row, Sheet, Toggle, success } from '@/components/ui';
import { dateTime, timeAgo } from '@/lib/format';
import { shareMailto, useCaseShares, useCaseTexts, usePartners, useRevokeShare, useShareCase } from '@/services/partners';
import { space, type, useTheme } from '@/theme/tokens';

const CONSENT_METHODS = ['verbal', 'written', 'in_app'] as const satisfies readonly ConsentMethod[];
const CONSENT_LABEL: Record<ConsentMethod, string> = { verbal: 'Told me', written: 'Signed a release', in_app: 'In the app' };
const TEXT_REASON: Record<string, string> = {
  coalesced: 'skipped: texted recently',
  invalid_number: 'skipped: not a textable number',
  opted_out: 'they replied STOP',
};

/**
 * Figma P2: who this case was shared with, with the person's consent, and
 * sharing it with a partner (only partners that accept shares). Also what
 * the requester was texted about it. The case's history records each share.
 */
export function CaseShares({ item }: { item: Case }) {
  const theme = useTheme();
  const shares = useCaseShares(item.id);
  const texts = useCaseTexts(item.id);
  const revoke = useRevokeShare(item.id);
  const [open, setOpen] = useState(false);

  return (
    <Card style={{ gap: space.sm }}>
      <CardTitle title="Shared with partners" icon="people-outline" />
      {shares.data?.length ? (
        shares.data.map((s) => <ShareLine key={s.id} share={s} onRevoke={() => revoke.mutate(s.id, { onSuccess: () => success() })} busy={revoke.isPending} />)
      ) : (
        <Text style={[type.footnote, { color: theme.textSecondary }]}>Not shared. Share only after the person agrees, and only what they agree to.</Text>
      )}
      {revoke.error ? <ErrorBanner error={revoke.error} /> : null}
      <Button label="Share with a partner" icon="share-outline" variant="tinted" onPress={() => setOpen(true)} />
      {texts.data?.length ? (
        <Text style={[type.caption, { color: theme.textSecondary }]}>
          Texts to the requester:{' '}
          {texts.data
            .slice(0, 3)
            .map((t) => `${t.status === 'sent' ? 'sent' : TEXT_REASON[t.reason ?? ''] ?? `${t.status} (${t.reason ?? 'unknown'})`} ${timeAgo(t.created_at)}`)
            .join(' · ')}
          . They only say there&apos;s an update.
        </Text>
      ) : null}
      <ShareSheet item={item} visible={open} onClose={() => setOpen(false)} />
    </Card>
  );
}

function ShareLine({ share: s, onRevoke, busy }: { share: CaseShare; onRevoke: () => void; busy: boolean }) {
  const theme = useTheme();
  const extras = [s.include_contact && 'name and phone', s.include_location && 'location'].filter(Boolean).join(' and ');
  return (
    <View style={[styles.line, { borderTopColor: theme.separator }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.subhead, { color: theme.text, fontWeight: '600', textDecorationLine: s.revoked_at ? 'line-through' : 'none' }]}>{s.partner_name}</Text>
        <Text style={[type.caption, { color: theme.textSecondary }]}>
          {s.purpose} · summary{extras ? ` and ${extras}` : ''} · consent: {CONSENT_LABEL[s.consent_method].toLowerCase()} · {s.shared_by_name ?? 'Staff'}, {dateTime(s.created_at)}
          {s.revoked_at ? ` · stopped ${dateTime(s.revoked_at)}` : ''}
        </Text>
      </View>
      {s.revoked_at ? null : <Button label="Stop" variant="plain" loading={busy} onPress={onRevoke} />}
    </View>
  );
}

function ShareSheet({ item, visible, onClose }: { item: Case; visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const partners = usePartners('', null);
  const share = useShareCase(item.id);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState('');
  const [consent, setConsent] = useState(false);
  const [method, setMethod] = useState<ConsentMethod>('verbal');
  const [note, setNote] = useState('');
  const [contact, setContact] = useState(false);
  const [location, setLocation] = useState(false);
  const [sent, setSent] = useState<SharedCase | null>(null);

  // Partners with an agreement; those taking this case's service first.
  const eligible = (partners.data ?? [])
    .filter((p) => p.accepts_shares && p.active)
    .sort((a, b) => Number(b.categories.includes(item.category)) - Number(a.categories.includes(item.category)));
  const close = () => {
    setSent(null);
    setPartnerId(null);
    setPurpose('');
    setConsent(false);
    setNote('');
    setContact(false);
    setLocation(false);
    share.reset();
    onClose();
  };
  const submit = () =>
    partnerId &&
    share.mutate(
      { partner_id: partnerId, purpose: purpose.trim(), consent, consent_method: method, consent_note: note.trim() || null, include_contact: contact, include_location: location },
      {
        onSuccess: (result) => {
          success();
          setSent(result);
        },
      },
    );

  if (sent) {
    const email = sent.share.partner_email;
    return (
      <Sheet visible={visible} onClose={close} title={`Shared with ${sent.share.partner_name}`} subtitle="It's on the case's history. Now send them the details.">
        <Card>
          <Text style={[type.footnote, { color: theme.text }]} selectable>
            {sent.message}
          </Text>
        </Card>
        {email ? <Button label={`Email ${email}`} icon="mail-outline" onPress={() => Linking.openURL(shareMailto(email, sent.subject, sent.message))} /> : null}
        <Button label="Send another way" icon="share-outline" variant="tinted" onPress={() => Share.share({ title: sent.subject, message: sent.message })} />
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={close} title="Share with a partner" dismissLabel="Cancel">
      {eligible.length ? (
        <Group header="Partner">
          {eligible.map((p) => (
            <Row
              key={p.id}
              title={p.name}
              subtitle={p.categories.includes(item.category) ? 'Takes this kind of case' : null}
              icon={partnerId === p.id ? 'checkmark-circle' : 'ellipse-outline'}
              onPress={() => setPartnerId(p.id)}
              accessibilityLabel={`${p.name}${partnerId === p.id ? ', selected' : ''}`}
            />
          ))}
        </Group>
      ) : (
        <Text style={[type.footnote, { color: theme.textSecondary }]}>No partner has a sharing agreement yet. Mark one under Me &gt; Partners.</Text>
      )}
      <Field label="Why you're sharing *" value={purpose} onChangeText={setPurpose} placeholder="Intake for a family bed tonight" maxLength={500} />
      <Group header="What to include" footer="The summary is always included. Add more only if the person agreed to it.">
        <Row title="Name and phone number" right={<Toggle label="Include name and phone" value={contact} onChange={setContact} />} />
        <Row title="Location" right={<Toggle label="Include location" value={location} onChange={setLocation} />} />
      </Group>
      <Group header="Consent">
        <Row title="The person agreed to this share" right={<Toggle label="The person agreed" value={consent} onChange={setConsent} />} />
      </Group>
      {consent ? (
        <>
          <ChoiceRow label="How they agreed" options={CONSENT_METHODS} value={method} onChange={(m) => setMethod(m ?? 'verbal')} labels={CONSENT_LABEL} />
          <Field label="Who agreed, and any limits" value={note} onChangeText={setNote} placeholder="Dana, by phone; only for housing" maxLength={500} />
        </>
      ) : null}
      {share.error ? <ErrorBanner error={share.error} /> : null}
      <Button label="Share" size="lg" loading={share.isPending} disabled={!partnerId || !purpose.trim() || !consent} onPress={submit} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm },
});
