import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { Badge, Card } from '@/components/staff/kit';
import { Button, EmptyState, ErrorBanner, success } from '@/components/ui';
import { TRAINING_MODULES } from '@/lib/training';
import { useSetModuleDone, useTrainingProgress } from '@/services/training';
import { space, type, useTheme } from '@/theme/tokens';

/** T2: one lesson. Read the points, mark it done, go to the next one. */
export default function LessonScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const progress = useTrainingProgress();
  const setDone = useSetModuleDone();
  const index = TRAINING_MODULES.findIndex((m) => m.id === id);
  const lesson = TRAINING_MODULES[index];

  if (!lesson) {
    return (
      <Page>
        <BackLink label="Training" fallback="/staff/training" />
        <EmptyState icon="school-outline" title="Lesson not found" body="It may have been renamed. Pick one from the course." />
      </Page>
    );
  }

  const done = progress.data?.completed.some((c) => c.module_id === lesson.id) ?? false;
  const next = TRAINING_MODULES.slice(index + 1).find((m) => !progress.data?.completed.some((c) => c.module_id === m.id));

  const complete = () =>
    setDone.mutate(
      { moduleId: lesson.id, done: true },
      {
        onSuccess: () => {
          success();
          if (next) router.replace({ pathname: '/staff/training/[id]', params: { id: next.id } });
          else router.replace('/staff/training');
        },
      },
    );

  return (
    <Page contentStyle={{ maxWidth: 720, gap: space.lg }}>
      <BackLink label="Training" fallback="/staff/training" />
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: theme.accentSoft }]}>
          <Ionicons name={lesson.icon} size={26} color={theme.accent} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[type.caption, { color: theme.textSecondary, fontWeight: '700' }]}>
            MODULE {index + 1} OF {TRAINING_MODULES.length} · {lesson.minutes} MIN
          </Text>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
            {lesson.title}
          </Text>
        </View>
      </View>
      <View style={styles.badges}>
        <Badge label={lesson.required ? 'Required' : 'Optional'} color={lesson.required ? theme.accent : theme.textSecondary} />
        {done ? <Badge label="Done" color={theme.accent} icon="checkmark" /> : null}
      </View>

      <Text style={[type.body, { color: theme.textSecondary }]}>{lesson.summary}</Text>

      <Card style={{ gap: space.md }}>
        {lesson.points.map((point, i) => (
          <View key={point} style={styles.point}>
            <Text style={[styles.number, { color: theme.accent }]}>{i + 1}</Text>
            <Text style={[type.body, { color: theme.text, flex: 1 }]}>{point}</Text>
          </View>
        ))}
      </Card>

      {setDone.error ? <ErrorBanner error={setDone.error} /> : null}
      {done ? (
        <>
          {next ? (
            <Button label={`Next: ${next.title}`} icon="arrow-forward" size="lg" onPress={() => router.replace({ pathname: '/staff/training/[id]', params: { id: next.id } })} />
          ) : null}
          <Button label="Mark as not done" variant="plain" loading={setDone.isPending} onPress={() => setDone.mutate({ moduleId: lesson.id, done: false })} />
        </>
      ) : (
        <Button label="Mark as done" icon="checkmark-circle-outline" size="lg" loading={setDone.isPending} onPress={complete} />
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '800' },
  badges: { flexDirection: 'row', gap: 6 },
  point: { flexDirection: 'row', gap: space.md },
  number: { fontSize: 17, fontWeight: '800', width: 20 },
});
