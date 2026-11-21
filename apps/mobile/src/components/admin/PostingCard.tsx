import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { RedRule } from '@/components/brand';
import type { IconName } from '@/components/ui';
import { payLabel, whenLabel, type Posting } from '@/lib/opportunities';
import { radius, space, useTheme } from '@/theme/tokens';

/** A posting as a resident would see it in the Opportunities list. */
export function PostingCard({ posting: p }: { posting: Posting }) {
  const theme = useTheme();
  const isJob = p.kind === 'job';
  const facts: { icon: IconName; text: string }[] = [];
  const pay = payLabel(p);
  if (pay) facts.push({ icon: 'cash-outline', text: pay });
  if (isJob && p.employmentType) facts.push({ icon: 'time-outline', text: p.employmentType });
  const where = p.setting === 'Remote' ? 'Remote' : p.neighborhood || p.address;
  if (where) facts.push({ icon: 'location-outline', text: where });
  const when = whenLabel(p);
  if (when) facts.push({ icon: 'calendar-outline', text: when });
  if (p.days.length || p.hours) facts.push({ icon: 'alarm-outline', text: [p.days.join(', '), p.hours].filter(Boolean).join(' · ') });
  if (!isJob && p.spots) facts.push({ icon: 'people-outline', text: `${p.spots} volunteers needed` });

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator, boxShadow: theme.shadow }]}>
      <View style={[styles.tag, { backgroundColor: isJob ? theme.accentSoft : theme.warningSoft }]}>
        <Ionicons name={isJob ? 'briefcase' : 'hand-left'} size={13} color={isJob ? theme.accent : theme.soon} />
        <Text style={[styles.tagText, { color: isJob ? theme.accent : theme.soon }]}>{isJob ? 'Job' : 'Volunteer'}</Text>
      </View>
      <Text style={[styles.title, { color: theme.text }]}>{p.title || 'Untitled posting'}</Text>
      <Text style={[styles.org, { color: theme.textSecondary }]}>
        {[p.organization, p.category].filter(Boolean).join(' · ')}
      </Text>
      {p.summary ? <Text style={[styles.summary, { color: theme.text }]}>{p.summary}</Text> : null}
      <RedRule width={26} />
      <View style={{ gap: space.xs }}>
        {facts.map((f) => (
          <View key={f.icon} style={styles.fact}>
            <Ionicons name={f.icon} size={16} color={theme.accent} />
            <Text style={[styles.factText, { color: theme.textSecondary }]}>{f.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.xl, borderWidth: 1, borderRadius: radius.md },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  title: { fontSize: 20, fontWeight: '800' },
  org: { fontSize: 14, fontWeight: '600' },
  summary: { fontSize: 15, lineHeight: 22 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  factText: { fontSize: 14, flex: 1 },
});
