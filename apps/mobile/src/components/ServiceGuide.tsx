import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { CaseCategory } from '@/api/types';
import { PLAYBOOKS, PLAYBOOKS_CHECKED_ON, type Contact } from '@/lib/playbooks';
import { SERVICE_INFO } from '@/lib/requests';
import { radius, space, useTheme } from '@/theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * The handling guide for one ComForce service: a header that opens and
 * closes, then urgent checks, questions, steps, cautions and contacts.
 */
export function ServiceGuide({ category, initiallyOpen = false }: { category: CaseCategory; initiallyOpen?: boolean }) {
  const theme = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  const guide = PLAYBOOKS[category];
  const service = SERVICE_INFO[category];

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.accent }]}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`How to handle ${service.label} requests`}
        style={({ pressed }) => [styles.header, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="book" size={20} color={theme.accent} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.text }]}>How to handle {service.label}</Text>
          <Text style={[styles.small, { color: theme.textSecondary }]}>{guide.summary}</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={theme.textSecondary} />
      </Pressable>

      {open ? (
        <View style={{ gap: space.lg }}>
          <View style={[styles.urgent, { backgroundColor: theme.dangerSoft, borderLeftColor: theme.danger }]}>
            <Text style={[styles.sectionTitle, { color: theme.danger }]}>Escalate right away if</Text>
            {guide.urgentIf.map((line) => (
              <Bullet key={line} icon="warning" color={theme.danger} text={line} />
            ))}
          </View>

          <Section title="Ask">
            {guide.ask.map((line) => (
              <Bullet key={line} icon="help-circle-outline" color={theme.accent} text={line} />
            ))}
          </Section>

          <Section title="Steps">
            {guide.steps.map((line, i) => (
              <View key={line} style={styles.bullet}>
                <View style={[styles.stepNo, { backgroundColor: theme.accent }]}>
                  <Text style={{ color: theme.onAccent, fontSize: 12, fontWeight: '900' }}>{i + 1}</Text>
                </View>
                <Text style={[styles.text, { color: theme.text }]}>{line}</Text>
              </View>
            ))}
          </Section>

          <Section title="Avoid">
            {guide.avoid.map((line) => (
              <Bullet key={line} icon="close-circle-outline" color={theme.soon} text={line} />
            ))}
          </Section>

          <Section title="Contacts and resources">
            {guide.contacts.map((c) => (
              <ContactRow key={c.name} contact={c} />
            ))}
          </Section>

          <Text style={[styles.small, { color: theme.textTertiary }]}>
            Draft guidance for ComForce staff. Numbers and links checked {PLAYBOOKS_CHECKED_ON}; confirm with a lead when unsure.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Bullet({ icon, color, text }: { icon: IconName; color: string; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.bullet}>
      <Ionicons name={icon} size={18} color={color} style={{ marginTop: 1 }} />
      <Text style={[styles.text, { color: theme.text }]}>{text}</Text>
    </View>
  );
}

function ContactRow({ contact }: { contact: Contact }) {
  const theme = useTheme();
  const open = (url: string) => Linking.openURL(url).catch(() => undefined);
  return (
    <View style={[styles.contact, { backgroundColor: theme.fill }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.contactName, { color: theme.text }]}>{contact.name}</Text>
        <Text style={[styles.small, { color: theme.textSecondary }]}>{contact.detail}</Text>
      </View>
      <View style={styles.contactActions}>
        {contact.phone ? (
          <LinkPill icon="call" label={contact.phone} onPress={() => open(`tel:${contact.phone!.replace(/[^\d+]/g, '')}`)} />
        ) : null}
        {contact.url ? <LinkPill icon="open-outline" label="Website" onPress={() => open(contact.url!)} /> : null}
      </View>
    </View>
  );
}

function LinkPill({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.pill, { backgroundColor: theme.surface, borderColor: theme.accent }, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={14} color={theme.accent} />
      <Text style={[styles.pillText, { color: theme.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg, padding: space.lg, borderWidth: 1.5, borderRadius: radius.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { fontSize: 17, fontWeight: '900' },
  sectionTitle: { fontSize: 13, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.4 },
  small: { fontSize: 13, lineHeight: 18 },
  text: { flex: 1, fontSize: 15, lineHeight: 21 },
  urgent: { gap: space.sm, padding: space.md, borderLeftWidth: 4, borderRadius: radius.sm },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  stepNo: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  contact: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.sm },
  contactName: { fontSize: 15, fontWeight: '800' },
  contactActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.md, paddingVertical: 6, borderWidth: 1, borderRadius: 999 },
  pillText: { fontSize: 13, fontWeight: '800' },
});
