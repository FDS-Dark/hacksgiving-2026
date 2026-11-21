import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import type { CaseCategory, PublicRequest } from '@/api/types';
import { Container, Page } from '@/components/Page';
import { Display, Green, RedRule, Ribbon, SectionHeading } from '@/components/brand';
import { StatusPill } from '@/components/StatusPill';
import { Button, ErrorBanner, Field, FieldLabel, Loading, success } from '@/components/ui';
import { PICKABLE_SERVICES, SERVICE_INFO, STATUS_INFO, formatWhen, type ServiceInfo } from '@/lib/requests';
import { useMyRequests, useSubmitRequest } from '@/services/cases';
import { useMe } from '@/services/user';
import { radius, space, useTheme } from '@/theme/tokens';

/** null = "Not sure": the API's triage picks the service. */
type Choice = CaseCategory | null;

const MAX_DESCRIPTION = 4000;

/**
 * Get Help: a community member describes what they need, optionally picks
 * the service, and it lands in the ComForce worker queue as a new case.
 * Below the form, their own requests and where each one stands.
 */
export default function HelpScreen() {
  const theme = useTheme();
  const mine = useMyRequests();
  const [sent, setSent] = useState<PublicRequest | null>(null);

  return (
    <Page bleed refreshing={mine.isRefetching} onRefresh={() => mine.refetch()}>
      <Hero />
      <Container style={styles.body}>
        <EmergencyNotice />
        {sent ? <Confirmation request={sent} onAnother={() => setSent(null)} /> : <RequestForm onSent={setSent} />}

        <View style={{ gap: space.lg, marginTop: space.xl }}>
          <SectionHeading title="Your Requests" />
          {mine.isPending ? (
            <Loading label="Loading your requests" />
          ) : mine.isError ? (
            <ErrorBanner error={mine.error} onRetry={() => mine.refetch()} />
          ) : mine.data.length === 0 ? (
            <Text style={[styles.muted, { color: theme.textTertiary }]}>Requests you send will show up here so you can follow them.</Text>
          ) : (
            mine.data.map((r) => <RequestCard key={r.id} request={r} />)
          )}
        </View>
      </Container>
    </Page>
  );
}

function Hero() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  return (
    <View style={{ backgroundColor: theme.surface, borderBottomColor: theme.separator, borderBottomWidth: StyleSheet.hairlineWidth }}>
      <Container style={styles.hero}>
        <Ribbon>We&apos;re Here For You</Ribbon>
        <Display size={width >= 900 ? 48 : 34}>
          How can we <Green>help</Green> today?
        </Display>
        <Text style={[styles.lede, { color: theme.textSecondary }]}>
          Tell us what is going on in your own words. Your request goes straight to the ComForce MKE team, and we will connect you with
          the right service.
        </Text>
      </Container>
    </View>
  );
}

function EmergencyNotice() {
  const theme = useTheme();
  const call = () => Linking.openURL('tel:911').catch(() => undefined);
  return (
    <View style={[styles.emergency, { backgroundColor: theme.dangerSoft, borderColor: theme.danger }]}>
      <Ionicons name="warning" size={22} color={theme.danger} />
      <Text style={[styles.emergencyText, { color: theme.text }]}>
        <Text style={{ fontWeight: '800' }}>In danger right now?</Text> Call 911 first. This form is not monitored as an emergency line.
      </Text>
      {Platform.OS === 'web' ? null : <Button label="Call 911" variant="destructive" onPress={call} />}
    </View>
  );
}

function RequestForm({ onSent }: { onSent: (r: PublicRequest) => void }) {
  const theme = useTheme();
  const me = useMe();
  const submit = useSubmitRequest();

  const [description, setDescription] = useState('');
  const [service, setService] = useState<Choice>(null);
  const [location, setLocation] = useState('');
  // null until they type: show the account name till then.
  const [typedName, setName] = useState<string | null>(null);
  const name = typedName ?? me.data?.display_name ?? '';
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);

  const missingDescription = description.trim().length === 0;
  const missingContact = !phone.trim() && !email.trim();

  const send = () => {
    setTouched(true);
    if (missingDescription) return;
    submit.mutate(
      {
        description: description.trim(),
        category: service,
        location: location.trim() || null,
        contact_name: name.trim() || null,
        contact_phone: phone.trim() || null,
        contact_email: email.trim() || null,
        title: null,
        latitude: null,
        longitude: null,
      },
      {
        onSuccess: (r) => {
          success();
          onSent(r);
        },
      },
    );
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator, boxShadow: theme.shadow }]}>
      <Step n={1} title="What's going on?" />
      <View style={{ gap: 6 }}>
        <TextInput
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={MAX_DESCRIPTION}
          placeholder="For example: My family was evicted yesterday and we need somewhere to stay tonight."
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.accent}
          accessibilityLabel="Describe what you need help with"
          textAlignVertical="top"
          style={[
            styles.textarea,
            { backgroundColor: theme.fill, color: theme.text, borderColor: touched && missingDescription ? theme.danger : 'transparent' },
          ]}
        />
        {touched && missingDescription ? (
          <Text style={[styles.hint, { color: theme.danger }]}>Tell us a little about what you need.</Text>
        ) : (
          <Text style={[styles.hint, { color: theme.textTertiary }]}>Share as much or as little as you are comfortable with.</Text>
        )}
      </View>

      <Step n={2} title="Which kind of help?" subtitle="Optional. Not sure? Leave it to us and we'll route it." />
      <View style={styles.services}>
        <ServiceOption
          active={service === null}
          onPress={() => setService(null)}
          icon="sparkles"
          label="Not sure"
          blurb="ComForce will route it to the right team."
        />
        {PICKABLE_SERVICES.map((c) => (
          <ServiceOption
            key={c}
            active={service === c}
            onPress={() => setService(c)}
            icon={SERVICE_INFO[c].icon}
            label={SERVICE_INFO[c].label}
            blurb={SERVICE_INFO[c].blurb}
          />
        ))}
      </View>

      <Step n={3} title="How can we reach you?" />
      <View style={{ gap: space.md }}>
        <Field label="Your name" icon="person-outline" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
        <Field
          label="Phone"
          icon="call-outline"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
        />
        <Field
          label="Email"
          icon="mail-outline"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
        />
        <Field
          label="Where are you? (neighborhood, cross streets or address)"
          icon="location-outline"
          value={location}
          onChangeText={setLocation}
        />
        {missingContact ? (
          <Text style={[styles.hint, { color: theme.textTertiary }]}>
            Without a phone or email, we can only reply here in the app.
          </Text>
        ) : null}
      </View>

      {submit.isError ? <ErrorBanner error={submit.error} /> : null}
      <Button label="Send my request" icon="send" size="lg" loading={submit.isPending} onPress={send} />
      <FieldLabel>Only ComForce MKE staff can see your request and contact details.</FieldLabel>
    </View>
  );
}

function Step({ n, title, subtitle }: { n: number; title: string; subtitle?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.step}>
      <View style={[styles.stepNumber, { backgroundColor: theme.accent }]}>
        <Text style={{ color: theme.onAccent, fontWeight: '900' }}>{n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={[styles.stepTitle, { color: theme.text }]}>
          {title}
        </Text>
        {subtitle ? <Text style={[styles.hint, { color: theme.textSecondary }]}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function ServiceOption({
  active,
  onPress,
  icon,
  label,
  blurb,
}: {
  active: boolean;
  onPress: () => void;
  icon: ServiceInfo['icon'];
  label: string;
  blurb: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      accessibilityLabel={`${label}. ${blurb}`}
      style={({ pressed }) => [
        styles.option,
        { borderColor: active ? theme.accent : theme.separator, backgroundColor: active ? theme.accentSoft : theme.surface },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Ionicons name={icon} size={22} color={theme.accent} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionLabel, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.optionBlurb, { color: theme.textSecondary }]}>{blurb}</Text>
      </View>
      <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={20} color={active ? theme.accent : theme.textTertiary} />
    </Pressable>
  );
}

function Confirmation({ request, onAnother }: { request: PublicRequest; onAnother: () => void }) {
  const theme = useTheme();
  const service = SERVICE_INFO[request.category];
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.accent, boxShadow: theme.shadow, alignItems: 'center' }]}>
      <Ionicons name="checkmark-circle" size={56} color={theme.accent} />
      <Text accessibilityRole="header" style={[styles.confirmTitle, { color: theme.text }]}>
        Request #{request.number} received
      </Text>
      <RedRule />
      <Text style={[styles.lede, { color: theme.textSecondary, textAlign: 'center' }]}>
        Thank you for reaching out. A ComForce MKE team member will follow up with you. You can check on it here any time.
      </Text>
      <View style={[styles.routed, { backgroundColor: theme.accentSoft }]}>
        <Ionicons name={service.icon} size={22} color={theme.accent} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.hint, { color: theme.textSecondary }]}>Routed to</Text>
          <Text style={[styles.optionLabel, { color: theme.text }]}>{service.label}</Text>
        </View>
      </View>
      <View style={styles.confirmActions}>
        <Button label="View request" icon="eye" onPress={() => router.navigate({ pathname: '/help/[id]', params: { id: request.id } })} />
        <Button label="Send another" variant="tinted" icon="add" onPress={onAnother} />
      </View>
    </View>
  );
}

function RequestCard({ request }: { request: PublicRequest }) {
  const theme = useTheme();
  const service = SERVICE_INFO[request.category];
  const status = STATUS_INFO[request.status];
  return (
    <Pressable
      onPress={() => router.navigate({ pathname: '/help/[id]', params: { id: request.id } })}
      accessibilityRole="link"
      accessibilityLabel={`Request ${request.number}, ${request.title}, ${status.label}`}
      style={({ pressed }) => [styles.request, { backgroundColor: theme.surface, borderColor: theme.separator }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={service.icon} size={26} color={theme.accent} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.optionLabel, { color: theme.text }]} numberOfLines={1}>
          {request.title}
        </Text>
        <Text style={[styles.hint, { color: theme.textSecondary }]}>
          #{request.number} · {service.label} · {formatWhen(request.created_at)}
        </Text>
      </View>
      <StatusPill status={request.status} />
      <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { paddingVertical: space.xxl, gap: space.lg },
  lede: { fontSize: 17, lineHeight: 26, maxWidth: 640 },
  body: { paddingTop: space.xl, gap: space.xl, maxWidth: 820 },
  muted: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  emergency: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.md, padding: space.lg, borderRadius: radius.md, borderLeftWidth: 4 },
  emergencyText: { flex: 1, minWidth: 200, fontSize: 15, lineHeight: 21 },
  card: { gap: space.lg, padding: space.xl, borderWidth: 1, borderRadius: radius.md },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  stepNumber: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontSize: 19, fontWeight: '800' },
  textarea: { minHeight: 140, padding: space.md, borderRadius: radius.sm, borderWidth: 1, fontSize: 17, lineHeight: 23 },
  hint: { fontSize: 13, lineHeight: 18 },
  services: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  option: {
    flexGrow: 1,
    flexBasis: 240,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderWidth: 1.5,
    borderRadius: radius.sm,
  },
  optionLabel: { fontSize: 16, fontWeight: '800' },
  optionBlurb: { fontSize: 13, lineHeight: 18 },
  confirmTitle: { fontSize: 26, fontWeight: '900', textAlign: 'center' },
  routed: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.sm, alignSelf: 'stretch' },
  confirmActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, justifyContent: 'center' },
  request: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderWidth: 1, borderRadius: radius.md },
});
