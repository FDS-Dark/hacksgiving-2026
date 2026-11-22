import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { Card } from '@/components/staff/kit';
import { ErrorBanner, Loading } from '@/components/ui';
import { REQUIRED_MODULES, TRAINING_MODULES } from '@/lib/training';
import { useTrainingProgress } from '@/services/training';
import { radius, space, type, useTheme } from '@/theme/tokens';

/** T1: the worker training course, with saved progress and "ready for the field". */
export default function TrainingScreen() {
  const theme = useTheme();
  const progress = useTrainingProgress();
  const done = new Set(progress.data?.completed.map((c) => c.module_id) ?? []);
  const doneCount = TRAINING_MODULES.filter((m) => done.has(m.id)).length;
  const requiredLeft = REQUIRED_MODULES.filter((m) => !done.has(m.id)).length;
  const next = TRAINING_MODULES.find((m) => m.required && !done.has(m.id)) ?? TRAINING_MODULES.find((m) => !done.has(m.id));

  return (
    <Page refreshing={progress.isRefetching} onRefresh={() => progress.refetch()} contentStyle={{ maxWidth: 720, gap: space.lg }}>
      <BackLink label="Me" fallback="/staff/me" />
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          Training
        </Text>
        <Text style={[type.subhead, { color: theme.textSecondary }]}>Everything you need before and between shifts.</Text>
      </View>

      {progress.isPending ? (
        <Loading label="Loading your progress" />
      ) : progress.error ? (
        <ErrorBanner error={progress.error} onRetry={() => progress.refetch()} />
      ) : (
        <>
          <Card style={{ gap: space.md }}>
            <View style={styles.progressHead}>
              <Text style={[type.headline, { color: theme.text }]}>
                {doneCount} of {TRAINING_MODULES.length} modules done
              </Text>
              <Text style={[type.footnote, { color: requiredLeft ? theme.textSecondary : theme.accent, fontWeight: '700' }]}>
                {requiredLeft ? `${requiredLeft} required left` : 'Ready for the field'}
              </Text>
            </View>
            <View
              style={[styles.track, { backgroundColor: theme.fill }]}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: TRAINING_MODULES.length, now: doneCount }}
            >
              <View style={[styles.bar, { backgroundColor: theme.accent, width: `${(doneCount / TRAINING_MODULES.length) * 100}%` }]} />
            </View>
            {next ? (
              <Pressable onPress={() => router.push({ pathname: '/staff/training/[id]', params: { id: next.id } })} accessibilityRole="button">
                <Text style={[type.footnote, { color: theme.accent, fontWeight: '700' }]}>Next up: {next.title} ›</Text>
              </Pressable>
            ) : null}
          </Card>

          <View style={[styles.list, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
            {TRAINING_MODULES.map((m, i) => {
              const finished = done.has(m.id);
              return (
                <Pressable
                  key={m.id}
                  onPress={() => router.push({ pathname: '/staff/training/[id]', params: { id: m.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Module ${i + 1}: ${m.title}, ${m.minutes} minutes${m.required ? ', required' : ''}${finished ? ', done' : ''}`}
                  style={({ pressed }) => [styles.row, i > 0 && { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { opacity: 0.7 }]}
                >
                  <View style={[styles.badge, { backgroundColor: finished ? theme.accent : theme.accentSoft }]}>
                    <Ionicons name={finished ? 'checkmark' : m.icon} size={20} color={finished ? theme.onAccent : theme.accent} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[type.subhead, { color: theme.text, fontWeight: '700' }]}>
                      {i + 1}. {m.title}
                    </Text>
                    <Text style={[type.caption, { color: theme.textSecondary }]}>
                      {m.minutes} min · {m.required ? 'Required' : 'Optional'}
                      {finished ? ' · Done' : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800' },
  progressHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.sm },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
  list: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  badge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
